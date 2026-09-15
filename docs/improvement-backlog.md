# Clouded — improvement and future-development backlog

Written 2026-09-15 from a full read of `LSP-tatsugiri/clouded-ios` @ `fb5ad88`
(README, CLAUDE.md, `extraction/`, `supabase/`, `web/`, `ios/`, `docs/`).
Nothing here is signed off; each item that gets picked becomes a PRD delta
against `README.md`, not a new PRD.

Ordering rule used throughout: does it serve **capture** (the stated primary
blocker) or the **learning loop** (the stated secondary job)? Anything that
serves neither is ranked below anything that serves either, however clever.

---

## 0. Repo inconsistencies found — fix regardless of what else is built

| # | Finding | Where | Why it matters |
|---|---|---|---|
| 0.1 | `README.md` line 5 still says **"Status: pre-build … No app yet, on purpose."** | `README.md:5` | Seven steps are done and the site is live. It is the first thing a friend reads. |
| 0.2 | Local testbed defaults to **`claude-sonnet-4-5-20250929`**; the edge function defaults to **`claude-sonnet-5`** | `extraction/src/extract.js:4`, `extraction/src/resolve.js:15` vs `supabase/functions/extract/index.ts:24` | `npm run fresh` without `MODEL=` set silently produces a baseline from a different model than production, under a different `promptHash`. The committed `out/` baseline is documented as sonnet-5. Make the Node default match, or make the default an error. |
| 0.3 | `proposed_skills` is `select using (true)` for every authenticated user, and its `reasons[]` and `idea_ids[]` are copied out of capability rows that may belong to **private** ideas | `supabase/migrations/20260912215850_init.sql` (RLS block) | A friend cannot read your private idea but can read a sentence explaining why it needs a skill. Small blast radius at ten trusted people; still contradicts "private by default". Restrict the select to `curators`, or strip `reasons` from the shared registry. |
| 0.4 | **No way to delete an idea** from any client | `web/lib/db.js` has no delete; `ios/` neither | RLS already permits it (`ideas: own … for all`). A capture-first tool with no undo makes a typo permanent, and a wrong capture costs a cent to extract and then sits in the list forever. |
| 0.5 | `invite()` is `security definer` and lets **any** group creator allowlist **any** email | `20260915071927_groups_invites_profiles.sql` | Anyone with an account can create a group and mint accounts on your Anthropic key. Trust-based by design, but it is the allowlist's only hole and worth naming in `CLAUDE.md` next to the no-cost-cap note. |
| 0.6 | Sign-up confirmation email still unresolved (`mailer_autoconfirm: false`) | `docs/step-7-plan.md`, loose end | Blocks the one Step 7 item still open: the first real friend. Decide before inviting anyone. |

---

## 1. The learning loop is open — the highest-value change to the concept

The app computes what you would have to learn. Nothing in the system ever
learns that you learned it. `user_skills` is a 51-row form, filled once, and
the README already predicts nobody maintains it — while every distance, every
sort, the leverage ranking and the whole friend pool are computed from it.
That is the single largest structural weakness, bigger than any UI gap.

Three changes close it, in increasing size:

1. **Rate from where the gap appears.** On the idea page each capability line
   already renders `[ ]` + the skill name. Make the mark itself a control:
   click cycles `none → some → solid` and writes `user_skills`. The profile
   form stops being the only way in, and rating happens at the moment you are
   looking at the thing that needs it. ~30 lines in `app.js` + `db.js`.
2. **"I built this."** Add `ideas.built_at`. Marking an idea built offers to
   set each of its capabilities to `solid` (confirm per capability — the
   claim should be checkable, same rule as the taxonomy). This is the honest
   profile source the design review asked for (§5) *and* the idea list's
   missing end state. The README says the product "ends where work begins";
   it does not have to manage the work to record that it happened.
3. **Say what moved.** After any profile change, one line: *"parametric-cad
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

- `built_at` (above), plus `dropped_at` with a one-line reason. Not a score —
  a fact.
- Default the list to live ideas, with built/dropped behind a toggle.
- **Near-duplicate detection at capture.** Frictionless capture guarantees
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

1. **App Intent + Shortcut** (`AppIntents`, ~60 lines). Gives the Action
   Button, Siri, the lock-screen widget and the Shortcuts app in one go,
   without a new UI. This is the cheapest way to deliver what the README
   already promises.
2. **Local outbox for the row.** Same spool pattern `Uploader` already uses:
   write the row to a file in the App Group, POST on launch/connectivity.
   The `id` is already chosen client-side, so retries are idempotent.
