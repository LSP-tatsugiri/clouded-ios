# Step 5 — Web list view, sorted and filterable

Written 2026-09-13 at the close of Step 4. Read `CLAUDE.md` first for the
invariants. `docs/step-4-plan.md` has the schema, the edge function and the
acceptance numbers this step builds on. This file is the concrete plan for the
web client; nothing here is built yet.

## State at handoff

- Hosted Supabase project with the Phase B schema, the `extract` edge function
  (v3) wired to a webhook on `ideas`, and 19 extracted ideas under
  `test@clouded.dev` (`88976eb5-…`). RLS verified 20/20 with a group mate, a
  stranger and the anon key.
- Baseline on `claude-sonnet-5` committed in `extraction/out/`, prompt
  `e3446a126ffc`. Same-prompt wobble across 3 runs: verdict 19/19, crux
  identical 16/19, skill-set overlap 0.89. Hosted output matches it within
  that wobble.
- `extraction/data/profile.json` is the author's skill levels: 51 ids →
  `none | some | solid`, unlisted means `none`. `user_skills` is empty.
- `extraction/src/distance.js` is the reference for held / partial / gap and
  the flat score; the crux-first sort exists only as a decision, not code.
- Trello board: https://trello.com/b/eSTxmwz7/clouded. Commit messages name
  what shipped.

## Decisions (made 2026-09-14)

All four recommendations below were accepted as written: seed `user_skills`
with a script now and a profile page in Phase B; show one crux, not a ranked
top-2; keep the anon key in a gitignored `web/config.js`; plain ES modules
with no bundler. The reasoning is kept because the crux decision is worth
revisiting when the friend pool grows.

1. **Seeding `user_skills` from `profile.json`.** Options:
   (a) a one-off script, `supabase/scripts/seed-profile.mjs --user <uuid>`,
   upserting `profile.json` through the service role from `supabase/.env`,
   skipping ids not in `skills` with a warning;
   (b) a profile page in the web app with a three-state control per skill,
   which friends need anyway;
   (c) both.
   Recommended: **(c)**, script first. The script is ten minutes and unblocks
   the list on day one; the page is Phase B and is how the profile stays
   honest afterwards. `profile.json` stays the author's local scratch, not a
   source of truth, once the page exists.

2. **Crux display: one crux or a ranked top-2.** The numbers: on sonnet-5
   the crux is identical across three same-prompt runs for 16/19 ideas
   (13/16 of the clear ones). The three that flip — knob (haptic-profiles vs
   bldc-foc), pokemon-bin (print-joinery vs print-tolerancing), dryer
   (airflow-thermal vs mains-safety) — are each two genuinely plausible
   project-killers, and on the dryer the model marked both in one run.
   A ranked top-2 means changing the tool schema, which moves the prompt
   hash and costs a fresh baseline (~$1 with stability), and it would land
   together with `strict: true` since both touch the schema.
   Recommended: **one crux for Step 5**, shown as "the hard part", with the
   `crux_rank = 2` column left empty. 84% stable is enough for a list sort;
   the sort key is the crux's held/partial/gap status, and two plausible
   cruxes in the same idea usually share that status. Revisit top-2 with
   strict mode when the friend pool makes the schema change worth a baseline.

3. **Where the anon key and project URL live for the client.** They are
   public by design (RLS is the boundary, verified), but the working rule
   has been "never in a tracked file". Recommended: keep the rule. The page
   loads them from a gitignored `web/config.js` (`export const SUPABASE_URL`,
   `SUPABASE_ANON_KEY`) with a committed `web/config.example.js`. Hosting is
   deferred: v1 runs locally with `npx serve web`, and a static host with
   env-substituted config comes with Step 7 when friends need a URL.

4. **Stack.** Recommended: `web/` as plain ES modules, no bundler, no
   framework, `@supabase/supabase-js` from the jsDelivr ESM CDN pinned to a
   version. ~10 users, one list, one detail page, one profile page. A
   framework buys nothing here and adds a build step to every change. If
   the group feed (deferred) ever needs it, that is the time.

## Phase A — scaffold and sign-in (built 2026-09-14)

- `web/`: `index.html`, `app.js`, `style.css`, `lib/db.js` (the client and
  every query), `lib/dom.js` (an `el()` helper whose string children become
  text nodes, so idea text can never inject markup), `config.example.js`.
  `config.js` is gitignored and generated from `supabase/.env`.
- `web/serve.mjs`: a no-dependency static server bound to 127.0.0.1, because
  ES modules will not load over `file://`. `node web/serve.mjs` →
  http://localhost:5173. This replaces the `npx serve` in the sketch above;
  one fewer install, and it refuses path traversal.
