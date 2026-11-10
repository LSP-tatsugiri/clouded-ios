# Clouded — improvement and future-development backlog

Written 2026-09-15 from a full read of `LSP-tatsugiri/clouded-ios` @ `fb5ad88`
(README, CLAUDE.md, `extraction/`, `supabase/`, `web/`, `ios/`, `docs/`).
Nothing here is signed off; each item that gets picked becomes a PRD delta
against `README.md`, not a new PRD.

**Reconciled against the code 2026-11-10** (`docs/superpowers/plans/2026-11-10-backlog-sweep.md`):
everything that shipped is struck below with its date and commit. Items
dated 2026-10-16, 2026-10-22 or 2026-11-10 are committed but not on `main`,
so not on the live site, until the branches merge. Round one of the
2026-11-10 pass is `agent/backlog-sweep` (stacked on `agent/critique-p1`);
round two is `agent/backlog-round-2`, stacked on round one, so merging it
brings both. Round two also needs four migrations pushed and the edge
function redeployed; see the plan's "Owner steps".

Ordering rule used throughout: does it serve **capture** (the stated primary
blocker) or the **learning loop** (the stated secondary job)? Anything that
serves neither is ranked below anything that serves either, however clever.

---

## 0. Repo inconsistencies found — fix regardless of what else is built

| # | Finding | Where | Why it matters |
|---|---|---|---|
| 0.1 | ~~`README.md` line 5 still says **"Status: pre-build … No app yet, on purpose."**~~ **Fixed 2026-09-16** (`795e062`): it now reads "Status: built, Steps 1–7 done". | `README.md:5` | Seven steps are done and the site is live. It is the first thing a friend reads. |
| 0.2 | ~~Local testbed defaults to **`claude-sonnet-4-5-20250929`**; the edge function defaults to **`claude-sonnet-5`**~~ **Fixed 2026-09-16** (`637238a`): `extract.js` and `resolve.js` default to `claude-sonnet-5`. | `extraction/src/extract.js:4`, `extraction/src/resolve.js:15` vs `supabase/functions/extract/index.ts:24` | `npm run fresh` without `MODEL=` set silently produces a baseline from a different model than production, under a different `promptHash`. The committed `out/` baseline is documented as sonnet-5. Make the Node default match, or make the default an error. |
| 0.3 | ~~`proposed_skills` is `select using (true)` for every authenticated user, and its `reasons[]` and `idea_ids[]` are copied out of capability rows that may belong to **private** ideas~~ **Already fixed when this was written**: the finding read `init.sql` alone. `20260912222851_proposed_skills_private.sql` dropped the policy on 2026-09-12, and `20260914063115_curators_and_promotion.sql` reopened the select to curators only (`is_curator()`), which is the restriction asked for here. | `supabase/migrations/20260912215850_init.sql` (RLS block) | A friend cannot read your private idea but can read a sentence explaining why it needs a skill. Small blast radius at ten trusted people; still contradicts "private by default". Restrict the select to `curators`, or strip `reasons` from the shared registry. |
| 0.4 | ~~**No way to delete an idea** from any client~~ **Shipped on the web 2026-09-16** (`6e6ccc1`, `deleteIdea` in `web/lib/db.js`, a two-click button on the idea page; the same two steps on your own list cards since 2026-11-10, `558034a`). The iOS app still has none. | `web/lib/db.js` has no delete; `ios/` neither | RLS already permits it (`ideas: own … for all`). A capture-first tool with no undo makes a typo permanent, and a wrong capture costs a cent to extract and then sits in the list forever. |
| 0.5 | ~~`invite()` is `security definer` and lets **any** group creator allowlist **any** email.~~ **Fixed 2026-10-16** (`483615d`, `20261016231832_invite_cap_and_member_consent.sql`): a non-curator may bring five new addresses, a curator is not capped. Applied to the hosted database: `supabase migration list` shows it on the remote (checked 2026-11-10). | `20260915071927_groups_invites_profiles.sql` | Anyone with an account can create a group and mint accounts on your Anthropic key. Trust-based by design, but it is the allowlist's only hole and worth naming in `CLAUDE.md` next to the no-cost-cap note. |
| 0.6 | ~~Sign-up confirmation email still unresolved (`mailer_autoconfirm: false`)~~ **Decided 2026-09-16: confirmation stays on** (`docs/step-7-plan.md`). The sign-up card says to check email since 2026-10-16 (`b297ca2`). What still blocks the first real friend is custom SMTP: `docs/hosting.md` says the built-in mailer refuses addresses outside the project's team, and nothing in the repo records SMTP being set up. *Still open 2026-11-10: the owner skipped email (SMTP and the §6 digest) in round two.* | `docs/step-7-plan.md`, loose end | Blocks the one Step 7 item still open: the first real friend. Decide before inviting anyone. |

