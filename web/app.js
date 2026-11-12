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
  addFeedback, addIdea, amCurator, capabilitiesFor, createGroup, db, deleteGroup, deleteIdea, extractDraft,
  groupMembers, groupSkills, idea as fetchIdea, ideas, invite, mediaUrl, myFeedback, myGroups, myProfile,
  mySkills, pendingInvites, profilesFor, promoteSkill, proposedSkills, rejectSkill, removeMember, renameGroup,
  revokeInvite, runsFor, session, setBuilt, setClarification, setDisplayName, setDropped, setShare, setSkillLevel, sharedIdeas,
  signIn, signOut, signUp, skills, skillsFor, uploadFeedbackShot, watchRuns
} from "./lib/db.js";
// its own line, apart from the list above: the Group tab's claims
import { addClaim, claimsFor, removeClaim } from "./lib/db.js";
import { el, holdFocus, mount } from "./lib/dom.js";
import { explain } from "./lib/errors.js";
import { DEFAULTS, activeCount, decodeFilters, encodeFilters, needsExtraction } from "./lib/filters.js";
import { SHORTCUTS, keyAction, nextIndex } from "./lib/keys.js";
import { claimState, claimsByIdea, groupHeld, memberCount, withClaim } from "./lib/group.js";
import { DROP_REASON_MAX, buildChoices, cleanReason, duplicateReason, isLive, lifecycleOf, movedHeadline, skillsNeeded } from "./lib/lifecycle.js";
import { UNRATED, levelChoices } from "./lib/rating.js";
import { similarIdeas } from "./lib/similar.js";
import { canDictate, dictation } from "./lib/speech.js";
import { TICK_MS, WINDOW_MS, answerPending, batchSubmit, filledAnswers, queuedSince, resultOf, startWait, step } from "./lib/wait.js";
// separate lines for the help page, run errors and the profile's lead section
import { explainRun } from "./lib/errors.js";
import { MARKS, SECTIONS } from "./lib/help.js";
import { skillsNeededList } from "./lib/lifecycle.js";
import { assumptionOf, iterationTag } from "./lib/extracted.js";
// build.mjs writes COMMIT into config.js on the host; the hand-written local
// config.js has no such export, and a named import of a missing export fails
// at link time, so read it off the namespace
import * as config from "./config.js";

const COMMIT = config.COMMIT ?? "dev";
import { ANSWER_LINK, FAILED, SAVED, SENDING, bandFor, forcedBand, opener, readBack } from "./lib/waifu.js";

const MARK = { have: "[x]", partial: "[~]", gap: "[ ]", proposed: "[?]", friend: "[+]" };
// Closest-to-me bands, by the short count: key, heading, one line under it.
const BANDS = [
  ["now", "Buildable now", "No skill missing."],
  ["one", "One skill away", "One skill short."],
  ["far", "Further out", "Two or more skills short."],
  ["vague", "Needs a detail", "Answer one question and extraction runs."],
  ["draft", "Not extracted", "Saved as written. Extract one when you want its gaps."],
  // no question to answer: no result yet, a failed run, or an answer still re-running
  ["waiting", "Not extracted yet", "Nothing to answer yet."]
];
// "draft" is the database's word; the cards say what it means
const statusWord = (s) => (s === "draft" ? "not extracted" : s);
const mark = (k) => el("span", { class: `mark ${k}` }, MARK[k]);
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Declared before `state`, because state's initialiser calls currentRoute(),
// which reads this. A const declared further down would still be in its
// temporal dead zone at that point and throw on load.
const ROUTES = new Set(["profile", "review", "group", "waifu", "report", "help"]);

const app = document.getElementById("app");

// One polite live region for the session (index.html, outside #app). Every
// render rebuilds #app, and a live region rebuilt with it is read again on
// each repaint or not at all. Callers announce a change of stage, never a
// tick, so the 2 s extraction poll says "Extracting" once.
const live = document.getElementById("live");
function announce(text) {
  if (live && live.textContent !== text) live.textContent = text;
}
const state = {
  session: null,
  route: currentRoute(),
  ideas: [],
  caps: [],
  skills: [],          // 52 rows, seeded by migration, cached after first load
  levels: new Map(),   // skill_id -> none | some | solid
  // both mirrored in the hash query, see lib/filters.js and filtersToHash()
  filters: { domain: "", crux: "", proposed: false, friend: false, skill: "", q: "", lifecycle: "live" },
  // Ideas tab: newest | closest (the distance sort). Newest by default, as the
  // Group feed already was — what you just captured is what you came to see.
  sort: "newest",
  filterOpen: false,   // the list's Filter disclosure; in state so a re-render keeps it open
  leverageOpen: false, // the list's "What to learn next" disclosure, which only a narrow window folds
  confirmCard: null,   // id of the list card whose Delete is waiting for a second click
  lastMoved: null,     // { head, parts, seen }: the last rating that moved an idea, for the list's banner
  pool: new Map(),     // skill_id -> [user_id] of group mates holding it solid
  names: new Map(),    // user_id -> display_name, for everyone in your groups
  curator: null,       // null = not yet checked
  proposals: [],
  detail: null,        // { idea, caps, runs, groups } for the idea page
  profile: null,       // { user_id, display_name } — yours
  needFirst: [],       // profile: [{ skill_id, ideas }] your live ideas need and you had not rated at load
  groups: [],          // { id, name, created_by, members: [{ user_id, display_name, added_at }], invites: [{ email }] }
  confirmDelete: null, // group id whose delete (creator) or leave (member) button is waiting for a second click
  confirmRemove: null, // "<group id>/<user id>" whose Remove button is waiting for a second click
  loadedRoute: null,   // the route the last finished load() was for; until it matches, empty means "not yet"
  confirmDeleteIdea: false, // the idea page's delete button is waiting for a second click
  moved: "",           // idea page: what the last rating changed, one line
  lifecycleForm: null, // idea page: null | "build" | "drop" — which lifecycle form is open
  buildTicks: new Set(), // skill ids ticked in the "I built this" checklist; starts empty on purpose
  dropDraft: "",       // the drop reason being typed, kept across re-renders
  confirmDuplicate: null, // idea page: id of the "Looks like" match whose "Drop this one as a duplicate" waits for a second click
  feed: [],            // shared ideas from every group, newest first (decision 12)
  feedCaps: [],        // their capability rows; apart from caps, which is your own ideas' only
  feedSort: "newest",  // "newest" | "closest"
  claims: null,        // idea_id -> [user_id] who said "I can do a hard part"; null when idea_claims cannot be read
  friend: null,        // { profile, levels } for the friend profile page
  waifu: { phase: "asking", ideaId: null, line: null }, // #/waifu: asking | sending | saved | failed
  // "signin" | "create" on the sign-in card; the landing's invite link opens it on create
  authMode: location.hash === "#create" ? "create" : "signin",
  notice: null,        // the sign-in card's one non-error message: "check your email"
  reportFrom: "",      // the hash the footer link was clicked on; a report records it as its route
  reportKind: "bug",   // "bug" | "improvement" on the report form
  reports: [],         // your feedback rows, newest first
  draft: { title: "", body: "", file: null }, // the report form, kept across re-renders (watch() repaints every 2 s)
  sent: null,          // { id, number, error } after a report is sent, while the number is awaited
  waiting: "",         // progress text while an answer re-runs extraction
  correcting: false,   // idea page: the "Assumed: … — not right?" form is open
  correctDraft: "",    // what is typed in it, kept across re-renders
  extracting: new Map(), // idea_id -> { stage, seconds } while the list watches a new idea
  stalled: new Map(),  // idea_id -> since, for waits that ran out: what "Check again" polls for
  rerun: new Map(),    // idea_id -> since, for answers sent this session whose re-run has not landed: resumed on return
  // idea_id -> since for every answer sent this session, until a run newer
  // than it is seen. Unlike rerun, a wait that times out leaves it, so the
  // card stays read-only rather than offering a second paid answer (kindOf).
  // In memory only: nothing in the rows says when a clarification was written.
  answered: new Map(),
  checked: new Map(),  // idea_id -> { at, run }: the last read-only "Check again" on a card with no result
  batch: { open: false, drafts: new Map(), sending: false, note: "" }, // the "answer them all" form
  error: null,
  errorDetail: null,   // { for, raw }: the raw message behind state.error, shown only while it is that error
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

// The part of the hash after "?", without it: the list's filters live there.
function hashQuery() {
  const q = location.hash.indexOf("?");
  return q >= 0 ? location.hash.slice(q + 1) : "";
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
  // each page's own title is its h1, so the wordmark is not a heading; the
  // waifu scene has no title of its own and keeps the h1 waifu.css styles
  return el("header", { style: site ? "view-transition-name: app-header" : null },
    // the word is its own span so a phone can show the mark alone (style.css)
    el(site ? "p" : "h1", { class: site ? "brand" : null }, site && brandMark(), site ? el("span", { class: "word" }, "clouded") : "clouded"),
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
  class: "auth", "aria-labelledby": "auth-title",
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
    state.authMode = mode; clearError(); state.notice = null;
    if (AUTH_HASH.test(location.hash)) history.replaceState(null, "", `#${mode}`);
    render();
  };
  const form = el("form", {
    class: "card signin",
    onsubmit: (e) => {
      e.preventDefault();
      const email = form.elements.email.value.trim();
      const password = form.elements.password.value;
      state.notice = null;
      run(async () => {
        if (!creating) return signIn(email, password);
        if ((await signUp(email, password)).confirm) {
          state.notice = `Check ${email} for a confirmation link. Open it and you are signed in. Nothing there after a few minutes? Look in spam, then tell whoever invited you.`;
        }
      });
    }
  },
    // the landing behind the dialog owns the page's h1; this names the dialog
    el("h2", { id: "auth-title" }, brandMark(), "clouded"),
    el("p", { class: "muted" },
      "How far each idea is from something you could actually build."),
    // the two modes as a switch, so which one you are in is never a guess
    el("div", { class: "seg auth-seg", "aria-label": "Sign in or create an account" },
      el("button", { type: "button", "aria-pressed": String(!creating), onclick: () => setMode("signin") }, "Sign in"),
      el("button", { type: "button", "aria-pressed": String(creating), onclick: () => setMode("create") }, "Create account")),
    el("p", { class: "how" },
      creating
        ? "Accounts are invite-only. Use the email address a friend invited, and choose a password of at least 8 characters. We then email you a link: open it to confirm the address, and you are signed in."
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
    errorLine(),
    state.notice && el("p", { class: "notice", role: "status" }, state.notice),
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
  // a rating, said as one, so it does not read like a claim (claimRow)
  if (cruxHeld) parts.push(`${nameList(f.cruxHolders)} rated the hard part solid`);
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
    el("span", { class: "lbl" }, "a hard part")
  );
}

// The hard part resolving letter by letter in mono tiles when an extraction
// lands, then settling to plain text. Every character is its own text node
// (never markup), and the interval stops when the card leaves the page.
// Under reduced motion the text simply fades in.
//
// Letters sit inside one .w span per word, so the line can only break at a
// space \u2014 a tile per character in one wrapping row broke "authen / tication"
// on a phone. The tiles are hidden from assistive tech, which hears the
// wrap's label once instead of a stream of random letters.
const FLAP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function splitFlap(text) {
  const wrap = el("span", { class: "flap", role: "img", "aria-label": text });
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    wrap.classList.add("done", "fade-in");
    wrap.removeAttribute("role");
    wrap.removeAttribute("aria-label");
    wrap.textContent = text;
    return wrap;
  }
  const rnd = () => FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)];
  const nbsp = "\u00a0";
  const tiles = [...text].map((c) => el("span", { class: c === " " ? "ch sp" : "ch", "aria-hidden": "true" }, c === " " ? nbsp : rnd()));
  let word = null;
  for (const t of tiles) {
    if (t.classList.contains("sp")) { wrap.append(t); word = null; continue; }
    if (!word) wrap.append(word = el("span", { class: "w" }));
    word.append(t);
  }
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

// Built or dropped, on any card that shows one. The reason sits beside the
// tag, not inside it: tags never wrap, and a reason is a sentence.
function lifecycleTags(idea) {
  const life = lifecycleOf(idea);
  if (life === "built") return [el("span", { class: "tag level-solid" }, `built ${fmtDate(idea.built_at)}`)];
  if (life === "dropped") return [
    el("span", { class: "tag" }, `dropped ${fmtDate(idea.dropped_at)}`),
    el("span", { class: "drop-reason" }, idea.drop_reason)
  ];
  return [];
}

// What every idea card shares. One tab stop, the title link, which is also
// what names the card for a screen reader; the card itself is not focusable.
// A click anywhere on it opens the idea, unless it landed on something that
// has its own job (a link), finished a text selection, or is the second click
// of a double-click, which is someone selecting a word. A vague card
// (`anywhere` false) opens from its title only: it holds an answer box, and a
// stray click on the question beside it would throw away what was typed.
function cardProps(idea, cls, glide, anywhere = true) {
  return {
    class: cls, "data-idea": idea.id, "aria-label": idea.objective || idea.raw,
    style: glide ? `view-transition-name: idea-${idea.id}` : null,
    onclick: anywhere && ((e) => {
      if (e.defaultPrevented || e.button !== 0 || e.detail > 1 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.target.closest("a, button, input, textarea, select, label, form, .card-confirm")) return;
      if (String(getSelection()) !== "") return;
      location.hash = `#/idea/${idea.id}`;
    })
  };
}

