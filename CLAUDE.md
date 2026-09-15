# clouded — working rules

An idea database that reports how far each idea is from something the owner could
actually build. Read `README.md` for the full design; this file is the short list
of things to keep true while writing code. `docs/design-review.md` holds the
open questions and the reasoning behind the product decisions.
`docs/step-4-plan.md` covers Supabase and the edge function — read it before
touching `supabase/`. `docs/step-5-plan.md` covers the web client and records
what each phase decided and verified — read it before touching `web/`.
`docs/step-6-plan.md` is the current build step (the iOS capture app) and
records its decisions; it is built on the Mac.

Audience: the author plus ~10 friends. No growth, revenue, or public users.
Optimise for low friction and few moving parts, not for scale.

## Invariants

These are load-bearing. Changing one is a product decision, not a refactor.

- **Capabilities are checkable tasks, never depth labels.** "Model a part
  parametrically from measured dimensions", not "Intermediate CAD". If you cannot
  answer "can you do this?" yes or no without hedging, it is written wrong.
- **The canonical skill list is passed into the extraction prompt.** The model
  picks from a closed set. Unmatched capabilities are recorded as `proposed` and
  wait for a human to confirm them. Never auto-create a skill.
- **Exactly one capability per idea is the crux** — the part most likely to kill
  the project.
- **No numeric idea scores.** A model cannot rate idea quality. The output is a
  distance and a crux.
- **No time estimates.** Any "~2 weeks" the app prints is a lie that reads as
  authoritative.
- **`ideas.raw` is never overwritten.** Extraction output lives alongside it so a
  better prompt can be re-run over the whole history.
- **Extraction runs server-side**, for the same reason.
- **Ideas are private by default**, shared with one tap.
- **Every row carries `user_id`**, even while there is one user.

## Layout

- `extraction/` — standalone Node script, no dependencies, Node 20+. This is
  where prompt work happens. `src/extract.js` holds the system prompt and the
  tool schema; `src/resolve.js` matches proposed capabilities to the table and
  keeps the proposal registry; `src/distance.js` turns capabilities plus profile
  into gaps; `src/stability.js` measures run-to-run wobble; `data/skills.json`
  is the canonical table (51 entries); `schema.sql` is the starting point for
  the Supabase migration; `out/` is committed on purpose.
- `supabase/` — `migrations/` is the schema, `functions/extract/` is the
  pipeline as a Deno edge function with its tests in `functions/_shared/`,
  `scripts/` holds the seed and acceptance drivers. Keys live in gitignored
  `supabase/.env`.
- `web/` — the web client: list, idea page, profile, curator review. Plain ES
  modules, no bundler, no framework; `@supabase/supabase-js` from a pinned
  CDN. `config.js` is gitignored. It imports `extraction/src/distance.js`
  directly (one copy of the distance logic), which `serve.mjs` serves by
  mounting `/extraction/src/` read-only — hosting must reproduce that mapping.
- `/` — the iOS app. Empty on purpose; capture is built last, because what an
  entry stores depends on what extraction produces.

Run: `cd extraction && npm start` (uses cached output) or `npm run fresh`
(re-extracts everything after a prompt change). Needs `ANTHROPIC_API_KEY` in
`extraction/.env`. The web client is `node web/serve.mjs`; the Deno tests are
`deno test --allow-read --allow-env supabase/functions/_shared/`.

## Build order

1. Extraction script against real ideas — done
2. Tune the prompt until capabilities are consistently checkable — done
3. Hand-curate the skills table from what extraction produces — done; ongoing via `out/proposed.json`
4. Supabase schema + pipeline as an edge function — done 2026-09-13, see `docs/step-4-plan.md`
5. Web list view, sorted and filterable — done 2026-09-14, see `docs/step-5-plan.md`
6. iOS capture app + Share Extension ← current, see `docs/step-6-plan.md`
7. Sharing and the friend skill pool
8. Later: graph view, roadmaps, starter kits

