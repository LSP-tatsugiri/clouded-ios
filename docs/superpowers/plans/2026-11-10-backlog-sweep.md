# Backlog sweep — plan, 2026-11-10

Branch `agent/backlog-sweep`, stacked on `agent/critique-p1` (which `main`
does not have yet: 13 commits of idea lifecycle and critique P1 fixes are
still waiting for the owner's merge).

Sources read: `CLAUDE.md` (known problems, schema fixes),
`docs/improvement-backlog.md`, `.impeccable/critique/2026-10-22…md`,
`docs/handoff-2026-09-28-ios-capture.md`, open issues, every remote branch.

Constraint for this pass: **no Anthropic API calls** (the key is expired),
no `supabase db push`, no push to `main`, nothing in `ios/` (Xcode is on the
Mac). Signed-in screens cannot be opened by the agent, so new logic goes
into pure modules under `web/lib/` with `node:test` tests.

## What was found

| # | Problem | Source | Status before this pass |
|---|---|---|---|
| F1 | `agent/build-review-fixes` (7 commits, 2026-10-16) never merged: CI workflow, Deno suite un-red, invite cap migration, scoped capability reads, "a hard part", sign-up email copy | `git branch -r` | stranded; migration `20261016231832` not applied |
| F2 | Filter bar has ~9 controls, says "Crux" where the app says "hard part", and filters/sort reset after opening an idea | critique P2 #4 | open |
| F3 | Rating mark on the idea page: ~20px target, unrated reads as none so first click writes "some", raw skill id in the "what moved" line | critique P2 #5 | open |
| F4 | Accessibility: cards are two tab stops, flap letters read mid-animation, extraction progress not a live region, `▣` has no text, leverage numbers unlabelled, two `h1`s on Profile/Group, "not rated" only in `::after` | critique personas + minors | open |
| F5 | Dark-mode filled buttons 3.4:1; bounce easing on button hover; landing stragglers; "Sign in" hidden ≤480px | critique minors | open |
| F6 | Errors: raw `err.message` shown by `run()`; extraction timeout says "Reload" with no retry | critique heuristic 9 | open |
| F7 | "N of M shown" excludes vague ideas that Newest shows | critique minor | open |
| F8 | No near-duplicate detection | backlog §2 | open |
| F9 | Empty-profile state: with zero ratings every sort is meaningless and the page only says so in small grey text | backlog §4 | open |
| F10 | Docs drift: backlog still lists shipped items as open (0.1–0.4, §1.1, §1.3, search, capability scoping); `CLAUDE.md` "Schema fixes needed" describes `extraction/schema.sql`, which the migrations superseded; "51-skill" vs 52; `docs/feedback-migrate.sh` would file two shipped items as new issues | reading | open |
| F11 | CI does not run `web/test/` | `.github/workflows/test.yml` | open |

## Workstreams

Agents do not commit; the orchestrator commits each stream by pathspec.

### W0 — merge the stranded branch (orchestrator, done first)
Merge `origin/agent/build-review-fixes`. Resolves F1. Both suites must pass.

### W1 — list and filters (`web/app.js` list + plumbing sections, `web/style.css`, new `web/lib/filters.js`, `web/lib/similar.js`)
- F2: search, sort and the Live/Built/Dropped toggle stay visible; Domain,
  hard-part state and the two checkboxes fold into one "Filter" disclosure
  that shows a count of active filters. Labels: "Hard part held / partial /
  missing". Filters and sort are serialised into the hash query and restored
  on load, so Back from an idea returns to the same view. Pure
  encode/decode in `web/lib/filters.js`, tested round-trip.
- F7: the "N of M shown" count agrees with the rows on screen in every sort.
- F9: when the user has rated nothing, the list leads with a prompt naming
  how many distinct skills their own ideas need and linking to the profile;
  it disappears once any is rated.
- F4 (list part): one tab stop per card with an accessible name; leverage
  numbers get a text label.
- F8 (logic): `web/lib/similar.js` — trigram similarity over
  `raw`/`objective` plus shared-capability count, pure, tested. No
  migration, no embeddings: every row is already in the client.

### W2 — idea page, rating, a11y, polish (`web/app.js` idea/profile/group/plumbing, `web/style.css`, `web/index.html`, `web/lib/rating.js`) — after W1, same files
- F3: mark hit area ≥ 32px with a visible chip; the three levels offered
  as an explicit none/some/solid choice instead of a blind cycle; unrated
  shown as unrated; "what moved" uses the skill's name.
- F8 (UI): idea page shows "looks like: <objective>" links from
  `similar.js`. Link only — merging two ideas is a product decision
  (`ideas.raw` is never overwritten) and is not built.
- F4 (rest), F5, F6 as listed above. Retry on timeout re-polls; it never
  re-runs extraction, which would spend credit.

### D1 — docs, CI, hygiene (parallel with W1; `docs/`, `CLAUDE.md`, `README.md`, `extraction/schema.sql` header, `.github/`)
- F10, F11. Strike shipped backlog items with dates from `git log`; fold
  this pass's results in after W2.

### R — review loop
A fresh reviewer gets this plan and `git diff agent/critique-p1...HEAD`,
checks each F-row against the diff, the invariants in `CLAUDE.md`, and
hunts regressions. Findings go back to a fixer; repeat until it passes.

## Not in this pass, and why

| Item | Why not |
|---|---|
| CAD split test (backlog §5), `assumption` field + `strict: true` (§4), vague-bucket batch answer | Needs the Anthropic key; ~$0.30 per re-baseline (19 ideas × ~$0.016). The second also needs `supabase functions deploy`. |
| Realtime instead of the 2 s poll (§4) | Touches the capture path and can only be proven by adding a real idea (1¢) after a publication migration is pushed. |
| Claims, group leverage (§6) | The backlog gates both on the first real friend joining. |
| Look and feel (§8), Live2D, waifu read-back (§7) | The backlog says each needs the owner's decisions before code. |
| iOS share-sheet title (§3.4), Control Centre button (§3.3) | Mac only. |
| Distance is a flat count; leverage biased by taxonomy; held-out ideas | Open product questions in `CLAUDE.md`, each needing an API experiment or a friend's ideas. |

## Round two

Branch `agent/backlog-round-2`, stacked on `agent/backlog-sweep` (round
one), so it carries round one and `agent/critique-p1` with it. Commits:
`git log --oneline agent/backlog-sweep..agent/backlog-round-2`.

Unlike round one, this round had the Anthropic key (renewed 2026-11-10)
and spent it once, on the re-baseline.

### Owner decisions, 2026-11-10

- Build the assumption line, `strict: true` on both tools, and the
  per-capability tutorial/iteration tag.
- Do **not** build the ranked second crux. The "exactly one crux" invariant
  stays; "a hard part" is the answer to its instability.
- A duplicate is resolved by dropping one idea with a pointer to the other,
  not by merging. `ideas.raw` is never overwritten.
- Skip look and feel (backlog §8) this round.
- Skip email: SMTP for sign-up confirmation (§0.6) and the weekly digest (§6).

### Workstreams

- **A — list** (`ea12053`, `558034a`): delete from your own cards; keyboard
  shortcuts `/ n j k ?` (`web/lib/keys.js`); hover lifts a card without
  blurring its siblings; a leverage row filters the list (`skill` in the
  hash); the leverage panel above the list below 900px; a one-row filter bar
  at 390px; vague ideas left out under extraction-based filters; the "what
  moved" line opens the list once.
- **B — idea page, profile, help** (`4d79c08`): developer data under one
  Details; skill ids off the profile rows; `#/help` (`web/lib/help.js`);
  the profile opens on "Your ideas need these"; a failed run reads as a
  sentence (`explainRun`); mic contrast in dark mode; the sign-in dialog's
  heading.
- **C — group, claims, mobile** (`cfe4591`, `0b42abd`): the "Still missing"
  panel (`web/lib/group.js`); "I can do a hard part" (migration
  `20261110115450_idea_claims.sql`); the Group tab and profile grid at 390px
  (the header nav still wraps); the feed's Closest sort no longer throws on
  a vague idea.
- **D — landing, waifu** (`f4aaa99`, `36daae4`): one wordmark on a phone,
  invite-only said by the sign-in doors, a closing call to action, a clearer
  type scale; the waifu scene reads the hard part back, or asks a vague
  idea's question in her band's words.
- **E — extraction waiting** (`d1431b6`, `13c7ba7`): Realtime raced against
  a slower poll (migration `20261110153527_realtime_extraction_runs.sql`,
  `web/lib/wait.js`); an idea with no result gets a read-only "Check again"
  card; one form answers every vague idea.
- **F — prompt** (`6e1a299`, `df2e51b`, `9ad1502`): `assumption` and
  per-capability `iteration` (migration
  `20261110161336_assumption_and_iteration.sql`), `strict: true` on
  `record_extraction` and `resolve_skill`; the idea page shows "Assumed: …
  — not right?" and a "needs iteration" tag (`web/lib/extracted.js`).
  Distance does not read `iteration`. Prompt hash `b6a035830560` →
  `57810805f527`.
- **G — drop as duplicate** (`7108fe2`, `939b23d`): "Drop this one as a
  duplicate" beside each "Looks like" match (migration
  `20261110161103_idea_duplicate_of.sql`).