// Delete from the list: the idea page's two steps (deleteControl), inline on
// your own cards. The button is the last thing in the card's foot and quiet
// until the card is hovered or holds focus (always there on a touch screen);
// the question takes its place under the foot. Focus goes to "Keep it", so a
// second Enter cannot delete, and after a delete to the card that moved up.
const cardLinks = () => [...app.querySelectorAll(".list .card.idea h3 a")];

function cardDelete(idea) {
  return state.confirmCard !== idea.id && el("button", {
    type: "button", class: "link danger card-del", "aria-label": `Delete idea: ${idea.objective || idea.raw}`,
    onclick: () => { state.confirmCard = idea.id; render({ focus: `[data-idea="${idea.id}"] .keep` }); }
  }, "Delete");
}

function cardConfirm(idea) {
  if (state.confirmCard !== idea.id) return null;
  const at = `[data-idea="${idea.id}"]`;
  return el("div", { class: "card-confirm", role: "group", "aria-label": "Delete this idea" },
    el("p", { class: "hint" }, "Delete this idea? Its extraction goes with it."),
    el("div", { class: "row" },
      el("button", { class: "btn sm warn", type: "button", disabled: state.busy, onclick: async () => {
        if (state.busy) return;   // a double click deletes once
        const i = cardLinks().findIndex((a) => a.closest(at));
        await run(async () => {
          state.confirmCard = null;
          await deleteIdea(idea.id, idea.image_path);
          announce("Idea deleted.");
          await load();
        });
        const links = cardLinks();
        (links[i] ?? links[i - 1] ?? captureBox).focus();
      } }, "Yes, delete"),
      el("button", { class: "btn sm ghost keep", type: "button",
        onclick: () => { state.confirmCard = null; render({ focus: `${at} .card-del` }); } }, "Keep it")));
}

function ideaRow({ idea, extraction }, glide = true) {
  const d = distanceOf(extraction, state.levels);
  const crux = cruxOf(extraction);
  const anyProposed = extraction.capabilities.some((c) => !c.skill_id);
  const title = idea.objective || idea.raw;
  const landed = justLanded.has(idea.id);

  return el("article", cardProps(idea, landed ? "card idea fade-in" : "card idea", glide),
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
      lifecycleTags(idea),
      idea.image_path && el("span", { class: "tag", role: "img", "aria-label": "has a picture", title: "has a picture" }, "▣"),
      friendLine({ idea, extraction }),
      el("span", { class: "spacer" }),
      el("span", {}, "you"),
      el("span", {}, fmtDate(idea.created_at)),
      cardDelete(idea)
    ),
    cardConfirm(idea)
  );
}

// A card the list is still waiting on. The bar is indeterminate on purpose:
// extraction is one API call of unknown length, and a bar that creeps to 90%
// and waits would be a time estimate in disguise. The stages are real events.
//
// The bar is decoration and the seconds change on every poll, so neither is
// in a live region: watch() announces each stage once through announce().
function extractingRow(idea, { stage, seconds, again }) {
  const saving = stage === "saving";
  const fresh = Date.now() - Date.parse(idea.created_at) < WATCH_WINDOW_MS;
  return el("article", { class: "card idea busy" },
    el("div", { class: "card-head" }, el("div", {},
      el("h3", {}, idea.raw),
      el("p", { class: "raw" }, again ? "Checking again" : idea.queued_at && idea.is_clear == null ? "Extracting a saved idea"
        : fresh ? "Just added" : "Re-extracting after your answer"))),
    el("div", { class: "progress" },
      el("div", { class: "bar", "aria-hidden": "true" }, el("i", {})),
      el("span", {}, saving ? "Saving the result" : again ? `Checking, ${seconds}s` : `Extracting, ${seconds}s`)),
    el("p", { class: "steps" }, saving ? "Writing the capabilities and a hard part"
      : again ? "Looking for the result. Nothing is re-run, so this costs nothing."
      : "Reading the idea and listing what it would take"),
    el("div", { class: "card-foot" }, el("span", {}, "you"), el("span", {}, fmtDate(idea.created_at)))
  );
}

// Too vague to extract: the question and an answer box on the card. The
// answer is the same write the idea page makes (setClarification, which
// re-runs extraction), and the wait is the same watcher a new idea gets, so
// the card turns into the extracting card and then the full one.
//
// Only an idea extraction actually asked about gets the box (lib/wait.js,
// resultOf). One with no result yet — the webhook never came, or the key was
// dead — gets waitingRow instead: an answer there would be a paid re-run
// answering a question nobody asked.
//
// The answer fields are kept across renders, like captureBox: the list
// repaints every 2 s while another idea extracts, and a rebuilt field would
// drop what was typed. kept() hands back the same element; render() puts
// the caret back in it if it had it (holdFocus).
const answerInputs = new Map(), batchInputs = new Map();   // idea_id -> field
function kept(map, id, make) {
  if (!map.has(id)) map.set(id, make());
  return map.get(id);
}

// What an idea with no full card is (lib/wait.js, resultOf), from the latest
// run this session has seen and any answer it sent. Only "vague" gets a box.
function kindOf(idea, run = state.checked.get(idea.id)?.run ?? null) {
  return resultOf(idea, run, Date.now(), WATCH_WINDOW_MS, state.answered.get(idea.id) ?? null);
}

// An answer was just written: wait for its re-run (rerun), and keep the card
// read-only until a run newer than it is seen (answered, settleAnswer).
function sentAnswer(id, since) {
  state.rerun.set(id, since);
  state.answered.set(id, since);
}
function settleAnswer(id, run) {
  if (!answerPending(state.answered.get(id), run)) state.answered.delete(id);
}

function vagueRow(idea, glide = true) {
  const kind = kindOf(idea);
  if (kind === "draft") return draftRow(idea, glide);
  if (kind !== "vague") return waitingRow(idea, kind, glide);
  const input = kept(answerInputs, idea.id, () =>
    el("input", { name: "clarification", "aria-label": "Your answer", placeholder: "A few words is enough", required: true, autocomplete: "off" }));
  const form = el("form", {
    class: "row",
    onsubmit: (e) => {
      e.preventDefault();
      const text = input.value.trim();
      // one submit, one write: a second press while it is in flight does nothing
      if (!text || state.busy) return;
      run(async () => {
        const since = new Date().toISOString();
        await setClarification(idea.id, text);
        answerInputs.delete(idea.id);
        sentAnswer(idea.id, since);
        watch(idea.id, since);
      });
    }
  },
    input,
    el("button", { type: "submit", class: "btn sm", disabled: state.busy }, "Answer")
  );
  return el("article", cardProps(idea, justLanded.has(idea.id) ? "card idea vague fade-in" : "card idea vague", glide, false),
    el("div", { class: "card-head" }, el("div", {},
      el("h3", {}, el("a", { href: `#/idea/${idea.id}` }, idea.raw)),
      el("p", { class: "raw" }, "Too vague to extract yet"))),
    el("div", { class: "ask" },
      el("p", {}, el("b", {}, "One question: "), idea.clarifying_question ?? "What is it, in a sentence?"),
      // with the batch form open, answering happens there, once
      state.batch.open ? el("p", { class: "hint" }, "Answer it in the form above.") : [
        form,
        // answering runs extraction server-side, which is a paid API call
        el("p", { class: "hint" }, "Answering re-runs extraction, about a cent.")]),
    el("div", { class: "card-foot" }, lifecycleTags(idea), el("span", {}, "you"), el("span", {}, fmtDate(idea.created_at)), cardDelete(idea)),
    cardConfirm(idea)
  );
}

// Saved without extracting: the sentence as written, and the one button that
// spends on it. "Extract now" is extractDraft(), which moves the row to
// pending; load() then sees a pending row asked for just now and watches it
// like a new idea, so the card becomes the extracting card and then the full
// one (or the question, if it turns out vague).
function draftRow(idea, glide) {
  return el("article", cardProps(idea, "card idea vague draft", glide),
    el("div", { class: "card-head" }, el("div", {},
      el("h3", {}, el("a", { href: `#/idea/${idea.id}` }, idea.raw)),
      el("p", { class: "raw" }, "Saved without extracting"))),
    el("div", { class: "ask" },
      el("div", { class: "row" },
        el("button", { type: "button", class: "sm secondary", "data-extract": idea.id, disabled: state.busy,
          onclick: () => extractNow(idea.id) }, "Extract now"),
        el("span", { class: "hint" }, "One API call, about a cent."))),
    el("div", { class: "card-foot" }, lifecycleTags(idea), el("span", {}, "you"), el("span", {}, fmtDate(idea.created_at)), cardDelete(idea)),
    cardConfirm(idea)
  );
}

// one press, one call: run() sets busy before its first await, and the
// database refuses a second extract_draft once the row is no longer a draft
function extractNow(id) {
  if (state.busy) return;
  run(async () => { await extractDraft(id); await load(); });
}

// An idea with no extraction result, or an answer whose re-run has not
// landed: nothing to answer, and nothing on this side can start the
// extraction again — that is the webhook's job. "Check again" only reads
// (checkIdea), so it costs nothing.
function waitingRow(idea, kind, glide) {
  return el("article", cardProps(idea, "card idea vague waiting", glide),
    el("div", { class: "card-head" }, el("div", {},
      el("h3", {}, el("a", { href: `#/idea/${idea.id}` }, idea.raw)),
      el("p", { class: "raw" }, waitingHead(kind)))),
    waitingNote(idea, kind, true),
    el("div", { class: "card-foot" }, lifecycleTags(idea), el("span", {}, "you"), el("span", {}, fmtDate(idea.created_at)), cardDelete(idea)),
    cardConfirm(idea)
  );
}

const waitingHead = (kind) => kind === "answering" ? "Answered, not re-extracted yet." : "Not extracted yet.";

// The why and the read-only "Check again", on the list's waiting card and on
// the idea page. `check` is false for a friend's idea: it is not theirs to
// chase, so it gets the why alone.
function waitingNote(idea, kind, check, head = null) {
  const seen = state.checked.get(idea.id);
  // for an answer still out, a run from before it is no news
  const said = !seen ? null
    : kind === "answering" ? "Checked: still nothing."
    : seen.run?.error ? "Checked: the last attempt failed."
    : seen.run ? "Checked: a run exists but the idea has not caught up yet."
    : "Checked: still nothing.";
  return el("div", { class: "ask" },
    el("p", {}, head && el("b", {}, `${head} `), kind === "failed" ? "Extraction ran and failed, so there is no question to answer yet."
      : kind === "pending" ? "The result has not arrived yet."
      : kind === "answering" ? "Your answer was sent. Its re-run has not landed yet, so there is nothing to answer again."
      : "The extraction result never arrived."),
    check && el("div", { class: "row" },
      el("button", { type: "button", class: "sm secondary", "data-check": idea.id, disabled: state.busy, onclick: () => checkIdea(idea.id) }, "Check again"),
      said && el("span", { class: "hint", role: "status" }, said)),
    el("p", { class: "hint" }, "If it stays like this, tell the owner — the extraction service may be down."));
}

// Read-only: the idea and its runs, then the page again. Never addIdea or
// setClarification, the two writes that start a (paid) extraction.
function checkIdea(id) {
  run(async () => {
    const [one, [latest = null]] = await Promise.all([fetchIdea(id), runsFor(id)]);
    state.checked.set(id, { at: Date.now(), run: latest });
    settleAnswer(id, latest);
    await load();
    const k = kindOf(one, latest);
    announce(k === "clear" || k === "vague" ? "The extraction has landed." : "Still not extracted.");
  }).then(() => document.querySelector(`[data-check="${id}"]`)?.focus());
}

// Every vague idea on one screen, when there are two or more (backlog §4):
// the raw text, its question, a field each, and one submit that sends only
// the filled ones, one setClarification each, in order. The first failure
// stops it: what was sent is said, and the rest stay filled in.
function vagueBatch(ideas) {
  const b = state.batch;
  // the ones with a question still open: the cards that would carry a box
  const list = ideas.filter((i) => kindOf(i) === "vague" && !state.extracting.has(i.id));
  if (list.length < 2) { b.open = false; return null; }
  if (!b.open) return el("p", { class: "batch-open" },
    el("button", { type: "button", class: "sm secondary", onclick: () => { b.open = true; b.note = ""; render({ focus: ".batch textarea" }); } },
      `Answer all ${list.length} on one screen`));

  const ids = list.map((i) => i.id);
  const cost = el("p", { class: "hint" });
  const submit = el("button", { type: "submit", class: "btn sm" });
  // the fields are kept across renders but this form is not, so their
  // oninput calls whichever recount the latest render left here
  batchRecount = () => {
    const k = filledAnswers(ids, b.drafts).length;
    const said = batchSubmit(k, b.sending);
    cost.textContent = said.cost;
    submit.textContent = said.label;
    submit.disabled = !k || b.sending || state.busy;
  };
  const form = el("form", {
    class: "batch ask",
    onsubmit: (e) => { e.preventDefault(); sendBatch(ids); }
  },
    el("h2", {}, "Answer them all"),
    el("ol", {}, list.map((i) => el("li", {},
      el("p", { class: "raw" }, i.raw),
      el("p", {}, el("b", {}, "Question: "), i.clarifying_question ?? "What is it, in a sentence?"),
      // three fields called "Your answer" would be one name three times to a screen reader
      el("label", { class: "fld" }, el("span", {}, "Your answer", el("span", { class: "sr-only" }, ` for “${i.raw}”`)),
        kept(batchInputs, i.id, () => el("textarea", {
          name: `answer-${i.id}`, rows: 2, placeholder: "Leave empty to skip",
          oninput: (e) => { b.drafts.set(i.id, e.target.value); batchRecount(); }
        })))))),
    b.note && el("p", { class: "error", role: "status" }, b.note),
    cost,
    el("div", { class: "row" }, submit,
      el("button", { type: "button", class: "link", onclick: () => { b.open = false; render({ focus: ".batch-open button" }); } }, "close"))
  );
  batchRecount();
  return form;
}
let batchRecount = () => {};

