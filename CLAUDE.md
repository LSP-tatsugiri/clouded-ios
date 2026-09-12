# clouded — working rules

An idea database that reports how far each idea is from something the owner could
actually build. Read `README.md` for the full design; this file is the short list
of things to keep true while writing code. `docs/design-review.md` holds the
open questions and the reasoning behind the product decisions.

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
  tool schema; `src/distance.js` turns capabilities plus profile into gaps;
  `data/skills.json` is the canonical table; `schema.sql` is the target Postgres
  schema.
- `/` — the iOS app. Empty on purpose; capture is built last, because what an
  entry stores depends on what extraction produces.

Run: `cd extraction && npm start` (uses cached output) or `npm run fresh`
(re-extracts everything after a prompt change). Needs `ANTHROPIC_API_KEY` in
`extraction/.env`.

## Build order

1. Extraction script against real ideas ← current
2. Tune the prompt until capabilities are consistently checkable
3. Hand-curate the skills table from what extraction produces
4. Supabase schema + pipeline as an edge function
5. Web list view, sorted and filterable
6. iOS capture app + Share Extension
7. Sharing and the friend skill pool
8. Later: graph view, roadmaps, starter kits

Build on the web first. Port to the phone only what actually gets reached for
while out. Capture is the only phone-first part.

## Known problems — do not treat these as settled

- **Distance is a flat count of gaps.** "Pick PETG for heat" and "mechanical
  singulation of small fasteners" both count 1, and the model is capped at 3–7
  capabilities, so a weekend project and a six-month one can score the same.
  Planned fix: sort by crux status first (held / partial / gap), then by gap
  count. Consider a per-capability flag for "learnable from a tutorial" vs
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
- **Findings in the README come from 4 extractions.** Re-run all 19.

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
