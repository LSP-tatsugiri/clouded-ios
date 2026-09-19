# Feedback — bug and improvement reports, filed to GitHub Issues

Written 2026-09-19 from the signed-off PRD (Cowork project doc
`claude/feedback-reporting-prd.md`). Read `CLAUDE.md` first for the
invariants. Phases A and B are built and verified below; C, D and E are the
spec for the next session.

## State at handoff

- `main` @ `89e81b7`, redesign merged (origin/redesign is an ancestor of main).
  Local checkout on the PC has uncommitted edits to `CLAUDE.md`, `README.md`,
  `.gitignore` and a skill file that are **not** part of this work; this plan
  does not touch those files.
- `CLAUDE.md` already names GitHub Issues as the tracker
  (`docs/agents/issue-tracker.md`) with five triage labels
  (`docs/agents/triage-labels.md`). No `.github/` existed before this.
- The repo is public. Everything in an issue is world-readable.
- `docs/improvement-backlog.md` is the other place findings live. Since it was
  written, these items shipped or were settled: §0.1, §0.2, §0.3 (was already
  fixed by `20260912222851`), §0.4 (`deleteIdea`), §0.6 (confirmation stays
  on), §1.1 + §1.3 (`8a02b91`), §4 search (`b491a07`), §5 CAD split
  (postponed, `3d3941c`).

## Decisions (2026-09-19)

1. **GitHub Issues is the source of truth.** Trello keeps only cards actively
   being worked, made by hand. The backlog doc becomes issues (Phase E).
2. **Friends report from inside the app**, not only Brian and Daniel. So the
   path is table → webhook → edge function → issue, not a prefilled
   new-issue URL: friends have no GitHub account and the report must survive
   GitHub being down.
3. **The repo stays public.** Consequences: the issue carries the reporter's
   display name (never email or user id) and the screenshot's storage path
   (never the picture or a signed URL); both forms say so in one line.
4. **The row is the report as sent.** Client-chosen `id`; screenshot uploaded
   first, row inserted with `screenshot_path` set; no client UPDATE. Same
   trick iOS capture uses for ideas. Nothing is editable, nothing can be
   unsent.
5. **Reporter sees "sent, #N" and nothing more.** Status, comments and
   closure live on GitHub. Sync back is deferred until a friend asks.
6. **No offline outbox, no rate limit, no anonymous path.** Ten trusted
   people. The no-cap note in `CLAUDE.md` extends to reports.
7. **Web entry: a footer line on every page** ("report a problem · <commit>"),
   not a nav tab. **iOS entry: the ideas-list toolbar.**

## Phase B — server (built 2026-09-19, Cowork)

Files, all new except the two-line `config.toml` addition:

- `supabase/migrations/20260919160000_feedback.sql` — `feedback` table (insert
  own, read own, curators read all; UPDATE/DELETE revoked), private bucket
  `feedback-media` (write/delete under own prefix, read own or curator).
- `supabase/functions/report/index.ts` — the function. Same shape as
  `extract`: `x-webhook-secret`, 202 then `EdgeRuntime.waitUntil`, direct
  call with `{ "feedback_id": "<uuid>" }` for retries. Idempotent: a row with
  `github_issue_number` set is skipped. Writes `github_error` on failure.
- `supabase/functions/_shared/report.ts` — routing and the issue body, pure.
- `supabase/functions/_shared/github.ts` — one `fetch` to create an issue.
- `supabase/functions/_shared/secret.ts` — `authorized()` lifted from
  `extract/index.ts` verbatim; extract can import it when next touched.
- `supabase/functions/_shared/report_test.ts` — 13 tests: routing (insert
  files, retry files, updates/other tables/junk ignored), labels, title
  trim/cap, body context, no user id or email in the body, screenshot by path
  only, table-cell escaping, GitHub call headers/body/error/repo guard.
- `supabase/config.toml` — `[functions.report] verify_jwt = false`.

