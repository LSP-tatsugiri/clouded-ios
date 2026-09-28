# Handoff — iOS capture: the offline outbox and the App Intent, 2026-09-28

For a fresh Claude Code session, on the **Mac** (this work is `ios/`, and Xcode
is Mac-only). Read `CLAUDE.md` first — especially **agent work goes to
`agent/<topic>` branches, never `main`**, enforced by
`.claude/hooks/guard-main.mjs`. Then this file. It records what shipped, what
was deliberately not verified, and the traps found while building it. The
previous handoff is `docs/handoff-2026-09-25-speech.md`.

## Where things stand

- **`main` @ `6d5beca`.** `clouded.monoesport.com` serves it. The default-sort
  change (both lists open on Newest) was pushed by the owner on 2026-09-28.
- **Two branches are waiting to be merged, and the second contains the first.**
  Merge in this order, or simply merge the second:

  | Branch | Commit | What |
  |---|---|---|
  | `agent/ios-outbox` | `0fafd20` | improvement-backlog §3.2 — an idea captured with no network waits in an outbox |
  | `agent/ios-app-intent` | `290057b` | improvement-backlog §3.1 — capture from the Action Button, Siri or Shortcuts |

  Compare links:
  `https://github.com/LSP-tatsugiri/clouded-ios/compare/main...agent/ios-outbox`
  `https://github.com/LSP-tatsugiri/clouded-ios/compare/agent/ios-outbox...agent/ios-app-intent`

- **No migration, no edge function, no API spend.** Nothing here touches the
  schema or Anthropic. A queued idea costs the same one cent when it flushes,
  not an extra one.

### §3.2 — the outbox (`Shared/Outbox.swift`)

`Capture.save()` used to throw the idea away when the insert could not reach
the database. The README names that exact failure — "an idea lost because you
were in a basement" — as the worst thing the product can do. The row now goes
to a spool: one JSON file per idea in the App Group container, the same shape
`Uploader` already uses for pictures, so the app and the Share Extension share
one queue and it outlives the process that wrote it.

The list shows a queued row with the status `"waiting to send"` and no
navigation link, because nothing has been extracted yet to open. A flush turns
it into a real row, and runs on launch, on foreground, and when
`NWPathMonitor` sees signal.

Three rules the spool has to keep, each with a test:

- **Nothing is ever aged out.** `Uploader.sweep()` drops image spool after a
  day because a missing picture is cosmetic; a dropped row is the bug.
- **Sending is oldest-first and stops at the first failure**, so ideas land in
  capture order and a dead network is tried once per flush, not once per queued
  idea.
- **A duplicate-key error means the row already landed** and only the response
  was lost. The id is chosen client-side, so that is success, not failure.

### §3.1 — the App Intent (`clouded/CaptureIntent.swift`)

One `AppIntent` plus an `AppShortcutsProvider`, which is the whole of the
Action Button, Siri, the Shortcuts app and a lock-screen or Control Centre
button — no new screen, no new target. It saves without opening the app, takes
the sentence only, and offline it says *"Saved — waiting for signal"* rather
than claiming an idea landed. Siri asking for the sentence is also most of what
decision 4 (voice) deferred.

### The first test target in `ios/`

`cloudedTests`, 21 tests, run with:

