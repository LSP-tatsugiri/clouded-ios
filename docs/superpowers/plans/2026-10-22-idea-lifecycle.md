# Idea Lifecycle (built and dropped) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner mark an idea built (rating the skills they actually used as solid) or dropped (with a one-line reason), with the Ideas list showing live ideas by default.

**Architecture:** Three nullable columns on `ideas` carry the state; the client writes them under the existing owner RLS policy. Pure lifecycle rules live in a new `web/lib/lifecycle.js` with `node:test` tests; `web/app.js` uses them in the list, the idea page, "what moved" and the Group feed.

**Tech Stack:** Postgres via Supabase migrations; plain ES modules in the browser (no bundler, no framework, `el()` from `web/lib/dom.js`); Node 20+ built-in `node:test` for the pure module.

**Spec:** `docs/superpowers/specs/2026-10-22-idea-lifecycle-design.md`

## Global Constraints

- Work on branch `agent/idea-lifecycle`; never push to `main` (a hook refuses it).
- No Anthropic API spend: never add an idea or answer a clarifying question while testing.
- `supabase db push` (the real apply) is the owner's to run. The agent writes the migration, runs `supabase db push --dry-run`, commits and pushes the branch.
- Migration filename timestamp from `date -u +%Y%m%d%H%M%S` (never `supabase migration new`; it hangs on stdin).
- No new dependencies anywhere. ESM. Terse comments in the house style (say why, not what).
- `ideas.raw` is never written. No change to extraction or the edge function.
- Drop reason: required, trimmed, 1–200 characters.
- Built and dropped are mutually exclusive; "Back to live" clears all three columns.
- The "I built this" checklist starts **all unticked**; it lists only capabilities with a `skill_id` that are not already `solid`.
- Closest-to-me bands, the leverage panel and "what moved" count **live ideas only**. A Built or Dropped view is one list, newest-marked first, with no distance sort.
- Group feed hides dropped ideas and tags built ones. Dropping never unshares.
- Test user: `test@clouded.dev`; credentials in gitignored `supabase/.env`. Never print the password.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_idea_lifecycle.sql` | create | columns, check constraints, column grant |
| `web/lib/lifecycle.js` | create | pure rules: state of an idea, checklist choices, reason cleaning, "what moved" headline |
| `web/test/lifecycle.test.mjs` | create | `node:test` tests for the pure module |
| `web/lib/db.js` | modify | new columns in three selects; `setBuilt`, `setDropped` |
| `web/app.js` | modify | list control and tags, idea-page actions and banner, `whatMoved` over a set, feed filter |
| `web/style.css` | modify | banner, checklist, drop form, drop-reason line |
| `CLAUDE.md`, `docs/improvement-backlog.md` | modify | record what shipped |

The friend page (`friendView`) shows skills only, never ideas, so it needs no change even though the spec mentions friend pages.

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/<ts>_idea_lifecycle.sql`

**Interfaces:**
- Produces: columns `ideas.built_at timestamptz`, `ideas.dropped_at timestamptz`, `ideas.drop_reason text`, updatable by `authenticated` on their own rows.

- [ ] **Step 1: Write the migration**

```bash
cd /c/Users/2004b/Code/clouded-ios && TS=$(date -u +%Y%m%d%H%M%S) && echo "supabase/migrations/${TS}_idea_lifecycle.sql"
```

Write that file with exactly:

```sql
-- Idea lifecycle: built and dropped (docs/superpowers/specs/2026-10-22-idea-lifecycle-design.md).
-- An idea is live while both timestamps are null. Built and dropped exclude
-- each other, and "back to live" is setting all three to null again, so
-- nothing here is one-way. Owner-only writes come from "ideas: own"; a group
-- mate holds only the select policy and cannot mark someone else's idea.

alter table ideas
  add column built_at    timestamptz,
  add column dropped_at  timestamptz,
  add column drop_reason text,           -- one line, why; a fact, not a score
  add constraint ideas_built_or_dropped check (built_at is null or dropped_at is null),
  add constraint ideas_drop_has_reason  check ((dropped_at is null) = (drop_reason is null)),
  add constraint ideas_drop_reason_line check (drop_reason is null or length(btrim(drop_reason)) between 1 and 200);

-- init.sql revoked update on ideas and granted it column by column; these
-- three join clarification, image_path, audio_path, transcript and shared_to.
grant update (built_at, dropped_at, drop_reason) on ideas to authenticated;
```

