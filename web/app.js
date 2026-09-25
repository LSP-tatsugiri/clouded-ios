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
  addFeedback, addIdea, amCurator, capabilities, capabilitiesFor, createGroup, db, deleteGroup, deleteIdea,
  groupMembers, groupSkills, idea as fetchIdea, ideas, invite, mediaUrl, myFeedback, myGroups, myProfile,
  mySkills, pendingInvites, profilesFor, promoteSkill, proposedSkills, rejectSkill, removeMember, renameGroup,
  revokeInvite, runsFor, session, setClarification, setDisplayName, setShare, setSkillLevel, sharedIdeas,
  signIn, signOut, signUp, skills, skillsFor, uploadFeedbackShot
} from "./lib/db.js";
import { el, mount } from "./lib/dom.js";
import { canDictate, dictation } from "./lib/speech.js";
// build.mjs writes COMMIT into config.js on the host; the hand-written local
// config.js has no such export, and a named import of a missing export fails
// at link time, so read it off the namespace
import * as config from "./config.js";

const COMMIT = config.COMMIT ?? "dev";
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
const ROUTES = new Set(["profile", "review", "group", "waifu", "report"]);

const app = document.getElementById("app");
const state = {
  session: null,
  route: currentRoute(),
  ideas: [],
  caps: [],
  skills: [],          // 51 rows, seeded by migration, cached after first load
  levels: new Map(),   // skill_id -> none | some | solid
  filters: { domain: "", crux: "", proposed: false, friend: false, q: "" },
  sort: "closest",     // Ideas tab: closest (the distance sort) | newest
  pool: new Map(),     // skill_id -> [user_id] of group mates holding it solid
  names: new Map(),    // user_id -> display_name, for everyone in your groups
  curator: null,       // null = not yet checked
  proposals: [],
  detail: null,        // { idea, caps, runs, groups } for the idea page
  profile: null,       // { user_id, display_name } — yours
  groups: [],          // { id, name, created_by, members: [{ user_id, display_name, added_at }], invites: [{ email }] }
  confirmDelete: null, // group id whose delete button is waiting for a second click
  confirmDeleteIdea: false, // the idea page's delete button is waiting for a second click
  moved: "",           // idea page: what the last rating changed, one line
  feed: [],            // shared ideas from every group, newest first (decision 12)
  feedSort: "newest",  // "newest" | "closest"
  friend: null,        // { profile, levels } for the friend profile page
  waifu: { phase: "asking", ideaId: null, line: null }, // #/waifu: asking | sending | saved | failed
  // "signin" | "create" on the sign-in card; the landing's invite link opens it on create
  authMode: location.hash === "#create" ? "create" : "signin",
  reportFrom: "",      // the hash the footer link was clicked on; a report records it as its route
  reportKind: "bug",   // "bug" | "improvement" on the report form
  reports: [],         // your feedback rows, newest first
  draft: { title: "", body: "", file: null }, // the report form, kept across re-renders (watch() repaints every 2 s)
  sent: null,          // { id, number, error } after a report is sent, while the number is awaited
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
  // assets/mark.svg inline (minus its style block) so the brackets take
  // --ink and the cloud --flow from the page; keep the two files in step
  t.innerHTML =
    `<svg viewBox="0 0 36 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="M7 3H3v18h4M29 3h4v18h-4" stroke="var(--ink)"/>` +
    `<path d="M13 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 12.1 9.6 4.2 4.2 0 0 0 13 18Z" stroke="var(--flow)"/></svg>`;
  return t.content.firstElementChild;
}

