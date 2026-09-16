# Handoff — web redesign shipped, 2026-09-16

For a fresh Claude Code session on either machine, working on `main`.
Read `CLAUDE.md` first (invariants, working rules, the two-machine rules).
Then this file. `docs/redesign-plan.md` is the design record (§8 and §9
list every decision the build made); `docs/improvement-backlog.md` is what
comes next.

## Where things stand

- **The web redesign is live on `main`** (`795e062..6065dd1`, eleven
  commits, fast-forwarded from the `redesign` branch and pushed, which
  deployed `clouded.monoesport.com`). The `redesign` branch still exists on
  origin at the same commit; it can be deleted, nothing depends on it.
- Design reference is `docs/redesign/desktop-mockup.html` (the approved
  mockup; its `:root` tokens are the source of truth for colours and fonts).
  Fonts: Bricolage Grotesque and IBM Plex Mono from Google Fonts, linked in
  `web/index.html`.
- Everything in `web/style.css` is new. `web/app.js` changed only in
  `header()` and the `*View` / `*Row` / `*Card` builders, plus the three
  agreed exceptions: one line in `watch()` (`justLanded.add`), `refreshTally()`
  repainting the rated bar and domain counts, and `render()` now taking
  `{ animate }` and painting through `document.startViewTransition`.
- **Untouched and verified byte-identical to the pre-redesign `main`:**
  `web/lib/db.js`, `supabase/`, `ios/`, `web/waifu.css`, `web/lib/waifu.js`,
  and the functions `waifuView`, `cloudSvg`, `previewFont`, `placementTool`.
  The `#/waifu` scene's computed styles were diffed against the old `main`
  and matched; keep it that way — every redesigned element default is scoped
  with `:where(#app > :not(.waifu))` and the header adds its cloud icon and
  `view-transition-name`s only when `state.route !== "waifu"`.
- The owner ran the full §7 checklist from `docs/redesign-plan.md` on the
  preview, including the paid items (add an idea, answer a vague one,
  promote/reject), before the merge.

## What the redesign settled (short form; long form in redesign-plan §8–9)

- No Undo on Review: `db.js` has nothing that reverses a promotion or a
  rejection.
- Unrated skills are absent rows, not `'none'`; the profile now checks
  nothing for them and the dashed control / "not rated" tag are CSS on
  `:not(:has(input:checked))`. "Show only unrated" is CSS-only (`:has()`).
- Answering a vague idea from its card is `setClarification` then the
  existing `watch()`, so the card becomes the extracting card and then the
  full one, with the split-flap on the hard part (once per idea, in memory).
- The extracting card keeps the indeterminate sweep and shows real elapsed
  seconds and the real stage — "no time estimates" is an invariant, so the
  mockup's five-second fill and invented step names were not built.
- Bands on Closest to me: 0 short / 1 / 2+ / vague, from `distanceOf().gap`.
  Band copy is "No skill missing" etc., not the mockup's, because a 0-short
  idea can still have partials.
- Jump links in the Profile and Review side panels scroll with
  `preventDefault` — a plain `#d-…` href changes the route.
- "Manage group" (`<details>`) reads its own `open` state off the page
  before each rebuild so it survives rename/invite/revoke/remove.
- Motion, picked on the "Clouded Motion Options" artifact: 1C springy
  controls, 2C page slide by tab order (`ROUTE_ORDER` in `app.js`) with the
  active pill gliding, 3A cards gliding on sort/filter (each card is named
  `idea-<id>`, skipped above 40 cards), 4A one card in focus with the rest
  frosted (blur 3 px, 120 ms delay, `tabindex="0"` on cards). All off under
  reduced motion; none into or out of `#/waifu`.

## Known, deliberately left

- `watch()` re-renders the list every 2 s while an idea extracts, which
  clears anything being typed in the capture box or a card's answer box.
  Pre-existing; the inline answer box makes it easier to notice. Fix would
  be Realtime instead of polling (backlog §4) or preserving input values
  across `mount()`.
- On a first visit to an idea page the page slide plays into the brief
  "Loading…" state and the content then pops in, because the route change
  paints before the fetch returns. Same sequence as before, with the slide
  on the first half. Holding the transition until `load()` resolves is a
  small change in `render()`/the hashchange handler if it bothers anyone.
- Phone-width design is deferred (redesign-plan §3): the pages work at
  400 px (side panels stack, nothing scrolls sideways) but were laid out
  for desktop.
- The Trello claim of `web/` that the plan asked for was never made.

## Suggested next work (from `docs/improvement-backlog.md`, re-checked today)

Backlog §8's first two items (unified colour scheme on the web, dynamic
web animations) are now done and should be marked so. §0.1 (README status
line) was already fixed in `795e062`. Still open, in the order I'd take them:

1. **§0.4 Delete an idea.** No client can. RLS allows it. One `db.js`
   function plus a control on the idea page under the share control. This
   is a `db.js` change, so it is outside the redesign's no-touch rule and
   needs the owner's go — they were leaning yes.
2. **§0.2** `extraction/src/extract.js:4` and `resolve.js:19` default to
   `claude-sonnet-4-5-20250929`; the edge function defaults to
   `claude-sonnet-5`. Make the Node default match (or error without
   `MODEL=`), so `npm run fresh` cannot silently baseline a different model.
3. **§0.6** decide sign-up email confirmation before inviting anyone new.
4. **§1.1 + §1.3 rate in place, say what moved.** Make the `[ ]` mark on the
   idea page a click-to-cycle level control writing `setSkillLevel`, and
   after any level change print one line: "parametric-cad → solid. N ideas
   moved closer." Highest value per line in the backlog; the profile is 13
   of 53 rated and everything hangs off it.
5. **§4 Search.** 29 ideas now, the backlog's threshold is ~30, and "add a
   search bar to the clouded app" is itself an idea in the list.
6. **§5 CAD split test**, ~$0.20 of API, before trusting the leverage panel's
   headline.

## Environment notes for the next session

- Dev server: `node web/serve.mjs` (port 5173). Sign in as the test user
  (`TEST_USER_EMAIL` / `TEST_USER_PASSWORD` in gitignored `supabase/.env`).
- The Chrome DevTools MCP page keeps its Supabase session between
  reloads on the same origin; a different port is a different origin and
  needs its own sign-in.
- To check `#/waifu` against a reference: `git worktree add <dir> <ref>`,
  copy `web/config.js` in, serve it on another port, and compare
  `getComputedStyle` of `header`, `header h1`, `.tab`, `button.link`,
  `.waifu-input`, `.waifu-bar button`, `.waifu-bar .cost`,
  `.waifu-bubble-text` — that is the check the redesign used.
- Cost rule still applies: adding an idea or answering a vague one is a
  paid call (~1¢ + ~0.6¢ resolve). Say the estimate before spending.
