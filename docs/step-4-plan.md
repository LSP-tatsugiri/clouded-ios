# Step 4 — Supabase schema + extraction as an edge function

Written 2026-09-12 as a handoff from a Cowork session to Claude Code. Read
`CLAUDE.md` first for the invariants. `docs/design-review.md` has the reasoning
behind the product. This file is the concrete plan for the next build step.

## State at handoff

- `extraction/` is done for now: prompt tuned, `resolve.js` matches proposed
  capabilities to the skill table, `stability.js` measures wobble,
  `out/extractions.json` is the baseline (19 ideas, 77 capabilities, 0 new
  proposals on the last run), `out/proposed.json` is the proposal registry.
- Model decided: `claude-sonnet-5` (sonnet-4-5 retires from 2026-09-29).
  The baseline was produced on sonnet-4-5; re-run `npm run fresh` and
  `node --env-file=.env src/stability.js 3` on Sonnet 5 when the API key has
  credits, and commit the new `out/`.
- Trello board: https://trello.com/b/eSTxmwz7/clouded. A nightly task reads
  GitHub commits and moves cards; write commit messages that name what shipped.

## Decisions (made 2026-09-12)

1. **Crux representation: `crux_rank smallint`** (1 primary, 2 secondary,
   null otherwise). A partial unique index enforces exactly one rank-1 row per
   idea. Backward compatible with the boolean: the edge function writes
   `crux_rank = 1` where `is_crux = true` and leaves the extraction tool
   schema unchanged, so Phase D compares against the existing baseline. Switch
   the tool to a ranked top-2 as its own commit, with a fresh baseline, after
   Phase D passes. (Context: `is_crux` flipped on 6/19 ideas across
   same-prompt runs.)
2. **Distance sort: crux status first** (held / partial / gap), then gap
   count. App-side; no schema change. The "learnable from a tutorial" flag
   stays deferred until the crux-first sort has been used for a while.

## Phase A — project + tooling

```
npm i -g supabase
supabase login
supabase init                      # creates supabase/ with config.toml, migrations/
supabase link --project-ref <ref>  # asks for the DB password
supabase start                     # optional local Postgres via Docker
```

Commit `supabase/`. Never commit the anon key, project URL or DB password;
they go in gitignored `.env` files. The edge function gets its Anthropic key via
`supabase secrets set`.

## Phase B — schema as a migration

Start from `extraction/schema.sql` and write `supabase/migrations/<ts>_init.sql`.
`extraction/schema.sql` then becomes a pointer to the migration, not a second
source of truth.

### Security fixes (all three are real holes in the current file)

- `"shared ideas are readable"` has no role: add `to authenticated`. As written,
  the anon key shipped in the client reads every shared idea.
- `user_skills` select policy is `using (true)`: every profile is public.
  Restrict to authenticated users who share a group with the row's owner.
- `skills` has no RLS at all: enable it. Read for authenticated; no client
  write policy — skills are seeded by migration and edited by the edge
  function under the service role, which bypasses RLS.
- Add `groups (id, name, created_by)` and `group_members (group_id, user_id)`.
  `ideas.shared boolean` becomes `ideas.shared_to uuid references groups`
  (null = private). One group today; the column is what you can't add later
  without a data migration.

### What the script grew this week

- `ideas.clarification text` — the user's answer to a clarifying question.
  `raw` is never edited.
- `idea_capabilities`: `skill_id` nullable; add `proposed_key text`,
  `resolved text` (direct | lexical:exact | lexical:tokens |
  semantic:canonical | semantic:previous | semantic:promoted | new),
  `resolved_from text`, `resolve_why text`. Primary key becomes
  `(idea_id, coalesce(skill_id, proposed_key))` or a surrogate id.
- `proposed_skills` — the registry as rows:
  `key text primary key, names text[], reasons text[], idea_ids uuid[],
  run_count int, crux_count int, rejected text, promoted text references skills,
  created_at, updated_at`.
- `extraction_runs (id, idea_id, model, prompt_hash, output jsonb, created_at)`
  — every extraction ever, raw. This is what makes "re-run a better prompt
  over history" a query, and it is the stability data for free.
- Drop the `vector(1536)` columns for now. Nothing writes them and the size
  ties you to a provider you haven't picked. Add them with pgvector later.

Then `supabase db push` and seed `skills` from `extraction/data/skills.json`
(51 rows) with a small script.

## Phase C — the edge function (built 2026-09-13)

`supabase/functions/extract/` plus `supabase/functions/_shared/`. A port, not
a rewrite: the two API calls are plain `fetch`, and the prompt, tool schema and
lexical matcher are byte-identical to `extraction/src/` — `prompt_test.ts` and
`resolve_test.ts` import the Node files under Deno and assert it. The only
change to `extraction/` is two exports at the end of `extract.js` for that test.

What differs from the script:

- skills come from `select * from skills order by sort_order`; `sort_order` is
  the skills.json index and exists because it is part of the prompt hash
- the registry is `proposed_skills` rows; only entries a run touched are
  upserted, and `rejected` / `promoted` are never written by the function
- writes happen in a fixed order: `extraction_runs` (raw output, or the error),
  then `idea_capabilities` (delete + insert), then the idea's status, then the
  registry. A failure after the run row exists loses nothing.
