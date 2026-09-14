// clouded — web client.
//
// Phase A: sign in, list what you can see.
// Phase B: rate your skills, which is what distance is measured against.
// Phase C: sort by distance, filter, and show which skill unlocks the most.
//
// classify / distanceOf / sortKey / leverage come from extraction/src/
// distance.js, the same module the Node report uses, served through a mount in
// serve.mjs rather than copied here. See docs/refactor-extraction-core.md.

import {
  classify, compareKeys, cruxOf, cruxStatus, distanceOf, leverage, sortKey
} from "/extraction/src/distance.js";
import {
  addIdea, amCurator, capabilities, db, ideas, mySkills, promoteSkill, proposedSkills,
  rejectSkill, session, setSkillLevel, signIn, signOut, skills
} from "./lib/db.js";
import { el, mount } from "./lib/dom.js";

const LEVELS = ["none", "some", "solid"];
const MARK = { have: "[x]", partial: "[~]", gap: "[ ]", proposed: "[?]" };

const app = document.getElementById("app");
const state = {
  session: null,
  route: currentRoute(),
  ideas: [],
  caps: [],
  skills: [],          // 51 rows, seeded by migration, cached after first load
  levels: new Map(),   // skill_id -> none | some | solid
  filters: { domain: "", crux: "", proposed: false },
  curator: null,       // null = not yet checked
  proposals: [],
  error: null,
  busy: false
};

const ROUTES = new Set(["profile", "review"]);
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  return ROUTES.has(h) ? h : "list";
}

const skillName = (id) => state.skills.find((s) => s.id === id)?.name ?? id;

// An "extraction" as distance.js expects it, assembled from the two tables.
function extractionOf(idea, capsById) {
  return { clear: idea.is_clear === true, capabilities: capsById.get(idea.id) ?? [] };
}

function header() {
  const tab = (href, label, route) =>
    el("a", { href, class: state.route === route ? "tab on" : "tab" }, label);
  return el("header", {},
    el("h1", {}, "clouded"),
    el("nav", {},
      tab("#/", "Ideas", "list"),
      tab("#/profile", "Profile", "profile"),
      // only a curator sees this; the policy enforces it regardless
      state.curator === true && tab("#/review", "Review", "review"),
      el("button", { class: "link", onclick: () => run(signOut) }, "Sign out")
    )
  );
}

// ---------------------------------------------------------------- sign in

function signInView() {
  const form = el("form", {
    class: "card",
    onsubmit: (e) => {
      e.preventDefault();
      run(() => signIn(form.elements.email.value.trim(), form.elements.password.value));
    }
  },
    el("h1", {}, "clouded"),
    el("p", { class: "muted" },
      "How far each idea is from something you could actually build."),
    el("label", {}, "Email",
      el("input", { name: "email", type: "email", required: true, autocomplete: "username" })),
    el("label", {}, "Password",
      el("input", { name: "password", type: "password", required: true, autocomplete: "current-password" })),
    el("button", { type: "submit", disabled: state.busy }, state.busy ? "Signing in…" : "Sign in"),
    state.error && el("p", { class: "error" }, state.error)
  );
  return form;
}

// ---------------------------------------------------------------- list

function capLabel(cap) {
  return cap.skill_id ? skillName(cap.skill_id) : `${cap.proposed_key} (proposed)`;
}

function ideaRow({ idea, extraction }) {
  const held = state.levels;
  const d = distanceOf(extraction, held);
  const crux = cruxOf(extraction);
  const cruxClass = crux ? classify(crux, held) : null;
  const anyProposed = extraction.capabilities.some((c) => !c.skill_id);
  const title = idea.objective || idea.raw;

  const counts = d && [
    `${d.gap} short`,
    d.partial ? `${d.partial} partial` : null,
    d.have ? `${d.have} held` : null
  ].filter(Boolean).join(" · ");

  return el("li", { class: "idea" },
    el("div", { class: "idea-head" },
      el("div", { class: "idea-title" }, title),
      d && el("span", { class: "counts" }, counts)
    ),
    title !== idea.raw && el("div", { class: "idea-raw" }, idea.raw),

    crux && el("div", { class: `crux ${cruxClass}` },
      el("span", { class: "mark" }, MARK[cruxClass]),
      el("span", { class: "crux-label" }, capLabel(crux)),
      el("span", { class: "crux-tag" }, "the hard part")
    ),

    el("div", { class: "meta" },
      idea.domain && el("span", { class: "tag" }, idea.domain),
      anyProposed && el("span", { class: "tag warn" }, "proposed skill"),
      idea.status !== "extracted" && el("span", { class: "tag warn" }, idea.status),
      idea.shared_to && el("span", { class: "tag" }, "shared")
    ),

    // the rest of the capabilities, crux first already shown above
    el("ul", { class: "caps" },
      extraction.capabilities.filter((c) => c !== crux).map((c) => {
        const k = classify(c, held);
        return el("li", { class: k },
          el("span", { class: "mark" }, MARK[k]),
          el("span", {}, capLabel(c))
        );
      })
    )
  );
}

