// clouded — web client. Step 5 Phase A: sign in, list what you can see.
//
// The distance sort, the filters, the leverage panel and the idea page are
// Phase C and D. This file shows ideas in capture order on purpose, and says
// so on screen, so that nothing here is mistaken for the ranking before
// distance.js exists.

import { addIdea, db, ideas, session, signIn, signOut } from "./lib/db.js";
import { el, mount } from "./lib/dom.js";

const app = document.getElementById("app");
const state = { session: null, ideas: [], error: null, busy: false };

// ---------------------------------------------------------------- views

function signInView() {
  const form = el("form", {
    class: "card",
    onsubmit: (e) => {
      e.preventDefault();
      const email = form.elements.email.value.trim();
      const password = form.elements.password.value;
      run(() => signIn(email, password));
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
    el("header", {},
      el("h1", {}, "clouded"),
      el("button", { class: "link", onclick: () => run(signOut) }, "Sign out")
    ),
    add,
    state.error && el("p", { class: "error" }, state.error),
    el("p", { class: "muted" },
      `${state.ideas.length} ideas · capture order, until the distance sort lands`),
    el("ul", { class: "ideas" }, state.ideas.map(ideaRow))
  );
}

// ---------------------------------------------------------------- plumbing

function render() {
  mount(app, state.session ? listView() : signInView());
}

async function run(fn) {
  state.busy = true; state.error = null; render();
  try { await fn(); }
  catch (err) { state.error = err.message; }
  finally { state.busy = false; render(); }
}

async function load() {
  state.ideas = state.session ? await ideas() : [];
}

// Fires on sign-in, sign-out and token refresh, and is what repaints after the
// sign-in form resolves.
db.auth.onAuthStateChange((_event, s) => {
  const changed = s?.user?.id !== state.session?.user?.id;
  state.session = s;
  if (changed) run(load); else render();
});

state.session = await session();
await run(load);
