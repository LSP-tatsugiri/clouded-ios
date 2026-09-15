# Handoff — PC session, 2026-09-15

For a fresh Claude Code session on the **Windows PC**, working on `main`.
Read `CLAUDE.md` first (invariants, working rules, the two-machine rules).
Then this file. Then nothing else until the task needs it.

## Where things stand

- **Step 5 (web list view) is closed.** `docs/step-5-plan.md` records every
  phase and what was verified. The list watches a new idea on its own row
  until extraction lands (indeterminate bar, stage text, no percentages).
- **The web client is live at https://clouded.monoesport.com** on Vercel,
  deploying on every push to `main`. `docs/hosting.md` has the decisions,
  the setup that was done, and day-to-day operations. Verified live: DNS,
  HTTPS, every file served, sign-in, an uninvited sign-up refused,
  `acceptance.mjs rls` 22/22.
- **Sign-up is self-serve behind an email allowlist** (migration
  `20260915033902`, trigger on `auth.users`). Invite a friend with
  `node --env-file=supabase/.env supabase/scripts/allow.mjs <email>`.
  No friend has been invited yet.
- **Step 6 (iOS capture) is being built on the Mac**, branch `step-6`, from
  `docs/step-6-plan.md`. Its pushed commits show Phases A and B done
  (Phase A: `ideas.source_url`, private `idea-media` bucket, image on the
  web idea page; Phase B: Xcode scaffold, sign-in, Share Extension reads
  the session). Phases C–E remain. **Do not touch `ios/`, and do not edit
  the web idea page's media rendering — that is the Mac's.**
- Both migrations from both branches are applied on the hosted database:
  `20260915033902_allowed_emails` (main) and
  `20260915034222_media_and_source` (step-6). This checkout lacks the
  step-6 file until the branch merges; `supabase migration list` shows it
  as remote-only, which is expected.

## The next task on this machine: Step 7

**Sharing and the friend skill pool.** The pieces exist underneath —
`groups`, `group_members`, `ideas.shared_to`, RLS verified 22/22, a share
select on the idea page — but there is no UI to create a group or add a
member, so nobody can actually share anything yet. Step 7 is, roughly:

1. Group creation and membership UI (inviting by email sits naturally on the
   allowlist that already exists — think about whether an invite should
   both allowlist and add to the group).
2. "A friend can unblock this": the list filter and row marker that Step 5
   Phase C left as a placeholder ("waits for Step 7").
3. The friend skill pool feeding the leverage ranking.

**Start with a grilling session** (`mattpocock-skills:grilling`), the way
Steps 5 and 6 were started, and write `docs/step-7-plan.md` in the same
shape as `docs/step-6-plan.md` (state at handoff, decisions with reasons,
phases with verification, not-in-this-step). Commit and push the plan
before building. Known open questions to put to the owner: whether groups
are one-per-friend-circle or many; whether a friend's profile is visible to
the whole group or per idea; what "can unblock" means precisely (a friend
holds the crux solid? any gap?); whether the group feed (deferred after
v1 in the README) comes into scope now that the URL is live.

## Rules that bit us, in one place

- **Say the API cost before spending it** (`CLAUDE.md`). Adding an idea or
  re-running extraction is ~1¢ each; say the count.
- **Migrations: commit and push the file in the same step as
  `supabase db push`.** Applying first and committing later blocks the
  other machine's CLI. The owner runs `supabase db push`, `login` and
  `functions deploy` in a real terminal; the agent dry-runs.
- **Pushing to `main` deploys the live site.** Push finished, verified
  work; the Stop hook reports unpushed commits but never pushes.
- **Pull before touching shared state.** The UserPromptSubmit hook says
  what the Mac pushed; act on it.
- **Never keys in a tracked file.** `supabase/.env` and `web/config.js`
  are gitignored; `web/build.mjs` generates config on the host.
- **Every file edit here is gated by a fact-forcing hook** (ECC GateGuard):
  state importers, affected functions, data shape and the user's verbatim
  instruction before the first edit of each file, and the request plus what
  the command produces before the first Bash command. Just answer it.
- The browser for live checks is **Browser 2 (Windows)**; the dev server
  may already be running on `:5173` from another session (EADDRINUSE means
  use it, not start another).

## Small things left open

- The owner is on voice input; short confirmations like "ok" or a single
  word are answers to the last question asked, not new instructions.

Closed before this handoff was picked up: the two test ideas are deleted
(23 ideas remain), `Claude outputs/` is tracked, and the Mac has pushed
its merge of `main` into `step-6` (`39c3972`).

## First prompt to give the new session

> Read CLAUDE.md and docs/handoff-2026-09-15-pc.md. Then start the
> grilling session for Step 7 (sharing and the friend skill pool).