- [ ] **Step 2: Dry-run against the hosted project**

Run: `cd /c/Users/2004b/Code/clouded-ios && supabase db push --dry-run`
Expected: lists exactly one pending migration, `<ts>_idea_lifecycle.sql`, and no error. If the CLI says it is not linked or logged in, stop and hand that to the owner (`supabase login` needs a TTY).

- [ ] **Step 3: Commit and push the branch**

```bash
cd /c/Users/2004b/Code/clouded-ios
git add supabase/migrations/*_idea_lifecycle.sql
git commit -m "Migration: ideas.built_at, dropped_at, drop_reason

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin agent/idea-lifecycle
```

- [ ] **Step 4: Hand the apply to the owner**

Tell the owner to run `supabase db push` in a terminal from the repo root, on this branch. After they confirm, verify with `supabase migration list` (the new migration shows in both Local and Remote columns). Tasks 2–6 can proceed meanwhile; the end-to-end check in Task 7 needs the push.

---

### Task 2: Pure lifecycle module

**Files:**
- Create: `web/lib/lifecycle.js`
- Test: `web/test/lifecycle.test.mjs`

**Interfaces:**
- Produces (all named exports of `web/lib/lifecycle.js`):
  - `DROP_REASON_MAX: number` (200)
  - `lifecycleOf(idea: {built_at?, dropped_at?}): "live" | "built" | "dropped"`
  - `isLive(idea): boolean`
  - `buildChoices(caps: {skill_id: string|null}[], levels: Map<string,string>): caps[]` — the capabilities the built checklist offers, in input order
  - `cleanReason(text: string|null|undefined): string | null` — trimmed reason, or null when it would be refused
  - `movedHeadline(skillIds: string[], after: Map<string,string>): string`

- [ ] **Step 1: Write the failing tests**

`web/test/lifecycle.test.mjs`:

```js
// Run: node --test web/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { DROP_REASON_MAX, buildChoices, cleanReason, isLive, lifecycleOf, movedHeadline } from "../lib/lifecycle.js";

test("lifecycleOf reads the two timestamps", () => {
  assert.equal(lifecycleOf({ built_at: null, dropped_at: null }), "live");
  assert.equal(lifecycleOf({}), "live");   // a row selected before the migration
  assert.equal(lifecycleOf({ built_at: "2026-10-22T10:00:00Z", dropped_at: null }), "built");
  assert.equal(lifecycleOf({ built_at: null, dropped_at: "2026-10-22T10:00:00Z" }), "dropped");
  assert.equal(isLive({ built_at: null, dropped_at: null }), true);
  assert.equal(isLive({ built_at: "2026-10-22T10:00:00Z" }), false);
});

test("buildChoices offers rateable skills not already solid", () => {
  const caps = [
    { skill_id: "parametric-cad" },
    { skill_id: "soldering" },
    { skill_id: null, proposed_key: "kiln-firing" },
    { skill_id: "pcb-layout" }
  ];
  const levels = new Map([["soldering", "solid"], ["pcb-layout", "some"]]);
  assert.deepEqual(buildChoices(caps, levels).map((c) => c.skill_id), ["parametric-cad", "pcb-layout"]);
  assert.deepEqual(buildChoices([], levels), []);
});

test("cleanReason trims and refuses empty or over-long reasons", () => {
  assert.equal(cleanReason("  bought one instead "), "bought one instead");
  assert.equal(cleanReason("   "), null);
  assert.equal(cleanReason(""), null);
  assert.equal(cleanReason(null), null);
  assert.equal(cleanReason("x".repeat(DROP_REASON_MAX)), "x".repeat(DROP_REASON_MAX));
  assert.equal(cleanReason("x".repeat(DROP_REASON_MAX + 1)), null);
});

test("movedHeadline names one skill or counts several", () => {
  const after = new Map([["parametric-cad", "solid"], ["soldering", "solid"], ["pcb-layout", "solid"]]);
  assert.equal(movedHeadline(["parametric-cad"], after), "parametric-cad → solid.");
  assert.equal(movedHeadline(["parametric-cad", "soldering", "pcb-layout"], after), "3 skills → solid.");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /c/Users/2004b/Code/clouded-ios && node --test web/test/`