### Re-baseline

`b818caa`, 2026-11-10, sonnet-5, prompt `57810805f527`, about $0.20: 19 of
19 extracted, 15 clear (anime90s is now vague, one fewer than before), no
idea with two cruxes, 35 of 76 capabilities tagged `iteration`. **Known
flaw:** `assumption` was filled on all 15 clear ideas, unambiguous ones
included; recorded in `CLAUDE.md` Known problems. Same-prompt wobble was
not re-measured.

### Review rounds

1. Database side — **failed**: `distance.test.js` still pinned the
   2026-09-13 baseline; dropping as a duplicate did not fall back once
   `duplicate_of` was known missing; the Realtime subscription asked for
   every event, DELETEs included, which Realtime sends without RLS. Fixed in
   `e0af96f`.
2. Web side — **failed**: the batch form's count went stale; list run
   errors showed raw; focus was lost on the 2 s repaint. Fixed in
   `ffc9607` (`holdFocus` in `web/lib/dom.js`).
3. Re-review of `ffc9607` — re-review pending.

### Still open after round two

§3.3 and §3.4 (iOS, on the Mac); §4 the header nav at 390px; §5 held-out
ideas, the CAD split, weighting distance by `iteration`; §6 the weekly
digest and §0.6 SMTP; §8 look and feel, Live2D included; the critique's
remaining questions to consider.

## Owner steps after review

Round one's steps are folded in: `20261016231832` is already on the hosted
database (`supabase migration list`, 2026-11-10), so its `--include-all`
push is no longer needed.

1. Merge the round-two pull request (`agent/backlog-round-2` into `main`).
   It contains round one and `agent/critique-p1`.
2. `supabase db push`. No `--include-all`: `supabase migration list` shows
   everything through `20261022233104` applied, and the four new files,
   `20261110115450_idea_claims.sql`,
   `20261110153527_realtime_extraction_runs.sql`,
   `20261110161103_idea_duplicate_of.sql` and
   `20261110161336_assumption_and_iteration.sql`, all sort after it.
3. `supabase functions deploy extract` — after the push, never before: the
   new function writes `ideas.assumption` and `idea_capabilities.iteration`,
   and against a database without those columns the capability write fails
   and the idea is marked failed with no capabilities.
4. If the renewed Anthropic key is a new string, `supabase secrets set
   ANTHROPIC_API_KEY=…`; the project secret was last updated 2026-09-13.
5. Close issue #4 (the test report "123").
