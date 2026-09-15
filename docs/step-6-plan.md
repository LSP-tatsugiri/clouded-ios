# Step 6 — iOS capture app + Share Extension

Written 2026-09-14 at the close of Step 5, from a grilling session that
settled every branch below. Read `CLAUDE.md` first for the invariants;
`docs/step-5-plan.md` has the web client this app talks alongside. Nothing
here is built yet. Development moves to the Mac for this step: Swift needs
Xcode, and `supabase db push` needs the CLI login.

## State at handoff

- Hosted Supabase project: schema through `20260914063115`, the `extract`
  edge function on a webhook that fires on INSERT and on a changed
  `clarification`, 19 baseline ideas plus a few added from the web under
  `test@clouded.dev` (`88976eb5-…`). RLS 20/20 (`acceptance.mjs rls`).
- `ideas` already has `image_path`, `audio_path`, `transcript` — written by
  nothing, read by nothing. Extraction reads `raw` and `clarification` only.
  `authenticated` may UPDATE `clarification, image_path, audio_path,
  transcript, shared_to` on own rows; `raw` is immutable by trigger.
- No storage bucket exists.
- Web: list, idea page (clarification + share), profile, curator review;
  `node web/serve.mjs`; the list watches a pending idea until it lands.
- This machine is Windows. A Mac exists; Xcode status unconfirmed.

## The correction that shaped this step

The README describes screenshots as "the main input". The grilling clarified
the intent: **media is the inspiration that came with the idea, attached for
context, not the input extraction reads.** The idea is always a sentence.
That removes the screenshot-extraction spike `CLAUDE.md` called for (there is
nothing to test: the model never sees the image) and makes the schema's
existing shape — text in `raw`, media in side columns — the right one.

## Decisions (made 2026-09-14)

1. **Native SwiftUI app with a Share Extension**, not the iOS-Shortcut
   alternative the design review offered. Named reasons: easier installation
   for friends and a more refined product. The cost that comes with it:
   friends install via TestFlight, and TestFlight needs the paid developer
   account ($99/yr). Build with a free Apple ID until a friend wants it.
2. **Offline loss is acceptable in v1.** No local queue, no sync engine.
   Uploads go through a background `URLSession`, which the system finishes
   after the extension is dismissed and retries when connectivity returns —
   most of the offline story for free. A visible failure is honest; a lost
   idea is rare.
3. **One idea = a sentence (required) + optional image + optional link.**
   Media cannot be saved without the sentence. This is the README's
   one-line-minimum rule applied at the field level, and keeps `raw not
   null` true. No "bookmark" bucket; if the note is skipped often, that is a
   measurement to take later.
4. **Image only; voice is dictation into the text field.** No audio upload,
   no transcription. `audio_path` and `transcript` stay unused until missed.
5. **Storage visibility mirrors `ideas` exactly**: the owner always, group
   members when the idea is shared to their group. The picture is half the
   idea.
6. **App contents in v1: capture + a read-only list.** Sign-in, capture
   screen, the Share Extension, and a list so you can watch an idea land and
   answer its clarifying question. No profile editing, sharing or review on
   the phone.
7. **The phone list is newest-first**, showing sentence, status, and once
   extracted the crux with its status mark. The closest-to-buildable sort
   stays on the web: `distance.js` cannot be imported by Swift, and a second
   copy is the thing Phase C avoided. If the sort is ever wanted on the
   phone, move it server-side; do not port it.
8. **Share Extension accepts images and URLs.** A URL lands in a new
   `ideas.source_url`, shown as a link on the idea page, ignored by
   extraction. Refusing URLs would mean screenshotting TikTok first.
9. **Write order**: insert the row → get the id → upload the image to
   `<user_id>/<idea_id>.jpg` → PATCH `image_path`. Extraction starts on the
   insert and does not wait for the picture. A failed upload leaves an idea
   without its image; the page says so; v1 has no retry button (re-share).
10. **Images are downscaled** to a longest side of 2048 px and re-encoded
    JPEG ~0.8 before upload.
11. **Sign-in is email + password**, once, in the app. The extension reads
    the session from a shared Keychain group and never shows a form.
12. **Live updates**: pull-to-refresh, plus polling every few seconds while
    any row is pending, stopping when none is. No Realtime.
13. **Answering the clarifying question is in v1**: one field writing
    `clarification`, which re-runs extraction as on the web.
14. **The app lives in `ios/`**, not at the repo root as `CLAUDE.md` once
    planned; the root now has four siblings and an Xcode tree among them
    would be a mess. `CLAUDE.md` is updated in Phase A.
15. **iOS 17 minimum.** Bundle id `com.monoesport.clouded`, extension
    `com.monoesport.clouded.share`, App Group `group.com.monoesport.clouded`,
    shared Keychain access group. Reverse-DNS of `monoesport.com`, which the
    owner controls (the web client is hosted at `clouded.monoesport.com`,
    see `docs/hosting.md`). Hard to change later; chosen now.
16. **Web changes in this step are two**: the idea page shows the image
    (signed URL, the bucket is private) and the source link; the list row
    gets a marker for "has image".

