# Handoff — speech-to-text capture, 2026-09-25

For a fresh Claude Code session on the **PC** (web work). Read `CLAUDE.md`
first — especially **agent work goes to `agent/<topic>` branches, never
`main`**, enforced by `.claude/hooks/guard-main.mjs`. Then this file. It
records where the project stands, the one decision waiting on the owner, and
what was learned from reading the code.

## Where things stand

- **`main` @ `222f0cf`**, pushed and deployed. `clouded.monoesport.com` serves
  that commit; `config.js` on the host carries it, and the footer prints it.
- **The feedback feature is live and verified end to end** (2026-09-19). A row
  inserted into `feedback` becomes a GitHub issue in about two seconds, via a
  trigger on the table calling the `report` edge function. Verified: issue #3
  filed by the webhook alone; issue #2 filed by a direct retry after a
  deliberate bad token left `github_error` on the row instead of losing it.
  Both closed. The plan is `docs/feedback-plan.md`; the prior handoff is
  `docs/handoff-2026-09-19-feedback.md`.
- **Phases A, B and C are done.** **Phase D (iOS) is dropped for now** — the
  owner said so on 2026-09-25. It stays specified in the plan if it ever comes
  back. **Phase E has not run** (see Loose ends).
- **Three landing/auth changes shipped** before the feedback work: a wrapping
  capture box, share buttons instead of a checkbox, a clearer sign-in card, a
  landing top bar, and the sign-in card as a `<dialog>`.
- **Three `agent/` branches on origin are fully merged** and can be deleted:
  `agent/feedback`, `agent/review-branch-rule`, `agent/signin-dialog`.

## The next piece of work: speech-to-text capture on the web

Proposed 2026-09-25 and agreed as the next feature. It serves **capture**, the
project's stated primary blocker, so it ranks high by the backlog's own
ordering rule. It is self-contained in `web/`: no schema change, no migration,
no edge function, **no Anthropic credit**.

### The open decision — the owner's, do not pick for them

The browser's built-in `SpeechRecognition` (`webkitSpeechRecognition` in
Chrome, Edge and Safari; **Firefox does not support it**) sends the captured
audio to the browser vendor's servers to transcribe. The invariant says *ideas
are private by default*, so dictating an idea quietly breaking that is a
product decision, not a detail. Three ways out, presented to the owner on
2026-09-25, **not yet chosen**:

1. **Accept it**, and say so in one line beside the microphone button — the
   same way the capture box already states the extraction cost.
2. **Use a paid transcription API** instead. Keeps audio away from the browser
   vendor, adds a per-use cost to the owner's key and a server round trip.
   Argues against the no-cost-cap note in `CLAUDE.md`.
3. **Narrower support**, skipping the vendor engine entirely.

**Ask before building.** If the owner picks (1), the work is roughly forty
lines and half an hour.

### Where it goes

Five text inputs exist in the web client. Only the first is clearly worth it:

| What | Where |
|---|---|
| **New idea (the capture box)** — the target | `web/app.js:545`, inside the `add` form at ~`:530` |
| Hidden `#/waifu` capture scene | `web/app.js:1112` — natural second, same helper |
| Inline clarification answer (list) | `web/app.js:418` |
| Clarification answer (idea page) | `web/app.js:1418` |
| Report form body | `web/app.js:1687` |

### Notes from reading the code

- The capture box is a `<textarea>` that grows with its text via `grow()`
  (`web/app.js:247`); Enter sends, Shift+Enter breaks the line. Dictated text
  must go through the same path — set `.value`, then call `grow(input)` — or
  the box will not resize.
- `.capture` is a flex row (`web/style.css:317`) with the textarea, the Add
  button and the cost line. A mic button is a fourth child; keep it clear of
  the `.cost` span, which is `align-self: flex-start` at button height.
- **`render()` repaints the whole view**, and `watch()` triggers a repaint
  every 2 s while any idea is extracting. The report form solves this by
  keeping its draft in `state.draft` (`reportView`, `web/app.js:1652`). A
  dictation buffer needs the same treatment or a repaint will wipe it
  mid-sentence. This bit once already.
- Recognition needs HTTPS. The live site qualifies; `localhost` is exempt, so
  `node web/serve.mjs 8080` is fine for development.
- Permission is a browser microphone prompt on first use. It must not fire on
  page load — only on the button.
- `reduceMotion()` exists for animation; there is no equivalent "prefers no
  microphone", so the button must be opt-in per use, never auto-start.

## Loose ends, none of them blocking

1. **Phase E never ran.** Findings now land in two places that do not sync:
   the in-app form files GitHub issues, while `docs/improvement-backlog.md` is
   still a document. That is the same trap `CLAUDE.md` flags for proposed
   skills. `docs/feedback-migrate.sh` is written and waiting; **the owner runs
   it** in a shell where `gh` is signed in. Afterwards: the superseded header
   on the backlog, the `CLAUDE.md` paragraph and the README sentence (texts are
   in `docs/feedback-plan.md`), then delete the migrate script.
2. **The Deno suite is red on `main`:** 34 pass, 1 fails — *"prompt hash
   reproduces the committed baseline"*, `supabase/functions/_shared/prompt_test.ts:20`.
   Expected and documented (promoting `ui-mockup` changed the skill list and so
   the hash), but a build that is already red hides the next real failure.
   Re-baselining costs about $0.30 of API credit; **say the cost before
   spending it**. Decide on purpose or not at all.
3. **Issue #4 is open** — the test report titled "123", sent from the owner's
   localhost review. Safe to close.
4. **The landing scrolls sideways at phone width.** At a 381 px viewport the
   document is 430 px wide; the overflow is the "How it works" capture
   fragment, `.land-frag.land-capture` inside `.land-steps li.card`
   (`web/style.css`). Pre-existing, not caused by the dialog work. It matters
   more once dictation ships, because dictation earns its keep on a phone —
   worth folding into the same branch.

## Decided, do not reopen without the owner

- **Agent work goes to `agent/<topic>`; the owner merges and pushes `main`.**
  The push hook refuses it, by design. Hand over the compare link:
  `https://github.com/LSP-tatsugiri/clouded-ios/compare/main...agent/<topic>`.
- `gh` is signed in on the PC as `LSP-tatsugiri`, so `gh pr create` works now.
- iOS feedback (Phase D) is dropped for now.
- No client UPDATE or DELETE on `feedback`; the row is the report as sent.
- No status sync back into the app, no notifications, no offline outbox, no
  per-user cost cap.
- `GITHUB_TOKEN` is a fine-grained PAT, this repo only, Issues read/write,
  1-year expiry. Never in any tracked file.

## Environment notes

- **The `!` prefix only works typed into the Claude Code prompt**, not in a
  separate PowerShell window, and those commands are Bash. Pasting one into
  PowerShell fails on `!` and `&&`. This cost two rounds on 2026-09-19.
- The dashboard's webhook UI did not save the hook; the trigger was created
  instead by `supabase/scripts/report-webhook.mjs`, which reads the secret from
  the gitignored `.env` and drops a temporary SQL file. Safe to re-run.
- `supabase db query` needs `--linked` on this machine — without it the CLI
  tries a local database, and there is no Docker on either machine.
- Owner-only, in a real terminal: `supabase login`, `db push`,
  `functions deploy`, and any push to `main`. Read-only CLI calls
  (`migration list`, `secrets list`, `functions list`, `db push --dry-run`)
  work from the agent.