- `capabilityRows()` enforces what the unique indexes demand: one row per
  skill, one per proposed key, at most one crux (`crux_rank = 1`)
- the model default is `claude-sonnet-5`; override with the `MODEL` secret
- both API calls send `thinking: {type: "disabled"}` with `max_tokens` 4096
  (extract) and 1024 (resolve). Sonnet 5 thinks by default, thinking counts
  against `max_tokens`, and at 1500 five of 19 runs came back truncated or
  double-encoded and were stored as extracted. `extraction/src/` sends the
  same, so the baseline re-run and the function stay in lockstep.
- Sonnet 5 also, with thinking off and `stop_reason: tool_use`, sometimes
  returns `capabilities` as a JSON-encoded string: the array itself, or the
  whole record wrapped in it (2 of 5 re-runs on 2026-09-13). Both decode
  cleanly, so `repairExtraction()` decodes them before validation and notes
  it in `_meta.repaired`. The real fix is `strict: true` on the tool with
  `additionalProperties: false` and `anyOf` nullables; that changes the tool
  schema and so the prompt hash, so it waits for the baseline re-run.
- `extraction_runs.output` carries a `_meta` key: `stop_reason`,
  `input_tokens`, `output_tokens`, `repaired`. A `max_tokens` stop or a
  record that is still malformed after repair (non-boolean `clear`, non-array
  `capabilities`, clear with zero capabilities) is stored with both the
  output and an `error`, and the idea is marked `failed`, never `extracted`.

Trigger and re-runs:

- Dashboard webhook on `ideas`, events INSERT and UPDATE. The function ignores
  every UPDATE except a changed `clarification`, which is what stops its own
  status writes from looping. `webhook_test.ts` covers this.
- Direct call with `{ "idea_id": "<uuid>" }` for re-runs and Phase D.
- Auth is a shared secret in the `x-webhook-secret` header; `verify_jwt` is
  off for this function in `config.toml`. The function replies 202 at once and
  finishes in `EdgeRuntime.waitUntil`, because the webhook client times out
  before the API call returns.

Deploy (secrets never go in git):

```
supabase db push                                   # skills.sort_order + reseed
supabase secrets set ANTHROPIC_API_KEY=... WEBHOOK_SECRET=...
supabase functions deploy extract
```

Then Dashboard → Database → Webhooks → Create: table `ideas`, events Insert +
Update, type Supabase Edge Function → `extract`, HTTP header
`x-webhook-secret: <the same WEBHOOK_SECRET>`, timeout 5000 ms. Verify by
inserting one idea in the SQL editor and watching `extraction_runs`,
`idea_capabilities` and the idea's `status`.

Local checks (needs Deno, `npm i -g deno`):

```
deno test --allow-read --allow-env supabase/functions/_shared/
deno check supabase/functions/extract/index.ts
```

`supabase functions serve` needs Docker and is not available on this machine.

## Phase D — acceptance

1. Insert the 19 ideas from `extraction/data/ideas.json` through the REST API
   (with `clarification` where present). Wait for the webhooks.
2. Pull `idea_capabilities` and compare with `extraction/out/extractions.json`:
   same skill ids, same cruxes, modulo the wobble already measured. That's the
   test that says Step 4 is done.
3. RLS the boring way: two users, share an idea from one, confirm the other
   sees it and a third user doesn't. Confirm the anon key sees nothing.

All of it is `supabase/scripts/acceptance.mjs` (`seed`, `wait`, `diff`,
`rls`, `rerun`), run with `node --env-file=supabase/.env` and `--user <uuid>`.
Keys live in gitignored `supabase/.env`; see the script header.

First run, 2026-09-13, on `claude-sonnet-5` against the sonnet-4-5 baseline:
19/19 extracted, RLS 20/20. The diff exposed the truncation defect above
(5 malformed runs stored as extracted). Of the 14 honest runs: verdict
agreed 14/14, exact skill set 6/11, mean overlap 76%, crux 7/11.

After the thinking fix and the repair step, all 19 honest against the
sonnet-4-5 baseline: verdict 19/19, exact skill set 7/16, mean overlap 81%,
crux 10/16.

**Closed 2026-09-13.** Baseline re-run on sonnet-5 (`npm run fresh`, then
`stability.js 3`) and committed. Same-model wobble on sonnet-5: crux
identical 16/19 (13/16 of the clear ideas), verdict 19/19, skill overlap
0.89. Hosted vs that baseline: verdict 19/19, exact skill set 8/16, overlap
87%, crux 13/16. The crux figure is identical to the within-model wobble and
two of the three disagreeing ideas (pokemon-bin, dryer) are the ones
`stability.js` flags as unstable. That is model wobble, not pipeline drift.
Step 4 is done. Spend for the whole step: about $1.80.

## Trello cards this closes

- Phases A+B → "Step 4 · Create Supabase project + apply schema.sql"
- Phase C → "Step 4 · Move extraction to an edge function"
- Phase D → "Step 4 · Test RLS sharing policies"
- `extraction_runs` → "Step 4 · Job to re-run extraction over all history" is
  a query away
- "Step 4 · pgvector" stays deferred until the semantic call is a problem