function sendBatch(ids) {
  const b = state.batch;
  if (b.sending || state.busy) return;   // a double click sends nothing twice
  const answers = filledAnswers(ids, b.drafts);
  if (!answers.length) return;
  b.sending = true; b.note = "";
  let sent = 0;
  run(async () => {
    try {
      for (const { id, text } of answers) {
        const since = new Date().toISOString();
        await setClarification(id, text);   // the paid write, once per filled answer
        sent++;
        b.drafts.delete(id); batchInputs.delete(id);
        sentAnswer(id, since);
        watch(id, since);
      }
      announce(`Sent ${sent} ${sent === 1 ? "answer" : "answers"}.`);
    } catch (err) {
      b.note = `Sent ${sent} of ${answers.length}. The rest are still filled in.`;
      throw err;
    } finally {
      b.sending = false;
    }
  // the Send button was rebuilt as "Sending…" and back: put focus on what is
  // left of the batch (an unsent answer, or its opener), else the capture box
  }).then(() => (app.querySelector(".batch textarea, .batch-open button") ?? captureBox).focus());
}

// Always on screen: Live/Built/Dropped, the sort, search and the count. The
// rest (domain, the hard part's state, the two checkboxes) folds into one
// Filter button that says how many are on. A button and a panel rather than
// <details>: the open flag sits in state, so the re-render every change
// causes cannot close it, and the panel can take a full row of its own.
function filterBar(domains, shownCount, total) {
  const f = state.filters;
  // focus goes back to the control just used: the bar is rebuilt under it.
  // The selects and checkboxes are found by name, the buttons by data-pick.
  const set = (k, v, focus = `.controls [name="${k}"]`) => { f[k] = v; render({ animate: true, focus }); };
  const picked = (k, v) => `.controls [data-pick="${k}-${v}"]`;
  const sortButton = (key, label) => el("button", {
    type: "button", "data-pick": `sort-${key}`, "aria-pressed": String(state.sort === key),
    onclick: () => { state.sort = key; render({ animate: true, focus: picked("sort", key) }); }
  }, label);
  const lifeButton = (key, label) => el("button", {
    type: "button", "data-pick": `lifecycle-${key}`, "aria-pressed": String(f.lifecycle === key),
    onclick: () => set("lifecycle", key, picked("lifecycle", key))
  }, label);
  const on = activeCount(f);
  const check = (k, label) => el("label", { class: "chk" },
    el("input", { type: "checkbox", name: k, checked: f[k], onchange: (e) => set(k, e.target.checked) }),
    el("span", {}, label));
  // a phone has no room for both toggles beside search: one select stands in
  // for them there (CSS shows one or the other), so the bar is a single row
  const show = f.lifecycle === "live" ? `live-${state.sort}` : f.lifecycle;
  const showPick = el("select", {
    name: "show", class: "show-pick", "aria-label": "Show",
    onchange: (e) => {
      const [life, sort] = e.target.value.split("-");
      if (sort) state.sort = sort;
      set("lifecycle", life, '.controls [name="show"]');
    }
  }, [["live-newest", "Live, newest"], ["live-closest", "Live, closest"], ["built", "Built"], ["dropped", "Dropped"]]
    .map(([v, label]) => el("option", { value: v, selected: show === v }, label)));
  const skillLabel = f.skill.startsWith("proposed:") ? `${f.skill.slice(9)} (proposed)` : skillName(f.skill);
  return el("div", { class: "controls" },
    el("div", { class: "views" },
      el("div", { class: "seg", role: "group", "aria-label": "Show" },
        lifeButton("live", "Live"), lifeButton("built", "Built"), lifeButton("dropped", "Dropped")),
      // distance only means something for ideas you might still build
      f.lifecycle === "live" && el("div", { class: "seg", role: "group", "aria-label": "Sort" },
        sortButton("newest", "Newest"), sortButton("closest", ["Closest", el("span", { class: "wide" }, " to me")]))),
    el("div", { class: "find" },
      showPick,
      searchBox,
      el("button", {
        type: "button", class: on ? "secondary filter-toggle on" : "secondary filter-toggle",
        "aria-expanded": String(state.filterOpen), "aria-controls": state.filterOpen ? "filter-panel" : null,
        onclick: () => { state.filterOpen = !state.filterOpen; render({ focus: ".filter-toggle" }); }
      }, on ? `Filter (${on})` : "Filter"),
      (on > 0 || f.q || f.skill) && el("button", {
        type: "button", class: "link",
        onclick: () => {
          const { sort, ...cleared } = DEFAULTS;
          state.filters = { ...cleared, lifecycle: f.lifecycle };
          searchBox.value = "";
          render({ animate: true, focus: ".filter-toggle" });
        }
      }, "clear"),
      el("span", { class: "count" }, `${shownCount} of ${total} shown`)),
    // set from the leverage panel; a chip rather than a panel field, since
    // it names one skill and the way back is to take it off
    f.skill && el("div", { class: "chips" },
      el("button", {
        type: "button", class: "chip", "aria-label": `Remove filter: needs ${skillLabel}`,
        onclick: () => set("skill", "", ".filter-toggle")
      }, el("span", {}, "Needs: ", el("b", {}, skillLabel)), el("span", { "aria-hidden": "true" }, " ×"))),
    state.filterOpen && el("div", { class: "filter-panel", id: "filter-panel", role: "group", "aria-label": "Filters" },
      el("select", { name: "domain", "aria-label": "Domain", onchange: (e) => set("domain", e.target.value) },
        el("option", { value: "", selected: f.domain === "" }, "Any domain"),
        // a domain from an old link that no idea has any more still shows, so it can be seen and cleared
        [...new Set([...domains, f.domain].filter(Boolean))]
          .map((d) => el("option", { value: d, selected: f.domain === d }, d))),
      el("select", { name: "crux", "aria-label": "Hard part", onchange: (e) => set("crux", e.target.value) },
        [["", "Any hard part"], ["have", "Hard part held"], ["partial", "Hard part partial"], ["gap", "Hard part missing"]]
          .map(([v, label]) => el("option", { value: v, selected: f.crux === v }, label))),
      check("proposed", "Has a proposed skill"),
      check("friend", "A friend can unblock it"))
  );
}

// The prompt the list leads with until one skill is rated: without a profile
// every idea is all gaps and "Closest to me" sorts nothing.
function rateFirst() {
  const n = skillsNeeded(state.ideas, state.caps);
  return el("p", { class: "rate-first" },
    el("span", {}, n > 0
      ? `Your ideas need ${n} different ${n === 1 ? "skill" : "skills"}, and you have not rated any yet. Until you do, every idea looks equally far away.`
      : "You have not rated any skills yet. Until you do, every idea looks equally far away."),
    el("a", { href: "#/profile", class: "btn sm" }, "Rate your skills"));
}

// Each row is a button that filters the list to the ideas it counts (the
// skill filter, shown as a chip under the bar); pressing the row that is on
// takes it off. Leverage counts live ideas, so it switches the list to Live.
// Beside the list on a wide window; on a narrow one it sits above the list,
// folded, as "What to learn next" (CSS swaps the heading for the toggle).
function leveragePanel(items) {
  const top = leverage(items, state.levels).slice(0, 10);
  const f = state.filters;
  const pick = (key) => {
    f.skill = f.skill === key ? "" : key;
    if (f.skill) f.lifecycle = "live";
    render({ animate: true, focus: `.leverage [data-skill="${CSS.escape(key)}"]` });
  };
  return el("aside", { class: state.leverageOpen ? "leverage open" : "leverage", "aria-label": "Highest leverage" },
    el("h2", {}, "Highest leverage"),
    el("button", {
      type: "button", class: "link lev-toggle", "aria-expanded": String(state.leverageOpen), "aria-controls": "lev-body",
      onclick: () => { state.leverageOpen = !state.leverageOpen; render({ focus: ".lev-toggle" }); }
    }, "What to learn next"),
    el("div", { class: "lev-body", id: "lev-body" },
      el("p", {}, "Learn one of these and this many ideas move closer. Pick one to see them."),
      el("ol", {}, top.map((e) => el("li", {}, el("button", {
        type: "button", class: "link lev-row", "data-skill": e.key, "aria-pressed": String(f.skill === e.key), onclick: () => pick(e.key)
      },
        // the unit under the number, so it is not a bare figure to anyone
        el("span", { class: "k" }, String(e.ideaIds.length), el("small", {}, e.ideaIds.length === 1 ? " idea" : " ideas")),
        el("span", {}, e.skillId ? skillName(e.skillId) : `${e.proposedName} (proposed)`)
      )))),
      // before the first load there is nothing to rank, which is not the same as nothing to learn
      !top.length && state.loadedRoute === "list" && el("p", { class: "muted" }, "Nothing to learn — every capability is held."))
  );
}

