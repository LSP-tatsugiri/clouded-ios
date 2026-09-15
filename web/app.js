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
  addIdea, amCurator, capabilities, capabilitiesFor, db, idea as fetchIdea, ideas, mediaUrl, myGroups,
  mySkills, promoteSkill, proposedSkills, rejectSkill, runsFor, session, setClarification, signUp,
  setShare, setSkillLevel, signIn, signOut, skills
} from "./lib/db.js";
import { el, mount } from "./lib/dom.js";

const LEVELS = ["none", "some", "solid"];
const MARK = { have: "[x]", partial: "[~]", gap: "[ ]", proposed: "[?]" };

// Declared before `state`, because state's initialiser calls currentRoute(),
// which reads this. A const declared further down would still be in its
// temporal dead zone at that point and throw on load.
const ROUTES = new Set(["profile", "review"]);

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
  detail: null,        // { idea, caps, runs, groups } for the idea page
  authMode: "signin",  // "signin" | "create" on the sign-in card
  waiting: "",         // progress text while an answer re-runs extraction
  extracting: new Map(), // idea_id -> { stage, seconds } while the list watches a new idea
  error: null,
  busy: false
};

// Function declarations, not const arrows, for the same reason ROUTES sits
// above `state`: these run during that initialiser.
function hashPath() { return location.hash.replace(/^#\/?/, ""); }

function currentRoute() {
  const h = hashPath();
  if (h.startsWith("idea/")) return "idea";
  return ROUTES.has(h) ? h : "list";
}

function currentIdeaId() {
  const h = hashPath();
  return h.startsWith("idea/") ? h.slice(5) : null;
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

// One card, two modes. Creating an account is self-serve but gated: the
// server refuses emails that were not invited (docs/hosting.md), and the
// message says so rather than looking like a wrong password.
function signInView() {
  const creating = state.authMode === "create";
  const form = el("form", {
    class: "card",
    onsubmit: (e) => {
      e.preventDefault();
      const email = form.elements.email.value.trim();
      const password = form.elements.password.value;
      run(() => (creating ? signUp(email, password) : signIn(email, password)));
    }
  },
    el("h1", {}, "clouded"),
    el("p", { class: "muted" },
      "How far each idea is from something you could actually build."),
    el("label", {}, "Email",
      el("input", { name: "email", type: "email", required: true, autocomplete: "username" })),
    el("label", {}, "Password",
      el("input", {
        name: "password", type: "password", required: true, minlength: 8,
        autocomplete: creating ? "new-password" : "current-password"
      })),
    el("button", { type: "submit", disabled: state.busy },
      state.busy ? (creating ? "Creating…" : "Signing in…") : (creating ? "Create account" : "Sign in")),
    state.error && el("p", { class: "error" }, state.error),
    el("p", { class: "muted switch" },
      creating ? "Already have an account? " : "Invited? ",
      el("a", {
        href: "#", onclick: (e) => { e.preventDefault(); state.authMode = creating ? "signin" : "create"; state.error = null; render(); }
      }, creating ? "Sign in" : "Create an account"))
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
      el("a", { href: `#/idea/${idea.id}`, class: "idea-title" }, title),
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
      idea.shared_to && el("span", { class: "tag" }, "shared"),
      idea.image_path && el("span", { class: "tag", title: "has a picture" }, "▣")
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

// A row the list is still waiting on. The bar is indeterminate on purpose:
// extraction is one API call of unknown length, and a bar that creeps to 90%
// and waits would be a time estimate in disguise. The stages are real events.
function extractingRow(idea, { stage, seconds }) {
  const text = stage === "saving" ? "saving the result…" : `extracting… ${seconds}s`;
  return el("li", { class: "idea extracting" },
    el("div", { class: "idea-title" }, idea.raw),
    el("div", { class: "progress" }, el("div", { class: "progress-bar" })),
    el("p", { class: "muted" }, text)
  );
}

function vagueRow(idea) {
  return el("li", { class: "idea vague" },
    el("a", { href: `#/idea/${idea.id}`, class: "idea-title" }, idea.raw),
    idea.clarifying_question && el("p", { class: "question" }, idea.clarifying_question),
    el("p", { class: "muted" }, el("a", { href: `#/idea/${idea.id}`, class: "tab" }, "answer this →"))
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
  // ideas being watched sit above the list, outside the filters, until they land
  const extracting = rows.filter((r) => state.extracting.has(r.idea.id));
  const settled = rows.filter((r) => !state.extracting.has(r.idea.id));
  const clear = settled.filter((r) => r.idea.is_clear === true);
  const vague = settled.filter((r) => r.idea.is_clear !== true);

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
      // load() sees the new row as pending and starts watching it
      run(async () => { await addIdea(raw); input.value = ""; await load(); });
    }
  },
    el("input", { name: "raw", placeholder: "An idea, in as few words as you like", autocomplete: "off" }),
    el("button", { type: "submit", disabled: state.busy }, "Add"),
    // adding runs extraction server-side, which is a paid API call
    el("span", { class: "muted cost" }, "extracts on save · ~1¢")
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
        extracting.length > 0 && el("ul", { class: "ideas" },
          extracting.map((r) => extractingRow(r.idea, state.extracting.get(r.idea.id)))),
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

// ---------------------------------------------------------------- idea page

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The webhook fires on a changed clarification, but it does not reset status,
// so a new extraction_runs row is the only reliable signal that the re-run
// happened.
//
// Seeing that row is not the same as seeing the result. The function writes
// the run first, then the capabilities, then the idea row, precisely so a
// failure in resolution cannot lose the raw output. Reloading the moment the
// run appears therefore races those later writes and can show the previous
// verdict. So: wait for the run, then wait for the idea row to agree with it.
// How long a wait for extraction lasts before giving up: 60 polls, 2 s apart.
const WATCH_POLLS = 60, WATCH_TICK_MS = 2000, WATCH_WINDOW_MS = WATCH_POLLS * WATCH_TICK_MS;

// onProgress({ stage, seconds }) is called on every tick: the idea page turns
// it into a line of text, the list into the bar on the new idea's row.
async function awaitRerun(ideaId, since, onProgress) {
  let run = null;
  for (let i = 0; i < WATCH_POLLS && !run; i++) {
    await sleep(WATCH_TICK_MS);
    onProgress({ stage: "extracting", seconds: (i + 1) * WATCH_TICK_MS / 1000 });
    [run] = await runsFor(ideaId, since);
  }
  if (!run || run.error) return run;

  onProgress({ stage: "saving", seconds: null });
  for (let i = 0; i < 10; i++) {
    if ((await fetchIdea(ideaId)).is_clear === run.clear) break;
    await sleep(1000);
  }
  return run;
}

// Watch a just-added (or still pending) idea from the list until its
// extraction lands, then reload so the row takes its sorted place. Runs
// unawaited so the list stays usable meanwhile.
async function watch(ideaId, since) {
  if (state.extracting.has(ideaId)) return;
  state.extracting.set(ideaId, { stage: "extracting", seconds: 0 });
  render();
  try {
    const got = await awaitRerun(ideaId, since, (p) => { state.extracting.set(ideaId, p); render(); });
    if (!got) state.error = "Extraction has not landed yet. Reload in a moment.";
    else if (got.error) state.error = `Extraction failed: ${got.error}`;
  } catch (err) {
    state.error = err.message;
  } finally {
    state.extracting.delete(ideaId);
    if (state.route === "list") await load().catch((err) => { state.error = err.message; });
    render();
  }
}

function capabilityDetail(cap) {
  const k = classify(cap, state.levels);
  const isCrux = cap.crux_rank === 1;
  return el("li", { class: `capdetail ${k}${isCrux ? " is-crux" : ""}` },
    el("div", { class: "capdetail-head" },
      el("span", { class: "mark" }, MARK[k]),
      el("span", { class: "capdetail-name" }, capLabel(cap)),
      isCrux && el("span", { class: "crux-tag" }, "the hard part")
    ),
    cap.reason && el("p", { class: "capdetail-reason" }, cap.reason),
    el("details", { class: "resolution" },
      el("summary", {}, `resolved: ${cap.resolved}`),
      el("dl", {},
        cap.resolved_from && [el("dt", {}, "proposed as"), el("dd", {}, cap.resolved_from)],
        cap.resolve_why && [el("dt", {}, "because"), el("dd", {}, cap.resolve_why)],
        el("dt", {}, "skill id"), el("dd", {}, cap.skill_id ?? `${cap.proposed_key} (not in the table)`)
      )
    )
  );
}

function shareControl(idea, groups) {
  return el("div", { class: "share" },
    el("label", {}, "Shared with",
      el("select", {
        onchange: (e) => run(async () => {
          await setShare(idea.id, e.target.value || null);
          await load();
        })
      },
        el("option", { value: "", selected: !idea.shared_to }, "Private"),
        groups.map((g) => el("option", { value: g.id, selected: idea.shared_to === g.id }, g.name))
      )),
    !groups.length && el("p", { class: "muted" },
      "No groups yet. Sharing needs one, and group management arrives in step 7.")
  );
}

function answerBox(idea) {
  const form = el("form", {
    class: "answer",
    onsubmit: (e) => {
      e.preventDefault();
      const text = form.elements.clarification.value.trim();
      if (!text) return;
      run(async () => {
        const since = new Date().toISOString();
        await setClarification(idea.id, text);
        state.waiting = "waiting for extraction…";
        const got = await awaitRerun(idea.id, since, ({ stage, seconds }) => {
          state.waiting = stage === "saving" ? "saving the result…" : `waiting for extraction… ${seconds}s`;
          render();
        });
        state.waiting = "";
        if (!got) state.error = "The re-run has not landed yet. Reload in a moment.";
        else if (got.error) state.error = `Extraction failed: ${got.error}`;
        await load();
      });
    }
  },
    el("label", {}, "Your answer",
      el("textarea", {
        name: "clarification", rows: 2, required: true,
        placeholder: "Say what the thing actually is"
      })),
    el("p", { class: "muted" }, "Answering re-runs extraction. That is one API call, about a cent."),
    el("button", { type: "submit", disabled: state.busy }, state.busy ? "Working…" : "Answer and re-extract")
  );
  return form;
}

function ideaView() {
  const d = state.detail;
  // no detail and an error means the load failed (not visible, no such id):
  // the error must show here or the page says "Loading…" forever
  if (!d) return el("div", {}, header(),
    state.error
      ? el("p", { class: "error" }, state.error, " ", el("a", { href: "#/" }, "← all ideas"))
      : el("p", { class: "muted" }, "Loading…"));

  const { idea, caps, runs, groups, imageUrl } = d;
  const extraction = { clear: idea.is_clear === true, capabilities: caps };
  const dist = distanceOf(extraction, state.levels);
  const crux = cruxOf(extraction);
  const ordered = crux ? [crux, ...caps.filter((c) => c !== crux)] : caps;

  const counts = dist && [
    `${dist.gap} short`,
    dist.partial ? `${dist.partial} partial` : null,
    dist.have ? `${dist.have} held` : null
  ].filter(Boolean).join(" · ");

  return el("div", {},
    header(),
    el("p", {}, el("a", { href: "#/", class: "tab" }, "← all ideas")),

    el("h2", { class: "detail-title" }, idea.objective || idea.raw),
    el("p", { class: "idea-raw" }, `captured as: ${idea.raw}`),
    idea.clarification && el("p", { class: "idea-raw" }, `you clarified: ${idea.clarification}`),

    // the inspiration that came with the idea; extraction never saw either
    imageUrl && el("a", { href: imageUrl, target: "_blank", rel: "noopener", class: "media" },
      el("img", { src: imageUrl, alt: "picture attached to this idea", loading: "lazy" })),
    idea.image_path && !imageUrl && el("p", { class: "idea-raw" }, "a picture was attached but could not be loaded"),
    idea.source_url && el("p", { class: "idea-raw" }, "from: ",
      el("a", { href: idea.source_url, target: "_blank", rel: "noopener noreferrer" }, idea.source_url)),

    el("div", { class: "meta" },
      idea.domain && el("span", { class: "tag" }, idea.domain),
      dist && el("span", { class: "tag" }, counts),
      idea.status !== "extracted" && el("span", { class: "tag warn" }, idea.status)
    ),

    state.error && el("p", { class: "error" }, state.error),
    state.waiting && el("p", { class: "muted" }, state.waiting),

    idea.is_clear === false && el("section", { class: "question-block" },
      el("h3", {}, "Too vague to extract"),
      idea.clarifying_question && el("p", { class: "question" }, idea.clarifying_question),
      answerBox(idea)
    ),

    caps.length > 0 && el("section", {},
      el("h3", {}, "What it would take"),
      el("ul", { class: "capdetails" }, ordered.map(capabilityDetail))
    ),

    shareControl(idea, groups),

    el("details", { class: "runs" },
      el("summary", {}, `Extraction history (${runs.length})`),
      el("ul", { class: "caps" }, runs.map((r) => el("li", {},
        el("span", { class: "mark" }, r.error ? "✕" : "·"),
        el("span", {}, `${new Date(r.created_at).toLocaleString()} · ${r.model} · ${r.prompt_hash}` +
          (r.error ? ` · ${r.error.slice(0, 80)}` : ""))
      )))
    )
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
  if (state.route === "idea") return void mount(app, ideaView());
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
    // A pending row is watched from here, whether it was just added or the
    // page was reloaded mid-extraction; `since` is the insert, which is what
    // fired the webhook. Older than the wait window means the webhook never
    // delivered, and re-watching it would loop: leave it as a pending row.
    const fresh = Date.now() - WATCH_WINDOW_MS;
    for (const i of ideaRows) {
      if (i.status === "pending" && Date.parse(i.created_at) > fresh) watch(i.id, i.created_at);
    }
  } else if (state.route === "review") {
    state.proposals = state.curator ? await proposedSkills() : [];
  } else if (state.route === "idea") {
    const id = currentIdeaId();
    const [one, caps, runs, groups] = await Promise.all([
      fetchIdea(id), capabilitiesFor(id), runsFor(id), myGroups()
    ]);
    // a missing object (upload failed, decision 9) must not take the page down
    const imageUrl = one.image_path ? await mediaUrl(one.image_path).catch(() => null) : null;
    state.detail = { idea: one, caps, runs, groups, imageUrl };
  }
}

addEventListener("hashchange", () => {
  state.route = currentRoute();
  status.textContent = "";
  state.detail = null;
  state.waiting = "";
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