```
cd ios && xcodebuild test -project clouded.xcodeproj -scheme cloudedTests \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

It compiles `Outbox.swift`, `AppGroup.swift` and `Records.swift` and nothing
else — all Foundation — so it needs no host app, no Supabase package and no
code signing, and runs in well under a second. Two seams keep it that way, and
both are worth preserving:

- `Outbox.flush(send:)` takes the send as a closure, so the spool logic never
  imports Supabase.
- The Postgres error code reaches it through a `PostgresCoded` protocol, with
  `extension PostgrestError: PostgresCoded {}` on the app side.

`AppGroup.swift` exists for the same reason: it holds the App Group id so
`Outbox` can compute its directory without pulling in `Config`, which
`fatalError`s on a missing Info.plist key.

## Verified, and deliberately not verified

**Verified:** 21 tests pass. App and Share Extension build clean for the
simulator with no new warnings. The extracted `Metadata.appintents` really does
name `CaptureIdeaIntent`, its `sentence` parameter and the shortcut phrases.
The app installs and launches clean in the simulator — the check that would
have caught a crash from the new `NWPathMonitor` in `IdeasModel.init`.

**Not verified, both on purpose:**

1. **The end-to-end offline path** — capture with the network down, see the
   "waiting to send" row, restore the network, watch it land. The owner chose
   on 2026-09-28 to rely on the unit tests rather than have the agent toggle
   the Mac's Wi-Fi. So the join between `Capture.save` and the spool is
   unexercised; the spool itself is well covered.
2. **Running the intent from Siri or an Action Button.** The simulator has no
   Action Button. This needs the phone, and it is the one thing worth doing by
   hand before trusting §3.1.

## Loose ends, none of them blocking

1. **`docs/feedback-migrate.sh` lines 36–37 are stale.** They would file §3.1
   and §3.2 as fresh GitHub issues; both shipped today. Skip those two lines
   when Phase E finally runs. Everything else about Phase E is unchanged and
   still waiting — see `docs/handoff-2026-09-25-speech.md`.
2. **The Deno suite is still red on `main`:** 34 pass, 1 fails, the prompt-hash
   baseline test. Pre-existing and documented; re-baselining costs about $0.30
   of API credit, so decide on purpose or not at all. Deno is still not
   installed on the Mac.
3. **Issue #4 is still open** — the test report titled "123". Safe to close.
4. **Nine merged branches can be deleted from origin:** `agent/feedback`,
   `agent/review-branch-rule`, `agent/signin-dialog`, `agent/speech-capture`,
   `agent/handoff-speech`, `agent/default-sort-newest`, `landing`, `redesign`,
   `step-6`.

## Decided, do not reopen without the owner

- **The outbox holds the row only.** The picture keeps the background
  `URLSession` path and its token-lifetime limit: an upload delayed past about
  an hour still fails and the idea shows without its picture. Explicit scope
  decision, 2026-09-28.
- **Any failure spools, not only an obviously offline one.** A row sitting
  visibly in the queue is recoverable; a row thrown away with the sheet is not.
  The known trade-off is that a permanently rejected row blocks the ones behind
  it — acceptable at ten trusted people and a fixed row shape.
- **Queued rows are visible in the list**, not hidden behind a counter. A queue
  nobody can see is indistinguishable from a lost idea.
- **The intent saves without opening the app**, and takes the sentence only.
- **The Action Button gate in `docs/step-6-plan.md`** ("after the share sheet is
  proven to get used") was put to the owner on 2026-09-28 and overridden
  deliberately, as the cheapest way to deliver capture the README already
  promises.

## Notes from building it, worth not rediscovering

- **An App Intent needs `AppIntents.framework` as a real dependency.** Without
  it the build still succeeds and the intent silently never appears anywhere.
  The only sign is a warning buried in the log: *"Metadata extraction skipped,
  no AppIntents.framework dependency found"*. It is now a commented line in
  `project.yml`. When in doubt, check the built
  `clouded.app/Metadata.appintents/extract.actionsdata` — it names every intent
  that made it through.
- **`supabase.auth.session` needs the network** (it refreshes an expired
  token); `supabase.auth.currentSession` is `nonisolated` and does not. Offline
  capture turns on that difference: the stored session still carries the right
  user id, which is all that naming the row and the image path takes.
- **The SPM checkout is on disk at `ios/Build/SourcePackages/checkouts/`**
  (gitignored). Grep it to confirm an SDK API instead of guessing —
  `PostgrestError.code` and `currentSession` were both settled that way.
- **The first `xcodebuild` of a session can take three to five minutes** while
  the simulator boots; later runs are seconds. Start it in the background.
- **Only `cloudedTests` has a generated shared scheme**, committed at
  `ios/clouded.xcodeproj/xcshareddata/xcschemes/`, because it is the one target
  declaring `scheme:` in `project.yml`. `clouded` and `cloudedShare` get
  autocreated schemes from Xcode.
- **`xcodegen generate` after every `project.yml` change**, and the generated
  `clouded.xcodeproj` is committed on purpose — never edit it by hand.

## What is next

From the backlog's own suggested order, with §3.1 and §3.2 now struck off:

1. **§1.2 + §2 — `built_at`, `dropped_at`, near-duplicate detection.** Web, and
   the completion of the learning-loop set whose other two thirds (§1.1
   rate-in-place, §1.3 "what moved") already shipped. Needs a migration, so
   commit it in the same step as the owner running `supabase db push`.
2. **§5 — the CAD split test.** Still the cheapest high-information experiment
   in the repo, still **PC-only**: `extraction/.env` holds the Anthropic key and
   exists only there. ~$0.25–0.30.
3. **§3.3 — the Control Centre / lock-screen button** now follows for free, the
   shortcut being already offered. §3.4 (keeping the page title alongside
   `source_url`, which the Share Extension already has) is the last §3 item.
