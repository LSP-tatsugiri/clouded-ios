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

## Phase C — the edge function

`supabase functions new extract`. Triggered by a database webhook on insert
to `ideas` (Dashboard → Database → Webhooks, or `pg_net` in a migration).

It is a port, not a rewrite. `extract.js` and `resolve.js` are plain `fetch`
with no dependencies. Changes:

- `readFileSync(skills.json)` → `select * from skills`
- `loadRegistry()` / `saveRegistry()` → `proposed_skills` reads and upserts
- write to `extraction_runs` first, then `idea_capabilities`, so a failure
  in resolution never loses the raw output
- runs as service role; `supabase secrets set ANTHROPIC_API_KEY=...`
- Deno, not Node: `Deno.env.get`, no `node:` imports

Keep the prompt strings byte-identical to `extraction/src/extract.js` so the
baseline stays comparable. Keep `promptHash` and store it on the run row.

## Phase D — acceptance

1. Insert the 19 ideas from `extraction/data/ideas.json` through the REST API
   (with `clarification` where present). Wait for the webhooks.
2. Pull `idea_capabilities` and compare with `extraction/out/extractions.json`:
   same skill ids, same cruxes, modulo the wobble already measured. That's the
   test that says Step 4 is done.
3. RLS the boring way: two users, share an idea from one, confirm the other
   sees it and a third user doesn't. Confirm the anon key sees nothing.

## Trello cards this closes

- Phases A+B → "Step 4 · Create Supabase project + apply schema.sql"
- Phase C → "Step 4 · Move extraction to an edge function"
- Phase D → "Step 4 · Test RLS sharing policies"
- `extraction_runs` → "Step 4 · Job to re-run extraction over all history" is
  a query away
- "Step 4 · pgvector" stays deferred until the semantic call is a problem