3. **Control Center / lock-screen widget** once (1) exists — a button, not a
   screen.
4. A **share-sheet action that keeps the source URL and page title**, since
   `source_url` exists and the extension already has both.

## 4. Web — concrete gaps

- **Search.** There is no text search over `raw`/`objective`. Below 30 ideas
  scrolling works; above it, nothing does. Client-side filter box: 15 lines.
- **Replace the 2-second poll with Realtime.** `watch()` polls `runsFor()` up
  to 60 times per new idea (`app.js:905`), and the idea page does it again.
  Supabase Realtime on `extraction_runs` insert removes ~60 round-trips per
  capture and the whole `WATCH_WINDOW_MS` guesswork.
- **The list fetches every capability row you can see, on every load**
  (`capabilities()` with no filter) and again on the Group tab. Fine now;
  it is an unbounded query as the group grows. Scope it to the ideas being
  shown, or let PostgREST embed it into the ideas select.
- **Empty-profile state.** With zero ratings every idea is all-gaps and the
  sort is meaningless. The list says so in small grey text; it should be the
  first thing on the page until at least the skills that appear in your own
  ideas are rated. A "rate the 12 skills your ideas actually need" flow beats
  a 51-row form for cold start.
- **Mobile web.** Only two breakpoints; the Group tab and the profile radio
  grid were not built for a phone. Since the phone app has no sharing or
  feed, mobile web *is* the phone's sharing UI today.
- **The vague bucket costs a cent per answer and gives no batch path.** If
  three entries are vague, that is three round-trips through a form. Let the
  answer box take all of them on one screen.
- **Assumption visibility.** The README's own finding — "pcb coaster" read as
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
- **Held-out ideas.** Every idea in `ideas.json` is one the table was written
  around. Run 10 ideas from outside the backlog (a friend's, once one joins)
  and watch the proposed rate. A low rate on *your* ideas proves nothing.
- **Crux stability.** Committed at 16/19 same-prompt. The UI calls it "the
  hard part" as if settled. Either ship the ranked top-2 (schema change,
  already scoped) or soften the label to "a hard part" until the number
  justifies the definite article.
- **A per-capability "learnable from a tutorial vs needs real iteration"
  flag** is the one addition that would make distance mean size without
  printing a time estimate. It stays inside the invariants: it is a checkable
  property of the capability, not a number about the idea.

## 6. Group — what makes sharing worth opening twice

Today the feed is read-only and the pool is a lookup. Two additions make it a
loop rather than a display, both cheap because the data model already carries
them:

- **Claims.** A button on a shared idea: *"I can do the hard part."* One row
  (`idea_claims`), and it doubles as the profile signal the design review
  asked for — a claim against a real capability is more honest than a form.
  It is also the smallest possible version of comments, without needing a
  notification path.
- **Group leverage.** The leverage ranking over the union of the group's
  skills: *"between the six of you, two skills away from nine ideas."* Same
  `leverage()` function, different `held` map. Already scoped as Step 8
  decision 11.

Comments still need a notification path before they are worth building, which
is correctly deferred. A weekly email digest (one scheduled function, no push
infrastructure) is the cheapest path to "someone notices".

## 7. Waifu view — where the fun part could go

It is an unlisted capture route with six time bands. Two extensions that add
no new surface:

- She reacts to the extraction result rather than just confirming the save —
  the crux read back in one line ("the hard part's the motor control, right?").
  That is the app's only output shown at the moment of capture, and it is the
  one moment the person is actually looking.
- A band-aware line for the vague bucket ("what *is* a 3d printed?"), which
  makes the clarifying question feel like conversation instead of a form.

Keep it unlisted, keep it capture-only. The value is that it makes capture
something you want to open, which is the stated primary blocker.

## 8. Look and feel — owner's notes, 2026-09-15, not yet scoped

Parked by the owner to come back to; none has a plan or a grilling yet.
Each needs one before any code.

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

1. §0 fixes (0.1, 0.2, 0.4 are each under an hour).
2. §1.1 and §1.3 — rate-in-place and "what moved". Small, and they make every
   other number in the app mean something.
3. §5 CAD split test — before trusting or publishing the headline finding.
4. §3.1 App Intent — the README's promised capture, cheaply.
5. §1.2 + §2 built/dropped/duplicates — before the list gets to 80.
6. §6 claims + group leverage — when the first real friends are in.
