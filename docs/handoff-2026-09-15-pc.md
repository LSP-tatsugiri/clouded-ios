# Handoff — PC session, 2026-09-15 (evening)

For a fresh Claude Code session on the **Windows PC**, working on `main`.
Read `CLAUDE.md` first (invariants, working rules, the two-machine rules).
Then this file. Then only the plan the task needs. This replaces the
morning's handoff; git has the old one.

## Where things stand

- **Steps 1–7 are done and merged.** The Mac closed Step 6 (iOS capture)
  and merged `step-6` into `main`; the PC closed Step 7 (sharing, invites,
  profiles, the friend skill pool, the Group tab with the feed). Both plans
  record every decision and what each phase verified. `acceptance.mjs rls`
  is 45/45 (~$0, no ideas inserted).
- **The web client is live at https://clouded.monoesport.com**, deploying
  on every push to `main`. Both machines push to `main` now; the Mac keeps
  pushing small iOS commits, so **pull before every push** (`git pull
  --rebase origin main` when the push is rejected).
- **The waifu view is live and unlisted**: `clouded.monoesport.com/#/waifu`.
  `docs/waifu-view-plan.md` is the record — the reduced v1 (she asks, you
  answer, she acknowledges; no read-back, no voice, no name), the comic-cloud
  bubble from the owner's reference, Yusei Magic at 23 px with auto-fit,
  and the dev tools: `#/waifu?place=1` (drag the bubble, size slider, copies
  the CSS), `?band=dusk`, `?font=<key>`. Decisions 11–13 there are the
  latest. The bubble sits at `31.3% / 14.4%`, placed by the owner.
- **Assets**: `web/assets/scene.mp4` (the one 5 s loop, 2.95 MB) and
  `scene.jpg` (poster). The 4 MB source still is in `Claude outputs/`.
  `ffmpeg 9` is installed via winget; in a fresh shell it is on PATH, in
  this harness's shell use the full path under
  `~/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg*/…/bin`.
- **No friend has been invited yet.** The database holds a demo: the test
  user's group "test's friends", the throwaway member "Alex"
  (`phaseb-friend@clouded.test`, holds `print-tolerancing` and
  `parametric-cad` solid) and one idea shared to the group. Delete Alex
  from the Group tab once a real friend is in; the admin API deletes the
  account.

## What is next (pick with the owner)

1. **Waifu view, deferred list**, in the order the plan gives: her
   read-back of crux and split (through `cruxOf`/`distanceOf`, never
   re-derived); her reacting to the clarifying question; the share line;
   knowing your name; the voice; the nav link; per-band videos (the owner
   makes them; the band logic is already there — `data-tod` selects). Start
   with a short grilling, as before; the plan's "Deferred" list is the
   agenda.
2. **The first real friend**: invite from the Group tab, watch the sign-up
   land, share one idea each way. Before that, decide **email
   confirmation**: `/auth/v1/settings` reports `mailer_autoconfirm: false`,
   so a sign-up sends a confirmation email through the rate-limited built-in
   mailer, while `web/lib/db.js` claims confirmation is off. Turn autoconfirm
   on in the dashboard (Authentication → Providers → Email) or invite a few
   at a time. Step 7 plan, Phase E, has the note.
3. **Comments** are the first post-v1 product feature, gated on a
   notification path. Not started; needs its own grilling.

## Rules that bit us, in one place

- **Say the API cost before spending it** (`CLAUDE.md`). Adding an idea is
  ~1¢; the harness commands `rls` and `list` are free.
- **Pull before touching shared state; push finished work.** The Mac and
  the PC both commit to `main` now. A rejected push means rebase, not force.
- **Pushing to `main` deploys the live site.** Docs-only commits deploy
  nothing visible; `web/` commits are live in about a minute.
- **The harness's Bash cannot take a heredoc containing an apostrophe**
  (`unexpected EOF while looking for matching '`). Write files with the
  Write tool, edit with Edit; use `printf '%s\n' … > "$TEMP/msg.txt"` and
  `git commit -F` for commit messages. Node one-liners work; Python is not
  installed.
- **Every first edit of a file is gated by a fact-forcing hook** (GateGuard):
  state importers, affected functions, data shape, and the user's verbatim
  instruction, then retry. Same for the first Bash command and anything it
  calls destructive. Just answer it.
- **The automation browser could not decode any mp4** on 2026-09-15 (a
  known-good public file also stuck at `readyState 0`). Verify video by
  `ffprobe` and by asking the owner; the poster still renders. `serve.mjs`
  serves `.mp4`/`.jpg` with Range support, so it is not the server.
- **A same-hash navigation does not reload the SPA**; press F5. After a
  Sign-out the browser keeps the test user's password in autofill — use
  it rather than typing the password into the transcript.
- **`web/build.mjs` copies `distance.js` for the host** and Vercel's output
  directory is `web`, so anything under `web/` ships as-is, `assets/`
  included. Keep the byte budgets in the waifu plan.
- Percentage `padding` on an absolutely positioned child resolves against
  its containing block's width (the scene), not its own; inset it instead.
- The owner is on voice input: short replies like "ok" or a single word
  answer the last question asked, not a new instruction. Numbers pasted
  from the `?place=1` readout are CSS to apply verbatim.

## First prompt to give the new session

> Read CLAUDE.md and docs/handoff-2026-09-15-pc.md. Then start a grilling
> session for the waifu view's next version, from the "Deferred" list in
> docs/waifu-view-plan.md.