Expected: FAIL — `Cannot find module '.../web/lib/lifecycle.js'`.

- [ ] **Step 3: Write the module**

`web/lib/lifecycle.js`:

```js
// An idea's lifecycle (docs/superpowers/specs/2026-10-22-idea-lifecycle-design.md).
//
// Live until it is built or dropped, and either is undone by "Back to live".
// Pure, so node:test covers it (web/test/); app.js does the DOM and db.js the
// writes. The database enforces the same rules with check constraints.

export const DROP_REASON_MAX = 200;

export function lifecycleOf(idea) {
  if (idea.built_at) return "built";
  if (idea.dropped_at) return "dropped";
  return "live";
}

export const isLive = (idea) => lifecycleOf(idea) === "live";

// What "I built this" offers to set solid. A proposed capability has no skill
// to rate, and one already solid has nothing to confirm. The list starts
// unticked in the UI: a skill goes to solid only when you say you used it.
export function buildChoices(caps, levels) {
  return caps.filter((c) => c.skill_id && levels.get(c.skill_id) !== "solid");
}

// The reason as it will be stored, or null when the check constraint would
// refuse it — so the form can refuse first, in words.
export function cleanReason(text) {
  const t = (text ?? "").trim();
  return t && t.length <= DROP_REASON_MAX ? t : null;
}

// The first half of the "what moved" line. Every skill in one batch went to
// the same level, so the first one's level speaks for all of them.
export function movedHeadline(skillIds, after) {
  const level = after.get(skillIds[0]);
  return skillIds.length === 1 ? `${skillIds[0]} → ${level}.` : `${skillIds.length} skills → ${level}.`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /c/Users/2004b/Code/clouded-ios && node --test web/test/`
Expected: 4 tests, all PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/2004b/Code/clouded-ios
git add web/lib/lifecycle.js web/test/lifecycle.test.mjs
git commit -m "Web: pure lifecycle rules, with node:test tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: db.js — read the columns, write the state

**Files:**
- Modify: `web/lib/db.js` — `ideas()` (~line 63), `sharedIdeas()` (~line 72), `idea()` (~line 111), new writes after `setShare()` (~line 254)

**Interfaces:**
- Consumes: the three columns from Task 1.
- Produces:
  - every row from `ideas()`, `sharedIdeas()`, `idea()` carries `built_at`, `dropped_at`, `drop_reason`
  - `setBuilt(id: string, on: boolean): Promise<{id}>` — `on` stamps `built_at` now; `false` puts the idea back to live. Always clears the dropped pair.
  - `setDropped(id: string, reason: string): Promise<{id}>` — stamps `dropped_at` now with `reason`; clears `built_at`. Callers pass a reason already cleaned by `cleanReason`.

Until the owner applies the migration, these selects fail against the hosted database ("column does not exist"). That is expected; only Task 7's browser check depends on it.

- [ ] **Step 1: Add the columns to the three selects**

In `ideas()` and `sharedIdeas()`, the select string becomes:

```js
    .select("id, user_id, raw, objective, domain, is_clear, clarifying_question, status, shared_to, image_path, created_at, built_at, dropped_at, drop_reason")
```

In `idea()`:

```js
    .select("id, user_id, raw, clarification, objective, domain, is_clear, clarifying_question, status, shared_to, image_path, source_url, created_at, built_at, dropped_at, drop_reason")
```

- [ ] **Step 2: Add the two writes after `setShare()`**

```js
// Built and dropped exclude each other (a check constraint says so too), so
// each write clears the other state. setBuilt(id, false) is "Back to live"
// from either state: it leaves all three columns null.
export async function setBuilt(id, on) {
  return ok(await db.from("ideas")
    .update({ built_at: on ? new Date().toISOString() : null, dropped_at: null, drop_reason: null })
    .eq("id", id).select("id").single(), "setBuilt");
}

export async function setDropped(id, reason) {
  return ok(await db.from("ideas")
    .update({ built_at: null, dropped_at: new Date().toISOString(), drop_reason: reason })
    .eq("id", id).select("id").single(), "setDropped");
}
```