- Sign-in is email + password against Supabase Auth; signed out, the page is
  only the form. Magic links need SMTP and can wait.
- `supabase/scripts/seed-profile.mjs --user <uuid> [--dry-run]` upserts
  `profile.json` into `user_skills` through the service role. Unknown skill
  ids are skipped with a warning; a level outside none/some/solid is a hard
  error, because a typo would quietly become a wrong distance. Run once for
  the author: 14 of 14 rows, 0 skipped.
- No hash routing yet — there is one view, so adding a router before the
  second view would be furniture. It arrives with the profile page.
- The list is deliberately in capture order and says so on screen, so
  nothing is mistaken for the ranking before `distance.js` exists.
- Verified from here: every file parses; the server returns the right status
  and content type for each route and 404s encoded traversal without leaking
  repo files; the exact `ideas` select the client issues returns 19 rows
  with the expected columns; the anon key alone returns 0.
  Still needs a human: the browser sign-in itself.

## Phase B — profile page

- All 51 skills grouped by `domain`, each a three-state control
  (none / some / solid) writing to `user_skills` (`upsert`, `on conflict
  (user_id, skill_id)`). `hazard` skills carry a marker.
- Acceptance: flipping a level changes the list order on the next render;
  reload shows the saved levels; a second user's levels are not visible.

## Phase C — the list

- `web/lib/distance.js`: port of `extraction/src/distance.js` (`classify`,
  `distanceOf`) plus the sort:
  1. crux status: held, then partial, then gap (a proposed crux counts as gap),
  2. gap count (proposed capabilities count as gaps, as in the script),
  3. partial count, then title.
  A Node test (`node --test web/lib/`) asserts `classify` and `distanceOf`
  agree with `extraction/src/distance.js` on the committed baseline, and
  pins the sort on hand-built cases.
- Row: title (`raw`, or `objective` when present), crux name with its
  status mark, `N short · M partial · K held`, domain, and `[?]` when any
  capability is still proposed. Vague ideas (`is_clear = false`) sit in
  their own section at the bottom with the clarifying question.
  `pending` and `failed` rows show their status instead of a distance.
- Filters: domain (from `ideas.domain`), crux status (held / partial / gap),
  and "has a proposed skill". "A friend can unblock it" waits for Step 7.
- Leverage ranking: for each skill, the number of ideas where it is a gap
  for the signed-in user, sorted desc, top 10 in a side panel. Same
  definition as the script's HIGHEST LEVERAGE section.
- Acceptance: for the author's profile the list order and the leverage top
  10 match what a Node script computes from the same rows with
  `distance.js` and the sort above (`supabase/scripts/acceptance.mjs list`
  can print that reference).

## Phase D — the idea page and the two writes

- Capabilities with held / partial / gap / proposed marks, the crux first
  and labelled, each with its `reason`. Resolution details (`resolved`,
  `resolved_from`, `resolve_why`) behind a disclosure.
- The clarifying question, when `is_clear = false`, with a text box that
  writes `ideas.clarification`. That is the only UPDATE the webhook acts
  on, so the answer re-runs extraction. `status` is not reset by the
  update, so the page polls `extraction_runs` for a row newer than the
  answer rather than watching `status`.
- An "add idea" box on the list page: one text field, inserts `raw`. This
  is the web capture path and the way to test without the SQL editor.
- Share: a select to set `shared_to` to one of the user's groups, or
  private. Groups have no UI yet; the select is empty until Step 7 unless a
  group exists.
- Acceptance: answer the question on "rc truck", see a new run row and the
  idea move into the sorted list; add an idea and see it extracted; the
  anon key can do neither.

## Phase E — acceptance and close

1. Fresh sign-in, seeded profile, 19 ideas: order matches the reference,
   leverage matches, filters reduce the list correctly.
2. RLS from the browser: a second user (create via the dashboard) sees only
   what `acceptance.mjs rls` says they should.
3. Commit `web/`, update `CLAUDE.md` layout and build order, README "you
   are here" to Step 6.

## Not in this step

- Group creation and membership UI, the friend skill pool, "who can unblock
  this" — Step 7.
- Comments and the group feed — deferred per README.
- Ranked top-2 crux and `strict: true` on the tool — one schema change, one
  baseline re-run, when the friend pool needs it.
- Hosting with a public URL — Step 7.
- Magic-link sign-in, password reset — when a friend actually needs it.

## Trello cards this closes

- "Step 5 · Web list view" (name to confirm on the board)
- Anything else on the board mentioning profile, leverage or filters