function vagueRow(idea) {
  return el("li", { class: "idea vague" },
    el("div", { class: "idea-title" }, idea.raw),
    idea.clarifying_question && el("p", { class: "question" }, idea.clarifying_question)
  );
}

function filterBar(domains) {
  const set = (k, v) => { state.filters[k] = v; render(); };
  return el("div", { class: "filters" },
    el("select", { onchange: (e) => set("domain", e.target.value) },
      el("option", { value: "", selected: state.filters.domain === "" }, "any domain"),
      domains.map((d) => el("option", { value: d, selected: state.filters.domain === d }, d))
    ),
    el("select", { onchange: (e) => set("crux", e.target.value) },
      [["", "any crux"], ["have", "crux held"], ["partial", "crux partial"], ["gap", "crux is a gap"]]
        .map(([v, label]) => el("option", { value: v, selected: state.filters.crux === v }, label))
    ),
    el("label", { class: "check" },
      el("input", {
        type: "checkbox",
        checked: state.filters.proposed,
        onchange: (e) => set("proposed", e.target.checked)
      }),
      el("span", {}, "has a proposed skill")
    ),
    (state.filters.domain || state.filters.crux || state.filters.proposed) &&
      el("button", { class: "link", onclick: () => { state.filters = { domain: "", crux: "", proposed: false }; render(); } }, "clear")
  );
}

function leveragePanel(items) {
  const top = leverage(items, state.levels).slice(0, 10);
  return el("aside", { class: "leverage" },
    el("h2", {}, "Highest leverage"),
    el("p", { class: "muted" }, "Learn this, and this many ideas move."),
    el("ol", {}, top.map((e) => el("li", {},
      el("span", { class: "n" }, String(e.ideaIds.length)),
      el("span", {}, e.skillId ? skillName(e.skillId) : `${e.proposedName} (proposed)`)
    ))),
    !top.length && el("p", { class: "muted" }, "Nothing to learn — every capability is held.")
  );
}

function listView() {
  const capsById = new Map();
  for (const c of state.caps) {
    if (!capsById.has(c.idea_id)) capsById.set(c.idea_id, []);
    capsById.get(c.idea_id).push(c);
  }

  const rows = state.ideas.map((idea) => ({ idea, extraction: extractionOf(idea, capsById) }));
  const clear = rows.filter((r) => r.idea.is_clear === true);
  const vague = rows.filter((r) => r.idea.is_clear !== true);

  // crux status first, then gaps, then partials, then title for a stable order
  clear.sort((a, b) =>
    compareKeys(sortKey(a.extraction, state.levels), sortKey(b.extraction, state.levels)) ||
    (a.idea.objective || a.idea.raw).localeCompare(b.idea.objective || b.idea.raw));

  const domains = [...new Set(state.ideas.map((i) => i.domain).filter(Boolean))].sort();
  const f = state.filters;
  const shown = clear.filter((r) =>
    (!f.domain || r.idea.domain === f.domain) &&
    (!f.crux || cruxStatus(r.extraction, state.levels) === f.crux) &&
    (!f.proposed || r.extraction.capabilities.some((c) => !c.skill_id)));

  const add = el("form", {
    class: "add",
    onsubmit: (e) => {
      e.preventDefault();
      const input = add.elements.raw;
      const raw = input.value.trim();
      if (!raw) return;
      run(async () => { await addIdea(raw); input.value = ""; await load(); });
    }
  },
    el("input", { name: "raw", placeholder: "An idea, in as few words as you like", autocomplete: "off" }),
    el("button", { type: "submit", disabled: state.busy }, "Add")
  );

  const rated = state.levels.size;

  return el("div", {},
    header(),
    add,
    state.error && el("p", { class: "error" }, state.error),
    filterBar(domains),
    el("p", { class: "muted" },
      `${shown.length} of ${clear.length} ideas · closest to buildable first` +
      (rated ? "" : " · rate your skills on the Profile tab to make this mean anything")),
    el("div", { class: "columns" },
      el("div", {},
        el("ul", { class: "ideas" }, shown.map(ideaRow)),
        !shown.length && el("p", { class: "muted" }, "No idea matches those filters."),
        vague.length > 0 && el("section", { class: "vague-section" },
          el("h2", {}, `Too vague to extract (${vague.length})`),
          el("p", { class: "muted" }, "The app should ask, not guess."),
          el("ul", { class: "ideas" }, vague.map((r) => vagueRow(r.idea)))
        )
      ),
      leveragePanel(clear.map((r) => ({ id: r.idea.id, extraction: r.extraction })))
    )
  );
}