## Phase A — server and web (Mac or Windows; push needs the Mac login)

- Migration `<ts>_media_and_source.sql`:
  - `alter table ideas add column source_url text;`
  - No new UPDATE grant: `source_url` is set at insert and `image_path` is
    already in the grant list. Verify, do not assume, that `authenticated`
    can INSERT `source_url` under the existing insert policy.
  - Bucket `idea-media`, private. Policies on `storage.objects` for
    `bucket_id = 'idea-media'`: INSERT/UPDATE/DELETE where the first path
    segment is `auth.uid()`; SELECT where the object's idea (second segment,
    without extension) is visible to the caller — own, or shared to a group
    they belong to. Express visibility with the same `my_group_ids()` the
    `ideas` policies use.
- `acceptance.mjs rls` gains checks: B (group mate) can read the shared
  idea's object and not others; C (stranger) and anon read nothing; a user
  cannot write under another user's prefix.
- Web: `db.js` gets `mediaUrl(path)` (signed URL, short expiry) and
  `source_url` in the idea selects; the idea page renders the image and the
  link; `ideaRow` shows a small marker when `image_path` is set.
- `CLAUDE.md`: layout gains `ios/`, the root line goes; build order marks 6
  current with this plan.
- **Work on branch `step-6`, and pull `main` into it before touching
  `web/`.** Hosting (`docs/hosting.md`) is being built on `main` in parallel
  from the Windows machine: a sign-up tab in `web/app.js` and `web/lib/db.js`,
  an `allowed_emails` migration, `web/build.mjs`. Migrations from both
  branches are pushed together with `supabase db push` from the Mac.

**Done 2026-09-15** (migration `20260915034222_media_and_source.sql`, on
branch `step-6`). Two departures from the text above: the storage SELECT
policy is `exists (select 1 from ideas where id = <id parsed from path>)`
under the caller's RLS rather than a restatement with `my_group_ids()`, so it
cannot drift from the ideas visibility; and `rls` inserts one idea to prove
`source_url` is insertable, so each run costs one extraction (~$0.01).
Verified: `rls` 27/27; a signed URL fetched as the test user returns the
object; a stranger and anon get 400/404 (storage hides, it does not 403);
the idea page shows the picture and the `from:` link, the list row the
marker. Learned: the storage API refuses `x-upsert` from authenticated
users under RLS — irrelevant to the app (one new object per idea) but it
tripped the test's positive control once. The bucket is also capped at
10 MiB and `image/jpeg` only, which the plan did not say.

## Phase B — app scaffold and sign-in (Mac)

- `ios/clouded.xcodeproj` with two targets, `clouded` (app) and
  `cloudedShare` (Share Extension), iOS 17, SwiftUI, `supabase-swift` via
  SPM pinned to a version. App Group and Keychain sharing entitlements on
  both.
- Config: project URL and anon key in a gitignored `ios/Config.xcconfig`
  with a committed `Config.example.xcconfig`, same rule as `web/config.js`.
- Sign-in screen; session stored in the shared Keychain group; signed-in
  state survives relaunch. The extension can read the same session.
- Verified: build on device with a free Apple ID; sign in; relaunch; still
  signed in; the extension target loads and can read the token.

