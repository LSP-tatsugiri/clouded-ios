# Handoff — feedback reporting, 2026-09-19

For a fresh Claude Code session on the **PC** (server + web) and later the
**Mac** (iOS). Read `CLAUDE.md` first — especially the rule added today:
**agent work goes to `agent/<topic>` branches, never `main`**, and
`.claude/hooks/guard-main.mjs` refuses a push to `main`. Then this file.
Then `docs/feedback-plan.md`, which is the spec — this file says where
things stand and in what order to take it.

## Where things stand

- **Branch `agent/feedback`**, pushed, one commit ahead of `main`:
  `273f3d8 Feedback: report edge function, feedback table, issue templates
  (Phase B)`. Compare link:
  https://github.com/LSP-tatsugiri/clouded-ios/compare/main...agent/feedback
  Not merged. The owner merges.
- **Uncommitted on that branch right now:** an 11-line edit to
  `docs/feedback-plan.md` (Phase E now points at the migrate script and
  records the Trello task deletion), plus two new files,
  `docs/feedback-migrate.sh` and this handoff. First commit of the next
  session picks those up.
- **Decided and signed off (Cowork, 2026-09-19):** bugs and improvements
  are reported from inside the app by anyone signed in, land in a
  `feedback` table, and are filed as **GitHub Issues** — the source of truth
  — by a `report` edge function. The repo stays public, so an issue carries
  the reporter's display name and a screenshot *path* only, never an email,
  user id, picture or signed URL. Trello keeps only cards actively being
  worked. Full list: `docs/feedback-plan.md` §Decisions.
- **What `273f3d8` holds:** `supabase/migrations/20260919160000_feedback.sql`,
  `supabase/functions/report/index.ts`,
  `supabase/functions/_shared/{report,github,secret}.ts` +
  `report_test.ts` (13 tests), `[functions.report] verify_jwt = false` in
  `supabase/config.toml`, `.github/ISSUE_TEMPLATE/{bug,improvement,config}.yml`,
  `docs/feedback-plan.md`.
- **Verified so far:** `deno test` 18/18 (13 new + the 5 in
  `webhook_test.ts`), `deno check` and `deno lint` clean on every new file,
  migration parses — all in the Cowork sandbox with `jsr:` imports mapped to
  local shims, because `jsr.io` is unreachable there. **Nothing has touched
  a real database or GitHub yet.** Re-run the tests here for real before
  anything else.
- **Phase A (labels, token, push, deploy, webhook) is the owner's** and may
  or may not have happened — check, don't assume: `gh label list`,
  `supabase secrets list` (names only), `supabase migration list`,
  `supabase functions list`. The migration is committed on the branch, so
  the "commit and push the migration in the same step as `db push`" rule
  is satisfied once the branch is pushed (it is); the owner merges before
  the Mac pulls.
- The **redesign is merged** into `main`; the `redesign` branch can go.
  Web work builds on top of `main` via this branch.
- **Backlog items already shipped** since `docs/improvement-backlog.md` was
  written: §0.1, §0.2, §0.3 (fixed earlier by `20260912222851`), §0.4, §0.6
  (decision), §1.1 + §1.3 (`8a02b91`), §4 search (`b491a07`); §5 CAD split
  postponed (`3d3941c`). `docs/feedback-migrate.sh` already excludes them.
- The nightly "Clouded — nightly Trello board sync" scheduled task was
  **deleted** 2026-09-19: cloud sessions get GitHub API access only for
  repos attached with credentials, which that task never had, so it stopped
  at "cannot read the repo" every night. Its state card "[auto] Board sync
  state — do not delete" in the board's Reference list is orphaned; the
  owner archives it.
- Cowork's Linux view of this checkout reports most files modified —
  CRLF only. On Windows `git status` shows the real set. Two stale
  `.git/*.lock` files that view left behind were removed.

## Order of work