- [ ] **Step 3: Check the module still parses**

Run: `cd /c/Users/2004b/Code/clouded-ios && node --check web/lib/db.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/2004b/Code/clouded-ios
git add web/lib/db.js
git commit -m "Web: read built/dropped, and write them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: "What moved" over a set of skills, live ideas only

**Files:**
- Modify: `web/app.js` — imports (~lines 11–20), `save()` (~line 667), `whatMoved()` (~line 690), `rate()` (~line 1330)

**Interfaces:**
- Consumes: `isLive`, `movedHeadline` (Task 2); `setBuilt`, `setDropped` (Task 3).
- Produces: `whatMoved(skillIds: string[], before: Map, after: Map): string`, counting live ideas only. Task 6 calls it with several ids.

- [ ] **Step 1: Imports**

After the `import { el, mount } from "./lib/dom.js";` line add:

```js
import { DROP_REASON_MAX, buildChoices, cleanReason, isLive, lifecycleOf, movedHeadline } from "./lib/lifecycle.js";
```

And in the `./lib/db.js` import list, the line beginning `revokeInvite,` becomes:

```js
  revokeInvite, runsFor, session, setBuilt, setClarification, setDisplayName, setDropped, setShare, setSkillLevel, sharedIdeas,
```

- [ ] **Step 2: Replace `whatMoved`**

Replace the whole function and its comment with:

```js
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
  return `${movedHeadline(skillIds, after)} ${parts.length ? parts.join("; ") + "." : "Nothing moved."}`;
}
```

- [ ] **Step 3: Update the two callers**

In `save()`: `whatMoved(skillId, before, state.levels)` → `whatMoved([skillId], before, state.levels)`.
In `rate()`: `state.moved = whatMoved(skillId, before, state.levels);` → `state.moved = whatMoved([skillId], before, state.levels);`.

Run: `cd /c/Users/2004b/Code/clouded-ios && grep -n "whatMoved(" web/app.js`
Expected: the definition plus exactly two calls, both passing `[skillId]`.

- [ ] **Step 4: Parse check and commit**

Run: `cd /c/Users/2004b/Code/clouded-ios && node --check web/app.js`
Expected: exit 0 (Node 22+ detects module syntax; a syntax error is what this catches — unresolved `/extraction/...` imports are not checked).

```bash
cd /c/Users/2004b/Code/clouded-ios
git add web/app.js
git commit -m "Web: what moved takes a set of skills, and counts live ideas only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ideas list — Live · Built · Dropped

**Files:**
- Modify: `web/app.js` — `state.filters` (~line 56), new `lifecycleTags()` above `ideaRow()` (~line 371), `ideaRow()` card-foot (~line 395), `vagueRow()` card-foot (~line 456), `filterBar()` (~line 460), `listView()` (~line 514)
- Modify: `web/style.css` — after `.tag.level-some` (~line 227)

**Interfaces:**
- Consumes: `lifecycleOf`, `isLive` (Task 2); rows carry the columns (Task 3).
- Produces: `state.filters.lifecycle: "live" | "built" | "dropped"`; `lifecycleTags(idea): Element[]` (Task 7 reuses it).

- [ ] **Step 1: Filter state**

In `state`, the filters line becomes:

```js
  filters: { domain: "", crux: "", proposed: false, friend: false, q: "", lifecycle: "live" },
```

In `filterBar`, the "clear" button's handler keeps the lifecycle choice — it is a view, not a filter:

```js
      el("button", { class: "link", onclick: () => { state.filters = { domain: "", crux: "", proposed: false, friend: false, q: "", lifecycle: state.filters.lifecycle }; searchBox.value = ""; render({ animate: true }); } }, "clear"),
```

- [ ] **Step 2: Tags on cards**

Above `function ideaRow`:

```js
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
```

In `ideaRow`'s card-foot, after the `idea.shared_to && el("span", { class: "tag" }, "shared"),` line, add `lifecycleTags(idea),`.
In `vagueRow`, the card-foot becomes:

```js
    el("div", { class: "card-foot" }, lifecycleTags(idea), el("span", {}, "you"), el("span", {}, fmtDate(idea.created_at)))
```