Verified in the Cowork sandbox with `jsr:` mapped to local shims (jsr.io is
unreachable there): `deno test` 18/18 (13 new + the 5 webhook tests),
`deno check` and `deno lint` clean on all new files; the migration parses
(`pglast`). **Not yet run against a database or GitHub** — that is Phase A's
verify step.

## Phase A — GitHub side and deploy (you, ~15 min)

Labels (`gh` on your machine; `api.github.com` is blocked from Cowork):

```
gh label list --limit 50
gh label create bug         --color d73a4a --description "Something did the wrong thing"
gh label create improvement --color a2eeef --description "Something could be better"
# create any of the five that are missing:
gh label create needs-triage    --color e4e669 --description "Maintainer needs to evaluate this issue"
gh label create needs-info      --color d876e3 --description "Waiting on reporter for more information"
gh label create ready-for-agent --color 0e8a16 --description "Fully specified, ready for an AFK agent"
gh label create ready-for-human --color 1d76db --description "Requires human implementation"
gh label create wontfix         --color ffffff --description "Will not be actioned"
```

Token: GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained → repository access **only `clouded-ios`** → permissions
**Issues: Read and write** (Metadata: read comes with it) → expiry 1 year →
put the expiry in Google Calendar. Then:

```
supabase secrets set GITHUB_TOKEN=github_pat_…
supabase db push                       # 20260919160000_feedback.sql
supabase functions deploy report
```

Webhook: Dashboard → Database → Webhooks → Create: table `feedback`, event
**Insert** only, type Supabase Edge Function → `report`, HTTP header
`x-webhook-secret: <the existing WEBHOOK_SECRET>`, timeout 5000 ms.

Verify (Phase A done-check):

1. SQL editor: `insert into feedback (user_id, kind, surface, title, body)
   values ('<your uuid>', 'bug', 'web', 'webhook test', 'ignore me');` →
   an issue appears within seconds, labelled `needs-triage` + `bug`, body
   shows your display name and no email; the row has
   `github_issue_number`. Close the issue.
2. `supabase secrets set GITHUB_TOKEN=wrong`, insert again → row gets
   `github_error` starting `github 401`. Set the real token back, then
   `curl -X POST "$SUPABASE_URL/functions/v1/report" -H "x-webhook-secret: $WEBHOOK_SECRET" -H "content-type: application/json" -d '{"feedback_id":"<that id>"}'`
   → issue filed, `github_error` cleared.
3. Templates: push `.github/ISSUE_TEMPLATE/` to `main`, open New issue on
   GitHub → two forms, no blank issue.

## Phase C — web (Claude Code, PC or Mac)

- `web/build.mjs`: also emit
  `export const COMMIT = "<VERCEL_GIT_COMMIT_SHA first 7, or 'dev'>";`
  into `config.js`. `config.js` is hand-written locally, so read it with
  `import * as config from "./config.js"` and `config.COMMIT ?? "dev"` —
  a named import of a missing export fails at link time.
- `web/lib/db.js`, three functions in the writes section:
  - `uploadFeedbackShot(userId, id, file)` → uploads to
    `feedback-media/<userId>/<id>.<ext>` (`ext` from the file's MIME:
    jpg/png/webp), returns the path. Re-encode to JPEG at longest side 2048
    the way capture does only if that helper already exists on the web;
    otherwise send the file as picked (bucket cap is 10 MiB).
  - `addFeedback(row)` → `insert(row).select("id").single()`; `row` carries
    the client-chosen `id` (`crypto.randomUUID()`), `kind`, `surface: "web"`,
    `title`, `body`, `route`, `app_version`, `device`, `screenshot_path`.
    On insert failure after an upload, remove the object.
  - `myFeedback()` → `select("id, kind, title, github_issue_number,
    github_error, created_at").order("created_at", { ascending: false })`.