**Done 2026-09-15** on the owner's iPhone 12 Pro (iOS 18.4.1), Personal
Team `MRQYR447Q9`, free Apple ID. The open risk is closed: the personal
team's profiles carry `com.apple.security.application-groups =
[group.com.monoesport.clouded]` on both targets (checked with `codesign -d
--entitlements`). There is no separate `keychain-access-groups`
entitlement; the App Group is used as the keychain access group, which
iOS allows. Verified by the owner on the phone: sign-in as the test user;
force-quit and relaunch → still signed in; share a screenshot → "clouded"
in the share sheet → "Signed in as test@clouded.dev". Two things the phone
needed before any of it, both owner-only: Developer Mode (the toggle in
Settings → Privacy & Security only appears after Xcode itself has
connected to the phone — `xcodebuild` alone does not make it show) and
trusting the developer certificate (Settings → General → VPN & Device
Management) before the first launch. Build and install from `ios/`:

    xcodebuild build -project clouded.xcodeproj -scheme clouded \
      -destination 'id=<udid>' -derivedDataPath Build \
      -allowProvisioningUpdates -allowProvisioningDeviceRegistration
    xcrun devicectl device install app --device <udid> \
      Build/Build/Products/Debug-iphoneos/clouded.app

`generic/platform=iOS` cannot register the device; the `id=` destination
can. The udid is in `xcrun devicectl list devices`. `ios/Build/` is now
gitignored. The device build plus Xcode's own DerivedData filled the
Mac's disk once; delete both when space runs out, they are caches.

## Phase C — the list (Mac)

- Newest-first list of own ideas: sentence, status tag, crux with mark once
  extracted, the clarifying question when vague. Pull-to-refresh; polling
  while any row is pending, stopped otherwise.
- Tapping a vague row's question opens a field; saving writes
  `clarification`; the row shows "extracting…" and polls until the new
  run lands (poll `extraction_runs` newer than the answer, then wait for
  `is_clear` to agree, exactly as `web/app.js` `awaitRerun` does).
- Verified: the same rows as the web, in `created_at desc`; an answer on
  the phone produces a new run visible on the web.

**Done 2026-09-15.** `ios/Shared/Records.swift` holds the row types plus
`cruxOf`/`classify` mirrored from `distance.js` (the list needs the crux's
mark, which is a per-row lookup, not the sort; decision 7 stands).
`ios/clouded/IdeasModel.swift` loads own ideas newest-first, capabilities
for those ids, skill names and the owner's levels; polls every 3 s while a
row is pending; `answer()` writes `clarification` and ports `awaitRerun`
(a run newer than the answer, then the row agreeing with the run's
verdict). `HomeView.swift` is the list with a pull-to-refresh and an
answer sheet that repeats the web's cost line. Verified on the phone: the
rows match the web's order (`created_at desc`); refresh works; answering
"rc truck" wrote the clarification, produced a new `extraction_runs` row
(`clear: true`, the 09-13 run was `false`) and the row updated in place.
Rows shared to a group by friends are not on the phone (the query filters
`user_id`, as `web/lib/db.js ideas()` does since Step 7).

## Phase D — capture and the Share Extension (Mac)

- In-app capture screen: the sentence (dictation is the keyboard's),
  attach photo (library or camera), attach link (paste). Save follows the
  write order in decision 9; the list shows the new row extracting.
- Share Extension: accepts `public.image` and `public.url`; shows the
  attachment and the sentence field; Save disabled while the field is
  empty; on Save, inserts the row, hands the image upload to a background
  `URLSession` keyed to the App Group, PATCHes `image_path` on completion,
  dismisses.
- Verified live: share a screenshot from the screenshot preview with a
  sentence → row appears on the web with the image; share a TikTok link →
  row with `source_url`; try to save with no sentence → cannot; airplane
  mode → upload completes when it is turned off.

**Done 2026-09-15.** `ios/Shared/Capture.swift` (the insert and the
uploader), `ios/clouded/CaptureView.swift` (sentence, PhotosPicker or
camera, a link field with the system paste button), and the extension's
`ShareViewController.swift` (one image or one web URL in; URL wins when a
page shares both). One departure from decision 9: the client chooses the
idea's id, so the row is inserted **with** `image_path` set and there is
no PATCH after the upload. Reason: once the extension is dismissed there
is no process to send the PATCH (the system would have to relaunch the
containing app for it), and the web page already says "attached but could
not be loaded" for a missing object, which is the honest state of a
failed upload. Extraction still starts on the insert. The upload is a
plain storage POST on a background `URLSession` with
`sharedContainerIdentifier` = the App Group, from a JPEG spooled in the
group container (swept after a day at app launch); it carries the token
of the moment, so an upload delayed past a token lifetime fails and the
idea shows without its picture. Verified on the phone: in-app capture
with a library photo → row extracting, then extracted, 1.0 MB JPEG in the
bucket; share a screenshot from the preview → Save disabled until a
sentence, then the row on the web with its 545 KB image (the upload
finished after the sheet closed); share a Douyin link → row with
`source_url`. Not run: the airplane-mode case; the insert needs the
network anyway, so what it would show is Save failing honestly.

## Phase E — acceptance and close

1. Fresh install on your phone: sign in, capture from the app, capture from
   the share sheet (image, URL), answer a question on the phone; each shows
   correctly on the web within the wait window.
2. `acceptance.mjs rls` 20+/20+ including the storage checks; a group mate
   sees the shared idea's image on the web, a stranger does not.
3. Commit `ios/`, update the README's "you are here" to Step 7, record what
   Phase E verified here.

**Done 2026-09-15.** (1) On the iPhone 12 Pro, on the install made today
(not a wipe-and-reinstall): sign-in, in-app capture with a photo, share a
screenshot, share a link, answer a question — each visible on the web /
server within the wait window (details under Phases B–D). (2) `rls`
52/52 after the Step 7 merge, storage checks included; a group mate reads
the shared idea's object through the same storage endpoint the web's
signed URL uses, a stranger and anon cannot. (3) `ios/` is committed; the
README and CLAUDE.md mark Step 6 done; `step-6` merged into `main`.
Left for later, all named in "Not in this step": TestFlight, the offline
queue, upload retry. One new item: the background upload sends the token
it was given, so an upload delayed past a token lifetime (about an hour)
fails silently and the idea shows without its picture — re-share it.

## Not in this step

- TestFlight and the paid developer account — when a friend asks.
- Offline queue and sync — decision 2.
- Voice recording and transcription — decision 4.
- The distance sort on the phone — decision 7.
- Retrying a failed image upload from the app — decision 9.
- Profile, sharing, review on the phone — decision 6.
- Widgets, Action Button, lock-screen capture — after the share sheet is
  proven to get used.

## Trello cards this closes

- "Step 6 · iOS capture" (name to confirm on the board)