- [ ] **Step 3: The control**

At the top of `filterBar`, next to `sortButton`, add:

```js
  const lifeButton = (key, label) => el("button", {
    type: "button", "aria-pressed": String(state.filters.lifecycle === key),
    onclick: () => set("lifecycle", key)
  }, label);
```

Replace the first child of `.controls` (the Sort `seg`) with:

```js
    el("div", { class: "seg", role: "group", "aria-label": "Show" },
      lifeButton("live", "Live"), lifeButton("built", "Built"), lifeButton("dropped", "Dropped")),
    // distance only means something for ideas you might still build
    state.filters.lifecycle === "live" && el("div", { class: "seg", role: "group", "aria-label": "Sort" },
      sortButton("newest", "Newest"), sortButton("closest", "Closest to me")),
```

- [ ] **Step 4: Split the rows in `listView`**

Replace the four lines from `const extracting = …` to `const vague = …` with:

```js
  const extracting = rows.filter((r) => state.extracting.has(r.idea.id));
  const settled = rows.filter((r) => !state.extracting.has(r.idea.id));
  // the leverage panel answers "what should I learn next", so finished ideas
  // never count, whichever set the list is showing
  const liveClear = settled.filter((r) => isLive(r.idea) && r.idea.is_clear === true);
  const inView = settled.filter((r) => lifecycleOf(r.idea) === state.filters.lifecycle);
  const clear = inView.filter((r) => r.idea.is_clear === true);
  const vague = inView.filter((r) => r.idea.is_clear !== true);
```

Then, in `listView`:
- Sort block: `if (state.sort === "newest") {` → `if (state.sort === "newest" || state.filters.lifecycle !== "live") {`
- Body block: `if (state.sort === "newest") {` → `if (state.sort === "newest" || state.filters.lifecycle !== "live") {`, and its first line becomes:

```js
    // a built or dropped view reads newest-marked first; for live ideas both
    // marks are null, so this is the plain created-at order
    const when = (i) => Date.parse(i.built_at ?? i.dropped_at ?? i.created_at);
    const all = [...shown, ...vagueShown].sort((a, b) => when(b.idea) - when(a.idea));
```

- Leverage panel: `leveragePanel(clear.map((r) => ({ id: r.idea.id, extraction: r.extraction })))` → `leveragePanel(liveClear.map((r) => ({ id: r.idea.id, extraction: r.extraction })))`
- Empty line: replace `!shown.length && !vague.length && el("p", { class: "muted" }, "No idea matches those filters.")` with:

```js
        !shown.length && !vagueShown.length && el("p", { class: "muted" },
          !inView.length && state.filters.lifecycle === "built" ? "Nothing built yet. Mark an idea built from its page."
          : !inView.length && state.filters.lifecycle === "dropped" ? "Nothing dropped."
          : "No idea matches those filters.")
```

- [ ] **Step 5: CSS**

After `.tag.level-some { … }` in `web/style.css`:

```css
.drop-reason { font-size: 0.8rem; color: var(--ink-3); font-style: italic; overflow-wrap: anywhere; min-width: 0; }
```

- [ ] **Step 6: Parse check and commit**

Run: `cd /c/Users/2004b/Code/clouded-ios && node --check web/app.js && node --test web/test/`
Expected: exit 0; 4 PASS.

```bash
cd /c/Users/2004b/Code/clouded-ios
git add web/app.js web/style.css
git commit -m "Web: the list opens on live ideas; built and dropped behind a toggle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Idea page — I built this, Drop it, Back to live

**Files:**
- Modify: `web/app.js` — `state` (~line 70), new functions after `deleteControl()` (~line 1408), `ideaView()` (~line 1443), the `hashchange` handler (~line 1904)
- Modify: `web/style.css` — after `.delete .row` (~line 889)

**Interfaces:**
- Consumes: `setBuilt`, `setDropped` (Task 3); `buildChoices`, `cleanReason`, `DROP_REASON_MAX`, `lifecycleOf` (Task 2); `whatMoved(skillIds, …)` (Task 4); existing `capLabel`, `ensureIdeas`, `run`, `load`, `setSkillLevel`, `fmtDate`.
- Produces: `state.lifecycleForm: null | "build" | "drop"`, `state.buildTicks: Set<string>`, `state.dropDraft: string`.

- [ ] **Step 1: State**

In `state`, after `moved: "",` add:

```js
  lifecycleForm: null, // idea page: null | "build" | "drop" — which lifecycle form is open
  buildTicks: new Set(), // skill ids ticked in the "I built this" checklist; starts empty on purpose
  dropDraft: "",       // the drop reason being typed, kept across re-renders