- `web/app.js`:
  - route `report` at `#/report`; `reportView()`: bug/improvement toggle,
    title (`maxlength=120`), text (`maxlength=4000`), optional image input,
    one muted line: *"Filed on GitHub as an issue under your display name —
    the tracker is public, so keep private idea text out. The screenshot
    stays private."* Send button disabled while busy.
  - prefill: `route` = the hash the user came from (the footer link stores
    `location.hash` in `state.reportFrom` before navigating), `app_version`
    = `COMMIT`, `device` = `navigator.userAgent`.
  - after send: poll `myFeedback()` every 2 s for up to 10 s; show
    "Sent — #N" when the number lands, "Sent — filing…" until then,
    "Sent — filing failed, it's saved and will be retried" if
    `github_error` shows up. Reset the form.
  - below the form: "Your reports" — title, date, `#N` (plain text, no link:
    the repo may go private later and friends see the number either way).
  - footer on every route except `waifu`: `report a problem · <commit>`,
    muted, same view-transition treatment as the header. Not a nav tab.
- Manual checklist (Vercel preview): send a bug with a screenshot → issue
  appears, screenshot line shows the path, object exists in the bucket;
  send an improvement without one → no screenshot line; refresh `#/report`
  → both listed with numbers; a second account cannot read the first's rows
  or objects (`acceptance.mjs rls` gains this check if it is cheap to add).

## Phase D — iOS (Claude Code, Mac)

- `ios/clouded/ReportView.swift`: a sheet from the ideas-list toolbar
  (`HomeView.swift` — a third `ToolbarItem`, or fold into the existing
  primary action as a `Menu`; read the file and pick the one that keeps the
  bar to two items). Same fields as web; `PhotosPicker` for the screenshot,
  re-encoded to JPEG longest side 2048 with the capture code path; direct
  upload (no `Uploader` spool — reports need network, see decision 6).
- `surface: "ios"`, `route`: `"ideas"` or `"idea/<id>"` depending on where
  the sheet opened, `app_version`: `CFBundleShortVersionString (CFBundleVersion)`,
  `device`: `UIDevice.current.model + " " + systemVersion`.
- Order: upload → insert with `screenshot_path` → dismiss with "Sent". No
  "your reports" list on the phone in v1.
- Share Extension gets nothing; a bug found there is reported from the app.

## Phase E — migrate the backlog, document, delete the dead sync

Needs its own "proceed" (mass operation: ~24 issues) — **given 2026-09-19.** The
runnable copy is `docs/feedback-migrate.sh` (`bash docs/feedback-migrate.sh`
from the repo root with `gh` signed in; creates the labels too, skips titles
that already exist; delete the file afterwards). What it does:

```
B="docs/improvement-backlog.md"
mk() { gh issue create --label improvement --label needs-triage --title "$1" --body "$2

See \`$B\` §$3 for the reasoning."; }
mk "Name the invite() allowlist hole in CLAUDE.md" "Any group creator can allowlist any email. Trust-based by design; record it next to the no-cost-cap note." "0.5"
mk "\"I built this\": ideas.built_at, offer to set its capabilities solid" "Marking an idea built is the honest profile source and the list's missing end state. Confirm per capability." "1.2"
mk "Idea lifecycle: dropped_at with a reason; default the list to live ideas" "Built/dropped behind a toggle before the list reaches 80." "2"
mk "Near-duplicate detection at capture (pg_trgm + capability overlap)" "Surface \"looks like #N\" on the idea page with a merge button. No embeddings needed for the first version." "2"
mk "App Intent + Shortcut for capture" "Gives Action Button, Siri, lock-screen widget and Shortcuts in one go; the README's promised capture, cheaply." "3.1"
mk "Local outbox for the idea row (offline capture)" "Same spool pattern Uploader uses; client-chosen id makes retries idempotent. The README names this exact failure as the worst one." "3.2"
mk "Control Center / lock-screen capture widget" "A button, not a screen. After the App Intent exists." "3.3"
mk "Share-sheet action keeps the source URL and page title" "source_url exists and the extension already has both." "3.4"
mk "Replace the 2-second poll with Supabase Realtime on extraction_runs" "Removes ~60 round-trips per capture and WATCH_WINDOW_MS guesswork." "4"
mk "Scope the capabilities query to the ideas being shown" "Unbounded query today, on every list load and again on the Group tab." "4"
mk "Empty-profile cold start: rate the skills your own ideas need" "Beats a 51-row form; with zero ratings every idea is all-gaps and the sort is meaningless." "4"
mk "Mobile web layout for the Group tab and profile grid" "Mobile web is the phone's sharing UI today." "4"
mk "Batch the vague-bucket answers on one screen" "Three vague entries are three round-trips through a form today." "4"
mk "Assumption visibility: extraction emits assumption separately, UI renders it correctable" "Prompt + schema change, so it re-baselines; bundle with the parked strict:true change." "4"
mk "Held-out ideas test: 10 ideas from outside the backlog" "A low proposed rate on your own ideas proves nothing; needs a friend's ideas." "5"
mk "Crux stability: ship ranked top-2 or soften \"the hard part\"" "Committed at 16/19 same-prompt; the definite article is not yet earned." "5"
mk "Per-capability \"tutorial vs iteration\" flag" "Makes distance mean size without printing a time estimate; a checkable property of the capability." "5"
mk "Claims: \"I can do the hard part\" on a shared idea" "One row (idea_claims); doubles as the honest profile signal and the smallest version of comments." "6"
mk "Group leverage over the union of the group's skills" "Same leverage() with a different held map. Step 8 decision 11." "6"
mk "Weekly email digest as the notification path" "One scheduled function, no push infrastructure; the prerequisite for comments." "6"
mk "Waifu view reacts to the extraction result" "The crux read back in one line at the moment the person is actually looking." "7"
mk "Waifu view: band-aware line for the vague bucket" "Makes the clarifying question feel like conversation instead of a form." "7"
mk "Ventures as an idea type (deferred 2026-09-16)" "ideas.kind = build | venture, gates, business-domain skills. Parked by decision; draft PRD in the Cowork project." "8"
mk "Stopgap: a named venture never triggers a build-artifact clarifying question" "Prompt rule 2 tweak; re-baselines. Cheap while §8 stays parked." "8"
```

Then:

- Add to the top of `docs/improvement-backlog.md`: *"Migrated to GitHub Issues
  #a–#z on <date>; this file stays as the reasoning behind them. Items 0.1,
  0.2, 0.3, 0.4, 0.6, 1.1, 1.3, §4 search and the §5 CAD split were already
  done or settled and were not filed."*
- `CLAUDE.md`, under *Agent skills → Issue tracker* (the PC copy has
  uncommitted edits; add this by hand or after those are committed):

  > **Feedback.** Bug and improvement reports from the app land in
  > `feedback` (own rows; curators read all) and are filed to GitHub Issues
  > by the `report` edge function — webhook on INSERT, `x-webhook-secret`,
  > `GITHUB_TOKEN` a fine-grained PAT scoped to this repo with Issues
  > read/write. The row is the record, the issue is the copy; retry with a
  > direct POST of `{feedback_id}`. The repo is public, so the issue carries
  > the display name and a screenshot *path* only. No per-user cap, same
  > trust basis as the no-cost-cap note. Plan: `docs/feedback-plan.md`.

- README *Views* section, one sentence: *"Every page has a report link;
  reports become GitHub issues (`docs/feedback-plan.md`)."*
- Cowork side: the nightly GitHub→Trello scheduled task was deleted
  2026-09-19 (it never could read the repo from the cloud). Its state card
  "[auto] Board sync state — do not delete" in the board's Reference list
  is now orphaned; archive it by hand.

## Done-check

1. A bug from web with a screenshot → issue with path line, object in
   bucket, `#N` shown in the app.
2. An improvement from iOS → issue, no screenshot line.
3. Wrong token → row kept with `github_error`; retry files it.
4. `/triage` (mattpocock-skills) runs over the open issues unchanged.
5. One list: backlog migrated, doc header added, Trello holds only active
   cards.