function header() {
  const site = state.route !== "waifu";   // the waifu header keeps its plain markup
  const tab = (href, label, route) => {
    const on = state.route === route;
    return el("a", {
      href, class: on ? "tab on" : "tab",
      style: site && on ? "view-transition-name: tab-on" : null
    }, label);
  };
  return el("header", { style: site ? "view-transition-name: app-header" : null },
    el("h1", {}, site && brandMark(), "clouded"),
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

// While signed out, #app holds one <dialog> with the sign-in card in it, and
// the static landing (index.html) shows behind. The dialog is open exactly
// when the hash is #signin or #create, which is what the landing's top bar
// and hero link to; closing it (Escape, the ×, a click on the backdrop)
// drops the hash again without a hashchange, so nothing reloads. One element
// for the life of the page: re-rendering the card inside it keeps it open
// without a backdrop flicker.
const AUTH_HASH = /^#(signin|create)$/;
function dropAuthHash() {
  if (AUTH_HASH.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
}
// Every way out drops the hash itself rather than trusting the close event
// alone: the ×, the backdrop, and Escape (the cancel event, which precedes
// the browser's own close). The close handler stays as the catch-all.
function closeAuth() { dropAuthHash(); if (authDialog.open) authDialog.close(); }
const authDialog = el("dialog", {
  class: "auth", "aria-label": "Sign in or create an account",
  onclose: dropAuthHash,
  oncancel: dropAuthHash,
  // the dialog box is exactly the card, so a click whose target is the
  // dialog itself landed on the backdrop
  onclick: (e) => { if (e.target === authDialog) closeAuth(); }
});

function paintAuth() {
  if (!app.contains(authDialog)) mount(app, authDialog);
  mount(authDialog,
    el("button", { type: "button", class: "auth-close", "aria-label": "Close", onclick: closeAuth }, "×"),
    signInView());
  const wanted = AUTH_HASH.test(location.hash);
  if (wanted && !authDialog.open) authDialog.showModal();
  if (!wanted && authDialog.open) authDialog.close();
  // a repaint rebuilds the form under the cursor (run() paints twice); put
  // focus back in the first field so typing carries on
  if (authDialog.open && !authDialog.contains(document.activeElement)) authDialog.querySelector("input")?.focus();
}

// One card, two modes. Creating an account is self-serve but gated: the
// server refuses emails that were not invited (docs/hosting.md), and the
// message says so rather than looking like a wrong password.
function signInView() {
  const creating = state.authMode === "create";
  const setMode = (mode) => {
    state.authMode = mode; state.error = null;
    if (AUTH_HASH.test(location.hash)) history.replaceState(null, "", `#${mode}`);
    render();
  };
  const form = el("form", {
    class: "card signin",
    onsubmit: (e) => {
      e.preventDefault();
      const email = form.elements.email.value.trim();
      const password = form.elements.password.value;
      run(() => (creating ? signUp(email, password) : signIn(email, password)));
    }
  },
    el("h1", {}, brandMark(), "clouded"),
    el("p", { class: "muted" },
      "How far each idea is from something you could actually build."),
    // the two modes as a switch, so which one you are in is never a guess
    el("div", { class: "seg auth-seg", "aria-label": "Sign in or create an account" },
      el("button", { type: "button", "aria-pressed": String(!creating), onclick: () => setMode("signin") }, "Sign in"),
      el("button", { type: "button", "aria-pressed": String(creating), onclick: () => setMode("create") }, "Create account")),
    el("p", { class: "how" },
      creating
        ? "Accounts are invite-only. Use the email address a friend invited, and choose a password of at least 8 characters. There is no confirmation email: you are signed in as soon as the account exists."
        : "Use the email and password you chose when you created your account. First time here? Switch to Create account."),
    el("label", { class: "fld" }, "Email",
      el("input", { name: "email", type: "email", required: true, autocomplete: "username", placeholder: creating ? "the address you were invited with" : null })),
    el("label", { class: "fld" }, creating ? "Choose a password" : "Password",
      el("input", {
        name: "password", type: "password", required: true, minlength: 8,
        placeholder: creating ? "at least 8 characters" : null,
        autocomplete: creating ? "new-password" : "current-password"
      })),
    el("button", { type: "submit", class: "btn", disabled: state.busy },
      state.busy ? (creating ? "Creating…" : "Signing in…") : (creating ? "Create account" : "Sign in")),
    state.error && el("p", { class: "error" }, state.error),
    el("p", { class: "muted switch" },
      creating
        ? "Not invited yet? Ask a friend who uses clouded to add your email on their Group tab."
        : ["No account yet? ", el("a", { href: "#create", onclick: (e) => { e.preventDefault(); setMode("create"); } }, "Create one"), "."])
  );
  return form;
}

// ---------------------------------------------------------------- list

// Size a textarea to its text. Borders sit outside scrollHeight, hence the
// offset/client difference; the CSS max-height caps it and scrolls past that.
function grow(t) {
  t.style.height = "auto";
  t.style.height = `${t.scrollHeight + t.offsetHeight - t.clientHeight}px`;
}

// One element for the session, like searchBox: watch() repaints the whole list
// every 2 s while an idea extracts, and a textarea rebuilt under a half-typed
// or half-spoken idea would lose the text, the caret and the live recognition.
//
// A textarea, not an input: a long idea wraps and the box grows with it, so the
// whole thing is readable before it is sent. Enter sends, Shift+Enter breaks
// the line.
const captureBox = el("textarea", {
  name: "raw", "aria-label": "New idea", rows: 1, autocomplete: "off",
  placeholder: "An idea, in as few words as you like",
  oninput: (e) => grow(e.target),
  onkeydown: (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); captureBox.form?.requestSubmit(); }
  }
});

// Dictation, where the browser has an engine for it; null in Firefox, and then
// nothing about the box changes. See web/lib/speech.js for why it discloses.
const mic = canDictate() ? dictation(captureBox) : null;

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

function ideaRow({ idea, extraction }, glide = true) {
  const d = distanceOf(extraction, state.levels);
  const crux = cruxOf(extraction);
  const anyProposed = extraction.capabilities.some((c) => !c.skill_id);
  const title = idea.objective || idea.raw;
  const landed = justLanded.has(idea.id);

  return el("article", {
    class: landed ? "card idea fade-in" : "card idea", "data-idea": idea.id, tabindex: 0,
    style: glide ? `view-transition-name: idea-${idea.id}` : null
  },
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
function vagueRow(idea, glide = true) {
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
  return el("article", {
    class: justLanded.has(idea.id) ? "card idea vague fade-in" : "card idea vague", tabindex: 0,
    style: glide ? `view-transition-name: idea-${idea.id}` : null
  },
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
  const set = (k, v) => { state.filters[k] = v; render({ animate: true }); };
  const sortButton = (key, label) => el("button", {
    type: "button", "aria-pressed": String(state.sort === key),
    onclick: () => { state.sort = key; render({ animate: true }); }
  }, label);
  const filtering = state.filters.domain || state.filters.crux || state.filters.proposed || state.filters.friend || state.filters.q;
  return el("div", { class: "controls" },
    el("div", { class: "seg", role: "group", "aria-label": "Sort" },
      sortButton("closest", "Closest to me"), sortButton("newest", "Newest")),
    searchBox,
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
      el("button", { class: "link", onclick: () => { state.filters = { domain: "", crux: "", proposed: false, friend: false, q: "" }; searchBox.value = ""; render({ animate: true }); } }, "clear"),
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
  // every word typed must appear somewhere in what the card shows
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (idea) => {
    const hay = `${idea.raw} ${idea.objective ?? ""} ${idea.domain ?? ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  };
  const vagueShown = vague.filter((r) => matches(r.idea));
  const shown = clear.filter((r) =>
    matches(r.idea) &&
    (!f.domain || r.idea.domain === f.domain) &&
    (!f.crux || cruxStatus(r.extraction, state.levels) === f.crux) &&
    (!f.proposed || r.extraction.capabilities.some((c) => !c.skill_id)) &&
    (!f.friend || friendMarker(r).cruxHeld));

  const add = el("form", {
    class: "capture",
    onsubmit: (e) => {
      e.preventDefault();
      mic?.stop();   // a word still being transcribed is not part of the idea
      const raw = captureBox.value.trim();
      if (!raw) return;
      // load() sees the new row as pending and starts watching it
      run(async () => { await addIdea(raw); captureBox.value = ""; grow(captureBox); await load(); });
    }
  },
    captureBox,
    mic?.button,
    el("button", { type: "submit", class: "btn", disabled: state.busy }, "Add idea"),
    // adding runs extraction server-side, which is a paid API call
    el("span", { class: "cost" }, "extracts on save, about 1¢"),
    mic?.note
  );

  const rated = state.levels.size;
  const glide = shown.length + vagueShown.length <= 40;
  const card = (r) => r.idea.is_clear === true ? ideaRow(r, glide) : vagueRow(r.idea, glide);

  // Closest to me groups by how many skills are short (the flat gap count
  // distance.js already gives); newest is one list by date, vague included.
  let body;
  if (state.sort === "newest") {
    const all = [...shown, ...vagueShown].sort((a, b) => Date.parse(b.idea.created_at) - Date.parse(a.idea.created_at));
    body = el("div", { class: "cards" }, all.map(card));
  } else {
    const bandOf = (r) => {
      const gap = distanceOf(r.extraction, state.levels).gap;
      return gap === 0 ? "now" : gap === 1 ? "one" : "far";
    };
    const byBand = new Map(BANDS.map(([k]) => [k, []]));
    for (const r of shown) byBand.get(bandOf(r)).push(r);
    for (const r of vagueShown) byBand.get("vague").push(r);
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
// radio change would pull focus out of the control being used. The bar, the
// text and the per-domain counts in the side panel are all repainted here.
const status = el("span", { class: "status" }, "");

// One element for the session, like `status`: mount() rebuilds the page on
// every keystroke, and a rebuilt input would lose its text and the caret.
// No glide while typing — a view transition per keystroke fights the caret.
const searchBox = el("input", {
  type: "search", class: "search", "aria-label": "Search ideas", placeholder: "Search", autocomplete: "off",
  oninput: () => { state.filters.q = searchBox.value; render(); searchBox.focus(); }
});
const tally = el("p", { class: "tally-text" }, "");
const ratedBar = el("div", { class: "rated-bar", "aria-hidden": "true" });
const domainCounts = new Map();   // domain -> the "rated/total" span in the side panel

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function refreshTally() {
  const n = { none: 0, some: 0, solid: 0, unrated: 0 };
  const perDomain = new Map();
  for (const s of state.skills) {
    const lv = state.levels.get(s.id);
    if (lv) n[lv]++; else n.unrated++;
    const d = s.domain || "other";
    const c = perDomain.get(d) ?? { rated: 0, total: 0 };
    c.total++; if (lv) c.rated++;
    perDomain.set(d, c);
  }
  const total = state.skills.length;
  const rated = total - n.unrated;
  tally.textContent =
    `${rated} of ${total} rated: ${n.solid} solid, ${n.some} some, ${n.none} none. ${n.unrated} still unrated.`;
  const pct = (k) => total ? `${(n[k] / total * 100).toFixed(1)}%` : "0%";
  ratedBar.replaceChildren(
    el("i", { class: "solid", style: `width:${pct("solid")}` }),
    el("i", { class: "some", style: `width:${pct("some")}` }),
    el("i", { class: "none", style: `width:${pct("none")}` })
  );
  for (const [domain, span] of domainCounts) {
    const d = perDomain.get(domain);
    span.textContent = d ? `${d.rated}/${d.total}` : "";
  }
}

function save(skillId, level) {
  const before = new Map(state.levels);
  state.levels.set(skillId, level);
  refreshTally();
  status.textContent = "saving…";
  status.className = "status";
  setSkillLevel(state.session.user.id, skillId, level)
    .then(ensureIdeas)
    .then(() => { status.textContent = whatMoved(skillId, before, state.levels); })
    .catch((err) => { status.textContent = err.message; status.className = "status error"; });
}

// The list loads ideas and capabilities; the profile and the idea page do
// not, and "what moved" needs them once.
async function ensureIdeas() {
  if (state.ideas.length) return;
  const me = state.session.user.id;
  [state.ideas, state.caps] = await Promise.all([ideas(me), capabilities()]);
}

// The one line the product exists to produce: a level changed, and this is
// what it did to your ideas. Distances before and after, over your own ideas
// (state.ideas is yours; a friend's shared ideas are not in it).
function whatMoved(skillId, before, after) {
  const capsById = new Map();
  for (const c of state.caps) {
    if (!capsById.has(c.idea_id)) capsById.set(c.idea_id, []);
    capsById.get(c.idea_id).push(c);
  }
  let closer = 0, further = 0, cleared = 0;
  for (const idea of state.ideas) {
    const ex = extractionOf(idea, capsById);
    const a = distanceOf(ex, before), b = distanceOf(ex, after);
    if (!a || !b) continue;
    if (b.score < a.score) { closer++; if (b.gap === 0 && a.gap > 0) cleared++; }
    else if (b.score > a.score) further++;
  }
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const parts = [];
  if (closer) parts.push(`${n(closer, "idea", "ideas")} moved closer`);
  if (cleared) parts.push(`${cleared} now ${cleared === 1 ? "has" : "have"} no gap left`);
  if (further) parts.push(`${n(further, "idea", "ideas")} moved further away`);
  return `${skillId} → ${after.get(skillId)}. ${parts.length ? parts.join("; ") + "." : "Nothing moved."}`;
}

// Radios, so the keyboard works and focus stays put. An unrated skill checks
// nothing: a row with no level is not "none" (db.js, setSkillLevel), and the
// dashed control and the "not rated" tag hang off that in CSS.
function levelControl(skill) {
  const current = state.levels.get(skill.id);
  return el("div", { class: "lvl", role: "radiogroup", "aria-label": skill.name },
    LEVELS.map((lv) => el("label", { "data-l": lv },
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
  return el("div", { class: "skill" },
    el("div", {},
      el("div", { class: "nm" },
        skill.name,
        skill.hazard && el("span", { class: "tag warn", title: "involves a real hazard" }, "hazard")
      ),
      el("code", {}, skill.id)
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
  domainCounts.clear();
  const count = (domain) => {
    const span = el("span", { class: "c" });
    domainCounts.set(domain, span);
    return span;
  };
  const jump = (domain) => el("a", {
    href: `#d-${slug(domain)}`,
    onclick: (e) => {
      // a plain hash link would change the route; scroll instead
      e.preventDefault();
      document.getElementById(`d-${slug(domain)}`)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });
    }
  },
    el("span", {}, domain),
    count(domain)
  );

  const view = el("div", { class: "profile" },
    header(),
    el("div", { class: "page-head" },
      el("div", {},
        el("h1", {}, "Your skills"),
        el("p", {}, "Be honest. An inflated profile makes every distance wrong.")),
      nameForm()
    ),
    state.error && el("p", { class: "error" }, state.error),
    el("div", { class: "rated" }, ratedBar, el("div", { class: "rated-row" }, tally, status)),
    el("div", { class: "layout" },
      el("div", {},
        [...byDomain].map(([domain, list]) => el("section", { class: "dom card", id: `d-${slug(domain)}` },
          el("h2", {}, domain),
          list.map(skillRow)
        )),
        el("p", { class: "card all-rated" }, "Every skill is rated.")
      ),
      el("aside", { "aria-label": "Domains" },
        el("h2", {}, "Domains"),
        el("p", {}, "Rated out of total in each."),
        el("ol", { class: "domains" }, [...byDomain.keys()].map((d) => el("li", {}, jump(d)))),
        // pure CSS: the page hides rated rows while this is checked
        el("label", { class: "chk unrated-only" },
          el("input", { type: "checkbox", id: "unrated-only" }),
          el("span", {}, "Show only unrated"))
      )
    )
  );
  refreshTally();
  return view;
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
    el("label", { class: "fld" }, "Your name, as friends see it",
      el("span", { class: "row" },
        el("input", { name: "name", value: state.profile?.display_name ?? "", maxlength: 60, required: true, autocomplete: "nickname" }),
        el("button", { type: "submit", class: "btn sm ghost", disabled: state.busy }, "Save")))
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
    onclick: () => { state.feedSort = key; render({ animate: true }); }
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
        ? el("div", { class: "cards" }, rows.map((r) => feedRow(r, me, rows.length <= 40)))
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

function feedRow({ idea, extraction }, me, glide = true) {
  const owner = idea.user_id === me
    ? el("span", { class: "owner" }, "you")
    : el("a", { href: `#/friend/${idea.user_id}`, class: "owner" }, state.names.get(idea.user_id) ?? "a friend");
  const title = idea.objective || idea.raw;
  if (idea.is_clear !== true) {
    return el("article", { class: "card idea vague", tabindex: 0, style: glide ? `view-transition-name: idea-${idea.id}` : null },
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

  return el("article", { class: "card idea", tabindex: 0, style: glide ? `view-transition-name: idea-${idea.id}` : null },
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
    el("p", { class: "back" }, el("a", { href: "#/group" }, "← group")),
    el("div", { class: "page-head" },
      el("div", {},
        el("h1", {}, f.profile.display_name),
        el("p", { class: "tally-text" }, `${solid} solid, ${some} some`))),
    byDomain.size
      ? [...byDomain].map(([domain, list]) => el("section", { class: "dom card" },
          el("h2", {}, domain),
          list.map(({ skill, level }) => el("div", { class: "skill" },
            el("div", {},
              el("div", { class: "nm" }, skill.name),
              el("code", {}, skill.id)),
            el("span", { class: `tag level-${level}` }, level)
          ))
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

// The mark on the idea page is the control: a click cycles your level for
// that skill, so rating happens where the gap shows and not only on the
// profile form. A proposed capability has no skill to rate and stays text.
function levelMark(cap, k) {
  if (!cap.skill_id) return mark(k);
  const current = state.levels.get(cap.skill_id) ?? "none";
  const next = LEVELS[(LEVELS.indexOf(current) + 1) % LEVELS.length];
  return el("button", {
    class: `mark ${k} rate`, type: "button", "data-skill": cap.skill_id,
    title: `you: ${current} · click for ${next}`,
    "aria-label": `${capLabel(cap)} — you: ${current}. Set ${next}`,
    onclick: () => rate(cap.skill_id, next)
  }, MARK[k]);
}

async function rate(skillId, level) {
  const before = new Map(state.levels);
  state.levels.set(skillId, level);
  state.moved = "saving…";
  render();
  try {
    await setSkillLevel(state.session.user.id, skillId, level);
    await ensureIdeas();
    state.moved = whatMoved(skillId, before, state.levels);
  } catch (err) {
    state.levels = before;
    state.moved = err.message;
  }
  render();
  // mount() rebuilt the page; put the keyboard back where it was
  document.querySelector(`button.rate[data-skill="${skillId}"]`)?.focus();
}

function capabilityDetail(cap) {
  const k = classify(cap, state.levels);
  const isCrux = cap.crux_rank === 1;
  return el("li", { class: `capdetail ${k}${isCrux ? " is-crux" : ""}` },
    el("div", { class: "capdetail-head" },
      levelMark(cap, k),
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

// Buttons, not a checkbox (2026-09-19): one "Share with <group>" per group
// while the idea is private, and "Make private" once it is shared. The same
// markup covers one group (the normal case) and several. Private ideas get
// the one hint about what sharing unlocks.
function shareControl(idea, groups) {
  const share = (groupId) => run(async () => { await setShare(idea.id, groupId); await load(); });
  const current = groups.find((g) => g.id === idea.shared_to);
  const control = el("div", { class: "share-row" },
    current
      ? [el("span", { class: "share-state" }, `Shared with ${current.name}`),
         el("button", { type: "button", class: "sm secondary", disabled: state.busy, onclick: () => share(null) }, "Make private")]
      : groups.map((g) =>
          el("button", { type: "button", class: "btn sm", disabled: state.busy, onclick: () => share(g.id) }, `Share with ${g.name}`)));
  return el("div", { class: "share" },
    control,
    !groups.length && el("p", { class: "muted" },
      "No group yet. Sharing needs one — ", el("a", { href: "#/group" }, "create it on the Group tab"), "."),
    groups.length > 0 && !idea.shared_to && el("p", { class: "muted" },
      "Private. Share it to see which friend already holds what it needs.")
  );
}

// Owner only. Two clicks, like deleting a group; the row, its capabilities and
// its runs go together, and the list is where you land afterwards.
function deleteControl(idea) {
  return el("div", { class: "delete" },
    state.confirmDeleteIdea
      ? el("div", {},
          el("p", { class: "hint" }, "Delete this idea? Its extraction goes with it."),
          el("div", { class: "row" },
            el("button", { class: "btn sm warn", type: "button", onclick: () => run(async () => {
              state.confirmDeleteIdea = false;
              await deleteIdea(idea.id, idea.image_path);
              state.detail = null;
              location.hash = "#/";
            }) }, "Yes, delete"),
            el("button", { class: "btn sm ghost", type: "button", onclick: () => { state.confirmDeleteIdea = false; render(); } }, "Keep it")))
      : el("button", { class: "link danger", type: "button", onclick: () => { state.confirmDeleteIdea = true; render(); } }, "Delete idea")
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
    el("label", { class: "fld" }, "Your answer",
      el("textarea", {
        name: "clarification", rows: 2, required: true,
        placeholder: "Say what the thing actually is"
      })),
    el("p", { class: "hint" }, "Answering re-runs extraction. That is one API call, about a cent."),
    el("button", { type: "submit", class: "btn sm", disabled: state.busy }, state.busy ? "Working…" : "Answer and re-extract")
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
    el("p", { class: "back" }, el("a", { href: "#/" }, "← all ideas")),

    el("div", { class: "card detail" },
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

    idea.is_clear === false && el("section", { class: "ask" },
      el("p", {}, el("b", {}, "Too vague to extract. "), idea.clarifying_question),
      mine && answerBox(idea)
    ),

    caps.length > 0 && el("section", {},
      el("h3", {}, "What it would take"),
      el("ul", { class: "capdetails" }, ordered.map(capabilityDetail)),
      el("p", { class: "rate-hint" }, "Click a mark to rate yourself on that skill."),
      state.moved && el("p", { class: "moved", role: "status" }, state.moved)
    ),

    mine && shareControl(idea, groups),
    mine && deleteControl(idea),

    // extraction_runs are readable by the owner only, so a friend would see 0
    mine && el("details", { class: "runs" },
      el("summary", {}, `Extraction history (${runs.length})`),
      el("ul", { class: "runs-list" }, runs.map((r) => el("li", {},
        el("span", { class: "mark" }, r.error ? "✕" : "·"),
        el("span", {}, `${new Date(r.created_at).toLocaleString()} · ${r.model} · ${r.prompt_hash}` +
          (r.error ? ` · ${r.error.slice(0, 80)}` : ""))
      )))
    )
    )
  );
}

// ---------------------------------------------------------------- review

// A proposal is the model asking for a skill the table does not have. Nothing
// is created automatically, which is the invariant; this is the human step.
// There is no undo: promotion inserts the skill and repoints capabilities,
// and db.js has nothing that reverses either, so a decided card only moves
// to "Already decided".
function proposalCard(p) {
  const settled = p.promoted || p.rejected;
  const formId = `promote-${p.key}`;

  const form = el("form", {
    class: "promote", id: formId,
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
    el("div", { class: "grid2" },
      el("label", { class: "fld" }, "Skill id",
        el("input", { name: "skillId", value: p.key, required: true, autocomplete: "off" })),
      el("label", { class: "fld" }, "Domain",
        el("input", {
          name: "domain", autocomplete: "off", list: "domains",
          placeholder: `e.g. ${[...new Set(state.skills.map((s) => s.domain).filter(Boolean))][0] ?? "fabrication"}`
        })),
      el("label", { class: "fld full" }, "Name, as a checkable task, not a depth label",
        el("input", {
          name: "name", required: true, autocomplete: "off",
          placeholder: "e.g. Measure a real object and design a part that fits it"
        })),
      el("label", { class: "fld full" }, "Aliases, comma separated",
        el("input", { name: "aliases", value: p.names.join(", "), autocomplete: "off" }))
    ),
    el("label", { class: "chk hazard" },
      el("input", { type: "checkbox", name: "hazard" }),
      el("span", {}, "Involves a real hazard"))
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
    el("input", { name: "why", placeholder: "Why this isn't a skill", required: true, autocomplete: "off" }),
    el("button", { class: "btn sm warn", type: "submit", disabled: state.busy }, "Reject")
  );

  const n = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return el("article", { class: settled ? "card rv gone" : "card rv", id: `p-${p.key}`, tabindex: 0 },
    el("div", { class: "card-head" },
      el("h3", {}, p.key),
      el("div", { class: "meta" },
        el("span", { class: "tag" }, n(p.idea_ids.length, "idea")),
        el("span", { class: "tag" }, n(p.run_count, "run")),
        p.crux_count > 0 && el("span", { class: "tag hard" }, `the hard part ×${p.crux_count}`)
      )
    ),
    p.names.length > 1 && el("p", { class: "raw" }, `also seen as: ${p.names.filter((x) => x !== p.key).join(", ")}`),
    p.reasons.length > 0 && el("div", { class: "why" },
      el("b", {}, "Why the model proposed it: "),
      p.reasons.length === 1 ? p.reasons[0] : el("ul", {}, p.reasons.map((r) => el("li", {}, r)))
    ),

    p.promoted && el("p", { class: "decided" }, mark("have"), ` promoted to ${p.promoted}`),
    p.rejected && el("p", { class: "decided" }, mark("gap"), ` rejected: ${p.rejected}`),
    !settled && form,
    // the promote button submits the form above through its id, so the
    // reject form can sit beside it without nesting forms
    !settled && el("div", { class: "actions" },
      el("button", { type: "submit", class: "btn sm", form: formId, disabled: state.busy }, "Promote to a skill"),
      reject
    )
  );
}

function reviewView() {
  if (state.curator !== true) {
    return el("div", {}, header(),
      el("p", { class: "muted" }, "Skill review is for curators. This account is not one."));
  }
  const open = state.proposals.filter((p) => !p.promoted && !p.rejected);
  const settled = state.proposals.filter((p) => p.promoted || p.rejected);
  const jump = (p) => el("a", {
    href: `#p-${p.key}`,
    onclick: (e) => {
      // a plain hash link would change the route; scroll instead
      e.preventDefault();
      document.getElementById(`p-${p.key}`)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    }
  },
    el("span", { class: "key" }, p.key),
    el("span", { class: "c" }, p.crux_count > 0 ? "crux" : "")
  );

  return el("div", {},
    header(),
    el("div", { class: "page-head" },
      el("div", {},
        el("h1", {}, "Proposed skills"),
        el("p", {}, "The model proposes a skill when nothing in the table covers a capability. Nothing is added until you promote it."))
    ),
    state.error && el("p", { class: "error" }, state.error),
    el("datalist", { id: "domains" },
      [...new Set(state.skills.map((s) => s.domain).filter(Boolean))].map((d) => el("option", { value: d }))),
    el("div", { class: "layout" },
      el("div", {},
        open.length
          ? el("div", { class: "cards" }, open.map(proposalCard))
          : el("p", { class: "muted" }, "Nothing proposed. Every capability matched a skill already in the table."),
        settled.length > 0 && el("details", { class: "settled-block" },
          el("summary", {}, `Already decided (${settled.length})`),
          el("div", { class: "cards" }, settled.map(proposalCard))
        )
      ),
      el("aside", { "aria-label": "Queue" },
        el("h2", {}, "Waiting for review"),
        el("p", {}, `${open.length} proposal${open.length === 1 ? "" : "s"} waiting.`),
        el("ol", { class: "domains queue" }, open.map((p) => el("li", {}, jump(p))))
      )
    )
  );
}

// ---------------------------------------------------------------- report

// Bug and improvement reports go into the feedback table and from there,
// through the report edge function, to a GitHub issue. The reporter sees
// "sent, #N" and nothing more (docs/feedback-plan.md, decision 5). The
// tracker is public, so the form says what leaves the account: the display
// name and the text, never the email or the picture.
function reportView() {
  const d = state.draft;
  const kindBtn = (kind, label) => el("button", {
    type: "button", "aria-pressed": String(state.reportKind === kind),
    onclick: () => { state.reportKind = kind; render(); }
  }, label);
  const form = el("form", {
    class: "report-form",
    onsubmit: (e) => {
      e.preventDefault();
      const title = d.title.trim();
      const body = d.body.trim();
      const file = d.file;
      if (!title || !body) return;
      const id = crypto.randomUUID();
      run(async () => {
        const me = state.session.user.id;
        const screenshot_path = file ? await uploadFeedbackShot(me, id, file) : null;
        await addFeedback({
          id, kind: state.reportKind, surface: "web", title, body,
          route: state.reportFrom || null, app_version: COMMIT, device: navigator.userAgent, screenshot_path
        });
        state.draft = { title: "", body: "", file: null };
        state.sent = { id, number: null, error: null };
        state.reports = await myFeedback();
      }).then(() => state.sent?.id === id && awaitIssue(id));
    }
  },
    el("div", { class: "seg", "aria-label": "Kind of report" },
      kindBtn("bug", "Something broke"), kindBtn("improvement", "Something could be better")),
    el("label", { class: "fld" }, "Title",
      el("input", { name: "title", required: true, maxlength: 120, autocomplete: "off", value: d.title,
        oninput: (e) => { d.title = e.target.value; },
        placeholder: state.reportKind === "bug" ? "What went wrong, in a line" : "What would be better, in a line" })),
    el("label", { class: "fld" }, state.reportKind === "bug" ? "What happened" : "What you would change",
      el("textarea", { name: "body", required: true, maxlength: 4000, rows: 5,
        oninput: (e) => { d.body = e.target.value; },
        placeholder: state.reportKind === "bug" ? "What you did, what you expected, what you got instead" : "The change, and what it would fix for you" }, d.body)),
    el("label", { class: "fld" }, "Screenshot, optional",
      shotInput()),
    el("p", { class: "hint" },
      "Filed on GitHub as an issue under your display name — the tracker is public, so keep private idea text out. The screenshot stays private."),
    el("button", { type: "submit", class: "btn sm", disabled: state.busy }, state.busy ? "Sending…" : "Send report"),
    state.error && el("p", { class: "error" }, state.error)
  );

  const sentLine = () => {
    const s = state.sent;
    if (!s) return null;
    const text = s.number ? `Sent — #${s.number}`
      : s.error ? "Sent — filing failed, it's saved and will be retried"
      : "Sent — filing…";
    return el("p", { class: "sent" }, text);
  };
  const numberOf = (r) => r.github_issue_number ? `#${r.github_issue_number}`
    : r.github_error ? "filing failed, will retry" : "filing…";

  return el("div", { class: "report" }, header(),
    el("h2", {}, "Report a problem"),
    el("p", { class: "muted" }, "A bug, or something that could be better. It goes to the tracker with the page you came from and the build you are on."),
    sentLine(),
    form,
    state.reports.length > 0 && el("section", { class: "reports" },
      el("h3", { class: "sub-h" }, "Your reports"),
      el("ul", { class: "plain" },
        state.reports.map((r) => el("li", {},
          el("span", { class: "r-title" }, r.title),
          el("span", { class: "r-meta" }, `${r.kind} · ${fmtDate(r.created_at)} · ${numberOf(r)}`))))
    )
  );
}

// A file input cannot take a value attribute; a DataTransfer puts the kept
// file back after a re-render so the picker still shows its name.
function shotInput() {
  const input = el("input", { name: "shot", type: "file", accept: "image/jpeg,image/png,image/webp",
    onchange: (e) => { state.draft.file = e.target.files[0] || null; } });
  if (state.draft.file) {
    try { const dt = new DataTransfer(); dt.items.add(state.draft.file); input.files = dt.files; } catch { /* keep the File in state regardless */ }
  }
  return input;
}

// After a send, the issue number lands a second or two later; look for it
// every 2 s for 10 s, then leave whatever the list says.
async function awaitIssue(id) {
  for (let i = 0; i < 5 && state.sent?.id === id && !state.sent.number && !state.sent.error; i++) {
    await sleep(2000);
    if (state.route !== "report" || state.sent?.id !== id) return;
    try { state.reports = await myFeedback(); } catch { continue; }
    const r = state.reports.find((x) => x.id === id);
    if (r) state.sent = { id, number: r.github_issue_number, error: r.github_error };
    render();
  }
}

// On every page but the waifu scene: the way to report, and which build this
// is, so a report can say so. Remembers the page it was clicked on.
function footer() {
  return el("footer", { class: "foot", style: "view-transition-name: app-footer" },
    el("a", { href: "#/report", onclick: () => { state.reportFrom = location.hash; } }, "report a problem"),
    el("span", { class: "sep" }, "·"),
    el("span", { class: "commit", title: "the build you are on" }, COMMIT)
  );
}

// ---------------------------------------------------------------- plumbing

function viewFor() {
  if (state.route === "review") return reviewView();
  if (state.route === "report") return reportView();
  if (state.route === "idea") return ideaView();
  if (state.route === "group") return groupView();
  if (state.route === "friend") return friendView();
  if (state.route === "waifu") return waifuView();
  return state.route === "profile" ? profileView() : listView();
}

// A page switch slides in the direction of travel along the tabs, and the
// active tab's pill glides, through the View Transitions API; a sort or
// filter change asks for the same (render({ animate: true })) so the cards,
// each named after its idea, glide to their new places. Anything else, an
// extraction tick or a save, paints plainly. Nothing animates without the
// API, under reduced motion, or into or out of the waifu scene.
const ROUTE_ORDER = { list: 0, idea: 0.5, group: 1, friend: 1.5, profile: 2, review: 3, report: 4 };
let paintedRoute = null;
let latest = null;   // a transition's callback paints whatever was built last

function render({ animate = false } = {}) {
  // the static landing (index.html) shows only while signed out
  document.documentElement.classList.toggle("signed-in", !!state.session);
  if (!state.session) { paintAuth(); paintedRoute = state.route; return; }
  if (authDialog.open) authDialog.close();   // signed in from the dialog
  latest = viewFor();
  if (state.route !== "waifu") latest.append(footer());
  const paint = () => mount(app, latest);
  const switched = paintedRoute !== null && paintedRoute !== state.route;
  const can = state.session && document.startViewTransition && !reduceMotion()
    && state.route !== "waifu" && paintedRoute !== "waifu";
  if (can && (switched || animate)) {
    document.documentElement.dataset.vt = switched ? "page" : "list";
    document.documentElement.dataset.dir =
      switched && (ROUTE_ORDER[state.route] ?? 0) < (ROUTE_ORDER[paintedRoute] ?? 0) ? "back" : "fwd";
    document.startViewTransition(paint);
  } else {
    paint();
  }
  paintedRoute = state.route;
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
  } else if (state.route === "report") {
    state.reports = await myFeedback();
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
  if (/^#(signin|create)$/.test(location.hash)) state.authMode = location.hash.slice(1);   // the landing's links
  status.textContent = "";
  state.detail = null;
  state.confirmDeleteIdea = false;
  state.sent = null;
  state.moved = "";
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
