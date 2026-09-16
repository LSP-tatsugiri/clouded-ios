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
  classify, compareKeys, cruxOf, cruxStatus, distanceOf, friendsWhoHold, leverage, sortKey
} from "/extraction/src/distance.js";
import {
  addIdea, amCurator, capabilities, capabilitiesFor, createGroup, db, deleteGroup, groupMembers,
  groupSkills, idea as fetchIdea, ideas, invite, mediaUrl, myGroups, myProfile, mySkills, pendingInvites,
  profilesFor, promoteSkill, proposedSkills, rejectSkill, removeMember, renameGroup, revokeInvite, runsFor,
  session, setClarification, setDisplayName, setShare, setSkillLevel, sharedIdeas, signIn, signOut,
  signUp, skills, skillsFor
} from "./lib/db.js";
import { el, mount } from "./lib/dom.js";
import { FAILED, SAVED, SENDING, bandFor, forcedBand, opener } from "./lib/waifu.js";

const LEVELS = ["none", "some", "solid"];
const MARK = { have: "[x]", partial: "[~]", gap: "[ ]", proposed: "[?]", friend: "[+]" };
// Closest-to-me bands, by the short count: key, heading, one line under it.
const BANDS = [
  ["now", "Buildable now", "No skill missing."],
  ["one", "One skill away", "One skill short."],
  ["far", "Further out", "Two or more skills short."],
  ["vague", "Needs a detail", "Answer one question and extraction runs."]
];
const mark = (k) => el("span", { class: `mark ${k}` }, MARK[k]);
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Declared before `state`, because state's initialiser calls currentRoute(),
// which reads this. A const declared further down would still be in its
// temporal dead zone at that point and throw on load.
const ROUTES = new Set(["profile", "review", "group", "waifu"]);

const app = document.getElementById("app");
const state = {
  session: null,
  route: currentRoute(),
  ideas: [],
  caps: [],
  skills: [],          // 51 rows, seeded by migration, cached after first load
  levels: new Map(),   // skill_id -> none | some | solid
  filters: { domain: "", crux: "", proposed: false, friend: false },
  sort: "closest",     // Ideas tab: closest (the distance sort) | newest
  pool: new Map(),     // skill_id -> [user_id] of group mates holding it solid
  names: new Map(),    // user_id -> display_name, for everyone in your groups
  curator: null,       // null = not yet checked
  proposals: [],
  detail: null,        // { idea, caps, runs, groups } for the idea page
  profile: null,       // { user_id, display_name } — yours
  groups: [],          // { id, name, created_by, members: [{ user_id, display_name, added_at }], invites: [{ email }] }
  confirmDelete: null, // group id whose delete button is waiting for a second click
  feed: [],            // shared ideas from every group, newest first (decision 12)
  feedSort: "newest",  // "newest" | "closest"
  friend: null,        // { profile, levels } for the friend profile page
  waifu: { phase: "asking", ideaId: null, line: null }, // #/waifu: asking | sending | saved | failed
  authMode: "signin",  // "signin" | "create" on the sign-in card
  waiting: "",         // progress text while an answer re-runs extraction
  extracting: new Map(), // idea_id -> { stage, seconds } while the list watches a new idea
  error: null,
  busy: false
};

