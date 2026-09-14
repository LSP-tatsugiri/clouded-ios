// clouded — web client.
//
// Step 5 Phase A: sign in, list what you can see.
// Step 5 Phase B: rate your skills, which is what distance is measured against.
//
// The distance sort, the filters, the leverage panel and the idea page are
// Phase C and D. The list is still in capture order and says so on screen, so
// nothing here is mistaken for the ranking before distance.js exists.

import { addIdea, db, ideas, mySkills, session, setSkillLevel, signIn, signOut, skills } from "./lib/db.js";
import { el, mount } from "./lib/dom.js";

const LEVELS = ["none", "some", "solid"];

const app = document.getElementById("app");
const state = {
  session: null,
  route: currentRoute(),
  ideas: [],
  skills: [],          // cached: 51 rows, seeded by migration, never changes at runtime
  levels: new Map(),   // skill_id -> none | some | solid
  error: null,
  busy: false
};

function currentRoute() {
  return location.hash.replace(/^#\/?/, "") === "profile" ? "profile" : "list";
}

// ---------------------------------------------------------------- chrome

function header() {
  const tab = (href, label, route) =>
    el("a", { href, class: state.route === route ? "tab on" : "tab" }, label);
  return el("header", {},
    el("h1", {}, "clouded"),
    el("nav", {},
      tab("#/", "Ideas", "list"),
      tab("#/profile", "Profile", "profile"),
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

function ideaRow(idea) {
  const title = idea.objective || idea.raw;
  return el("li", { class: "idea" },
    el("div", { class: "idea-title" }, title),
    title !== idea.raw && el("div", { class: "idea-raw" }, idea.raw),
    el("div", { class: "meta" },
      idea.domain && el("span", { class: "tag" }, idea.domain),
      idea.is_clear === false && el("span", { class: "tag warn" }, "needs a question"),
      idea.status !== "extracted" && el("span", { class: "tag warn" }, idea.status),
      idea.shared_to && el("span", { class: "tag" }, "shared")
    ),
    idea.is_clear === false && idea.clarifying_question &&
      el("p", { class: "question" }, idea.clarifying_question)
  );
}

function listView() {
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

  return el("div", {},
    header(),
    add,
    state.error && el("p", { class: "error" }, state.error),
    el("p", { class: "muted" },
      `${state.ideas.length} ideas · capture order, until the distance sort lands`),
    el("ul", { class: "ideas" }, state.ideas.map(ideaRow))
  );
}

// ---------------------------------------------------------------- profile

// Updated in place rather than through a re-render: re-rendering on every
// radio change would pull focus out of the control being used.
const status = el("span", { class: "status" }, "");
const tally = el("p", { class: "muted" }, "");

function countLevels() {
  const n = { none: 0, some: 0, solid: 0, unrated: 0 };
  for (const s of state.skills) {
    const lv = state.levels.get(s.id);
    if (lv) n[lv]++; else n.unrated++;
  }
  return n;
}

function refreshTally() {
  const n = countLevels();
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
        type: "radio",
        name: `lvl-${skill.id}`,
        value: lv,
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
  // skills arrive ordered by sort_order; keep that order inside each domain
  const byDomain = new Map();
  for (const s of state.skills) {
    const d = s.domain || "other";
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(s);
  }
  refreshTally();

  return el("div", {},
    header(),
    el("p", { class: "muted" },
      "Be honest. An inflated profile makes every distance wrong."),
    el("div", { class: "tally-row" }, tally, status),
    state.error && el("p", { class: "error" }, state.error),
    [...byDomain].map(([domain, list]) => el("section", { class: "domain" },
      el("h2", {}, domain),
      el("ul", { class: "skills" }, list.map(skillRow))
    ))
  );
}

// ---------------------------------------------------------------- plumbing

function render() {
  if (!state.session) return void mount(app, signInView());
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
    state.ideas = []; state.skills = []; state.levels = new Map();
    return;
  }
  if (state.route === "profile") {
    const [table, mine] = await Promise.all([
      state.skills.length ? state.skills : skills(),
      mySkills(state.session.user.id)
    ]);
    state.skills = table;
    state.levels = new Map(mine.map((r) => [r.skill_id, r.level]));
  } else {
    state.ideas = await ideas();
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
