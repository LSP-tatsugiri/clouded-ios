# Refactor — collapse the extraction pipeline into one module

Written 2026-09-14 from an architecture review, grilled to a settled design and
then parked. **Scheduled: after Step 5 Phase C.** Nothing here is built.

Read `CLAUDE.md` for the invariants. `docs/step-4-plan.md` describes the edge
function this refactor rewires; `docs/step-5-plan.md` is the active work and
comes first.

## Why

The extraction pipeline exists twice, once in Node and once in Deno, and seven
functions are defined in both: `slug`, `lexical`, `record`, `resolveExtraction`,
`dueForReview`, `repairExtraction`, `invalidExtraction`.

The drift is not theoretical. On 2026-09-13:

- Two logical fixes shipped as four commits: `8bd6542` + `ff8db17` (thinking
  disabled, `max_tokens` raised) and `1eb9c69` + `7639d59` (repair the
  string-encoded tool output).
- Both times the second copy was fixed only after it broke.
- `npm run fresh` crashed with `TypeError: Cannot create property 'skill_id' on
  string` because `resolve.js` lacked a repair `resolve.ts` already had. One
  wasted run, about $0.25.

**The seam is in the wrong place.** It currently sits at the runtime, Node
against Deno, and nothing behavioural varies across it. What varies is I/O:
where skills come from, where the registry lives, where output goes. That is
where the seam belongs.

## Facts established before deciding

- **Imports resolving outside `supabase/functions/` are bundled on deploy.**
  Verified 2026-09-14 with a throwaway `probe` function importing a marker from
  `extraction/src/`: deployed clean, returned the marker over HTTP 200, then
  deleted. The Supabase docs do not state this either way, so re-verify if the
  CLI changes. This is what makes `extraction/core/` reachable from the edge
  function at all.
- **The parity tests already execute Node source under Deno.**
  `prompt_test.ts` and `resolve_test.ts` import `../../../extraction/src/*.js`
  and call into it. One runtime already runs the other's code, which is the
  proof that the runtime split is not a real seam.
- `deno check` resolves a `../../../` import out of the functions directory,
  exit 0.

## Decisions

| # | Decision | |
|---|---|---|
| 1 | Timing | After Step 5 Phase C, not before |
| 2 | Prompt hash | Frozen at `e3446a126ffc`, asserted before and after |
| 3 | Language | Plain `.js` ESM, no build step |
| 4 | Types | JSDoc inside the `.js`, verified by `deno check` |
| 5 | Scope | Pure logic only; each caller keeps its own orchestration |
| 6 | Tests | Cross-copy assertions deleted, hash test kept, Deno stays the runner |
| 7 | Location | `extraction/core/` pure; `extraction/src/` becomes the local adapter |
| 8 | Interface | Data in, data out; callers own their `fetch` |
| 9 | Semantic call | Injected asker, plus pure `buildResolveRequest` / `parseResolveResponse` |
| 10 | Registry | `Map`, converted at the file boundary by the local adapter |
| 11 | Old files | Deleted, three callers updated, no compatibility shims |

The ones with reasoning worth keeping:

- **(1) After Phase C.** The tax only comes due when extraction changes, and
  nothing is scheduled to change it until strict tool schemas. Doing it sooner
  stalls the web client, which is the live work.
- **(2) Hash frozen.** Mixing a refactor with a behaviour change means that if
  the acceptance numbers move you cannot tell which caused it. The hash
  assertion is the test that proves the collapse changed nothing.
- **(3) Plain `.js`.** The only option all three consumers run with no build
  step, which is what lets the browser import the same module. A build step
  would be the first in the repo and contradicts the no-dependencies style rule.
- **(5) Pure logic only.** The two orchestrations genuinely differ: the script
  runs 19 ideas through a four-worker pool with a prompt-hash cache; the edge
  function runs one idea with a fixed write order so raw output survives a
  resolution failure. Sharing that would add branches, not concentrate
  complexity. The duplication that hurt is all in the pure half.
- **(8) Data in, data out.** Both things that drifted are pure: the request
  shape (`thinking`, `max_tokens`) and the response handling (repair,
  validate). This puts both inside the core while keeping it free of I/O.
  Owning the `fetch` would force network stubs into every test;
  `anthropic_test.ts` already monkey-patches `fetch` to avoid exactly that.
- **(9) Injected asker.** Resolution is not purely local: an unmatched
  capability triggers a second API call. The sequencing matters, because each
  resolution sees what earlier ones proposed, so it stays in the core and only
  the asking is injected. `resolve.ts` already proved this shape, and
  `resolve_test.ts` exploits it to run without a network.

## Target shape

```
extraction/core/              pure, no I/O, imported by all three callers
extraction/src/               local adapter: skills.json, out/*.json, process.env
supabase/functions/_shared/   Supabase adapter: tables, Deno.env
web/lib/                      browser adapter (arrives with candidate 2)
```

The core's interface, roughly:

```
systemPrompt(skills) · TOOL · promptHash(model, skills)
buildExtractionRequest({ skills, raw, clarification, model })
parseExtractionResponse(body)   -> { extraction, meta, error }   repair + validate + stop_reason
buildIndex(skills) · lexical(index, name) · slug(s)
buildResolveRequest(...) · parseResolveResponse(body)
resolveExtraction(extraction, idea, registry, runId, { skills, ask, log })
record(reg, ...) · dueForReview(reg) · capabilityRows(ideaId, runId, caps)
```

## Order of work

1. Create `extraction/core/` by moving the pure halves of `extract.js`,
   `resolve.js`, `prompt.ts`, `resolve.ts` and `anthropic.ts` into it. Add
   JSDoc types as they move.
2. Rewrite `extraction/src/` as the local adapter: file reads, `out/` writes,
   registry object to `Map` conversion, `process.env`, the worker pool, cache.
3. Rewrite `supabase/functions/_shared/` as the Supabase adapter: table reads,
   upserts, `Deno.env`, the run-row ordering.
4. Delete the emptied files and update the three callers: `index.js`,
   `stability.js`, `extract/index.ts`.
5. Trim the tests: drop the cross-copy assertions, keep the hash test.

## Verification

- `promptHash("claude-sonnet-5", skills)` still returns `e3446a126ffc`. This is
  the gate; if it moves, the refactor changed behaviour.
- `deno test --allow-read --allow-env supabase/functions/_shared/` green.
- `deno check supabase/functions/extract/index.ts` clean.
- `npm start` reports 19 cached and 0 to extract, which only happens if the hash
  is unchanged. Costs nothing.
- Deploy, re-run one idea through the edge function, confirm the capabilities
  match what is already in `idea_capabilities`. About $0.02.

## Not in scope

- **Strict tool schemas** (`strict: true`, `additionalProperties: false`,
  `anyOf` nullables). Parked separately. It changes the tool schema and so the
  prompt hash, which costs a baseline re-run of roughly $1. Do it after this,
  as its own change, with its own baseline.
- **Candidates 2, 3 and 4** from the same review, not yet explored:
  - **2. Parameterise distance** so the browser reuses `distance.js` instead of
    getting a second copy. Thirty lines, and **due during Phase C**, which is
    what would otherwise create the third copy.
  - **3. `web/lib/db.js` is shallow** (9 exports over 36 lines, 4 unused).
    Revisit after Phase C; it likely deepens on its own.
  - **4. The REST helper is duplicated** across `acceptance.mjs` and
    `seed-profile.mjs`.