// Function declarations, not const arrows, for the same reason ROUTES sits
// above `state`: these run during that initialiser.
function hashPath() { return location.hash.replace(/^#\/?/, "").replace(/\?.*$/, ""); }

function currentRoute() {
  const h = hashPath();
  if (h.startsWith("idea/")) return "idea";
  if (h.startsWith("friend/")) return "friend";
  return ROUTES.has(h) ? h : "list";
}

function currentIdeaId() {
  const h = hashPath();
  return h.startsWith("idea/") ? h.slice(5) : null;
}

// ?place=1 and ?band=dusk are accepted before the hash (the query string) or
// after it (#/waifu?band=dusk), since the second is what people type.
function pageParams() {
  const q = location.hash.indexOf("?");
  return (q >= 0 ? location.hash.slice(q) : "") + "&" + location.search.replace(/^[?]/, "");
}

function currentFriendId() {
  const h = hashPath();
  return h.startsWith("friend/") ? h.slice(7) : null;
}

const skillName = (id) => state.skills.find((s) => s.id === id)?.name ?? id;

// An "extraction" as distance.js expects it, assembled from the two tables.
function extractionOf(idea, capsById) {
  return { clear: idea.is_clear === true, capabilities: capsById.get(idea.id) ?? [] };
}

// The wordmark's cloud. Static markup, so a fragment is fine (el() cannot
// make namespaced SVG elements); left off the waifu scene, whose header
// waifu.css lays out as it always has.
function brandMark() {
  const t = document.createElement("template");
  t.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">` +
    `<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18Z"/></svg>`;
  return t.content.firstElementChild;
}

function header() {
  const tab = (href, label, route) =>
    el("a", { href, class: state.route === route ? "tab on" : "tab" }, label);
  return el("header", {},
    el("h1", {}, state.route !== "waifu" && brandMark(), "clouded"),
    el("nav", {},
      tab("#/", "Ideas", "list"),
      tab("#/group", "Group", "group"),
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

// The friend skill pool is consulted for shared ideas only (docs/step-7-plan.md,
// decision 9): a private idea shows nothing, and sharing it is how you find
// out who can help. That is a client rule, not a policy; the pool itself is
// readable either way.
function friendMarker({ idea, extraction }) {
  if (!idea.shared_to) return { cruxHeld: false, text: null };
  const f = friendsWhoHold(extraction, state.levels, state.pool);
  if (!f) return { cruxHeld: false, text: null };
  const crux = cruxOf(extraction);
  const iHoldCrux = crux ? classify(crux, state.levels) === "have" : true;
  const cruxHeld = !iHoldCrux && f.cruxHolders.length > 0;
  const parts = [];
  if (cruxHeld) parts.push(`${nameList(f.cruxHolders)} ${f.cruxHolders.length === 1 ? "holds" : "hold"} the hard part`);
  if (f.gaps) parts.push(`group covers ${f.covered} of ${f.gaps} ${f.gaps === 1 ? "gap" : "gaps"}`);
  return { cruxHeld, text: parts.length ? parts.join(" · ") : null };
}

// Up to two names, then a count: "Alex and Sam +1".
function nameList(ids) {
  const names = ids.map((id) => state.names.get(id) ?? "a friend");
  const shown = names.slice(0, 2).join(" and ");
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
}

function friendLine(row) {
  const m = friendMarker(row);
  return m.text && el("span", { class: m.cruxHeld ? "friend-line" : "friend-line dim" },
    mark(m.cruxHeld ? "friend" : "gap"), m.text);
}

// short / partial / held chips; zeros are left out
function tallyChips(d) {
  return el("div", { class: "tally" },
    d.gap > 0 && el("span", { class: "s" }, `${d.gap} short`),
    d.partial > 0 && el("span", { class: "p" }, `${d.partial} partial`),
    d.have > 0 && el("span", { class: "h" }, `${d.have} held`)
  );
}

function cruxBlock(crux, flap = false) {
  const k = classify(crux, state.levels);
  return el("div", { class: `crux ${k}` },
    mark(k),
    el("span", { class: "t" }, flap ? splitFlap(capLabel(crux)) : capLabel(crux)),
    el("span", { class: "lbl" }, "the hard part")
  );
}

// The hard part resolving letter by letter in mono tiles when an extraction
// lands, then settling to plain text. Every character is its own text node
// (never markup), and the interval stops when the card leaves the page.
// Under reduced motion the text simply fades in.
const FLAP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function splitFlap(text) {
  const wrap = el("span", { class: "flap" });
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    wrap.classList.add("done", "fade-in");
    wrap.textContent = text;
    return wrap;
  }
  const rnd = () => FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)];
  const nbsp = "\u00a0";
  const tiles = [...text].map((c) => el("span", { class: c === " " ? "ch sp" : "ch" }, c === " " ? nbsp : rnd()));
  wrap.append(...tiles);
  let frame = 0;
  const tick = setInterval(() => {
    if (!wrap.isConnected) return clearInterval(tick);
    frame++;
    let settled = 0;
    tiles.forEach((n, i) => {
      const c = text[i];
      if (c === " " || frame > 6 + i * 0.7) { n.textContent = c === " " ? nbsp : c; settled++; }
      else n.textContent = rnd();
    });
    if (settled === tiles.length) {
      clearInterval(tick);
      setTimeout(() => wrap.classList.add("done"), 350);
    }
  }, 45);
  return wrap;
}

// Ideas whose extraction landed since the last paint: the next render of
// their card plays the split-flap, once. In memory only, so a reload never
// replays it. watch() adds to it; listView() empties it after each paint.
const justLanded = new Set();

function capItem(cap) {
  const k = classify(cap, state.levels);
  return el("li", { class: k }, mark(k), el("span", {}, capLabel(cap)));
}

function ideaRow({ idea, extraction }) {
  const d = distanceOf(extraction, state.levels);
  const crux = cruxOf(extraction);
  const anyProposed = extraction.capabilities.some((c) => !c.skill_id);
  const title = idea.objective || idea.raw;
  const landed = justLanded.has(idea.id);

  return el("article", { class: landed ? "card idea fade-in" : "card idea", "data-idea": idea.id },
    el("div", { class: "card-head" },
      el("div", {},
        el("h3", {}, el("a", { href: `#/idea/${idea.id}` }, title)),
        title !== idea.raw && el("p", { class: "raw" }, idea.raw)),
      d && tallyChips(d)
    ),
    crux && cruxBlock(crux, landed),
    // the rest of the capabilities, crux first already shown above
    el("ul", { class: "caps" }, extraction.capabilities.filter((c) => c !== crux).map(capItem)),
    el("div", { class: "card-foot" },
      idea.domain && el("span", { class: "tag" }, idea.domain),
      anyProposed && el("span", { class: "tag prop" }, "proposed skill"),
      idea.status !== "extracted" && el("span", { class: "tag warn" }, idea.status),
      idea.shared_to && el("span", { class: "tag" }, "shared"),
      idea.image_path && el("span", { class: "tag", title: "has a picture" }, "▣"),
      friendLine({ idea, extraction }),
      el("span", { class: "spacer" }),
      el("span", {}, "you"),
      el("span", {}, fmtDate(idea.created_at))
    )
  );
}

// A card the list is still waiting on. The bar is indeterminate on purpose:
// extraction is one API call of unknown length, and a bar that creeps to 90%
// and waits would be a time estimate in disguise. The stages are real events.
function extractingRow(idea, { stage, seconds }) {
  const saving = stage === "saving";
  const fresh = Date.now() - Date.parse(idea.created_at) < WATCH_WINDOW_MS;
  return el("article", { class: "card idea busy" },
    el("div", { class: "card-head" }, el("div", {},
      el("h3", {}, idea.raw),
      el("p", { class: "raw" }, fresh ? "Just added" : "Re-extracting after your answer"))),
    el("div", { class: "progress" },
      el("div", { class: "bar" }, el("i", {})),
      el("span", {}, saving ? "Saving the result" : `Extracting, ${seconds}s`)),
    el("p", { class: "steps" }, saving ? "Writing the capabilities and the hard part" : "Reading the idea and listing what it would take"),
    el("div", { class: "card-foot" }, el("span", {}, "you"), el("span", {}, fmtDate(idea.created_at)))
  );
}

// Too vague to extract: the question and an answer box on the card. The
// answer is the same write the idea page makes (setClarification, which
// re-runs extraction), and the wait is the same watcher a new idea gets, so
// the card turns into the extracting card and then the full one.
function vagueRow(idea) {
  const form = el("form", {
    class: "row",
    onsubmit: (e) => {
      e.preventDefault();
      const text = form.elements.clarification.value.trim();
      if (!text) return;
      run(async () => {
        const since = new Date().toISOString();
        await setClarification(idea.id, text);
        watch(idea.id, since);
      });
    }
  },
    el("input", { name: "clarification", "aria-label": "Your answer", placeholder: "A few words is enough", required: true, autocomplete: "off" }),
    el("button", { type: "submit", class: "btn sm", disabled: state.busy }, "Answer")
  );
  return el("article", { class: justLanded.has(idea.id) ? "card idea vague fade-in" : "card idea vague" },
    el("div", { class: "card-head" }, el("div", {},
      el("h3", {}, el("a", { href: `#/idea/${idea.id}` }, idea.raw)),
      el("p", { class: "raw" }, "Too vague to extract yet"))),
    el("div", { class: "ask" },
      el("p", {}, el("b", {}, "One question: "), idea.clarifying_question ?? "What is it, in a sentence?"),
      form,
      // answering runs extraction server-side, which is a paid API call
      el("p", { class: "hint" }, "Answering re-runs extraction, about a cent.")),
    el("div", { class: "card-foot" }, el("span", {}, "you"), el("span", {}, fmtDate(idea.created_at)))
  );
}

function filterBar(domains, shownCount, total) {
  const set = (k, v) => { state.filters[k] = v; render(); };
  const sortButton = (key, label) => el("button", {
    type: "button", "aria-pressed": String(state.sort === key),
    onclick: () => { state.sort = key; render(); }
  }, label);
  const filtering = state.filters.domain || state.filters.crux || state.filters.proposed || state.filters.friend;
  return el("div", { class: "controls" },
    el("div", { class: "seg", role: "group", "aria-label": "Sort" },
      sortButton("closest", "Closest to me"), sortButton("newest", "Newest")),
    el("select", { "aria-label": "Domain", onchange: (e) => set("domain", e.target.value) },
      el("option", { value: "", selected: state.filters.domain === "" }, "Any domain"),
      domains.map((d) => el("option", { value: d, selected: state.filters.domain === d }, d))
    ),
    el("select", { "aria-label": "Crux", onchange: (e) => set("crux", e.target.value) },
      [["", "Any crux"], ["have", "Crux held"], ["partial", "Crux partial"], ["gap", "Crux is a gap"]]
        .map(([v, label]) => el("option", { value: v, selected: state.filters.crux === v }, label))
    ),
    el("label", { class: "chk" },
      el("input", {
        type: "checkbox",
        checked: state.filters.proposed,
        onchange: (e) => set("proposed", e.target.checked)
      }),
      el("span", {}, "Has a proposed skill")
    ),
    el("label", { class: "chk" },
      el("input", {
        type: "checkbox",
        checked: state.filters.friend,
        onchange: (e) => set("friend", e.target.checked)
      }),
      el("span", {}, "A friend can unblock it")
    ),
    filtering &&
      el("button", { class: "link", onclick: () => { state.filters = { domain: "", crux: "", proposed: false, friend: false }; render(); } }, "clear"),
    el("span", { class: "count" }, `${shownCount} of ${total} shown`)
  );
}

function leveragePanel(items) {
  const top = leverage(items, state.levels).slice(0, 10);
  return el("aside", { class: "leverage", "aria-label": "Highest leverage" },
    el("h2", {}, "Highest leverage"),
    el("p", {}, "Learn one of these and this many ideas move closer."),
    el("ol", {}, top.map((e) => el("li", {},
      el("span", { class: "k" }, String(e.ideaIds.length)),
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

  // crux status first, then gaps, then partials, then title for a stable order;
  // or, on request, most recently added first (the phone's only order)
  if (state.sort === "newest") {
    clear.sort((a, b) => Date.parse(b.idea.created_at) - Date.parse(a.idea.created_at));
  } else {
    clear.sort((a, b) =>
      compareKeys(sortKey(a.extraction, state.levels), sortKey(b.extraction, state.levels)) ||
      (a.idea.objective || a.idea.raw).localeCompare(b.idea.objective || b.idea.raw));
  }

  const domains = [...new Set(state.ideas.map((i) => i.domain).filter(Boolean))].sort();
  const f = state.filters;
  const shown = clear.filter((r) =>
    (!f.domain || r.idea.domain === f.domain) &&
    (!f.crux || cruxStatus(r.extraction, state.levels) === f.crux) &&
    (!f.proposed || r.extraction.capabilities.some((c) => !c.skill_id)) &&
    (!f.friend || friendMarker(r).cruxHeld));

  const add = el("form", {
    class: "capture",
    onsubmit: (e) => {
      e.preventDefault();
      const input = add.elements.raw;
      const raw = input.value.trim();
      if (!raw) return;
      // load() sees the new row as pending and starts watching it
      run(async () => { await addIdea(raw); input.value = ""; await load(); });
    }
  },
    el("input", { name: "raw", "aria-label": "New idea", placeholder: "An idea, in as few words as you like", autocomplete: "off" }),
    el("button", { type: "submit", class: "btn", disabled: state.busy }, "Add idea"),
    // adding runs extraction server-side, which is a paid API call
    el("span", { class: "cost" }, "extracts on save, about 1¢")
  );

  const rated = state.levels.size;
  const card = (r) => r.idea.is_clear === true ? ideaRow(r) : vagueRow(r.idea);

  // Closest to me groups by how many skills are short (the flat gap count
  // distance.js already gives); newest is one list by date, vague included.
  let body;
  if (state.sort === "newest") {
    const all = [...shown, ...vague].sort((a, b) => Date.parse(b.idea.created_at) - Date.parse(a.idea.created_at));
    body = el("div", { class: "cards" }, all.map(card));
  } else {
    const bandOf = (r) => {
      const gap = distanceOf(r.extraction, state.levels).gap;
      return gap === 0 ? "now" : gap === 1 ? "one" : "far";
    };
    const byBand = new Map(BANDS.map(([k]) => [k, []]));
    for (const r of shown) byBand.get(bandOf(r)).push(r);
    for (const r of vague) byBand.get("vague").push(r);
    body = BANDS.map(([k, h, p]) => {
      const items = byBand.get(k);
      return items.length > 0 && el("section", { class: `band ${k}` },
        el("div", { class: "band-head" }, el("h2", {}, h), el("span", { class: "n" }, String(items.length)), el("p", {}, p)),
        el("div", { class: "cards" }, items.map(card)));
    });
  }

  justLanded.clear();

  return el("div", {},
    header(),
    add,
    state.error && el("p", { class: "error" }, state.error),
    filterBar(domains, shown.length, clear.length),
    !rated && el("p", { class: "muted" }, "Rate your skills on the Profile tab to make the distances mean anything."),
    el("div", { class: "layout" },
      el("div", { class: "list" },
        extracting.length > 0 && el("div", { class: "cards extracting-cards" },
          extracting.map((r) => extractingRow(r.idea, state.extracting.get(r.idea.id)))),
        body,
        !shown.length && !vague.length && el("p", { class: "muted" }, "No idea matches those filters.")
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
    nameForm(),
    el("p", { class: "muted" }, "Be honest. An inflated profile makes every distance wrong."),
    el("div", { class: "tally-row" }, tally, status),
    state.error && el("p", { class: "error" }, state.error),
    [...byDomain].map(([domain, list]) => el("section", { class: "domain" },
      el("h2", {}, domain),
      el("ul", { class: "skills" }, list.map(skillRow))
    ))
  );
}

// The name friends see. Defaults to the email's local part at sign-up.
function nameForm() {
  const form = el("form", {
    class: "name-form",
    onsubmit: (e) => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      if (!name) return;
      run(async () => { state.profile = { ...state.profile, ...(await setDisplayName(state.session.user.id, name)) }; });
    }
  },
    el("label", {}, "Your name, as friends see it",
      el("input", { name: "name", value: state.profile?.display_name ?? "", maxlength: 60, required: true, autocomplete: "nickname" })),
    el("button", { type: "submit", class: "secondary", disabled: state.busy }, "Save")
  );
  return form;
}

// ---------------------------------------------------------------- group

// One group in practice (docs/step-7-plan.md, decision 1): "create" shows
// only when you are in none, and each group you are in gets a side panel,
// so being in two by accident is merely two panels rather than a broken page.
function groupView() {
  const me = state.session.user.id;
  if (!state.groups.length) {
    return el("div", {}, header(), state.error && el("p", { class: "error" }, state.error), createGroupCard());
  }
  const rows = feedRows();
  const sortButton = (key, label) => el("button", {
    type: "button", "aria-pressed": String(state.feedSort === key),
    onclick: () => { state.feedSort = key; render(); }
  }, label);

  return el("div", {},
    header(),
    el("div", { class: "page-head" },
      el("div", {},
        el("h1", {}, state.groups.length === 1 ? state.groups[0].name : "Group"),
        el("p", {}, "Ideas your group shared, and who can help with each.")),
      rows.length > 1 && el("div", { class: "seg", role: "group", "aria-label": "Sort feed" },
        sortButton("newest", "Newest"), sortButton("closest", "Closest to me"))
    ),
    state.error && el("p", { class: "error" }, state.error),
    el("div", { class: "layout" },
      rows.length
        ? el("div", { class: "cards" }, rows.map((r) => feedRow(r, me)))
        : el("p", { class: "muted" }, "Nothing shared yet. Share an idea from its page and it appears here for everyone in the group."),
      el("div", { class: "side" }, state.groups.map((g) => groupSection(g, me)))
    )
  );
}

// The feed (decision 12): every member's shared ideas, yours included,
// newest first, each measured against the reader's own profile. "Closest to
// me" is the same sort the Ideas tab uses.
function feedRows() {
  const capsById = new Map();
  for (const c of state.caps) {
    if (!capsById.has(c.idea_id)) capsById.set(c.idea_id, []);
    capsById.get(c.idea_id).push(c);
  }
  const rows = state.feed.map((idea) => ({ idea, extraction: extractionOf(idea, capsById) }));
  if (state.feedSort === "closest") {
    rows.sort((a, b) =>
      compareKeys(sortKey(a.extraction, state.levels), sortKey(b.extraction, state.levels)) ||
      Date.parse(b.idea.created_at) - Date.parse(a.idea.created_at));
  }
  return rows;
}

function feedRow({ idea, extraction }, me) {
  const owner = idea.user_id === me
    ? el("span", { class: "owner" }, "you")
    : el("a", { href: `#/friend/${idea.user_id}`, class: "owner" }, state.names.get(idea.user_id) ?? "a friend");
  const title = idea.objective || idea.raw;
  if (idea.is_clear !== true) {
    return el("article", { class: "card idea vague" },
      el("div", { class: "card-head" }, el("div", {},
        el("h3", {}, el("a", { href: `#/idea/${idea.id}` }, title)),
        el("p", { class: "raw" }, idea.status === "extracted" ? "Too vague to extract yet" : idea.status))),
      el("div", { class: "card-foot" }, owner, el("span", {}, fmtDate(idea.created_at)))
    );
  }
  const held = state.levels;
  const d = distanceOf(extraction, held);
  const crux = cruxOf(extraction);
  const cruxClass = crux ? classify(crux, held) : null;

  // who holds the crux: the reader counts here, unlike on the Ideas tab
  const f = friendsWhoHold(extraction, held, state.pool);
  const holders = [...(cruxClass === "have" ? ["you"] : []), ...f.cruxHolders.map((id) => state.names.get(id) ?? "a friend")];
  const holderText = holders.length
    ? `${holders.slice(0, 2).join(" and ")}${holders.length > 2 ? ` +${holders.length - 2}` : ""} ${holders.length === 1 && holders[0] !== "you" ? "holds" : "hold"} the hard part`
    : null;
  const coverText = f.gaps ? `group covers ${f.covered} of ${f.gaps} ${f.gaps === 1 ? "gap" : "gaps"}` : "nothing missing for you";

  return el("article", { class: "card idea" },
    el("div", { class: "card-head" },
      el("div", {}, el("h3", {}, el("a", { href: `#/idea/${idea.id}` }, title))),
      tallyChips(d)
    ),
    crux && cruxBlock(crux),
    el("ul", { class: "caps" }, extraction.capabilities.filter((c) => c !== crux).map(capItem)),
    el("div", { class: "card-foot" },
      owner,
      idea.domain && el("span", { class: "tag" }, idea.domain),
      el("span", {}, fmtDate(idea.created_at)),
      el("span", { class: "spacer" }),
      holderText && el("span", { class: "friend-line" }, mark("friend"), holderText),
      el("span", { class: f.covered ? "friend-line" : "friend-line dim" }, mark(f.covered ? "friend" : "gap"), coverText)
    )
  );
}

// ---------------------------------------------------------------- friend

// A group mate's profile (decision 13): name and the skills they hold at
// solid or some, by domain. Read-only; their ideas are the feed.
function friendView() {
  const f = state.friend;
  if (!f) return el("div", {}, header(),
    state.error
      ? el("p", { class: "error" }, state.error, " ", el("a", { href: "#/group" }, "← group"))
      : el("p", { class: "muted" }, "Loading…"));

  const byDomain = new Map();
  for (const s of state.skills) {
    const lv = f.levels.get(s.id);
    if (lv !== "solid" && lv !== "some") continue;
    const d = s.domain || "other";
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push({ skill: s, level: lv });
  }
  const solid = [...f.levels.values()].filter((l) => l === "solid").length;
  const some = [...f.levels.values()].filter((l) => l === "some").length;

  return el("div", {},
    header(),
    el("p", {}, el("a", { href: "#/group", class: "tab" }, "← group")),
    el("h2", { class: "detail-title" }, f.profile.display_name),
    el("p", { class: "muted" }, `${solid} solid · ${some} some`),
    byDomain.size
      ? [...byDomain].map(([domain, list]) => el("section", { class: "domain" },
          el("h2", {}, domain),
          el("ul", { class: "skills" }, list.map(({ skill, level }) => el("li", { class: "skill" },
            el("div", { class: "skill-text" },
              el("div", { class: "skill-name" }, skill.name),
              el("div", { class: "skill-id" }, skill.id)),
            el("span", { class: `tag level-${level}` }, level)
          )))
        ))
      : el("p", { class: "muted" }, "They have not rated any skill yet.")
  );
}

function createGroupCard() {
  const suggested = state.profile ? `${state.profile.display_name}'s group` : "";
  const form = el("form", {
    class: "card group-create",
    onsubmit: (e) => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      if (!name) return;
      run(async () => { await createGroup(name); await load(); });
    }
  },
    el("h2", {}, "No group yet"),
    el("p", {},
      "A group is your friends. Ideas you share go to it, and it tells you which friend already holds the skill an idea needs. ",
      "Joining a group means your skill levels are readable by everyone in it."),
    el("label", { class: "fld" }, "Group name",
      el("span", { class: "row" },
        el("input", { name: "name", value: suggested, maxlength: 60, required: true, autocomplete: "off" }),
        el("button", { type: "submit", class: "btn sm", disabled: state.busy }, "Create group")))
  );
  return form;
}

// The side panel: members always visible, everything that changes the group
// folded under "Manage group". The fold is rebuilt on every render, so it
// reads its own open state off the page before the rebuild rather than
// snapping shut after each rename or invite.
function groupSection(g, me) {
  const creator = g.created_by === me;
  const wasOpen = document.querySelector(`.manage[data-group="${g.id}"]`)?.open || state.confirmDelete === g.id;
  const initial = (name) => (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const others = g.members.filter((m) => m.user_id !== me);

  return el("aside", { "aria-label": g.name },
    el("h2", {}, "Members"),
    el("p", {}, "Everyone here can see each other's skill levels and the ideas shared to the group."),
    el("ul", { class: "people" }, g.members.map((m) => el("li", {},
      el("span", { class: "av", "aria-hidden": "true" }, initial(m.display_name)),
      m.user_id === me
        ? el("span", {}, m.display_name ?? m.user_id)
        : el("a", { href: `#/friend/${m.user_id}` }, m.display_name ?? m.user_id),
      m.user_id === me && el("span", { class: "tag" }, "you"),
      m.user_id === g.created_by && el("span", { class: "tag" }, "creator")
    ))),

    el("details", { class: "manage", "data-group": g.id, open: wasOpen },
      el("summary", {}, "Manage group"),
      creator && groupNameForm(g),
      creator && others.length > 0 && el("div", {},
        el("div", { class: "sub-h" }, "Members"),
        el("ul", { class: "plain" }, others.map((m) => el("li", {},
          el("span", {}, m.display_name ?? m.user_id),
          el("button", {
            class: "link", type: "button",
            onclick: () => run(async () => { await removeMember(g.id, m.user_id); await load(); })
          }, "Remove")
        )))),
      creator && inviteForm(g),
      creator && g.invites.length > 0 && el("div", {},
        el("div", { class: "sub-h" }, "Invited, not joined yet"),
        el("ul", { class: "plain" }, g.invites.map((i) => el("li", {},
          el("span", {}, i.email),
          el("button", { class: "link", type: "button", onclick: () => run(async () => { await revokeInvite(g.id, i.email); await load(); }) }, "Revoke")
        )))),

      el("div", { class: "group-actions" },
        creator
          ? (state.confirmDelete === g.id
            ? el("div", {},
                el("p", { class: "hint" }, "Delete the group? Every idea shared to it goes back to private."),
                el("div", { class: "row" },
                  el("button", { class: "btn sm warn", type: "button", onclick: () => run(async () => { state.confirmDelete = null; await deleteGroup(g.id); await load(); }) }, "Yes, delete"),
                  el("button", { class: "btn sm ghost", type: "button", onclick: () => { state.confirmDelete = null; render(); } }, "Keep it")))
            : el("button", { class: "link danger", type: "button", onclick: () => { state.confirmDelete = g.id; render(); } }, "Delete group"))
          : el("button", {
              class: "link danger", type: "button", onclick: () => run(async () => { await removeMember(g.id, me); await load(); })
            }, "Leave group")
      )
    )
  );
}

function groupNameForm(g) {
  const form = el("form", {
    onsubmit: (e) => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      if (!name || name === g.name) return;
      run(async () => { await renameGroup(g.id, name); await load(); });
    }
  },
    el("label", { class: "fld" }, "Group name",
      el("span", { class: "row" },
        el("input", { name: "name", value: g.name, maxlength: 60, required: true, autocomplete: "off" }),
        el("button", { type: "submit", class: "btn sm ghost", disabled: state.busy }, "Rename")))
  );
  return form;
}

// Inviting allowlists the address as well, so this is the whole onboarding
// path: the friend creates an account from the sign-in card and is in.
function inviteForm(g) {
  const form = el("form", {
    class: "invite",
    onsubmit: (e) => {
      e.preventDefault();
      const email = form.elements.email.value.trim();
      if (!email) return;
      run(async () => {
        const outcome = await invite(g.id, email);
        status.textContent = outcome === "joined"
          ? `${email} already had an account and is in the group.`
          : `${email} can now create an account; they join when they do.`;
        await load();
      });
    }
  },
    el("label", { class: "fld" }, "Invite a friend by email",
      el("span", { class: "row" },
        el("input", { name: "email", type: "email", required: true, placeholder: "friend@example.com", autocomplete: "off" }),
        el("button", { type: "submit", class: "btn sm", disabled: state.busy }, "Invite"))),
    el("p", { class: "hint" }, "They make their own account from the sign-in page and land here. Each idea they add costs the owner about a cent."),
    status
  );
  return form;
}

// ---------------------------------------------------------------- waifu

// One scene, unlisted (docs/waifu-view-plan.md). She asks, you answer, she
// says she has it and links to the idea. The bubble is updated in place
// rather than through render(): a re-render would rebuild the textarea and
// drop what you are typing.
function waifuView() {
  const w = state.waifu;
  const band = forcedBand(pageParams()) ?? bandFor(new Date());
  if (w.band !== band || !w.line) { w.band = band; w.line = opener(band); }
  if (w.phase === "sending") w.phase = "asking";   // a render mid-send means a route change; start over

  // A comic cloud (docs/waifu-view-plan.md, decision 11): the glass layer is
  // clipped to a path in objectBoundingBox units so it scales with the
  // bubble, and the same path is stroked on top as the thin rim.
  const line = el("span", { class: "waifu-bubble-line" });
  const text = el("span", { class: "waifu-bubble-text" }, line);
  const bubble = el("div", { class: "waifu-bubble" },
    el("div", { class: "waifu-bubble-glass" }),
    cloudSvg(),
    text
  );
  // A longer line shrinks to fit the cloud rather than spilling out of it:
  // start from the CSS size and step down until the text box fits.
  const fit = () => {
    text.style.fontSize = "";
    let px = parseFloat(getComputedStyle(text).fontSize);
    while (line.offsetHeight > text.clientHeight && px > 11) {
      px -= 1;
      text.style.fontSize = `${px}px`;
    }
  };
  state.waifu.fit = fit;
  const say = (words, link) => {
    line.replaceChildren(words);
    if (link) line.append(" ", el("a", { href: `#/idea/${link}` }, "See it on the list."));
    requestAnimationFrame(fit);
  };
  say(w.phase === "saved" ? SAVED : w.phase === "failed" ? FAILED : w.line);
  if (w.phase === "saved" && w.ideaId) say(SAVED, w.ideaId);

  const input = el("textarea", {
    class: "waifu-input", rows: 2, placeholder: "An idea, in as few words as you like",
    autocomplete: "off",
    onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } },
    oninput: () => { if (w.phase !== "asking" && w.phase !== "sending") { w.phase = "asking"; say(w.line); } }
  });
  const button = el("button", { type: "submit" }, "Tell her");
  const form = el("form", {
    class: "waifu-bar",
    onsubmit: async (e) => {
      e.preventDefault();
      const raw = input.value.trim();
      if (!raw || w.phase === "sending") return;
      w.phase = "sending"; button.disabled = true; say(SENDING);
      try {
        const { id } = await addIdea(raw);
        w.phase = "saved"; w.ideaId = id; input.value = ""; say(SAVED, id);
      } catch {
        w.phase = "failed"; say(FAILED);           // the text stays in the box
      } finally {
        button.disabled = false; input.focus();
      }
    }
  },
    input, button,
    el("span", { class: "muted cost" }, "extracts on save · ~1¢")
  );

  // The poster stands in when motion is unwelcome; otherwise the loop, muted
  // (autoplay needs it; the track is stripped), inline on phones.
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scene = still
    ? el("img", { class: "waifu-video", src: "assets/scene.jpg", alt: "" })
    : el("video", { class: "waifu-video", autoplay: true, loop: true, playsinline: true, poster: "assets/scene.jpg", src: "assets/scene.mp4" });
  if (!still) scene.muted = true;

  requestAnimationFrame(() => input.focus());
  const placing = new URLSearchParams(pageParams()).has("place");
  // Yusei Magic is the bubble's face (chosen 2026-09-15); ?font= tries another.
  // Loaded here, not in index.html, so no other route fetches it.
  const font = previewFont(new URLSearchParams(pageParams()).get("font") ?? "yusei-magic");
  const view = el("div", { class: placing ? "waifu placing" : "waifu", "data-tod": band, style: `--waifu-font: "${font}", sans-serif` },
    scene,
    header(),
    bubble,
    form
  );
  if (placing) view.append(placementTool(bubble, view));
  return view;
}

// The bubble refits its text when the window changes size; one listener,
// pointing at whichever view is current.
addEventListener("resize", () => state.waifu.fit?.());

// The cloud outline in a 0–1 box, drawn clockwise from the left edge: five
// lumps over the top, two down the right, the swoosh tail at the bottom
// right pointing at her, three lumps back along the bottom. Static markup,
// so a fragment is fine here; el() cannot make namespaced SVG elements.
const CLOUD_PATH =
  "M 0.04 0.46 A 0.15 0.2 0 0 1 0.18 0.14 A 0.14 0.17 0 0 1 0.38 0.07 " +
  "A 0.07 0.08 0 0 1 0.5 0.1 A 0.15 0.16 0 0 1 0.72 0.15 A 0.12 0.18 0 0 1 0.87 0.44 " +
  "A 0.1 0.13 0 0 1 0.82 0.66 C 0.9 0.68 0.97 0.72 1 0.8 C 0.92 0.81 0.84 0.8 0.75 0.77 " +
  "A 0.12 0.12 0 0 1 0.55 0.8 A 0.12 0.12 0 0 1 0.34 0.8 A 0.11 0.14 0 0 1 0.17 0.73 A 0.16 0.2 0 0 1 0.04 0.46 Z";

function cloudSvg() {
  const t = document.createElement("template");
  t.innerHTML =
    `<svg class="waifu-bubble-edge" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">` +
    `<defs><clipPath id="waifu-cloud" clipPathUnits="objectBoundingBox"><path d="${CLOUD_PATH}"/></clipPath></defs>` +
    `<path d="${CLOUD_PATH}" vector-effect="non-scaling-stroke"/></svg>`;
  return t.content.firstElementChild;
}

// ?font=<key>: try a bubble font from Google Fonts without editing CSS. The
// stylesheet is added once per font; the scene sets --waifu-font from it.
const FONTS = {
  "comic-neue": "Comic Neue", bangers: "Bangers", "yusei-magic": "Yusei Magic",
  "mochiy-pop": "Mochiy Pop One", "patrick-hand": "Patrick Hand", kalam: "Kalam",
  "permanent-marker": "Permanent Marker", "zen-kurenaido": "Zen Kurenaido"
};
function previewFont(key) {
  const family = FONTS[key];
  if (!family) return null;
  const id = `font-${key}`;
  if (!document.getElementById(id)) {
    document.head.append(el("link", {
      id, rel: "stylesheet",
      href: `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;700&display=swap`
    }));
  }
  return family;
}

// ?place=1: drag the bubble to where it should sit and read the CSS off the
// readout; releasing copies it to the clipboard. Dev-only, for choosing the
// position on a new scene without guessing percentages (docs/waifu-view-plan.md).
function placementTool(bubble, view) {
  const readout = el("pre", { class: "waifu-readout" }, "drag the bubble · slide for text size");
  let drag = null;
  const pct = (n, of) => `${(n / of * 100).toFixed(1)}%`;
  const textPx = () => Math.round(parseFloat(getComputedStyle(view).getPropertyValue("--waifu-text")) || 20);
  const css = () => {
    const r = bubble.getBoundingClientRect();
    return `.waifu-bubble { left: ${pct(r.left, innerWidth)}; top: ${pct(r.top, innerHeight)}; width: ${pct(r.width, innerWidth).replace("%", "vw")}; }\n` +
      `.waifu { --waifu-text: ${textPx()}px; }`;
  };
  const copy = () => { readout.textContent = css() + "\n(copied)"; navigator.clipboard?.writeText(css()).catch(() => {}); };
  // the slider sets the base size; fit() may still shrink a long line below it
  const slider = el("input", {
    type: "range", min: 12, max: 36, step: 1, value: textPx(), class: "waifu-size",
    oninput: (e) => { view.style.setProperty("--waifu-text", `${e.target.value}px`); state.waifu.fit?.(); readout.textContent = css(); },
    onchange: copy
  });
  bubble.after(slider);
  bubble.style.cursor = "move";
  bubble.addEventListener("pointerdown", (e) => {
    const r = bubble.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    bubble.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  bubble.addEventListener("pointermove", (e) => {
    if (!drag) return;
    bubble.style.left = `${e.clientX - drag.dx}px`;
    bubble.style.top = `${e.clientY - drag.dy}px`;
    readout.textContent = css();
  });
  bubble.addEventListener("pointerup", () => { drag = null; copy(); });
  return readout;
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
    justLanded.add(ideaId);   // the next paint of its card plays the split-flap
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

// A toggle when you are in exactly one group (the normal case), the select if
// ever in more. Private ideas get the one hint about what sharing unlocks.
function shareControl(idea, groups) {
  const share = (groupId) => run(async () => { await setShare(idea.id, groupId); await load(); });
  const control = groups.length === 1
    ? el("label", { class: "check" },
        el("input", {
          type: "checkbox", checked: idea.shared_to === groups[0].id,
          onchange: (e) => share(e.target.checked ? groups[0].id : null)
        }),
        el("span", {}, `Shared with ${groups[0].name}`))
    : el("label", {}, "Shared with",
        el("select", { onchange: (e) => share(e.target.value || null) },
          el("option", { value: "", selected: !idea.shared_to }, "Private"),
          groups.map((g) => el("option", { value: g.id, selected: idea.shared_to === g.id }, g.name))
        ));
  return el("div", { class: "share" },
    control,
    !groups.length && el("p", { class: "muted" },
      "No group yet. Sharing needs one — ", el("a", { href: "#/group" }, "create it on the Group tab"), "."),
    groups.length > 0 && !idea.shared_to && el("p", { class: "muted" },
      "Private. Share it to see which friend already holds what it needs.")
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
  // a friend's shared idea is readable but not editable: no answering, no
  // share control (RLS would refuse both; the page just does not offer them)
  const mine = idea.user_id === state.session.user.id;
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
      !mine && el("a", { href: `#/friend/${idea.user_id}`, class: "owner" }, state.names.get(idea.user_id) ?? "a friend"),
      idea.domain && el("span", { class: "tag" }, idea.domain),
      dist && el("span", { class: "tag" }, counts),
      idea.status !== "extracted" && el("span", { class: "tag warn" }, idea.status)
    ),

    state.error && el("p", { class: "error" }, state.error),
    state.waiting && el("p", { class: "muted" }, state.waiting),

    idea.is_clear === false && el("section", { class: "question-block" },
      el("h3", {}, "Too vague to extract"),
      idea.clarifying_question && el("p", { class: "question" }, idea.clarifying_question),
      mine && answerBox(idea)
    ),

    caps.length > 0 && el("section", {},
      el("h3", {}, "What it would take"),
      el("ul", { class: "capdetails" }, ordered.map(capabilityDetail))
    ),

    mine && shareControl(idea, groups),

    // extraction_runs are readable by the owner only, so a friend would see 0
    mine && el("details", { class: "runs" },
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
  if (state.route === "group") return void mount(app, groupView());
  if (state.route === "friend") return void mount(app, friendView());
  if (state.route === "waifu") return void mount(app, waifuView());
  mount(app, state.route === "profile" ? profileView() : listView());
}

async function run(fn) {
  state.busy = true; state.error = null; render();
  try { await fn(); }
  catch (err) { state.error = err.message; }
  finally { state.busy = false; render(); }
}

// Display names for whoever the current view mentions; cached for the session.
async function loadNames(ids) {
  const missing = ids.filter((id) => !state.names.has(id));
  for (const p of await profilesFor(missing)) state.names.set(p.user_id, p.display_name);
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
    const me = state.session.user.id;
    const [ideaRows, capRows, pool] = await Promise.all([ideas(me), capabilities(), groupSkills(me)]);
    state.ideas = ideaRows;
    state.caps = capRows;
    state.pool = pool;
    await loadNames([...new Set([...pool.values()].flat())]);
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
  } else if (state.route === "profile") {
    state.profile = await myProfile(state.session.user.id);
  } else if (state.route === "group") {
    const me = state.session.user.id;
    const [profile, groups, feed, capRows, pool] = await Promise.all([
      myProfile(me), myGroups(), sharedIdeas(), capabilities(), groupSkills(me)
    ]);
    state.profile = profile;
    state.feed = feed;
    state.caps = capRows;
    state.pool = pool;
    await loadNames([...new Set([...feed.map((i) => i.user_id), ...[...pool.values()].flat()])]);
    // members and names in two queries: group_members points at auth.users,
    // not profiles, so PostgREST cannot embed one in the other
    state.groups = await Promise.all(groups.map(async (g) => {
      const [members, invites] = await Promise.all([groupMembers(g.id), pendingInvites(g.id)]);
      const names = new Map((await profilesFor(members.map((m) => m.user_id))).map((p) => [p.user_id, p.display_name]));
      return { ...g, invites, members: members.map((m) => ({ ...m, display_name: names.get(m.user_id) })) };
    }));
    if (!state.groups.some((g) => g.id === state.confirmDelete)) state.confirmDelete = null;
  } else if (state.route === "idea") {
    const id = currentIdeaId();
    const [one, caps, runs, groups] = await Promise.all([
      fetchIdea(id), capabilitiesFor(id), runsFor(id), myGroups()
    ]);
    // a missing object (upload failed, decision 9) must not take the page down
    const imageUrl = one.image_path ? await mediaUrl(one.image_path).catch(() => null) : null;
    state.detail = { idea: one, caps, runs, groups, imageUrl };
    if (one.user_id !== state.session.user.id) await loadNames([one.user_id]);
  } else if (state.route === "friend") {
    const id = currentFriendId();
    const [profiles, levels] = await Promise.all([profilesFor([id]), skillsFor(id)]);
    // RLS hides a stranger's rows rather than refusing them
    if (!profiles.length) throw new Error("No such person, or you are not in a group with them.");
    state.friend = { profile: profiles[0], levels: new Map(levels.map((r) => [r.skill_id, r.level])) };
  }
}

addEventListener("hashchange", () => {
  state.route = currentRoute();
  status.textContent = "";
  state.detail = null;
  state.friend = null;
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