// The last "what moved" line (whatMoved() keeps it in state.lastMoved), as
// the first thing on the list after a rating changed something: the line the
// product exists to produce. Shown on one visit; leaving the list or the ×
// puts it away. Not a live region: the profile already said it there.
function movedBanner() {
  const m = state.lastMoved;
  if (!m?.moved) return null;
  m.shown = true;
  const [, head, rest] = /^(.*? → \w+\.) (.*)$/.exec(m.text) ?? [null, "", m.text];
  return el("div", { class: "moved-banner" },
    el("p", {}, head && el("b", {}, head, " "), rest),
    el("button", {
      type: "button", class: "link", "aria-label": "Dismiss",
      onclick: () => { state.lastMoved = null; render({ focus: ".capture textarea" }); }
    }, "×"));
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
  // the leverage panel answers "what should I learn next", so finished ideas
  // never count, whichever set the list is showing
  const liveClear = settled.filter((r) => isLive(r.idea) && r.idea.is_clear === true);
  const inView = settled.filter((r) => lifecycleOf(r.idea) === state.filters.lifecycle);
  const clear = inView.filter((r) => r.idea.is_clear === true);
  const vague = inView.filter((r) => r.idea.is_clear !== true);

  // crux status first, then gaps, then partials, then title for a stable order;
  // or, on request, most recently added first (the phone's only order)
  if (state.sort === "newest" || state.filters.lifecycle !== "live") {
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
  // a vague idea has no domain or capabilities to match, so any filter that
  // reads them leaves it out; search and Live/Built/Dropped still apply
  // newest-marked first, as the cards read (and so the batch form): a built
  // or dropped view by its mark, a live one by created_at, both marks null
  const when = (i) => Date.parse(i.built_at ?? i.dropped_at ?? i.created_at);
  const vagueShown = needsExtraction(f) ? []
    : vague.filter((r) => matches(r.idea)).sort((a, b) => when(b.idea) - when(a.idea));
  // the leverage panel's key: the skill id, or "proposed:<key>"
  const needs = (r) => r.extraction.capabilities.some((c) => (c.skill_id ?? `proposed:${c.proposed_key}`) === f.skill);
  const shown = clear.filter((r) =>
    matches(r.idea) &&
    (!f.domain || r.idea.domain === f.domain) &&
    (!f.crux || cruxStatus(r.extraction, state.levels) === f.crux) &&
    (!f.proposed || r.extraction.capabilities.some((c) => !c.skill_id)) &&
    (!f.friend || friendMarker(r).cruxHeld) &&
    (!f.skill || needs(r)));

  // Enter and "Add idea" extract (paid); "Save without extracting" keeps the
  // sentence as a draft and spends nothing until "Extract now"
  const save = (draft) => {
    // one submit, one addIdea: run() sets busy before its first await, so a
    // held Enter's second submit stops here
    if (state.busy) return;
    mic?.stop();   // a word still being transcribed is not part of the idea
    const raw = captureBox.value.trim();
    if (!raw) { captureBox.focus(); return; }
    // load() sees the new row as pending and starts watching it; a draft
    // lands under "Not extracted" and nothing watches it
    run(async () => {
      await addIdea(raw, { draft });
      captureBox.value = ""; grow(captureBox);
      if (draft) announce("Saved without extracting.");
      await load();
    });
  };
  const add = el("form", {
    class: "capture",
    onsubmit: (e) => { e.preventDefault(); save(false); }
  },
    captureBox,
    mic?.button,
    el("button", { type: "submit", class: "btn", disabled: state.busy }, "Add idea"),
    el("button", { type: "button", class: "btn ghost", disabled: state.busy, onclick: () => save(true) }, "Save without extracting"),
    // adding runs extraction server-side, which is a paid API call
    el("span", { class: "cost" }, "Add idea extracts, about 1¢. Saving without extracting is free."),
    mic?.note
  );

  const rated = state.levels.size;
  const loaded = state.loadedRoute === "list";
  const glide = shown.length + vagueShown.length <= 40;
  const card = (r) => r.idea.is_clear === true ? ideaRow(r, glide) : vagueRow(r.idea, glide);

  // Closest to me groups by how many skills are short (the flat gap count
  // distance.js already gives); newest is one list by date, vague included.
  // The batch answer form goes before the cards are built: whether it is open
  // decides whether each vague card carries its own box.
  const batch = vagueBatch(vagueShown.map((r) => r.idea));
  let body;
  if (state.sort === "newest" || state.filters.lifecycle !== "live") {
    const all = [...shown, ...vagueShown].sort((a, b) => when(b.idea) - when(a.idea));
    body = [batch, el("div", { class: "cards" }, all.map(card))];
  } else {
    const bandOf = (r) => {
      const gap = distanceOf(r.extraction, state.levels).gap;
      return gap === 0 ? "now" : gap === 1 ? "one" : "far";
    };
    const byBand = new Map(BANDS.map(([k]) => [k, []]));
    for (const r of shown) byBand.get(bandOf(r)).push(r);
    // only an idea with a question open counts as needing a detail; a draft
    // has its own band; the rest have nothing to answer and go last, under
    // their own quiet heading
    for (const r of vagueShown) {
      const k = kindOf(r.idea);
      byBand.get(k === "draft" || k === "vague" ? k : "waiting").push(r);
    }
    body = BANDS.map(([k, h, p]) => {
      const items = byBand.get(k);
      return items.length > 0 && el("section", { class: `band ${k}` },
        el("div", { class: "band-head" }, el("h2", {}, h), el("span", { class: "n" }, String(items.length)), el("p", {}, p)),
        k === "vague" && batch,
        el("div", { class: "cards" }, items.map(card)));
    });
  }

  justLanded.clear();

  return el("div", {},
    header(),
    el("h1", { class: "sr-only" }, "Your ideas"),
    movedBanner(),
    add,
    errorLine(),
    loaded && !rated && rateFirst(),
    // the count is of cards on the page: vague ideas show in both sorts (in
    // the date order, or under "Needs a detail" / "Not extracted yet"), so they are counted too
    filterBar(domains, shown.length + vagueShown.length, inView.length),
    el("div", { class: "layout" },
      el("div", { class: "list" },
        extracting.length > 0 && el("div", { class: "cards extracting-cards" },
          extracting.map((r) => extractingRow(r.idea, state.extracting.get(r.idea.id)))),
        body,
        // the first paint comes before load() answers: an empty list then
        // means "not yet", and saying "no idea matches" would be a false alarm
        !shown.length && !vagueShown.length && el("p", { class: "muted", role: "status" },
          !loaded ? "Loading your ideas…"
          : !state.ideas.length ? "No ideas yet. Write one in the box above."
          : !inView.length && state.filters.lifecycle === "built" ? "Nothing built yet. Mark an idea built from its page."
          : !inView.length && state.filters.lifecycle === "dropped" ? "Nothing dropped."
          : "No idea matches those filters.")
      ),
      leveragePanel(liveClear.map((r) => ({ id: r.idea.id, extraction: r.extraction })))
    )
  );
}

// ---------------------------------------------------------------- profile

// Updated in place rather than through a re-render: re-rendering on every
// radio change would pull focus out of the control being used. The bar, the
// text and the per-domain counts in the side panel are all repainted here.
const status = el("span", { class: "status", role: "status" }, "");

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

// `status` is one element shared by the profile and the invite form, so every
// write sets text, colour and tooltip together: an error's class and title
// must not outlive it.
function setStatus(text, detail = null, error = false) {
  status.textContent = text;
  status.title = detail ?? "";
  status.className = error ? "status error" : "status";
}

// `control` is the .rating the radio sits in. A save that fails puts the page
// back as it was, as rate() does on the idea page: the level, the tally, the
// radios and the "not rated" tag (CSS, off the radios), so nothing claims a
// rating the database does not have and the same level can be picked again
// (a radio left checked fires no change).
//
// The level to go back to is the last one the database is known to hold, not
// the screen as it was at this click: with two picks in flight the second
// one's "before" is the first one's unsaved guess. `saving` keeps that level
// per skill for as long as a write for it is in flight.
const saving = new Map();   // skill id -> { n: writes in flight, was: level in the database }

function save(skillId, level, control) {
  const before = new Map(state.levels);
  const flight = saving.get(skillId) ?? { n: 0, was: state.levels.get(skillId) };
  flight.n++;
  saving.set(skillId, flight);
  state.levels.set(skillId, level);
  syncRows(skillId, control);
  refreshTally();
  setStatus("saving…");
  setSkillLevel(state.session.user.id, skillId, level)
    .then(async () => {
      flight.was = level;
      // the rating is saved from here on: failing to read the ideas only
      // costs the "what moved" line, and must not undo it on screen
      try {
        await ensureIdeas();
        setStatus(whatMoved([skillId], before, state.levels));
      } catch (err) {
        console.error(err);
        setStatus("saved");
      }
    }, (err) => {
      console.error(err);
      // unless something newer was picked for this skill while this was in flight
      if (state.levels.get(skillId) === level) {
        const was = flight.was;
        if (was) state.levels.set(skillId, was); else state.levels.delete(skillId);
        refreshTally();
        syncRows(skillId, null);
      }
      const { text, detail } = explain(err);
      setStatus(text, detail, true);
    })
    .finally(() => { if (--flight.n === 0) saving.delete(skillId); });
}

// A skill your ideas need has two rows on the profile, one under "Your ideas
// need these" and one in its domain. Whatever state.levels now says goes
// into every row for the skill but `skip`, the control being used.
function syncRows(skillId, skip) {
  const at = state.levels.get(skillId) ?? null;
  for (const control of document.querySelectorAll(`.skill[data-skill="${CSS.escape(skillId)}"] .rating`)) {
    if (control === skip) continue;
    for (const r of control.querySelectorAll("input[type=radio]")) r.checked = r.value === at;
    control.querySelector(".lvl").setAttribute("aria-label", at ? skillName(skillId) : `${skillName(skillId)}, ${UNRATED}`);
  }
}

// The list loads ideas and capabilities; the profile and the idea page do
// not, and "what moved" needs them once.
async function ensureIdeas() {
  if (state.ideas.length) return;
  const me = state.session.user.id;
  ({ ideas: state.ideas, caps: state.caps } = await ideas(me));
}

// The one line the product exists to produce: levels changed, and this is
// what it did to your ideas. Distances before and after, over your own live
// ideas — a built or dropped idea moving closer is noise (state.ideas is
// yours; a friend's shared ideas are not in it). Several skills arrive
// together from "I built this".
function whatMoved(skillIds, before, after) {
  const capsById = new Map();
  for (const c of state.caps) {
    if (!capsById.has(c.idea_id)) capsById.set(c.idea_id, []);
    capsById.get(c.idea_id).push(c);
  }
  let closer = 0, further = 0, cleared = 0;
  for (const idea of state.ideas.filter(isLive)) {
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
  return (state.lastMoved = { text: `${movedHeadline(skillIds, after, skillName)} ${parts.length ? parts.join("; ") + "." : "Nothing moved."}`, moved: parts.length > 0 }).text;
}

// The one rating control, on the profile and on every capability of the idea
// page: none / some / solid, each a choice you make rather than a step in a
// cycle. Radios, so the arrow keys work and focus stays put. An unrated skill
// checks nothing — no row is not "none" (lib/rating.js) — and says so in
// words beside the control; the dashed border hangs off the same fact in CSS.
//
//   name    the radio group's name; unique per control on the page
//   label   what is being rated, for a screen reader
//   onPick  called with the level chosen, which is the level written
function levelControl(skillId, name, label, onPick) {
  const { unrated, options } = levelChoices(state.levels.get(skillId));
  return el("div", { class: "rating" },
    // real text, not CSS content, so it is read; hidden by CSS once a radio
    // in this control is checked, which the profile does without a re-render
    el("span", { class: "tag unrated" }, UNRATED),
    el("div", { class: "lvl", role: "radiogroup", "aria-label": unrated ? `${label}, ${UNRATED}` : label },
      options.map(({ level, checked }) => el("label", { "data-l": level },
        el("input", {
          type: "radio", name, value: level, checked,
          onchange: (e) => {
            e.target.closest(".lvl").setAttribute("aria-label", label);
            onPick(level, e.target.closest(".rating"));
          }
        }),
        el("span", {}, level)
      ))
    )
  );
}

// The row shows the skill's name; its id is the row's tooltip, for whoever is
// matching it against the table. `ideas` is set on a row under "Your ideas
// need these": how many live ideas need the skill. Those rows get a radio
// group of their own, since the same skill has a row in its domain too.
function skillRow(skill, ideas = 0) {
  return el("div", { class: "skill", "data-skill": skill.id, title: skill.id },
    el("div", {},
      el("div", { class: "nm" },
        skill.name,
        skill.hazard && el("span", { class: "tag warn", title: "involves a real hazard" }, "hazard")
      ),
      ideas > 0 && el("div", { class: "needs" }, `needed by ${ideas} ${ideas === 1 ? "idea" : "ideas"} of yours`)
    ),
    levelControl(skill.id, `${ideas ? "need" : "lvl"}-${skill.id}`, skill.name, (level, control) => save(skill.id, level, control))
  );
}

// What the profile leads with while your own live ideas need skills you have
// not rated: those skills only, most-needed first, so a first visit is a
// handful of rows and not the whole table. The list is fixed when the route
// loads (loadRoute), so a row does not vanish from under the radio that was
// just used; the section goes once every skill in it is rated, at the next
// build of the page.
function needFirst() {
  const rows = state.needFirst
    .map((n) => ({ skill: state.skills.find((s) => s.id === n.skill_id), ideas: n.ideas }))
    .filter((r) => r.skill);
  if (!rows.some((r) => !state.levels.has(r.skill.id))) return null;
  return el("section", { class: "dom card need" },
    el("h2", {}, "Your ideas need these"),
    el("p", { class: "need-note" }, "Not rated yet, and needed by ideas you have not built or dropped. Most-needed first; every skill is in the list below."),
    rows.map((r) => skillRow(r.skill, r.ideas))
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
        el("p", {}, "Be honest. An inflated profile makes every distance wrong. ", helpLink())),
      nameForm()
    ),
    errorLine(),
    el("div", { class: "rated" }, ratedBar, el("div", { class: "rated-row" }, tally, status)),
    el("div", { class: "layout" },
      el("div", {},
        needFirst(),
        [...byDomain].map(([domain, list]) => el("section", { class: "dom card", id: `d-${slug(domain)}` },
          el("h2", {}, domain),
          list.map((s) => skillRow(s))
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
    // no groups loaded yet is not "you have no group": hold the create card back until load() says so
    return el("div", {}, header(), errorLine(),
      state.loadedRoute === "group" ? createGroupCard() : [el("h1", { class: "sr-only" }, "Group"), el("p", { class: "muted", role: "status" }, "Loading your group…")]);
  }
  const rows = feedRows();
  // focus goes back to the button just used, as on the Ideas tab (filterBar):
  // the page is rebuilt under it
  const sortButton = (key, label) => el("button", {
    type: "button", "data-pick": `feed-sort-${key}`, "aria-pressed": String(state.feedSort === key),
    onclick: () => { state.feedSort = key; render({ animate: true, focus: `[data-pick="feed-sort-${key}"]` }); }
  }, label);

  return el("div", { class: "group" },
    header(),
    el("div", { class: "page-head" },
      el("div", {},
        el("h1", {}, state.groups.length === 1 ? state.groups[0].name : "Group"),
        el("p", {}, "Ideas your group shared, and who can help with each.")),
      rows.length > 1 && el("div", { class: "seg", role: "group", "aria-label": "Sort feed" },
        sortButton("newest", "Newest"), sortButton("closest", "Closest to me"))
    ),
    errorLine(),
    el("div", { class: "layout" },
      rows.length
        ? el("div", { class: "cards" }, rows.map((r) => feedRow(r, me, rows.length <= 40)))
        : el("p", { class: "muted" }, "Nothing shared yet. Share an idea from its page and it appears here for everyone in the group."),
      el("div", { class: "side" }, groupLeverage(rows), state.groups.map((g) => groupSection(g, me)))
    )
  );
}

// The feed (decision 12): every member's shared ideas, yours included,
// newest first, each measured against the reader's own profile. "Closest to
// me" is the same sort the Ideas tab uses.
function feedRows() {
  const capsById = new Map();
  for (const c of state.feedCaps) {
    if (!capsById.has(c.idea_id)) capsById.set(c.idea_id, []);
    capsById.get(c.idea_id).push(c);
  }
  // a dropped idea leaves the feed but stays shared, so a link to it still
  // works; a built one stays, tagged — that is news (spec 2026-10-22)
  const rows = state.feed
    .filter((idea) => lifecycleOf(idea) !== "dropped")
    .map((idea) => ({ idea, extraction: extractionOf(idea, capsById) }));
  if (state.feedSort === "closest") {
    // a vague idea has no key (sortKey is null) and sorts last; comparing a
    // null key threw, and the sort button did nothing
    const key = (r) => sortKey(r.extraction, state.levels);
    rows.sort((a, b) => {
      const ka = key(a), kb = key(b);
      return (ka && kb ? compareKeys(ka, kb) : !ka - !kb) ||
        Date.parse(b.idea.created_at) - Date.parse(a.idea.created_at);
    });
  }
  return rows;
}

function feedRow({ idea, extraction }, me, glide = true) {
  const owner = idea.user_id === me
    ? el("span", { class: "owner" }, "you")
    : el("a", { href: `#/friend/${idea.user_id}`, class: "owner" }, state.names.get(idea.user_id) ?? "a friend");
  const title = idea.objective || idea.raw;
  if (idea.is_clear !== true) {
    return el("article", cardProps(idea, "card idea vague", glide),
      el("div", { class: "card-head" }, el("div", {},
        el("h3", {}, el("a", { href: `#/idea/${idea.id}` }, title)),
        el("p", { class: "raw" }, idea.status === "extracted" ? "Too vague to extract yet" : statusWord(idea.status)))),
      el("div", { class: "card-foot" }, owner, lifecycleTags(idea), el("span", {}, fmtDate(idea.created_at))),
      claimRow(idea, false)
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
    ? `${holders.slice(0, 2).join(" and ")}${holders.length > 2 ? ` +${holders.length - 2}` : ""} rated the hard part solid`
    : null;
  const coverText = f.gaps ? `group covers ${f.covered} of ${f.gaps} ${f.gaps === 1 ? "gap" : "gaps"}` : "nothing missing for you";

  return el("article", cardProps(idea, "card idea", glide),
    el("div", { class: "card-head" },
      el("div", {}, el("h3", {}, el("a", { href: `#/idea/${idea.id}` }, title))),
      tallyChips(d)
    ),
    crux && cruxBlock(crux),
    el("ul", { class: "caps" }, extraction.capabilities.filter((c) => c !== crux).map(capItem)),
    el("div", { class: "card-foot" },
      owner,
      lifecycleTags(idea),
      idea.domain && el("span", { class: "tag" }, idea.domain),
      el("span", {}, fmtDate(idea.created_at)),
      el("span", { class: "spacer" }),
      holderText && el("span", { class: "friend-line" }, mark("friend"), holderText),
      el("span", { class: f.covered ? "friend-line" : "friend-line dim" }, mark(f.covered ? "friend" : "gap"), coverText)
    ),
    claimRow(idea, !!crux)
  );
}

// Group leverage (docs/improvement-backlog.md §6): the same leverage() the
// Ideas tab runs, over the feed's live ideas and against what the group holds
// between them rather than what the reader holds. No new request: the pool
// and the feed are already loaded for this tab. The pool spans every group
// you are in, and so does the feed, so with two groups this is one sum over
// both — one group is the case in practice (decision 1).
//
// A list, not a ranking: a lead of one or two ideas is inside run-to-run
// wobble (CLAUDE.md, known problems), so there are no rank numbers and the
// first row is not set apart. Equal counts sort by name, so the order does
// not shuffle with the feed's sort.
const GROUP_MISSING_MAX = 8;
function groupLeverage(rows) {
  const n = memberCount(state.groups);
  const items = rows.filter((r) => isLive(r.idea)).map(({ idea, extraction }) => ({ id: idea.id, extraction }));
  const label = (e) => (e.skillId ? skillName(e.skillId) : `${e.proposedName} (proposed)`);
  const missing = leverage(items, groupHeld(state.levels, state.pool))
    .sort((a, b) => b.ideaIds.length - a.ideaIds.length || label(a).localeCompare(label(b)));
  const shown = missing.slice(0, GROUP_MISSING_MAX);
  const body = () => {
    if (n < 2) return el("p", {}, "You are the only one here so far. When a friend joins, this lists the skills none of you hold yet.");
    if (!items.some((i) => i.extraction.clear)) return el("p", {}, "Nothing shared to measure yet. Share an idea and this lists the skills none of you hold for it.");
    if (!missing.length) return el("p", {}, `Between the ${n} of you, every skill the shared ideas need is held by someone.`);
    return [
      el("p", {}, `Between the ${n} of you, these skills are still missing:`),
      el("ul", { class: "missing" }, shown.map((e) => el("li", {},
        el("span", {}, label(e)),
        el("span", { class: "k" }, `${e.ideaIds.length} shared ${e.ideaIds.length === 1 ? "idea" : "ideas"}`)))),
      el("p", { class: "hint" },
        missing.length > shown.length && `And ${missing.length - shown.length} more. `,
        "Each count is how many shared ideas need that skill. A lead of one or two is a tie.")
    ];
  };
  return el("aside", { class: "group-leverage", "aria-label": "What the group is missing" },
    el("h2", {}, "Still missing"),
    body());
}

// Claims (docs/improvement-backlog.md §6): "I can do a hard part" of a group
// mate's shared idea. Names only, never a count: who said it is the whole
// signal. The same row serves the feed card and the idea page.
//
// state.claims is null when idea_claims could not be read — before the
// migration is pushed the table is not there — and then nothing about claims
// is drawn at all, button included: a write would only fail.
function claimRow(idea, hasCrux) {
  if (!state.claims) return null;
  const me = state.session.user.id;
  const c = claimState(idea, hasCrux, state.claims.get(idea.id) ?? [], me);
  if (!c.others.length && !c.mine && !c.canClaim) return null;
  // one data-pick for both buttons: after the write the page is rebuilt, and
  // focus lands on whichever of the two is there now
  const pick = `claim-${idea.id}`;
  const toggle = (on) => run(async () => {
    await (on ? addClaim(idea.id) : removeClaim(idea.id));
    state.claims = withClaim(state.claims, idea.id, me, on);
  }).then(() => app.querySelector(`[data-pick="${pick}"]`)?.focus());
  return el("div", { class: "claim" },
    c.others.length > 0 && el("span", { class: "friend-line" }, mark("friend"),
      // their own words, quoted: a claim, where friendMarker's line is a rating
      `${nameList(c.others)} said “I can do a hard part”`),
    c.mine && el("span", { class: "friend-line" }, mark("friend"), "You said you can do a hard part"),
    c.mine && el("button", {
      type: "button", class: "link", "data-pick": pick, disabled: state.busy,
      "aria-label": "Undo: you said you can do a hard part", onclick: () => toggle(false)
    }, "undo"),
    c.canClaim && el("button", {
      type: "button", class: "btn sm ghost", "data-pick": pick, disabled: state.busy, onclick: () => toggle(true)
    }, "I can do a hard part"));
}

// Reads fail soft: any error (no table yet, a policy, the network) is "no
// claims this time", said once in the console and never on the page.
let claimsWarned = false;
async function loadClaims(ideaIds) {
  try { return claimsByIdea(await claimsFor(ideaIds)); }
  catch (err) {
    if (!claimsWarned) console.warn("Claims are off: idea_claims could not be read.", err);
    claimsWarned = true;
    return null;
  }
}

// ---------------------------------------------------------------- friend

// A group mate's profile (decision 13): name and the skills they hold at
// solid or some, by domain. Read-only; their ideas are the feed.
function friendView() {
  const f = state.friend;
  if (!f) return el("div", {}, header(),
    state.error
      ? errorLine(el("a", { href: "#/group" }, "← group"))
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
          list.map(({ skill, level }) => el("div", { class: "skill", title: skill.id },
            el("div", {}, el("div", { class: "nm" }, skill.name)),
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
    el("h1", {}, "No group yet"),
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
        el("ul", { class: "plain" }, others.map((m) => {
          const name = m.display_name ?? m.user_id;
          const key = `${g.id}/${m.user_id}`;
          // two clicks, like deleting the group: removal unshares their ideas
          // here (unshare_on_leave), and only a new invite brings them back
          return state.confirmRemove === key
            ? el("li", { class: "confirm" },
                el("p", { class: "hint" }, `Remove ${name}? Their ideas shared here go back to private.`),
                el("div", { class: "row" },
                  el("button", { class: "btn sm warn", type: "button", onclick: () => run(async () => { state.confirmRemove = null; await removeMember(g.id, m.user_id); await load(); }) }, "Yes, remove"),
                  el("button", { class: "btn sm ghost", type: "button", onclick: () => { state.confirmRemove = null; render(); } }, "Keep them")))
            : el("li", {},
                el("span", {}, name),
                el("button", { class: "link", type: "button", onclick: () => { state.confirmRemove = key; render(); } }, "Remove"));
        }))),
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
          : (state.confirmDelete === g.id
            ? el("div", {},
                el("p", { class: "hint" }, `Leave ${g.name}? Your ideas shared to it go back to private, and you lose the feed.`),
                el("div", { class: "row" },
                  el("button", { class: "btn sm warn", type: "button", onclick: () => run(async () => { state.confirmDelete = null; await removeMember(g.id, me); await load(); }) }, "Yes, leave"),
                  el("button", { class: "btn sm ghost", type: "button", onclick: () => { state.confirmDelete = null; render(); } }, "Stay")))
            : el("button", { class: "link danger", type: "button", onclick: () => { state.confirmDelete = g.id; render(); } }, "Leave group"))
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
        setStatus(outcome === "joined"
          ? `${email} already had an account and is in the group.`
          : `${email} can now create an account; they join when they do.`);
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
  const say = (words, link, label = "See it on the list.") => {
    line.replaceChildren(words);
    if (link) line.append(" ", el("a", { href: `#/idea/${link}` }, label));
    requestAnimationFrame(fit);
  };
  // After a save: "Got it", then, once waifuListen has the extraction, the
  // hard part read back or her question (w.said, and w.vague for which
  // link). Kept in state, like fit, so the result reaches whichever view is
  // on screen when it lands.
  const heard = () => say(w.said ?? SAVED, w.ideaId, w.vague ? ANSWER_LINK : undefined);
  w.heard = heard;
  say(w.phase === "saved" ? SAVED : w.phase === "failed" ? FAILED : w.line);
  if (w.phase === "saved" && w.ideaId) heard();

  const input = el("textarea", {
    class: "waifu-input", rows: 2, placeholder: "An idea, in as few words as you like",
    autocomplete: "off",
    onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } },
    // typing the next idea moves on: she goes back to asking and stops listening for the last one
    oninput: () => { if (w.phase !== "asking" && w.phase !== "sending") { w.phase = "asking"; w.listen = null; say(w.line); } }
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
        w.phase = "saved"; w.ideaId = id; w.said = null; w.vague = false; input.value = ""; heard();
        waifuListen(id, band);                     // unawaited: the box is free for the next idea
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

// She waits for the extraction of the idea she was just told, then says one
// line about it (readBack, lib/waifu.js). The scene's own wait, apart from
// the list's watch(): the same window (60 looks, 2 s apart), nothing drawn
// while it runs, and silence if the run failed or never showed.
//
// It only reads. Inserting an idea and writing a clarification are the two
// things that start an extraction, a paid API call, and neither is in here.
//
// No `since` for runsFor: the idea is seconds old, so any run is its first.
// The function writes the run, then the capabilities, then the idea row, so
// the result is read once the row agrees with the run.
const WAIFU_LOOKS = 60, WAIFU_TICK_MS = 2000;

async function waifuListen(ideaId, band) {
  const w = state.waifu;
  const token = w.listen = {};
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const on = () => w.listen === token && state.route === "waifu" && !!state.session;
  try {
    let run = null;
    for (let i = 0; i < WAIFU_LOOKS && !run; i++) {
      await pause(WAIFU_TICK_MS);
      if (!on()) return;
      [run] = await runsFor(ideaId);
    }
    if (!run || run.error) return;
    let row = null;
    for (let i = 0; i < 10 && on(); i++) {
      row = await fetchIdea(ideaId);
      if (row.is_clear === run.clear) break;
      row = null;
      await pause(1000);
    }
    if (!row || !on()) return;
    const capabilities = row.is_clear ? await capabilitiesFor(ideaId) : [];
    const said = readBack({ ...row, capabilities }, skillName, band);
    if (!said || !on() || w.phase !== "saved" || w.ideaId !== ideaId) return;
    w.said = said; w.vague = row.is_clear === false;
    announce(said);
    w.heard?.();
  } catch {
    // a failed read is not worth a word from her; the idea is saved either way
  } finally {
    if (w.listen === token) w.listen = null;
  }
}

// Leaving the scene stops the wait; a ?band= change within it does not.
addEventListener("hashchange", () => { if (currentRoute() !== "waifu") state.waifu.listen = null; });

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
// How long a wait for extraction lasts before giving up: two minutes, as when
// it was 60 polls 2 s apart (lib/wait.js).
const WATCH_WINDOW_MS = WINDOW_MS;

// What a wait cut short by a route change returns: not a result, not a stall.
const CANCELLED = Symbol("cancelled");

// One wait per idea at most: idea_id -> stop(). A route change stops them all
// (stopWaits, from the hashchange handler); load() then restarts the ones the
// new page shows, which is why stopping has to be synchronous.
const waits = new Map();
function stopWaits() {
  for (const stop of [...waits.values()]) stop();
  state.extracting.clear();
}

// The race (lib/wait.js): a Realtime channel on this idea's runs and a poll
// of runsFor, whichever sees the run first. The state machine says what to
// do; this only owns the timers, the channel and the reads, and every exit
// (a run, the window, a failed read, stop()) clears all three. Resolves to
// the run, null when the window ran out, or CANCELLED.
function raceForRun(ideaId, since, onTick) {
  waits.get(ideaId)?.();
  return new Promise((resolve, reject) => {
    let s = startWait(), reading = false, ended = false, unsub = () => {}, clock = null, timer = null;
    const end = (fn, v) => {
      if (ended) return;
      ended = true; s = { ...s, done: true };
      clearInterval(clock); clearTimeout(timer); unsub();
      if (waits.get(ideaId) === stop) waits.delete(ideaId);
      fn(v);
    };
    const stop = () => end(resolve, CANCELLED);
    const on = (ev, run) => {
      const r = step(s, ev);
      s = r.s;
      for (const a of r.acts) {
        if (a === "close") { unsub(); unsub = () => {}; }
        else if (a === "progress") onTick(s.elapsed / 1000);
        else if (a === "poll") poll();
        else if (a === "finish") end(resolve, run);
        else if (a === "give-up") end(resolve, null);
      }
    };
    // one read in flight at a time: a slow network must not stack them
    const poll = async () => {
      if (reading) return;
      reading = true;
      try { const [run] = await runsFor(ideaId, since); if (run && !ended) on("row", run); }
      catch (err) { end(reject, err); }
      finally { reading = false; }
    };
    waits.set(ideaId, stop);
    clock = setInterval(() => on("tick"), TICK_MS);
    // a backstop: the ticks end the window themselves unless the tab throttles them
    timer = setTimeout(() => on("timeout"), WATCH_WINDOW_MS + TICK_MS);
    unsub = watchRuns(ideaId, since, {
      onRow: (run) => on("row", run),
      onStatus: (st) => on(st === "SUBSCRIBED" ? "subscribed" : "sub-error")
    });
  });
}

// onProgress({ stage, seconds }) is called on every tick: the idea page turns
// it into a line of text, the list into the bar on the new idea's row.
async function awaitRerun(ideaId, since, onProgress) {
  const run = await raceForRun(ideaId, since, (seconds) => onProgress({ stage: "extracting", seconds }));
  if (!run || run === CANCELLED || run.error) return run;

  // seeing the run is not seeing the result (above): a few reads of the row,
  // abandoned if the page moves on meanwhile
  const route = state.route;
  onProgress({ stage: "saving", seconds: null });
  for (let i = 0; i < 10; i++) {
    if ((await fetchIdea(ideaId)).is_clear === run.clear) break;
    await sleep(1000);
    if (state.route !== route || waits.has(ideaId)) return CANCELLED;
  }
  return run;
}

// Watch a just-added (or still pending) idea from the list until its
// extraction lands, then reload so the row takes its sorted place. Runs
// unawaited so the list stays usable meanwhile.
//
// Everything here reads. `again` marks a wait restarted by "Check again"
// (checkAgain()), so the card says it is looking, not extracting.
//
// A route change stops the wait (stopWaits) and it ends here silently: the
// list's load() starts it again on return, from the same `since`.
async function watch(ideaId, since, again = false) {
  if (state.extracting.has(ideaId)) return;
  state.extracting.set(ideaId, { stage: "extracting", seconds: 0, again });
  announce(again ? "Checking whether the extraction landed." : "Extracting the idea.");
  render();
  let got = null;
  try {
    got = await awaitRerun(ideaId, since, (p) => {
      if (!state.extracting.has(ideaId)) return;
      state.extracting.set(ideaId, { ...p, again });
      if (p.stage === "saving") announce("Saving the result.");
      render();
    });
    if (got === CANCELLED) return;
    // a timeout ends the wait but not the answer: answered stays, so the
    // card comes back read-only rather than with a second paid box
    state.rerun.delete(ideaId);
    if (got) settleAnswer(ideaId, got);
    if (!got) stall(ideaId, since, "Extraction has not landed yet. It may still be running.");
    else if (got.error) failRun(got.error);
    else announce("Extraction finished.");
  } catch (err) {
    fail(err);
  } finally {
    // a stopped wait leaves the map alone: a restarted one may already own it
    if (got !== CANCELLED) {
      state.extracting.delete(ideaId);
      if (state.route === "list") await load().catch(fail);
      justLanded.add(ideaId);   // the next paint of its card plays the split-flap
      render();
    }
  }
}

// Rating happens where the gap shows, not only on the profile: each
// capability on the idea page carries the profile's own control for its
// skill (levelControl). `name` is the radio group that was used, so the
// keyboard can be put back in it after the page is rebuilt.
async function rate(skillId, level, name) {
  const before = new Map(state.levels);
  const refocus = () => document.querySelector(`.lvl input[name="${name}"][value="${level}"]`)?.focus();
  state.levels.set(skillId, level);
  state.moved = "saving…";
  render();
  refocus();
  try {
    await setSkillLevel(state.session.user.id, skillId, level);
    await ensureIdeas();
    state.moved = whatMoved([skillId], before, state.levels);
  } catch (err) {
    console.error(err);
    state.levels = before;
    state.moved = explain(err).text;
  }
  render();
  refocus();
}

// `n` is the capability's place on the page: two capabilities can resolve to
// the same skill, and each needs a radio group of its own.
function capabilityDetail(cap, n) {
  const k = classify(cap, state.levels);
  const isCrux = cap.crux_rank === 1;
  const name = `lvl-cap-${n}`;
  return el("li", { class: `capdetail ${k}${isCrux ? " is-crux" : ""}` },
    el("div", { class: "capdetail-head" },
      mark(k),
      el("span", { class: "capdetail-name" }, capLabel(cap)),
      isCrux && el("span", { class: "crux-tag" }, "a hard part"),
      // quiet, and only for "iteration": a property of the task, not a size
      iterationTag(cap) && el("span", { class: "iter-tag" }, iterationTag(cap)),
      // a proposed capability has no skill to rate and stays text
      cap.skill_id && levelControl(cap.skill_id, name, `Your level: ${capLabel(cap)}`,
        (level) => rate(cap.skill_id, level, name))
    ),
    cap.reason && el("p", { class: "capdetail-reason" }, cap.reason)
  );
}

// How one capability was matched to the skill table: prompt-work data, shown
// only inside the page's closed "Details" (pageDetails).
function resolution(cap) {
  return el("li", { class: "resolution" },
    el("span", {}, capLabel(cap)),
    el("dl", {},
      el("dt", {}, "resolved"), el("dd", {}, cap.resolved),
      cap.resolved_from && [el("dt", {}, "proposed as"), el("dd", {}, cap.resolved_from)],
      cap.resolve_why && [el("dt", {}, "because"), el("dd", {}, cap.resolve_why)],
      el("dt", {}, "skill id"), el("dd", {}, cap.skill_id ?? `${cap.proposed_key} (not in the table)`)
    ));
}

// Everything on the idea page that only means something to whoever works on
// the prompt: how each capability was resolved, and the extraction runs with
// their model and prompt hash. One closed disclosure at the foot of the page,
// so the page above it is what a friend would understand.
// extraction_runs are readable by the owner only, so a friend would see none.
function pageDetails(caps, runs, mine) {
  if (!caps.length && !(mine && runs.length)) return null;
  return el("details", { class: "runs" },
    el("summary", {}, "Details"),
    caps.length > 0 && [
      el("h3", {}, "How each capability was matched"),
      el("ul", { class: "resolutions" }, caps.map(resolution))],
    mine && [
      el("h3", {}, `Extraction history (${runs.length})`),
      el("ul", { class: "runs-list" }, runs.map((r) => el("li", {},
        el("span", { class: "mark" }, r.error ? "✕" : "·"),
        el("span", {}, `${new Date(r.created_at).toLocaleString()} · ${r.model} · ${r.prompt_hash}` +
          (r.error ? ` · ${r.error.slice(0, 80)}` : ""))
      )))]
  );
}

// The quiet way to the help page, beside whatever shows the marks.
function helpLink() {
  return el("a", { href: "#/help", class: "help-link" }, "What do these marks mean?");
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

// Owner only, live ideas only: a built or dropped idea shows the banner and
// its "Back to live" instead. The built checklist starts unticked — a skill
// goes to solid only when you say you used it, the same checkable-claim rule
// as the taxonomy (spec 2026-10-22).
function lifecycleControl(idea, caps) {
  if (lifecycleOf(idea) !== "live") return null;
  const open = (form) => { state.lifecycleForm = form; state.buildTicks = new Set(); state.dropDraft = ""; clearError(); render(); };
  const cancel = el("button", { class: "btn sm ghost", type: "button", onclick: () => open(null) }, "Cancel");

  if (state.lifecycleForm === "build") {
    const choices = buildChoices(caps, state.levels);
    return el("div", { class: "lifecycle" },
      el("p", { class: "hint" }, choices.length
        ? "Which of these did you actually do? Each one you tick goes to solid."
        : "Nothing left to rate here: every skill it needs is already solid or still proposed."),
      choices.length > 0 && el("ul", { class: "build-list" }, choices.map((c) => el("li", {},
        el("label", { class: "chk" },
          el("input", {
            type: "checkbox", checked: state.buildTicks.has(c.skill_id),
            onchange: (e) => { if (e.target.checked) state.buildTicks.add(c.skill_id); else state.buildTicks.delete(c.skill_id); }
          }),
          el("span", {}, capLabel(c)))))),
      el("div", { class: "row" },
        el("button", { class: "btn sm", type: "button", disabled: state.busy, onclick: () => markBuilt(idea.id) }, "Mark built"),
        cancel));
  }

  if (state.lifecycleForm === "drop") {
    return el("form", {
      class: "lifecycle drop-form",
      onsubmit: (e) => {
        e.preventDefault();
        const reason = cleanReason(state.dropDraft);
        if (!reason) { clearError(); state.error = `Say why in a line, up to ${DROP_REASON_MAX} characters.`; render(); return; }
        run(async () => { await setDropped(idea.id, reason); state.lifecycleForm = null; state.dropDraft = ""; state.ideas = []; await load(); });
      }
    },
      el("label", { class: "fld" }, "Why are you dropping it?",
        el("input", {
          name: "reason", required: true, maxlength: DROP_REASON_MAX, autocomplete: "off", value: state.dropDraft,
          placeholder: "One line is enough", oninput: (e) => { state.dropDraft = e.target.value; }
        })),
      el("div", { class: "row" },
        el("button", { class: "btn sm", type: "submit", disabled: state.busy }, "Drop it"),
        cancel));
  }

  return el("div", { class: "lifecycle row" },
    el("button", { class: "sm secondary", type: "button", onclick: () => open("build") }, "I built this"),
    el("button", { class: "link", type: "button", onclick: () => open("drop") }, "Drop it"));
}

// Stamp built, then raise each ticked skill to solid, then say what moved —
// one line for the batch. state.ideas is emptied first so ensureIdeas()
// re-reads it: the cached copy would still count this idea as live.
// A failure still reloads, so the page shows what actually landed; a failed
// reload is swallowed so the original error is the one run() reports.
function markBuilt(ideaId) {
  const ticked = [...state.buildTicks];
  const before = new Map(state.levels);
  const me = state.session.user.id;
  run(async () => {
    state.moved = "";
    try {
      await setBuilt(ideaId, true);
      await Promise.all(ticked.map((id) => setSkillLevel(me, id, "solid")));
      for (const id of ticked) state.levels.set(id, "solid");
      state.ideas = [];
      await ensureIdeas();
      state.moved = ticked.length ? whatMoved(ticked, before, state.levels) : "";
    } finally {
      state.lifecycleForm = null;
      state.buildTicks = new Set();
      await load().catch(() => {});
    }
  });
}

// The idea page's wait for a re-run: after an answer, and again from "Check
// again" when that wait ran out. It only reads — the write that starts an
// extraction is answerBox's setClarification, never this — so asking twice
// costs nothing. The stage is announced once; the seconds are only on screen.
//
// Leaving the page stops it (stopWaits) and it ends without a word; coming
// back while state.rerun still holds the answer starts it again from load().
async function pollRerun(ideaId, since) {
  state.waiting = "waiting for extraction…";
  announce("Waiting for extraction.");
  let got = null;
  try {
    got = await awaitRerun(ideaId, since, ({ stage, seconds }) => {
      if (state.route !== "idea") return;
      state.waiting = stage === "saving" ? "saving the result…" : `waiting for extraction… ${seconds}s`;
      if (stage === "saving") announce("Saving the result.");
      render();
    });
    if (got === CANCELLED) return;
    state.rerun.delete(ideaId);
    if (got) settleAnswer(ideaId, got);   // a timeout leaves answered, as in watch()
    if (!got) stall(ideaId, since, "The re-run has not landed yet. It may still be running.");
    else if (got.error) failRun(got.error);
    else announce("Extraction finished.");
  } finally {
    if (got !== CANCELLED) state.waiting = "";
  }
  await load();
}

// What this idea resembles among your own (lib/similar.js): a link and the
// reason, nothing else. The match's score orders the list and is never shown,
// and there is no merging — `raw` is never overwritten. The idea's own
// capabilities come from the page, which is fresher than the cached list.
function looksLike(idea, caps) {
  const others = new Map(state.ideas.map((i) => [i.id, i]));
  const allCaps = [
    ...state.caps.filter((c) => c.idea_id !== idea.id),
    ...caps.map((c) => ({ ...c, idea_id: idea.id }))
  ];
  const found = similarIdeas(idea, state.ideas, allCaps).filter((m) => others.has(m.id));
  if (!found.length) return null;
  // resolving a duplicate is dropping this one, both yours and both live
  const canDrop = (other) => isLive(idea) && isLive(other) && other.user_id === idea.user_id;
  const asking = found.map((m) => others.get(m.id)).find((o) => o.id === state.confirmDuplicate && canDrop(o));
  return [el("p", { class: "looks-like" },
    el("span", { class: "lbl" }, "Looks like: "),
    found.map((m, i) => {
      const other = others.get(m.id);
      return [
        i > 0 && "; ",
        el("a", { href: `#/idea/${m.id}` }, other.objective || other.raw),
        el("span", { class: "why" }, ` (${lifecycleOf(other) === "built" ? `${m.why} · built` : m.why})`),
        canDrop(other) && !asking && [" ", el("button", {
          class: "link", type: "button", disabled: state.busy, "data-dup": other.id,
          onclick: () => { state.confirmDuplicate = other.id; clearError(); render({ focus: ".dup-confirm .ghost" }); }
        }, "Drop this one as a duplicate")]
      ];
    })),
    asking && duplicateConfirm(idea, asking)];
}

// The second click, like deleteControl's. It is an ordinary drop with the
// reason written for you and a pointer to the other idea (setDropped's third
// argument); "Back to live" undoes it. Nothing else is written.
function duplicateConfirm(idea, other) {
  // back to the drop link of the match that was opened, not the first one
  const keep = () => { state.confirmDuplicate = null; render({ focus: `.looks-like [data-dup="${other.id}"]` }); };
  return el("div", { class: "dup-confirm" },
    el("p", { class: "hint" }, `Drop this as a duplicate of “${other.objective || other.raw}”?`),
    el("div", { class: "row" },
      el("button", { class: "btn sm", type: "button", disabled: state.busy, onclick: () => {
        if (state.busy) return;
        run(async () => {
          await setDropped(idea.id, duplicateReason(idea, other), other.id);
          state.confirmDuplicate = null;
          state.ideas = [];
          await load();
        }).then(() => app.querySelector(".life-banner button, .looks-like button.link")?.focus());
      } }, "Yes, drop it"),
      el("button", { class: "btn sm ghost", type: "button", disabled: state.busy, onclick: keep }, "Keep it")));
}

// The vague idea's answer box, and (with `correct`) the form behind a clear
// idea's "Assumed: … — not right?". Both are the same write: the webhook
// re-runs extraction whenever clarification changes, whatever is_clear says.
function answerBox(idea, correct = false) {
  const form = el("form", {
    class: "answer",
    onsubmit: (e) => {
      e.preventDefault();
      const text = form.elements.clarification.value.trim();
      // one submit, one write: a second press while it is in flight does nothing
      if (!text || state.busy) return;
      // an unchanged clarification starts no run, and the wait would never end
      if (text === (idea.clarification ?? "").trim()) {
        clearError(); state.error = "That is what it already says. Change it to re-extract."; render(); return;
      }
      run(async () => {
        const since = new Date().toISOString();
        // the one write here, and the only thing that starts an extraction
        await setClarification(idea.id, text);
        state.correcting = false; state.correctDraft = "";
        sentAnswer(idea.id, since);
        await pollRerun(idea.id, since);
      });
    }
  },
    el("label", { class: "fld" }, correct ? "What did you mean?" : "Your answer",
      el("textarea", {
        name: "clarification", rows: 2, required: true,
        placeholder: correct ? "Say what the thing actually is, in a line" : "Say what the thing actually is",
        oninput: correct ? (e) => { state.correctDraft = e.target.value; } : undefined
      }, correct ? state.correctDraft : null)),   // a textarea's value is its text, not an attribute
    el("p", { class: "hint" }, "Answering re-runs extraction. That is one API call, about a cent."),
    el("div", { class: "row" },
      el("button", { type: "submit", class: "btn sm", disabled: state.busy }, state.busy ? "Working…" : correct ? "Correct and re-extract" : "Answer and re-extract"),
      correct && el("button", { type: "button", class: "btn sm ghost", onclick: () => { state.correcting = false; render(); } }, "Cancel"))
  );
  return form;
}

// "Assumed: <reading> — not right?" under the title of a clear idea whose
// wording admitted more than one reading. Only the owner gets the control:
// a friend could not save a clarification (RLS), so they see the line alone.
function assumedLine(idea, mine) {
  const text = assumptionOf(idea);
  if (!text) return null;
  return [
    el("p", { class: "assumed" },
      el("span", { class: "lbl" }, "Assumed: "), text,
      mine && !state.correcting && [" — ", el("button", {
        type: "button", class: "link", disabled: state.busy,
        onclick: () => { state.correcting = true; clearError(); render({ focus: ".assumed + .answer textarea" }); }
      }, "not right?")]),
    mine && state.correcting && answerBox(idea, true)
  ];
}

function ideaView() {
  const d = state.detail;
  // no detail and an error means the load failed (not visible, no such id):
  // the error must show here or the page says "Loading…" forever
  if (!d) return el("div", {}, header(),
    state.error
      ? errorLine(el("a", { href: "#/" }, "← all ideas"))
      : el("p", { class: "muted" }, "Loading…"));

  const { idea, caps, runs, groups, imageUrl } = d;
  // a friend's shared idea is readable but not editable: no answering, no
  // share control (RLS would refuse both; the page just does not offer them)
  const mine = idea.user_id === state.session.user.id;
  const extraction = { clear: idea.is_clear === true, capabilities: caps };
  const dist = distanceOf(extraction, state.levels);
  const crux = cruxOf(extraction);
  const ordered = crux ? [crux, ...caps.filter((c) => c !== crux)] : caps;
  // the page has the runs, so the latest one decides, not a "Check again"
  const kind = kindOf(idea, runs[0] ?? null);

  const counts = dist && [
    `${dist.gap} short`,
    dist.partial ? `${dist.partial} partial` : null,
    dist.have ? `${dist.have} held` : null
  ].filter(Boolean).join(" · ");

  const life = lifecycleOf(idea);
  // dropped as a duplicate: the owner gets a link to the idea it duplicates;
  // anyone else, or a pointer to an idea since deleted, gets the reason
  const dupOf = life === "dropped" && mine && idea.duplicate_of && state.ideas.find((i) => i.id === idea.duplicate_of);

  return el("div", {},
    header(),
    el("p", { class: "back" }, el("a", { href: "#/" }, "← all ideas")),

    el("div", { class: "card detail" },
    life !== "live" && el("div", { class: `life-banner ${life}` },
      el("span", {}, life === "built" ? `Built ${fmtDate(idea.built_at)}`
        : dupOf ? `Dropped ${fmtDate(idea.dropped_at)} as a duplicate of` : `Dropped ${fmtDate(idea.dropped_at)} —`),
      dupOf && el("a", { class: "dup-of", href: `#/idea/${dupOf.id}` }, dupOf.objective || dupOf.raw),
      life === "dropped" && !dupOf && el("span", { class: "drop-reason" }, idea.drop_reason),
      el("span", { class: "spacer" }),
      mine && el("button", {
        class: "link", type: "button", disabled: state.busy,
        onclick: () => run(async () => { await setBuilt(idea.id, false); state.ideas = []; await load(); })
      }, "Back to live")),
    el("h1", { class: "detail-title" }, idea.objective || idea.raw),
    el("p", { class: "idea-raw" }, `captured as: ${idea.raw}`),
    idea.clarification && el("p", { class: "idea-raw" }, `you clarified: ${idea.clarification}`),
    // a correction still re-running is not offered again (it is a paid write)
    assumedLine(idea, mine && !answerPending(state.answered.get(idea.id), runs[0] ?? null)),
    mine && looksLike(idea, caps),

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
      idea.status !== "extracted" && el("span", { class: "tag warn" }, statusWord(idea.status))
    ),

    errorLine(),
    state.waiting && el("p", { class: "muted" }, state.waiting),

    idea.status === "draft" && el("section", { class: "ask" },
      el("p", {}, el("b", {}, "Saved without extracting. "),
        "Nothing has read it yet, so it has no capabilities or hard part."),
      mine && el("div", { class: "row" },
        el("button", {
          type: "button", class: "btn sm", disabled: state.busy,
          onclick: () => {
            if (state.busy) return;
            run(async () => {
              // the one write here, and what starts the (paid) extraction
              await extractDraft(idea.id);
              await load();   // the page now reads pending, not draft
              // wait from the database's own stamp, not this browser's clock
              const since = state.detail?.idea.queued_at ?? new Date().toISOString();
              state.rerun.set(idea.id, since);
              await pollRerun(idea.id, since);
            });
          }
        }, state.busy ? "Working…" : "Extract now"),
        el("span", { class: "hint" }, "One API call, about a cent."))),

    kind === "vague" && el("section", { class: "ask" },
      el("p", {}, el("b", {}, "Too vague to extract. "), idea.clarifying_question),
      mine && answerBox(idea)
    ),
    // no result, a failed run, or an answer not landed: the list's waiting
    // card's words; "Check again" for the owner, and not while a wait runs.
    // A draft has its own section above and nothing to wait on.
    kind !== "vague" && kind !== "clear" && kind !== "draft" && el("section", { class: "waiting-note" },
      waitingNote(idea, kind, mine && !state.waiting, waitingHead(kind))),

    caps.length > 0 && el("section", {},
      el("div", { class: "taken-head" }, el("h2", {}, "What it would take"), helpLink()),
      el("ul", { class: "capdetails" }, ordered.map(capabilityDetail)),
      ordered.some((c) => c.skill_id) && el("p", { class: "rate-hint" },
        "Rate yourself on each skill here. It is the same rating as on your profile."),
      state.moved && el("p", { class: "moved", role: "status" }, state.moved)
    ),

    // "I can do a hard part" and who said so (claimRow(), Group section)
    idea.shared_to && claimRow(idea, !!crux),

    mine && shareControl(idea, groups),
    mine && lifecycleControl(idea, caps),
    mine && deleteControl(idea),

    pageDetails(ordered, runs, mine)
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
  return el("article", { class: settled ? "card rv gone" : "card rv", id: `p-${p.key}` },
    el("div", { class: "card-head" },
      el("h3", {}, p.key),
      el("div", { class: "meta" },
        el("span", { class: "tag" }, n(p.idea_ids.length, "idea")),
        el("span", { class: "tag" }, n(p.run_count, "run")),
        p.crux_count > 0 && el("span", { class: "tag hard" }, `a hard part ×${p.crux_count}`)
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
    errorLine(),
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
    errorLine()
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
    el("h1", {}, "Report a problem"),
    el("p", { class: "muted" }, "A bug, or something that could be better. It goes to the tracker with the page you came from and the build you are on."),
    sentLine(),
    form,
    state.reports.length > 0 && el("section", { class: "reports" },
      el("h2", { class: "sub-h" }, "Your reports"),
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

// ---------------------------------------------------------------- help

// What the marks, "a hard part" and distance mean. The words are in
// lib/help.js; this only lays them out.
function helpView() {
  return el("div", { class: "help" },
    header(),
    el("div", { class: "page-head" },
      el("div", {},
        el("h1", {}, "What the marks mean"),
        el("p", {}, "Every idea is a list of things you would have to be able to do. Each line carries one of these."))),
    el("section", { class: "card" },
      el("dl", { class: "help-marks" }, MARKS.map((m) => [
        el("dt", {}, mark(m.kind), el("span", {}, m.name)),
        el("dd", {}, m.text)]))),
    SECTIONS.map((s) => el("section", { class: "card" },
      el("h2", {}, s.title),
      s.body.map((p) => el("p", {}, p))))
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
  if (state.route === "help") return helpView();
  return state.route === "profile" ? profileView() : listView();
}

// A page switch slides in the direction of travel along the tabs, and the
// active tab's pill glides, through the View Transitions API; a sort or
// filter change asks for the same (render({ animate: true })) so the cards,
// each named after its idea, glide to their new places. Anything else, an
// extraction tick or a save, paints plainly. Nothing animates without the
// API, under reduced motion, or into or out of the waifu scene.
const ROUTE_ORDER = { list: 0, idea: 0.5, group: 1, friend: 1.5, profile: 2, review: 3, report: 4, help: 5 };
let paintedRoute = null;
let latest = null;   // a transition's callback paints whatever was built last
let heldFocus = null;   // holdFocus()'s restore, from before the page was built
let heldRoute = null;   // the route that focus was on

function render({ animate = false, focus = null } = {}) {
  // the static landing (index.html) shows only while signed out
  document.documentElement.classList.toggle("signed-in", !!state.session);
  if (!state.session) { paintAuth(); paintedRoute = state.route; return; }
  if (authDialog.open) authDialog.close();   // signed in from the dialog
  // before viewFor(): building the page moves the kept fields (captureBox,
  // searchBox, the answers) out of it, which blurs them. A render that comes
  // before a pending transition paints keeps the first one's memory.
  if (!heldFocus) { heldFocus = holdFocus(app); heldRoute = paintedRoute; }
  const route = state.route;
  latest = viewFor();
  if (state.route !== "waifu") latest.append(footer());
  // `focus` is a selector for the control that caused this render: the page
  // is rebuilt under it, and a keyboard user would otherwise start again
  // from the top
  // otherwise; with no `focus`, whatever had it gets it back (holdFocus)
  const paint = () => {
    // a repaint of the same page gets its focus back; a page switch does not,
    // or Back from the list would land on the same idea's card in the feed
    const restore = heldRoute === route ? heldFocus : null;
    heldFocus = null;
    mount(app, latest);
    const to = focus && app.querySelector(focus);
    if (to) to.focus(); else restore?.();
  };
  const switched = paintedRoute !== null && paintedRoute !== state.route;
  const can = state.session && document.startViewTransition && !reduceMotion()
    && state.route !== "waifu" && paintedRoute !== "waifu";
  if (can && (switched || animate)) {
    document.documentElement.dataset.vt = switched ? "page" : "list";
    document.documentElement.dataset.dir =
      switched && (ROUTE_ORDER[state.route] ?? 0) < (ROUTE_ORDER[paintedRoute] ?? 0) ? "back" : "fwd";
    // a newer transition skips this one, which rejects these with an
    // AbortError: expected on rapid route changes, so only that is ignored
    const t = document.startViewTransition(paint);
    const skipped = (e) => { if (e?.name !== "AbortError") console.error(e); };
    t.ready?.catch(skipped); t.finished?.catch(skipped); t.updateCallbackDone?.catch(skipped);
  } else {
    paint();
  }
  paintedRoute = state.route;
  filtersToHash();
}

// The list's filters and sort are mirrored in the hash query, so Back from an
// idea page (or a reload) returns to the same view. Read when the hash
// changes, written after every render. A bare "#/" — the Ideas tab, the
// redirect after a delete — carries no query and keeps what is in memory.
// Both leave any other hash alone: #signin, #create, Supabase's
// #access_token=…, and the other routes all have a non-empty path.
function filtersFromHash() {
  if (hashPath() !== "" || !hashQuery()) return;
  const { sort, ...filters } = decodeFilters(hashQuery());
  state.sort = sort;
  state.filters = filters;
  searchBox.value = filters.q;
}

function filtersToHash() {
  if (!state.session || state.route !== "list" || hashPath() !== "") return;
  const query = encodeFilters({ ...state.filters, sort: state.sort });
  if (query === encodeFilters(decodeFilters(hashQuery()))) return;
  // replaceState, not location.hash: no history entry per keystroke and no
  // hashchange (so no reload). Safari throws past 100 calls in 30 s.
  try { history.replaceState(null, "", query ? `#/?${query}` : "#/"); } catch { /* the next render tries again */ }
}

async function run(fn) {
  state.busy = true; clearError(); render();
  try { await fn(); }
  catch (err) { fail(err); }
  finally { state.busy = false; render(); }
}

function clearError() {
  state.error = null; state.errorDetail = null; state.stalled.clear();
}

// A thrown error becomes a sentence for the page (lib/errors.js). The raw
// message is not thrown away: it goes to the console and sits under "Details"
// on the error line for as long as that error is the one showing.
function fail(err) {
  console.error(err);
  const { text, detail } = explain(err);
  state.error = text;
  state.errorDetail = detail ? { for: text, raw: detail } : null;
  announce(text);
  return text;
}

// An extraction run that failed: the same shape as fail(), from the run's
// stored error (lib/errors.js, explainRun). It offers nothing to press —
// an extraction is a paid call, and only an answer or a new idea starts one.
function failRun(raw) {
  const { text, detail } = explainRun(raw);
  state.error = text;
  state.errorDetail = detail ? { for: text, raw: detail } : null;
  announce(text);
}

// A wait for extraction that ran out. The idea and the moment the wait began
// are kept so "Check again" can look for the same run.
function stall(ideaId, since, text) {
  state.stalled.set(ideaId, since);
  state.error = text;
  announce(text);
}

// Looks again for an extraction that is already running or already done.
// It only reads (runsFor, the idea row, then load()): it never inserts an
// idea or writes a clarification, which are the two things that start an
// extraction, and an extraction is a paid API call.
function checkAgain() {
  const waits = [...state.stalled];
  clearError();
  for (const [id, since] of waits) {
    if (state.route === "idea" && id === currentIdeaId()) run(() => pollRerun(id, since));
    else watch(id, since, true);
  }
  if (!waits.length) render();
}

// The page's one error: the sentence, "Check again" when it is a wait that
// ran out, and the raw message folded under "Details" when there is one.
function errorLine(...extra) {
  if (!state.error) return null;
  const raw = state.errorDetail?.for === state.error ? state.errorDetail.raw : null;
  return el("div", { class: "error" },
    el("span", {}, state.error),
    state.stalled.size > 0 && el("button", { type: "button", class: "sm secondary", disabled: state.busy, onclick: checkAgain }, "Check again"),
    extra,
    raw && el("details", {}, el("summary", {}, "Details"), el("code", {}, raw)));
}

// Display names for whoever the current view mentions; cached for the session.
async function loadNames(ids) {
  const missing = ids.filter((id) => !state.names.has(id));
  for (const p of await profilesFor(missing)) state.names.set(p.user_id, p.display_name);
}

// Views read state.loadedRoute to tell "nothing here" from "not loaded yet".
// The route is captured first: a hashchange mid-load must not mark the new
// route loaded with the old route's data. A failed load still counts — the
// error is on screen, and "Loading…" under it would never end.
async function load() {
  const route = state.route;
  try { await loadRoute(); } finally { state.loadedRoute = route; }
}

async function loadRoute() {
  if (!state.session) {
    state.ideas = []; state.caps = []; state.feedCaps = []; state.skills = []; state.levels = new Map();
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
    const [{ ideas: ideaRows, caps: capRows }, pool] = await Promise.all([ideas(me), groupSkills(me)]);
    state.ideas = ideaRows;
    state.caps = capRows;
    state.pool = pool;
    await loadNames([...new Set([...pool.values()].flat())]);
    // A pending row is watched from here, whether it was just added or the
    // page was reloaded mid-extraction; `since` is the insert, which is what
    // fired the webhook. Older than the wait window means the webhook never
    // delivered, and re-watching it would loop: it shows as a waiting card
    // (waitingRow). An answer sent this session whose wait a route change cut
    // short is picked up again the same way, from the moment it was sent.
    const fresh = Date.now() - WATCH_WINDOW_MS;
    for (const i of ideaRows) {
      // a draft sent with "Extract now" waits from that moment (queued_at)
      if (i.status === "pending" && Date.parse(queuedSince(i)) > fresh) watch(i.id, queuedSince(i));
    }
    for (const [id, since] of state.rerun) {
      if (Date.parse(since) > fresh) watch(id, since); else state.rerun.delete(id);
    }
  } else if (state.route === "review") {
    state.proposals = state.curator ? await proposedSkills() : [];
  } else if (state.route === "report") {
    state.reports = await myFeedback();
  } else if (state.route === "profile") {
    // your ideas are read here once, not per render, for "Your ideas need
    // these"; without them the profile is the plain table
    const [profile] = await Promise.all([myProfile(state.session.user.id), ensureIdeas().catch(() => { state.ideas = []; state.caps = []; })]);
    state.profile = profile;
    state.needFirst = skillsNeededList(state.ideas, state.caps).filter((n) => !state.levels.has(n.skill_id));
  } else if (state.route === "group") {
    const me = state.session.user.id;
    const [profile, groups, { ideas: feed, caps: feedCaps }, pool] = await Promise.all([
      myProfile(me), myGroups(), sharedIdeas(), groupSkills(me)
    ]);
    state.profile = profile;
    state.feed = feed;
    state.feedCaps = feedCaps;
    state.pool = pool;
    state.claims = await loadClaims(feed.map((i) => i.id));
    await loadNames([...new Set([...feed.map((i) => i.user_id), ...[...pool.values()].flat(), ...[...(state.claims?.values() ?? [])].flat()])]);
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
      fetchIdea(id), capabilitiesFor(id), runsFor(id), myGroups(),
      // your other ideas, for "Looks like" and "what moved": read once and
      // kept (ensureIdeas does nothing once they are loaded), and never
      // worth failing the page over
      ensureIdeas().catch(() => {})
    ]);
    // a missing object (upload failed, decision 9) must not take the page down
    const imageUrl = one.image_path ? await mediaUrl(one.image_path).catch(() => null) : null;
    // claims exist on shared ideas only; null (unreadable) hides the row
    state.claims = one.shared_to ? await loadClaims([id]) : null;
    state.detail = { idea: one, caps, runs, groups, imageUrl };
    settleAnswer(id, runs[0] ?? null);   // a run since the answer: its box may come back
    await loadNames([...(one.user_id !== state.session.user.id ? [one.user_id] : []), ...(state.claims?.get(id) ?? [])]);
    // an answer's wait that a route change cut short (pollRerun); unawaited, it reads only
    const since = state.rerun.get(id);
    if (since && !waits.has(id) && Date.parse(since) > Date.now() - WATCH_WINDOW_MS) pollRerun(id, since).catch(fail).then(() => render());
  } else if (state.route === "friend") {
    const id = currentFriendId();
    const [profiles, levels] = await Promise.all([profilesFor([id]), skillsFor(id)]);
    // RLS hides a stranger's rows rather than refusing them
    if (!profiles.length) throw new Error("No such person, or you are not in a group with them.");
    state.friend = { profile: profiles[0], levels: new Map(levels.map((r) => [r.skill_id, r.level])) };
  }
}

addEventListener("hashchange", () => {
  stopWaits();   // every channel and timer goes; load() restarts what the new page shows
  state.route = currentRoute();
  filtersFromHash();
  if (/^#(signin|create)$/.test(location.hash)) state.authMode = location.hash.slice(1);   // the landing's links
  setStatus("");
  state.detail = null;
  state.confirmDeleteIdea = false;
  state.confirmCard = null;
  if (state.lastMoved?.shown) state.lastMoved = null;   // the list's banner shows on one visit
  // a pending "Leave?" or "Remove?" should not be waiting when you come back
  state.confirmDelete = null;
  state.confirmRemove = null;
  state.sent = null;
  state.moved = "";
  state.lifecycleForm = null;
  state.buildTicks = new Set();
  state.dropDraft = "";
  state.confirmDuplicate = null;
  state.friend = null;
  state.waiting = "";
  state.correcting = false; state.correctDraft = "";
  run(load);
});

// The list's shortcuts (lib/keys.js decides which key means what). The help
// is one <dialog> for the session, outside #app, so a repaint every 2 s while
// an idea extracts cannot close it; Escape closes it as any modal does.
const keysDialog = el("dialog", { class: "keys", "aria-labelledby": "keys-h",
  onclick: (e) => { if (e.target === keysDialog) keysDialog.close(); } },
  el("div", { class: "keys-card" },
    el("h2", { id: "keys-h" }, "Keyboard shortcuts"),
    el("dl", {}, SHORTCUTS.map(([k, what]) => [el("dt", {}, el("kbd", {}, k)), el("dd", {}, what)])),
    el("p", { class: "hint" }, "On the Ideas tab, whenever you are not typing."),
    el("form", { method: "dialog" }, el("button", { class: "btn sm ghost" }, "Close"))));
document.body.append(keysDialog);

addEventListener("keydown", (e) => {
  if (!state.session || state.route !== "list" || authDialog.open) return;
  const onCard = !!document.activeElement?.closest?.(".list .card.idea");
  const action = keyAction(e, { onCard });
  if (!action) return;
  if (keysDialog.open && action !== "help") return;
  // the key would otherwise land in the box it just focused, or scroll
  e.preventDefault();
  if (action === "help") return keysDialog.open ? keysDialog.close() : keysDialog.showModal();
  if (action === "search") return searchBox.focus();
  if (action === "capture") return captureBox.focus();
  const links = cardLinks();
  const at = links.findIndex((a) => a.closest(".card")?.contains(document.activeElement));
  links[nextIndex(at, links.length, action)]?.focus();
});

// Fires on sign-in, sign-out and token refresh, and is what repaints after the
// sign-in form resolves.
db.auth.onAuthStateChange((_event, s) => {
  const changed = s?.user?.id !== state.session?.user?.id;
  state.session = s;
  if (changed) run(load); else render();
});

filtersFromHash();
state.session = await session();
await run(load);
