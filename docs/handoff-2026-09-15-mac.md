# Handoff — Mac session, 2026-09-15

For a fresh Claude Code session on the **Mac**, working on branch `step-6`.
Read `CLAUDE.md` first (invariants, working rules, the two-machine rules).
Then `docs/step-6-plan.md` — the plan this branch executes, with Phase A
recorded as verified. Then this file. `docs/handoff-2026-09-15-pc.md` is
the other machine's view; skim it for what `main` is doing (Step 7).

## Where things stand

- **Phase A is done and verified** (commit `ea65830`, note at the end of
  Phase A in the plan): `ideas.source_url`, private `idea-media` bucket,
  `acceptance.mjs rls` storage checks, image + link on the web idea page.
  Migration `20260915034222_media_and_source` is applied on the hosted
  database, as is main's `20260915033902_allowed_emails`; `supabase
  migration list` shows both, nothing pending.
- **Phase B is built, not yet verified on a phone.** `ios/` holds the
  XcodeGen spec (`project.yml`), the generated `clouded.xcodeproj`, two
  targets (`clouded`, `cloudedShare`), supabase-swift 2.55.2 pinned. The
  session is kept in the Keychain under the App Group, which doubles as
  the keychain access group (one entitlement per target; the plan said
  "App Group + Keychain sharing", this is the same result with less).
  Bundle ids follow decision 15 as amended on `main`:
  `com.monoesport.clouded`, `.share`, `group.com.monoesport.clouded`.
  Verified: simulator build green for both targets, app launches, reads
  its config, shows sign-in; `cloudedShare.appex` is in the bundle.
  **Not verified: sign-in on a device, relaunch, and the extension
  reading the token** — the device build got as far as "your team has no
  devices", which is a personal team needing the phone plugged in, not a
  project problem. Whether a free Apple ID's team accepts the App Group
  entitlement is still the open risk; it gets answered at the first
  device build.
- `main` has been merged into `step-6` twice (`39c3972`, `0e5794e`);
  `step-6` contains everything on `origin/main` as of this writing. The
  per-prompt sync hook from `main` is in this checkout now.
- `acceptance.mjs rls` has **29 checks** after the merge (PC's 22 +
  storage 7) but has not been run in that combined form yet; the last
  Mac run was 27/27 before the allowlist migration. Run it once (~1¢).

## This machine

- Xcode 27.0 at `/Applications/Xcode.app`, license accepted. `xcode-select`
  still points at CommandLineTools; every `xcodebuild`/`xcrun` here was run
  with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` set,
  which needs no sudo. iOS 27.0 simulator runtime present; iPhone
  simulators available (`xcrun simctl list devices available`).
- `xcodegen` 2.46.0 and `supabase` CLI 2.117.0 via Homebrew. The CLI is
  logged in and linked. No Docker, no psql, no Deno.
- `ios/Config.xcconfig` (gitignored) is filled: URL, anon key, and
  `DEVELOPMENT_TEAM = MRQYR447Q9` (the owner's Personal Team; Xcode 27
  does not show it in Settings → Accounts, it was read from
  `~/Library/Preferences/com.apple.dt.Xcode.plist`). Apple ID is added to
  Xcode. `supabase/.env` and `web/config.js` are present.
- The simulator still has the app installed under the **old** id
  `dev.clouded.app` from before the rename; uninstall it
  (`xcrun simctl uninstall booted dev.clouded.app`) or ignore it.
- Build commands that worked, from `ios/` (derived data path is anything):

      xcodegen generate
      xcodebuild build -project clouded.xcodeproj -scheme clouded \
        -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
      xcodebuild build -project clouded.xcodeproj -scheme clouded \
        -destination 'generic/platform=iOS' -allowProvisioningUpdates

  Redirect the build log to a file and grep `BUILD|error:`; the raw log is
  thousands of lines of package compiles.

## The next task on this machine: finish Phase B, then Phase C

1. **Device build.** Owner: plug the iPhone in by cable, trust the Mac,
   turn on Settings → Privacy & Security → Developer Mode. Agent: `xcrun
   devicectl list devices`, then the device build above plus
   `-allowProvisioningDeviceRegistration` (registers the phone with the
   personal team and creates both profiles), then install with
   `xcrun devicectl device install app --device <id> <path to clouded.app>`
   from `Build/Products/Debug-iphoneos`. If Apple refuses the App Group
   for a personal team, stop and say so — the fallback (no App Group; the
   extension does its own sign-in, or capture stays in-app only) is a
   product decision for the owner, not a workaround to pick alone.
2. **Owner verifies on the phone**: sign in as the test user; force-quit
   and relaunch → still signed in; share any screenshot → pick "clouded"
   in the share sheet → it reads "Signed in as test@clouded.dev". Record
   the result under Phase B in `docs/step-6-plan.md` (the Phase A note is
   the shape), commit, push.
3. **Phase C**: the newest-first list per the plan. `HomeView.swift` is
   the placeholder to replace. Reuse `web/app.js` `awaitRerun` logic for
   the clarification round-trip, in Swift, against `extraction_runs`.

## Rules that bit us, in one place

- **Say the API cost before spending it** (`CLAUDE.md`). Every INSERT on
  `ideas` fires extraction (~1¢), including test probes; `rls` does one.
- **Migrations: commit and push the file in the same step as `supabase
  db push`.** This session applied one before the file was pushed and
  blocked the PC. Out-of-order timestamps need `db push --include-all`.
- **Owner runs, in a real terminal:** `supabase login`, `supabase db
  push`, `supabase functions deploy`, `sudo xcodebuild -license`, adding
  the Apple ID in Xcode. The agent dry-runs and hands over.
- **Branch `step-6`; pull `main` before touching `web/`** — hosting and
  Step 7 are being built on `main` from the PC in parallel. `main` deploys
  the live site on push, so nothing goes to `main` until Phase E merges.
- **Do not put credentials into tool calls.** Signing in through the
  browser MCP would have put the test password into the transcript; the
  signed-URL check was done from a Node script reading `.env` instead.
- **Copying `supabase/.env` between machines can drop the dot** — it
  arrived here as `supabase/env`, which is *not* gitignored. Check with
  `git status` right after copying.
- **Every first Bash command and first file edit is gated** by the ECC
  fact-forcing hook: state the request and what the command produces.
  Just answer it.
- The owner is on voice input; "ok" or a single word answers the last
  question asked. Lead with the recommended option so it can be accepted
  in a word.

## Small things left open

- `Claude outputs/` at the repo root is now tracked (from `main`,
  `0db4042`); undecided whether it belongs in the repo long-term.
- The 320×200 striped test JPEG used for the web check is gone from the
  bucket and the idea; the bucket is empty. Nothing to clean.
- The `ideaRow` marker for "has a picture" is a `▣` tag; nobody has
  looked at it with a real photo yet.

## First prompt to give the new session

> Read CLAUDE.md, docs/step-6-plan.md and docs/handoff-2026-09-15-mac.md.
> Then run acceptance.mjs rls once (say the cost), and continue Step 6
> Phase B from the device build; my phone is plugged in.