1. **Re-verify Phase B here.** `deno test --allow-read --allow-env
   supabase/functions/_shared/` and `deno check
   supabase/functions/report/index.ts` (Deno via `npm i -g deno` if
   missing). `report/index.ts` mirrors `extract/index.ts` on purpose; if
   anything drifted, fix the new one. Commit the uncommitted docs on
   `agent/feedback` and push the branch.
2. **Phase A with the owner present.** Run what the CLI login allows
   (`gh label`, `supabase db push`, `supabase functions deploy report`);
   the fine-grained PAT and the dashboard webhook on `feedback` INSERT are
   the owner's hands. Then the three verify steps in the plan (SQL-editor
   insert → issue; wrong token → `github_error`; direct POST with
   `feedback_id` → filed). Do not skip the wrong-token test: it is the
   "no report lost" criterion. Note `db push` applies to the shared
   database whether or not the branch is merged; merge first if the Mac
   is about to pull.
3. **Phase C — web** (`docs/feedback-plan.md` §Phase C), on this branch.
   Notes from a read of `main` today:
   - `header()` is `web/app.js:122`; the nav holds four tabs and Sign out.
     There is **no footer element** anywhere yet — add one in the page
     builder, skipped when `state.route === "waifu"` (same guard the header
     uses). Every redesigned default is scoped with
     `:where(#app > :not(.waifu))`; keep the footer inside that.
   - Routes are hash paths through `hashPath()` (`app.js:75`); `#/report`
     is one more case, plus `ROUTE_ORDER` if the page slide should have a
     position for it (last).
   - `web/lib/db.js` is the only Supabase surface; add the three functions
     next to `deleteIdea` and keep the `ok()` shape. Upload first, insert
     second, remove the object if the insert fails.
   - `config.js` is hand-written locally and generated by `build.mjs` on
     Vercel, so `COMMIT` must be read through a namespace import.
   - `watch()` re-renders every 2 s while an idea extracts (known). The
     report form does not poll `runsFor`, but confirm typing in `#/report`
     survives a pending idea elsewhere; if not, it is the input-preservation
     issue the redesign handoff lists, not something to fix here.
   - Manual checklist is in the plan. Zero API cost: nothing here calls
     Anthropic.
4. **Phase D — iOS, on the Mac** (`docs/feedback-plan.md` §Phase D), same
   branch after the Mac pulls it. `HomeView.swift` toolbar has Sign out
   (`cancellationAction`) and one `primaryAction`; the sheet's entry goes
   there. Re-encode the screenshot with the capture code path; direct
   upload, no `Uploader` spool.
5. **Phase E.** The owner runs `bash docs/feedback-migrate.sh` (creates the
   labels too, skips titles that already exist). Then: the superseded
   header on `docs/improvement-backlog.md`, the `CLAUDE.md` paragraph and
   the README sentence — both texts are in the plan doc — and delete
   `docs/feedback-migrate.sh`. `/triage` should run over the result
   unchanged; if it trips on anything, that is a finding, not a reason to
   change the labels.

## Decided, do not reopen without the owner

- No client UPDATE or DELETE on `feedback`; the row is the report as sent.
- No status sync back to the app, no notifications, no offline outbox, no
  per-user cap, no Trello sync of any kind.
- Reporter sees "Sent — #N" (polled from `myFeedback()`), plain text, no
  link to the issue.
- `GITHUB_TOKEN` is a fine-grained PAT scoped to this one repo, Issues
  read/write, 1-year expiry. Never in `web/config.js`, `Config.xcconfig`,
  or any tracked file.

## Environment notes

- `api.github.com` is reachable from a Cowork/cloud session only for repos
  attached with credentials; this repo is not, so anything needing the
  GitHub API runs here with `gh`, not there. `raw.githubusercontent.com`
  works everywhere for public files.
- Dev server: `node web/serve.mjs` (port 5173); sign in as the test user
  (`TEST_USER_EMAIL` / `TEST_USER_PASSWORD` in gitignored `supabase/.env`).
- Both machines share the repo and the database; pull before touching
  shared state, push the branch when a task is committed.