```

In the `hashchange` handler, after `state.moved = "";` add:

```js
  state.lifecycleForm = null;
  state.buildTicks = new Set();
  state.dropDraft = "";
```

- [ ] **Step 2: The control and its two actions**

After `deleteControl`, add:

```js
// Owner only, live ideas only: a built or dropped idea shows the banner and
// its "Back to live" instead. The built checklist starts unticked — a skill
// goes to solid only when you say you used it, the same checkable-claim rule
// as the taxonomy (spec 2026-10-22).
function lifecycleControl(idea, caps) {
  if (lifecycleOf(idea) !== "live") return null;
  const open = (form) => { state.lifecycleForm = form; state.buildTicks = new Set(); state.dropDraft = ""; state.error = null; render(); };
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
        if (!reason) { state.error = `Say why in a line, up to ${DROP_REASON_MAX} characters.`; render(); return; }
        run(async () => { await setDropped(idea.id, reason); state.lifecycleForm = null; state.dropDraft = ""; await load(); });
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
function markBuilt(ideaId) {
  const ticked = [...state.buildTicks];
  const before = new Map(state.levels);
  const me = state.session.user.id;
  run(async () => {
    await setBuilt(ideaId, true);
    await Promise.all(ticked.map((id) => setSkillLevel(me, id, "solid")));
    for (const id of ticked) state.levels.set(id, "solid");
    state.ideas = [];
    await ensureIdeas();
    state.moved = ticked.length ? whatMoved(ticked, before, state.levels) : "";
    state.lifecycleForm = null;
    state.buildTicks = new Set();
    await load();
  });
}
```

- [ ] **Step 3: The banner and the control in `ideaView`**

Before the `return el("div", {}, header(), …` in `ideaView`, add:

```js
  const life = lifecycleOf(idea);
```

Inside `el("div", { class: "card detail" },`, as its first child (before the `h2`):

```js
    life !== "live" && el("div", { class: `life-banner ${life}` },
      el("span", {}, life === "built" ? `Built ${fmtDate(idea.built_at)}` : `Dropped ${fmtDate(idea.dropped_at)}:`),
      life === "dropped" && el("span", { class: "drop-reason" }, idea.drop_reason),
      el("span", { class: "spacer" }),
      mine && el("button", {
        class: "link", type: "button", disabled: state.busy,
        onclick: () => run(async () => { await setBuilt(idea.id, false); await load(); })
      }, "Back to live")),
```

And between `mine && shareControl(idea, groups),` and `mine && deleteControl(idea),`:

```js
    mine && lifecycleControl(idea, caps),
```

`state.moved` already renders inside the "What it would take" section, so the batch line appears there. A vague idea has no capabilities and no such section; its checklist shows the "Nothing left to rate" line and nothing moves.

- [ ] **Step 4: CSS**

Check for an existing spacer rule first: `grep -n "\.spacer" web/style.css`. Then after `.delete .row { … }` in `web/style.css` add the following, leaving out the `.life-banner .spacer` line if a global `.spacer { flex: 1 }` already exists:

```css
.lifecycle { margin: 1rem 0 0; }
.lifecycle.row { align-items: center; gap: 1rem; }
.lifecycle .hint { margin: 0 0 0.5rem; }
.build-list { list-style: none; margin: 0 0 0.75rem; padding: 0; display: grid; gap: 0.35rem; }
.drop-form .fld { margin-bottom: 0.6rem; }
.life-banner {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem;
  margin: 0 0 1rem; padding: 0.55rem 0.8rem;
  border-radius: 10px; border: 1px solid var(--line); background: var(--bg);
  font-weight: 600; color: var(--ink-2);
}
.life-banner.built { color: var(--held); border-color: var(--held); }
.life-banner .spacer { flex: 1; }
```

- [ ] **Step 5: Parse check and commit**

Run: `cd /c/Users/2004b/Code/clouded-ios && node --check web/app.js`
Expected: exit 0.

```bash
cd /c/Users/2004b/Code/clouded-ios
git add web/app.js web/style.css
git commit -m "Web: I built this, Drop it, and Back to live on the idea page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Group feed, docs, and the end-to-end check

**Files:**
- Modify: `web/app.js` — `feedRows()` (~line 863), `feedRow()` card-foots (~lines 882, 905)
- Modify: `CLAUDE.md` (the `web/` bullet under Layout), `docs/improvement-backlog.md` (§1 item 2, §2, Suggested order)

**Interfaces:**
- Consumes: `lifecycleOf` (Task 2), `lifecycleTags` (Task 5), the migration applied by the owner (Task 1 Step 4).

- [ ] **Step 1: Feed filter and tag**

In `feedRows()`, the `const rows = …` line becomes:

```js
  // a dropped idea leaves the feed but stays shared, so a link to it still
  // works; a built one stays, tagged — that is news (spec 2026-10-22)
  const rows = state.feed
    .filter((idea) => lifecycleOf(idea) !== "dropped")
    .map((idea) => ({ idea, extraction: extractionOf(idea, capsById) }));
```

In `feedRow()`: the vague card's foot becomes `el("div", { class: "card-foot" }, owner, lifecycleTags(idea), el("span", {}, fmtDate(idea.created_at)))`; in the full card's foot add `lifecycleTags(idea),` right after `owner,`.

- [ ] **Step 2: Docs**

`CLAUDE.md`, in the `web/` bullet under Layout, after the sentence ending "`docs/waifu-view-plan.md`)." add:

```
  An idea can be marked built or dropped from its page (2026-10-22,
  `docs/superpowers/specs/2026-10-22-idea-lifecycle-design.md`):
  `ideas.built_at`, `dropped_at`, `drop_reason`, rules in `lib/lifecycle.js`
  (tests: `node --test web/test/`). The list opens on live ideas; distance,
  leverage and "what moved" count live ideas only.
```

`docs/improvement-backlog.md`:
- §1 item 2: prefix with `~~**"I built this."**~~ **Shipped 2026-10-22** as the idea-lifecycle spec.` and keep the rest of the paragraph.
- §2: strike the first two bullets the same way (`~~…~~ **Shipped 2026-10-22.**`); the near-duplicate bullet stays as the open item.
- Suggested order, item 5: append ` — built/dropped shipped 2026-10-22; duplicates still open.`

- [ ] **Step 3: Tests and parse check**

Run: `cd /c/Users/2004b/Code/clouded-ios && node --test web/test/ && node --check web/app.js`
Expected: 4 PASS; exit 0.

- [ ] **Step 4: End-to-end in the browser (needs the owner's `db push`)**

Confirm first: `supabase migration list` shows the lifecycle migration in Remote. With `node web/serve.mjs` running and signed in as the test user (if the agent is not permitted to read the test password, ask the owner to sign the tab in), pick an **existing** idea with at least two non-solid skills — no new idea, no clarifying answer. Note that idea's current skill levels so they can be restored.

1. Idea page → **I built this** → checklist appears, all unticked → tick two → **Mark built**. Expect: banner "Built <today>", both skills now `[x]`, one line "2 skills → solid. …".
2. Ideas tab: the idea is gone from Live; **Built** shows it with a `built` tag; the leverage panel no longer counts it.
3. Idea page → **Back to live**: banner gone, both actions back.
4. **Drop it** with an empty reason → refused with the inline error, nothing written. Then a reason → banner "Dropped <today>: <reason>"; **Dropped** shows it with the reason.
5. If the test user has a group and the idea is shared: the Group tab no longer shows it; the idea's URL still opens.
6. **Back to live**. Restore the two skills to their noted levels on the Profile tab.

- [ ] **Step 5: Commit and push**

```bash
cd /c/Users/2004b/Code/clouded-ios
git add web/app.js CLAUDE.md docs/improvement-backlog.md
git commit -m "Web: the feed hides dropped ideas and tags built ones; docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

Hand over the compare link: `https://github.com/LSP-tatsugiri/clouded-ios/compare/main...agent/idea-lifecycle`.