// ---------------------------------------------------------------- profile

// Updated in place rather than through a re-render: re-rendering on every
// radio change would pull focus out of the control being used.
const status = el("span", { class: "status" }, "");
const tally = el("p", { class: "muted" }, "");

function refreshTally() {
  const n = { none: 0, some: 0, solid: 0, unrated: 0 };
  for (const s of state.skills) {
    const lv = state.levels.get(s.id);
    if (lv) n[lv]++; else n.unrated++;
  }
  const rated = state.skills.length - n.unrated;
  tally.textContent =
    `${rated} of ${state.skills.length} rated · ${n.solid} solid · ${n.some} some · ${n.none} none`;
}

function save(skillId, level) {
  state.levels.set(skillId, level);
  refreshTally();
  status.textContent = "saving…";
  status.className = "status";
  setSkillLevel(state.session.user.id, skillId, level)
    .then(() => { status.textContent = "saved"; })
    .catch((err) => { status.textContent = err.message; status.className = "status error"; });
}

function levelControl(skill) {
  const current = state.levels.get(skill.id) ?? "none";
  return el("div", { class: "seg-group", role: "radiogroup", "aria-label": skill.name },
    LEVELS.map((lv) => el("label", { class: "seg" },
      el("input", {
        type: "radio", name: `lvl-${skill.id}`, value: lv,
        checked: current === lv,
        onchange: () => save(skill.id, lv)
      }),
      el("span", {}, lv)
    ))
  );
}

function skillRow(skill) {
  return el("li", { class: "skill" },
    el("div", { class: "skill-text" },
      el("div", { class: "skill-name" },
        skill.name,
        skill.hazard && el("span", { class: "tag warn", title: "involves a real hazard" }, "hazard")
      ),
      el("div", { class: "skill-id" }, skill.id)
    ),
    levelControl(skill)
  );
}

function profileView() {
  const byDomain = new Map();
  for (const s of state.skills) {
    const d = s.domain || "other";
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(s);
  }
  refreshTally();

  return el("div", {},
    header(),
    el("p", { class: "muted" }, "Be honest. An inflated profile makes every distance wrong."),
    el("div", { class: "tally-row" }, tally, status),
    state.error && el("p", { class: "error" }, state.error),
    [...byDomain].map(([domain, list]) => el("section", { class: "domain" },
      el("h2", {}, domain),
      el("ul", { class: "skills" }, list.map(skillRow))
    ))
  );
}

// ---------------------------------------------------------------- review

