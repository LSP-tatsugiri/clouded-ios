# Web redesign plan

Status: signed off by Brian, 2026-09-16. Design reference: `docs/redesign/desktop-mockup.html`
(live copy: https://claude.ai/artifact/NTpLLxnDg3r8V3biHgdGd3).

## 1. Problem

clouded.monoesport.com works but looks like a bare prototype. It gets a full redesign (layout,
navigation and markup, not just colors) without losing any existing feature.

This reverses the 2026-09-15 decision that the list, detail, profile and review pages stay exactly
as they are. Waifu view is unchanged by this plan.

## 2. Success criteria

- The shipped pages match the mockup in light and dark, at desktop width.
- Below about 900px the pages still work: the side panel stacks under the main column.
- Every item on the manual checklist (section 7) passes on the Vercel preview.
- `git diff --stat main` shows no changes to: `web/lib/db.js`, `supabase/`, `ios/`, `web/waifu.css`,
  `web/lib/waifu.js`, or the functions `waifuView`, `cloudSvg`, `previewFont`, `placementTool`.

## 3. Scope

In: `web/style.css`, `web/index.html` (font link), and markup in `web/app.js` built by `header()`
and the `*View` / `*Row` / `*Card` builders.

Out: data loading, app state, handlers and queries (any design element that needs one is a stop
and ask), backend, iOS app, waifu view.

Deferred: phone-specific design, moving the leverage panel to a Learn tab, backlog features.

Surface: everything stays in `web/`. No new service or tool.

### Page by page

**Theme.** Tokens below on `:root`; the dark set applies under `prefers-color-scheme: dark`.
Fonts: Bricolage Grotesque (text and headings), IBM Plex Mono (marks, counts, ids, small meta).

| Token | Light | Dark |
|---|---|---|
| `--bg` | #f6f7fb | #0b0f18 |
| `--bg-2` | #ffffff | #121827 |
| `--ink` | #0f1422 | #f2f4fa |
| `--ink-2` | #4a5570 | #aab3c7 |
| `--ink-3` | #5f6984 | #7a85a0 |
| `--line` | #dde1ec | #26304a |
| `--flow` | #3461e6 | #5b84ff |
| `--crux` | #c93a30 | #ff6a5c |
| `--held` | #1a7d4a | #4fd18b |
| `--partial` | #8f5f08 | #f2b544 |

Status marks keep their bracket text and gain color: `[x]` held, `[~]` partial, `[ ]` short
(faint), `[?]` proposed (faint, italic), `[+]` friend (flow). "The hard part" is a crux-tinted
block with a crux left border.

**Header.** Wordmark with cloud icon; pill tabs Ideas, Group, Profile, Review (curator only),
Sign out.

**Ideas.**
- Capture box (large) with the ~1¢ cost note. Kept.
- Controls: Closest to me / Newest toggle, domain and crux selects, both checkboxes, shown count.
  All existing filters kept.
- Closest to me groups cards into bands, using the existing short count: Buildable now (0 short),
  One skill away (1), Further out (2+), Needs a detail (vague). Newest is one flat list by date.
- Idea card: title, raw text, tally chips (short / partial / held), hard-part block, two-column
  capability list, footer with domain tag, proposed-skill tag, friend line, owner, date.
- Extracting is a card state: progress bar, elapsed seconds, step text. When extraction finishes
  the card becomes the full card.
- Split-flap: when a card finishes extracting, the hard-part text resolves letter by letter in
  mono tiles, then settles to normal text. Once per idea. Fade instead under reduced motion.
- Vague is a card state: the question and an answer box inline, reusing the existing answer logic
  from idea detail.
- Highest leverage side panel kept as is, sticky.

**Group.**
- Page title is the group name; Newest / Closest to me toggle.
- Feed items are idea cards: title, tally, hard part, capabilities, footer with owner link,
  domain, date, "X holds the hard part", "group covers N of M gaps".
- Side panel: member list always visible; "Manage group" collapsed below it holding rename,
  remove, invite with cost note, pending invites with revoke, leave/delete.

**Profile.**
- Title, honesty note, name form.
- Rated bar (solid / some / none) and a text summary including the unrated count.
- Skills grouped by domain; none / some / solid control colored by level.
- Unrated skills look different from "none": dashed control and a "not rated" tag.
- Side panel: domains with rated/total, jump links, "Show only unrated" filter.

**Review.**
- Proposal cards: id, badges (ideas, runs, times it was the hard part), "Why the model proposed
  it" note, fields in two columns, hazard checkbox, Promote, reject reason plus Reject.
- Placeholder text is faint italic with an "e.g." prefix.
- Side panel: queue with jump links.

**Idea detail, friend page, sign-in.** Not designed yet. Apply tokens, fonts, cards and marks
only; keep their current layout.

## 4. Constraints

- Vanilla JS stays. No framework.
- Work on the `redesign` branch. Main deploys to production on push.
- Follow `CLAUDE.md`.
- Daniel also works in this repo; claim `web/` on the Trello board for the duration.

## 5. Check before building

Report findings from `web/lib/db.js` before writing code:

1. Can a promoted or rejected proposal be undone? If not, drop Undo from Review.
2. Is an unrated skill stored as null or as 'none'? The live Profile page shows "0 none" but
   highlights "none" on unrated rows. Fix only the display in this plan; report if data is wrong.
3. Can the answer box used on idea detail be reused on list cards without new queries?
4. Do the Group "Closest to me" sort and the per-card crux/tally data already exist for feed rows?

## 6. Plan

1. Tokens, fonts and base styles in `style.css`.
2. Header and tabs.
3. Ideas: controls, bands, idea card.
4. Ideas: extracting and vague card states, split-flap.
5. Group.
6. Profile, including the unrated state.
7. Review.
8. Idea detail, friend page, sign-in restyle.
9. Narrow-width stacking.
10. Push branch, run the checklist on the preview, confirm the no-touch files, merge.

One commit per step.

## 7. Manual checklist (run on the preview, light and dark)

- Sign in, sign out.
- Add an idea; watch it extract; split-flap plays once; reload and it does not replay.
- Answer a vague idea from its card.
- Closest to me shows bands; Newest shows a flat list; domain, crux and both checkboxes filter.
- Open an idea; re-run extraction; share it to the group.
- Group: feed renders; friend link opens their page; rename; invite; revoke; remove; leave/delete.
- Profile: set a level; tally and bar update; unrated rows look distinct; save name.
- Review (curator account): promote one, reject one with a reason.
- `#/waifu` looks and works exactly as before.
- Narrow window: nothing overflows sideways.

## 8. Built (2026-09-16, branch `redesign`)

Steps 1–9 landed as one commit each; step 10 is the preview checklist and
the merge. What the pre-build checks (section 5) and the build settled:

1. **No Undo on Review.** `db.js` has only `promoteSkill` and `rejectSkill`;
   promotion inserts the skill and repoints capabilities, and nothing
   reverses either. A decided card moves to "Already decided".
2. **Unrated is an absent row, not `'none'`.** The data was right; the bug
   was `levelControl` defaulting to `"none"`. Now nothing is checked, and the
   dashed control and "not rated" tag are CSS on `:not(:has(input:checked))`.
3. **Answering from a card** is `setClarification` then the existing
   `watch()`, so the card becomes the extracting card and then the full one.
   The idea page's `answerBox` is unchanged.
4. **Feed sort and card data** already existed; nothing new was queried.
5. **Split-flap trigger:** a module-level `justLanded` set. `watch()` adds
   the id after its reload (one line, the only change outside the builders
   apart from `refreshTally`), the next paint plays it, `listView` empties
   the set. In memory only, so a reload never replays.
6. **Extracting card** keeps the indeterminate sweep and shows the real
   elapsed seconds and the real stage, not the mockup's five-second fill and
   invented steps: "no time estimates" is an invariant.
7. **"Show only unrated"** is CSS-only (`:has()`), no state; it resets on
   navigation. `refreshTally()` also repaints the rated bar and the side
   panel's per-domain counts, so rating never re-renders.
8. **Jump links** in the Profile and Review side panels scroll with
   `preventDefault` — a plain `#d-…` href would change the route.
9. **"Manage group"** reads its own `open` state off the page before each
   rebuild so it stays open across rename, invite, revoke and remove.
10. **Waifu unchanged:** every redesigned element default is scoped with
    `:where(#app > :not(.waifu))`, the cloud icon is left off that header,
    and the computed styles of the scene's header, input, button and cost
    line were checked identical against `main`. `waifuView`, `cloudSvg`,
    `previewFont`, `placementTool`, `waifu.css`, `lib/waifu.js`, `lib/db.js`,
    `supabase/` and `ios/` are byte-identical to `main`.

Band copy differs from the mockup on purpose: "No skill missing" / "One
skill short" / "Two or more skills short", since a 0-short idea can still
have partials and the one short skill is not always the hard part.

Known, unchanged: `watch()` re-renders the list every 2 s while an idea
extracts, which clears anything being typed in the capture box or a card's
answer box. Not new, just easier to notice now.

## 9. Motion (2026-09-16, same branch)

Chosen on the live options page (`Clouded Motion Options` artifact):
1C springy controls, 2C page slide by tab order with the active pill
gliding, 3A cards gliding on sort and filter, 4A one card in focus with
the rest frosted. 1 and 4 are CSS plus `tabindex` on the cards. 2 and 3
are the one change to plumbing: `render({ animate })` builds the view,
then paints it through `document.startViewTransition` when the route
changed or a sort/filter handler asked, stamping `data-vt` and
`data-dir` on the root for the CSS; the header and the active tab carry
`view-transition-name`s, and each card is named after its idea (skipped
above 40 cards). No transition without the API, under reduced motion,
or into or out of `#/waifu`, whose builders stay byte-identical.