---

## 1. The learning loop is open — the highest-value change to the concept

The app computes what you would have to learn. Nothing in the system ever
learns that you learned it. `user_skills` is a 51-row form, filled once, and
the README already predicts nobody maintains it — while every distance, every
sort, the leverage ranking and the whole friend pool are computed from it.
That is the single largest structural weakness, bigger than any UI gap.

Three changes close it, in increasing size:

1. ~~**Rate from where the gap appears.**~~ **Shipped 2026-09-16** (`8a02b91`) as a mark that cycled on click; **changed 2026-11-10** (`8b3214c`) to an explicit none / some / solid choice, the same control as the profile's (`levelControl` and `rate` in `web/app.js`, `web/lib/rating.js`), so an unrated skill reads as unrated and a click writes the level picked, not the next one round. Was: On the idea page each capability line
   already renders `[ ]` + the skill name. Make the mark itself a control:
   click cycles `none → some → solid` and writes `user_skills`. The profile
   form stops being the only way in, and rating happens at the moment you are
   looking at the thing that needs it. ~30 lines in `app.js` + `db.js`.
2. ~~**"I built this."**~~ **Shipped 2026-10-22** as the idea-lifecycle spec. Add `ideas.built_at`. Marking an idea built offers to
   set each of its capabilities to `solid` (confirm per capability — the
   claim should be checkable, same rule as the taxonomy). This is the honest
   profile source the design review asked for (§5) *and* the idea list's
   missing end state. The README says the product "ends where work begins";
   it does not have to manage the work to record that it happened.
3. ~~**Say what moved.**~~ **Shipped 2026-09-16** (`8a02b91`, `whatMoved` in `web/app.js`; counts live ideas only since 2026-10-22, `8274a68`; names the skill rather than its id since 2026-11-10, `8b3214c`; after a rating moved something the list opens once on that line, also 2026-11-10, `558034a`). After any profile change, one line: *"parametric-cad
   → solid. 4 ideas moved closer; 2 now have no gap left."* This is the
   output the README claims the whole product exists to produce, and today it
   is never shown as an event — only as a static ranking you have to
   re-read. It costs nothing: the two distance computations already exist.

Do these three and the profile maintains itself as a by-product of use.

## 2. Idea lifecycle — the list becomes the guilt file the README opens with

`ideas` has no state except extraction status. At 19 ideas that is fine; the
README's own volume risk is about ~35/year, and the graph view wants 80. At 80
the list is mostly dead ideas: things done, things dropped, things that turned
out to be the same idea twice.

- ~~`built_at` (above), plus `dropped_at` with a one-line reason. Not a score —
  a fact.~~ **Shipped 2026-10-22.**
- ~~Default the list to live ideas, with built/dropped behind a toggle.~~ **Shipped 2026-10-22.**
- ~~**Near-duplicate detection at capture.**~~ **Shipped 2026-11-10** in
  two rounds. Round one (`8b3214c`, `web/lib/similar.js`, `looksLike` in
  `web/app.js`): your own idea pages show "Looks like" links to your other
  ideas whose wording is close (trigram similarity over `raw`/`objective`)
  or that share ≥3 skills. Matched in the client, where every row already
  is: no `pg_trgm`, and it runs when the page is opened, not at capture.
  Round two (`7108fe2`, `939b23d`, migration
  `20261110161103_idea_duplicate_of.sql`): beside each live match, "Drop
  this one as a duplicate" asks once more, then drops this idea with a
  written reason and `ideas.duplicate_of` pointing at the other; the dropped
  page links to it, Back to live undoes it. **Decided 2026-11-10: no
  merge.** A duplicate is resolved by dropping one with a pointer, so
  `ideas.raw` is never overwritten. Was: Frictionless capture guarantees
  double-capture of the same 1am thought. The cheap version needs no
  embeddings: `pg_trgm` similarity on `raw`/`objective`, plus "shares ≥3
  capabilities with an existing idea", surfaced on the idea page as
  *"looks like #N"* with a merge button. pgvector is in the README as the
  answer here, but trigram + the capability overlap you already store will
  catch most of it for free.