// A proposal is the model asking for a skill the table does not have. Nothing
// is created automatically, which is the invariant; this is the human step.
function proposalCard(p) {
  const settled = p.promoted || p.rejected;

  const form = el("form", {
    class: "promote",
    onsubmit: (e) => {
      e.preventDefault();
      const f = form.elements;
      run(async () => {
        await promoteSkill({
          key: p.key,
          skillId: f.skillId.value.trim(),
          name: f.name.value.trim(),
          domain: f.domain.value.trim(),
          aliases: f.aliases.value.split(",").map((s) => s.trim()).filter(Boolean),
          hazard: f.hazard.checked
        });
        await load();
      });
    }
  },
    el("label", {}, "Skill id",
      el("input", { name: "skillId", value: p.key, required: true, autocomplete: "off" })),
    el("label", {}, "Name — a checkable task, not a depth label",
      el("input", {
        name: "name", required: true, autocomplete: "off",
        placeholder: "Measure a real object and design a part that fits it"
      })),
    el("label", {}, "Domain",
      el("input", {
        name: "domain", autocomplete: "off", list: "domains",
        placeholder: [...new Set(state.skills.map((s) => s.domain).filter(Boolean))][0] ?? ""
      })),
    el("label", {}, "Aliases, comma separated",
      el("input", { name: "aliases", value: p.names.join(", "), autocomplete: "off" })),
    el("label", { class: "check" },
      el("input", { type: "checkbox", name: "hazard" }),
      el("span", {}, "involves a real hazard")),
    el("button", { type: "submit", disabled: state.busy }, "Promote to a skill")
  );

  const reject = el("form", {
    class: "reject",
    onsubmit: (e) => {
      e.preventDefault();
      const why = reject.elements.why.value.trim();
      if (!why) return;
      run(async () => { await rejectSkill(p.key, why); await load(); });
    }
  },
    el("input", { name: "why", placeholder: "Why this is not a skill", autocomplete: "off" }),
    el("button", { class: "secondary", type: "submit", disabled: state.busy }, "Reject")
  );

  return el("article", { class: settled ? "proposal settled" : "proposal" },
    el("div", { class: "idea-head" },
      el("div", { class: "idea-title" }, p.key),
      el("span", { class: "counts" },
        `${p.idea_ids.length} idea${p.idea_ids.length === 1 ? "" : "s"} · ${p.run_count} run${p.run_count === 1 ? "" : "s"}` +
        (p.crux_count ? ` · crux ×${p.crux_count}` : ""))
    ),
    p.names.length > 1 && el("div", { class: "idea-raw" }, `also seen as: ${p.names.filter((n) => n !== p.key).join(", ")}`),
    p.reasons.length > 0 && el("ul", { class: "caps" },
      p.reasons.map((r) => el("li", {}, el("span", { class: "mark" }, "·"), el("span", {}, r)))),

    p.promoted && el("p", { class: "tag" }, `promoted to ${p.promoted}`),
    p.rejected && el("p", { class: "tag warn" }, `rejected: ${p.rejected}`),
    !settled && form,
    !settled && reject
  );
}

function reviewView() {
  if (state.curator !== true) {
    return el("div", {}, header(),
      el("p", { class: "muted" }, "Skill review is for curators. This account is not one."));
  }
  const open = state.proposals.filter((p) => !p.promoted && !p.rejected);
  const settled = state.proposals.filter((p) => p.promoted || p.rejected);

  return el("div", {},
    header(),
    el("p", { class: "muted" },
      "The model proposes a skill when nothing in the table covers a capability. " +
      "Nothing is created until you say so."),
    state.error && el("p", { class: "error" }, state.error),
    el("datalist", { id: "domains" },
      [...new Set(state.skills.map((s) => s.domain).filter(Boolean))].map((d) => el("option", { value: d }))),
    el("h2", { class: "section" }, `Waiting for review (${open.length})`),
    open.length
      ? el("div", { class: "proposals" }, open.map(proposalCard))
      : el("p", { class: "muted" }, "Nothing proposed. Every capability matched a skill already in the table."),
    settled.length > 0 && el("details", { class: "settled-block" },
      el("summary", {}, `Already decided (${settled.length})`),
      el("div", { class: "proposals" }, settled.map(proposalCard))
    )
  );
}

// ---------------------------------------------------------------- plumbing

function render() {
  if (!state.session) return void mount(app, signInView());
  if (state.route === "review") return void mount(app, reviewView());
  mount(app, state.route === "profile" ? profileView() : listView());
}

async function run(fn) {
  state.busy = true; state.error = null; render();
  try { await fn(); }
  catch (err) { state.error = err.message; }
  finally { state.busy = false; render(); }
}

async function load() {
  if (!state.session) {
    state.ideas = []; state.caps = []; state.skills = []; state.levels = new Map();
    state.curator = null; state.proposals = [];
    return;
  }
  // checked once per session; the tab and the policy both depend on it
  if (state.curator === null) state.curator = await amCurator(state.session.user.id);
  // both views need the skill table and the profile: the list to classify, the
  // profile to show what is set
  const [table, mine] = await Promise.all([
    state.skills.length ? state.skills : skills(),
    mySkills(state.session.user.id)
  ]);
  state.skills = table;
  state.levels = new Map(mine.map((r) => [r.skill_id, r.level]));

  if (state.route === "list") {
    const [ideaRows, capRows] = await Promise.all([ideas(), capabilities()]);
    state.ideas = ideaRows;
    state.caps = capRows;
  } else if (state.route === "review") {
    state.proposals = state.curator ? await proposedSkills() : [];
  }
}

addEventListener("hashchange", () => {
  state.route = currentRoute();
  status.textContent = "";
  run(load);
});

// Fires on sign-in, sign-out and token refresh, and is what repaints after the
// sign-in form resolves.
db.auth.onAuthStateChange((_event, s) => {
  const changed = s?.user?.id !== state.session?.user?.id;
  state.session = s;
  if (changed) run(load); else render();
});

state.session = await session();
await run(load);