Build on the web first. Port to the phone only what actually gets reached for
while out. Capture is the only phone-first part.

## Known problems — do not treat these as settled

- **Distance is a flat count of gaps.** "Pick PETG for heat" and "mechanical
  singulation of small fasteners" both count 1, and the model is capped at 3–7
  capabilities, so a weekend project and a six-month one can score the same.
  The web list sorts by crux status first (held / partial / gap), then by gap
  count (`sortKey` in `distance.js`), which fixes the ordering but not the
  size. Consider a per-capability flag for "learnable from a tutorial" vs
  "needs real iteration".
- **The leverage ranking is biased by how the taxonomy is split.** `skills.json`
  has 15 embedded skills but 6 fabrication ones, and the prompt says to map
  loosely, so broad skills pick up more ideas and win by construction. Before
  trusting the CAD result, split `parametric-cad` into 2–3 skills and see whether
  the ranking changes.
- **A low `proposed` rate is not evidence the table is good.** The prompt forces
  reuse. The real risk is unrelated capabilities being merged, which is silent.
- **Screenshots are untested.** They are described as the main input, but
  `extract.js` is text-only. Test real screenshots before designing capture.
- **Proposed skills drift in name, not concept.** Handled by `src/resolve.js`
  (lexical + semantic match + registry). Two places to review them, and they
  do not sync: locally, edit `out/proposed.json` and add `"rejected": "<why>"`
  or `"promoted": "<skill_id>"`; in the app, the Review tab reads
  `proposed_skills` and calls `promote_proposed_skill` / `reject_proposed_skill`.
  Promotion there also repoints the capabilities that were waiting on the
  proposal, which the local flow does not do. Only a curator sees either the
  tab or the table; grant with `supabase/scripts/grant-curator.mjs`.
- **Model is `claude-sonnet-5`** as of 2026-09-12; the committed baseline in
  `out/` is from sonnet-5 (2026-09-13, prompt `e3446a126ffc`). Same-prompt
  wobble on it: crux identical 16/19, verdict 19/19, skill overlap 0.89.
- **The model sometimes marks two cruxes**, despite the invariant saying
  exactly one. It happened 5 times across 4 committed runs of 19 ideas, about
  1 idea in 10; `dryer` does it in the committed baseline. The database is
  safe (a partial unique index enforces one `crux_rank = 1`, and
  `capabilityRows()` keeps the first), but anything reading the JSON must pick
  deterministically: use `cruxOf()` from `distance.js`, never an ad-hoc loop.
  Reading the last on one side and the first on the other invented a false
  disagreement in the Phase D numbers once already.
- **Sonnet 5 sometimes returns the tool input double-encoded** — the whole
  record as a JSON string inside `capabilities`, about 1 call in 4. Both
  `extract.js` and the edge function decode it (`repairExtraction`) and
  reject anything still malformed. The proper fix, `strict: true` on the
  tool, changes the schema and so the prompt hash; parked.
- **Both API calls send `thinking: {type: "disabled"}`.** Sonnet 5 thinks by
  default and thinking counts against `max_tokens`; the baseline was never
  produced with thinking. Keep `extract.js`/`resolve.js` and
  `supabase/functions/_shared/` in lockstep; the Deno tests assert it.

## Schema fixes needed before the schema is used

In `extraction/schema.sql`:

- `shared ideas are readable` has no role restriction and there is no
  friend-group table. With the anon key shipped in the client, anyone can read
  every shared idea. Add `to authenticated` and a groups/membership table.
- `user_skills` is readable with `using (true)`, making every profile public.
- `skills` has no RLS enabled, so it is writable through the API.

## Style

- No dependencies in `extraction/` unless there is a real reason.
- ESM, Node 20+, `--env-file` rather than dotenv.
- Terse over clever. This is a personal tool.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `LSP-tatsugiri/clouded-ios`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root, created lazily by `/domain-modeling`. See `docs/agents/domain.md`.