## 3. Capture — the stated primary blocker, still thinner than the README claims

The README's Capture section promises voice via the Action Button or a
lock-screen widget, and offline-first local queueing. Step 6 delivered
neither (dictation is the keyboard's; the local queue was cut). The image
upload is queued through a background `URLSession`, but the **idea row itself
is a plain insert that fails with no network** — and the README names that
exact failure ("an idea lost because you were in a basement") as the worst
thing the product can do. Highest-value phone work, in order:

1. ~~**App Intent + Shortcut**~~ **Shipped 2026-09-28** as
   `ios/clouded/CaptureIntent.swift`. Sentence only, saved without opening the
   app. `Sentence.cleaned` in `Records.swift` now holds the blank-idea rule for
   all three capture surfaces. §3.3 below follows for free: the shortcut is
   already offered as a Control Centre and lock-screen button.
2. ~~**Local outbox for the row.**~~ **Shipped 2026-09-28** as
   `ios/Shared/Outbox.swift`, with `ios/cloudedTests` covering the spool
   (15 tests). Row only: the picture keeps the background `URLSession` path
   and its token-lifetime limit, which was the explicit scope decision. A
   permanent rejection (not a network failure) also spools, on the grounds
   that a row visibly stuck in the queue beats a row thrown away — it does
   block the ones behind it, which is the known trade-off.
3. **Control Center / lock-screen widget** once (1) exists — a button, not a
   screen.
4. A **share-sheet action that keeps the source URL and page title**, since
   `source_url` exists and the extension already has both.

*3 and 4 still open 2026-11-10: both are `ios/`, built on the Mac; neither
round of the 2026-11-10 pass touched `ios/`.*

## 4. Web — concrete gaps

- ~~**Search.**~~ **Shipped 2026-09-16** (`b491a07`, a client-side search box over the list). There is no text search over `raw`/`objective`. Below 30 ideas
  scrolling works; above it, nothing does. Client-side filter box: 15 lines.
- ~~**Replace the 2-second poll with Realtime.**~~ **Shipped 2026-11-10**
  (`d1431b6`, `13c7ba7`, INSERT-only since `e0af96f`; migration
  `20261110153527_realtime_extraction_runs.sql` adds `extraction_runs` to
  the Realtime publication): `watch()` and the idea page's wait subscribe to
  the idea's runs, INSERT events only, and race a poll alongside — every 8 s
  while the channel is up, every 2 s while it connects or after it fails
  (`web/lib/wait.js`). The poll is kept, as a safety net, not removed. An
  idea with no result yet (stale or failed) shows a read-only "Check again"
  card instead of a paid answer box. Was: `watch()` polls `runsFor()` up
  to 60 times per new idea (`app.js:905`), and the idea page does it again.
  Supabase Realtime on `extraction_runs` insert removes ~60 round-trips per
  capture and the whole `WATCH_WINDOW_MS` guesswork.
- ~~**The list fetches every capability row you can see, on every load**~~
  **Fixed 2026-10-16** (`e386a6b`): `ideas()` and `sharedIdeas()` in
  `web/lib/db.js` embed the rows for the ideas they return. Was:
  (`capabilities()` with no filter) and again on the Group tab. Fine now;
  it is an unbounded query as the group grows. Scope it to the ideas being
  shown, or let PostgREST embed it into the ideas select.
- ~~**Empty-profile state.**~~ **Shipped 2026-11-10** in two rounds. Round
  one (`4ff28db`, `rateFirst` in `web/app.js`): until one skill is rated the
  list leads with a prompt that counts the distinct skills your ideas need
  and links to the profile. Round two (`4d79c08`, `skillsNeededList` in
  `web/lib/lifecycle.js`): the profile opens on "Your ideas need these",
  the unrated skills your live ideas need, most-needed first, with the full
  table below. The rating happens on the profile, not inline on the list.
  Was: With zero ratings
  every idea is all-gaps and the sort is meaningless. The list says so in small grey text; it should be the
  first thing on the page until at least the skills that appear in your own
  ideas are rated. A "rate the 12 skills your ideas actually need" flow beats
  a 51-row form for cold start.
- ~~**Mobile web.**~~ **Shipped in part 2026-11-10.** Round one (`4ff28db`,
  `8b3214c`): at 640px the list's filter bar wraps and a profile skill row
  stacks its rating under the name. Round two: at 390px the Group tab does
  not overflow, its controls are at least 32px and the main ones 44px, a
  member's Remove confirmation stacks, and a profile rating spans the row
  under the skill name (`0b42abd`); the list's filter bar is one row, with a
  Show select for the two toggles, and the leverage panel sits above the
  list below 900px (`558034a`). **Still open:** the header nav still wraps
  at 390px. Was: Only two breakpoints; the Group tab and the profile radio
  grid were not built for a phone. Since the phone app has no sharing or
  feed, mobile web *is* the phone's sharing UI today.
- ~~**The vague bucket costs a cent per answer and gives no batch path.**~~
  **Shipped 2026-11-10** (`13c7ba7`, `ffc9607`, `batchSubmit` in
  `web/lib/wait.js`): two or more vague ideas can be answered on one form,
  which sends only the filled answers, one `setClarification` each, in
  order, stopping at the first failure, and says the count and cost before
  it sends. Each answer is still one extraction, about a cent. Was: If
  three entries are vague, that is three round-trips through a form. Let the
  answer box take all of them on one screen.
- ~~**Assumption visibility.**~~ **Shipped 2026-11-10** (`6e1a299`,
  `df2e51b`, `9ad1502`, migration `20261110161336_assumption_and_iteration.sql`,
  re-baselined in `b818caa` at prompt `57810805f527`): extraction returns
  `assumption`, and a clear idea's page shows "Assumed: … — not right?";
  the owner's "not right?" opens the answer box worded as a correction,
  which re-runs extraction (about a cent). Bundled with `strict: true` on
  both tools, as planned. **Known flaw:** in the re-baseline the model
  filled `assumption` on all 15 clear ideas, unambiguous ones included, so
  the line is not yet the rare flag it was meant to be. Was: The README's own finding — "pcb coaster" read as
  decorative art — concluded that assumptions must be visible in the UI. The
  objective sentence carries the assumption in prose; nothing marks it as a
  guess. Have extraction emit `assumption: string|null` separately and render
  it as a correctable line ("assumed: decorative PCB art — not right?").
  This is a prompt + schema change, so it re-baselines; bundle it with the
  `strict: true` change already parked.

## 5. Extraction quality — the two known biases, with tests that settle them

Both are already written down; neither has been run.

- **Split `parametric-cad` into 2–3 skills and re-run.** If CAD still tops the
  leverage ranking, the result is real. If it does not, the ranking is an
  artifact of a 15-vs-6 taxonomy split and the headline finding in the README
  is wrong. ~$0.20 for a re-baseline. This is the cheapest high-information
  experiment in the repo.
  *Scoped 2026-09-16, not run: `extraction/.env` (the Anthropic key) exists
  only on the PC.* The six CAD capabilities in the baseline are three things:
  a housing around other parts (knob, dryer, gundam), a parametric family
  (pokemon-bin, gridfinity), plain solid modeling (golf-mount). Split to test:
  `cad-solid-modeling` "Model a solid part in CAD from a sketch and
  dimensions"; `cad-enclosure` "Model a housing that fits the electronics,
  connectors and mechanism inside it"; `cad-parametric-family` "Build one
  parametric model whose dimensions drive a family of variants". Edit
  `data/skills.json` locally only, `npm start` (a full re-run anyway — the
  baseline is stale, see CLAUDE.md), compare the leverage top 10 against
  `git show HEAD:extraction/out/extractions.json`. ~$0.25–0.30.
  **Run 2026-11-10** on the PC, sonnet-5, 19 of 19 extracted, the split
  table and its output kept local and not committed (the baseline in `out/`
  is untouched). The three new skills were rated "some", as
  `parametric-cad` is. Leverage, top of each list:

  | Baseline (2026-09-13, unsplit) | Split (2026-11-10) |
  |---|---|
  | 6 `parametric-cad` | 4 `cad-solid-modeling` |
  | 4 `print-tolerancing` | 3 `cad-enclosure` |
  | 4 `print-joinery` | 3 each: `power-budgeting`, `illustration-fundamentals`, the five Blender skills, `print-material-choice` |
  | 3 each: five Blender skills, `print-material-choice` | 2 `cad-parametric-family` |

  The model used the split as scoped: golf-mount and gundam went to solid
  modeling; knob, dryer and (new) screws to the enclosure; pokemon-bin and
  gridfinity to solid modeling *and* the parametric family.
  **Reading:** the direction held and the margin did not. A CAD skill is
  still first, and the three together touch 7 of 16 clear ideas, more than
  any other family. But the lead went from 6-against-4 to 4-against-3 with
  nine skills tied one idea behind, and one idea is inside run-to-run
  wobble: against the baseline, with CAD merged back, skill overlap was
  0.84 and the crux was the same on 13 of 16 — the same-prompt figures are
  0.89 and 16 of 19. So "CAD is the highest-leverage skill" was mostly the
  width of one row. What survives is weaker: fabrication modeling is the
  largest cluster. Two caveats. There was no same-day control run on the
  unsplit table, so some of the difference is two months of drift and the
  `ui-mockup` promotion, not the split. And `print-tolerancing` and
  `print-joinery` fell from 4 ideas to under 3 in the split run, most likely
  because two CAD rows now take two of an idea's 3–7 capability slots —
  splitting a skill moves its neighbours too. Not decided here: whether to
  adopt the split in `skills.json` (a re-baseline and a seed migration).
- **Held-out ideas.** Every idea in `ideas.json` is one the table was written
  around. Run 10 ideas from outside the backlog (a friend's, once one joins)
  and watch the proposed rate. A low rate on *your* ideas proves nothing.
  *Still open 2026-11-10: no friend's ideas yet.*
- ~~**Crux stability.**~~ **Label softened 2026-10-16** (`2eece15`): the
  web app, the landing page and both iOS views say "a hard part".
  **Ranked top-2 decided against 2026-11-10** by the owner: the "exactly
  one crux" invariant stays, and "a hard part" is the answer to the
  instability. Decided, not shipped. (`strict: true`, parked with it, shipped
  on its own; see §4.) The 2026-11-10 re-baseline had no idea with two
  cruxes. Was: Committed at 16/19 same-prompt. The UI calls it "the
  hard part" as if settled. Either ship the ranked top-2 (schema change,
  already scoped) or soften the label to "a hard part" until the number
  justifies the definite article.
- ~~**A per-capability "learnable from a tutorial vs needs real iteration"
  flag**~~ **Shipped in part 2026-11-10** (`6e1a299`, `df2e51b`, `9ad1502`,
  re-baselined in `b818caa`): extraction tags each capability
  `"tutorial"` or `"iteration"` (`idea_capabilities.iteration`), and the
  idea page shows a quiet "needs iteration" tag (`web/lib/extracted.js`).
  **Distance does not use it:** a gap still counts 1 either way, so distance
  still does not mean size; weighting it is a later product decision. Rows
  extracted before 2026-11-10 have no tag until re-extracted. In the
  re-baseline 35 of 76 capabilities were tagged iteration. Was: the flag
  is the one addition that would make distance mean size without
  printing a time estimate. It stays inside the invariants: it is a checkable
  property of the capability, not a number about the idea.

## 6. Group — what makes sharing worth opening twice

Today the feed is read-only and the pool is a lookup. Two additions make it a
loop rather than a display, both cheap because the data model already carries
them:

- ~~**Claims.**~~ **Shipped 2026-11-10** (`cfe4591`, `0b42abd`, migration
  `20261110115450_idea_claims.sql`, `web/lib/group.js`): shared cards and a
  friend's idea page get "I can do a hard part" and the names of who said
  so. One row per person per idea, insertable only as yourself on a group
  mate's shared idea, deletable only by the claimer; claims go when the
  idea is unshared or moves group or the claimer leaves. Not yet fed into
  the profile or distance. Was: A button on a shared idea: *"I can do the hard part."* One row
  (`idea_claims`), and it doubles as the profile signal the design review
  asked for — a claim against a real capability is more honest than a form.
  It is also the smallest possible version of comments, without needing a
  notification path.
- ~~**Group leverage.**~~ **Shipped 2026-11-10** (`0b42abd`, `groupHeld` in
  `web/lib/group.js`): the Group tab's "Still missing" panel, "Between the
  N of you, these skills are still missing", is `leverage()` over the feed's
  live ideas against what anyone in the group holds at solid ("some" does
  not count), with counts per skill and no rank numbers. Was: The leverage ranking over the union of the group's
  skills: *"between the six of you, two skills away from nine ideas."* Same
  `leverage()` function, different `held` map. Already scoped as Step 8
  decision 11.

Comments still need a notification path before they are worth building, which
is correctly deferred. A weekly email digest (one scheduled function, no push
infrastructure) is the cheapest path to "someone notices". *Still open
2026-11-10: the owner skipped email in round two.*

## 7. Waifu view — where the fun part could go

It is an unlisted capture route with six time bands. Two extensions that add
no new surface:

- ~~She reacts to the extraction result rather than just confirming the save~~
  **Shipped 2026-11-10** (`36daae4`, `readBack` in `web/lib/waifu.js`):
  after capture she reads the hard part back. Was: the crux read back in one line ("the hard part's the motor control, right?").
  That is the app's only output shown at the moment of capture, and it is the
  one moment the person is actually looking.
- ~~A band-aware line for the vague bucket~~ **Shipped 2026-11-10**
  (`36daae4`): a vague idea's question comes with a lead-in in her band's
  words. Was: ("what *is* a 3d printed?"), which
  makes the clarifying question feel like conversation instead of a form.

Keep it unlisted, keep it capture-only. The value is that it makes capture
something you want to open, which is the stated primary blocker.

## 8. Look and feel — owner's notes, 2026-09-15, not yet scoped

Parked by the owner to come back to; none has a plan or a grilling yet.
Each needs one before any code. *Still parked 2026-11-10: the owner skipped
look and feel in round two. The §7 read-back that Live2D was waiting on now
exists.*

- **Unified product colour scheme.** One palette across the web client,
  the iOS app and the waifu chrome. Today `style.css`, `waifu.css` and the
  stock SwiftUI look were each picked in isolation.
- **Dynamic web animations.** Motion on the web client — transitions
  between routes, list rows settling, the extraction wait. Must respect
  `prefers-reduced-motion` the way the waifu poster already does.
- **Optimise the video for the waifu screen.** The 5 s loop is 2.95 MB
  against a 3 MB budget and crops with `object-position: 60% 12%`; look at
  encode settings, a per-orientation crop, and whether a shorter or
  smaller-frame loop reads the same. Playback rate was tried at 0.5 and
  0.75 on 2026-09-15 and put back to 1 — too slow by eye.
- **2D live art integration.** Replace or supplement the video loop with a
  rigged 2D character (Live2D or similar) so she can move and react rather
  than loop. Big: a runtime, an asset pipeline, and the expression
  variants the waifu plan already defers. Decide after the read-back
  (§7) exists, since that is what she would be reacting to.

---

## Suggested order

1. ~~§0 fixes (0.1, 0.2, 0.4 are each under an hour).~~ Done 2026-09-16,
   0.4 on the web only. 0.5 is applied (on the remote as of 2026-11-10);
   0.6 waits for custom SMTP, skipped in round two.
2. ~~§1.1 and §1.3 — rate-in-place and "what moved".~~ Shipped 2026-09-16.
3. ~~§5 CAD split test — before trusting or publishing the headline finding.~~ Run 2026-11-10: a CAD skill still leads, by one idea, inside the noise; see §5.
4. ~~§3.1 App Intent — the README's promised capture, cheaply.~~ Shipped
   2026-09-28, with §3.2 the outbox.
5. ~~§1.2 + §2 built/dropped/duplicates — before the list gets to 80.~~ Built/dropped shipped 2026-10-22; "Looks like" links and "Drop this one as a duplicate" shipped 2026-11-10. No merge, by decision.
6. ~~§6 claims + group leverage — when the first real friends are in.~~ Shipped 2026-11-10, ahead of the first friend.
7. ~~§4 Realtime, the batch answer, assumption + `strict: true`; §5 the iteration tag.~~ Shipped 2026-11-10 in round two, with one re-baseline (`b818caa`). The ranked top-2 crux was decided against.

Still open after round two (2026-11-10): §3.3 and §3.4 (iOS, on the Mac);
§4 the header nav wrapping at 390px; §5 held-out ideas (needs a friend's
ideas) and whether to weight distance by the iteration tag; §5 whether to
adopt the CAD split; §6 the weekly digest and §0.6 SMTP (email skipped this
round); §8 look and feel, Live2D included (skipped this round); and the
2026-10-22 critique's open questions beyond what the two rounds shipped.
