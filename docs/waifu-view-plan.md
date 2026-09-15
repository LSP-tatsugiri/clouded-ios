# Waifu view — plan

An extra `#/waifu` route: one ambient screen where you capture an idea by
answering a character who asks for it. Written 2026-09-15; refined the same
day after Step 7 closed; reduced to a v1 by a grilling session the same
evening. Read `CLAUDE.md` first for the invariants; `docs/step-5-plan.md`
describes the web client this sits inside and `docs/step-7-plan.md` the
sharing layer it must not disturb. This is **not** a numbered step. Steps 6
and 7 are both closed; nothing else is in progress.

## State at handoff

- `web/` is a hash-routed vanilla SPA: ES modules, no bundler, no framework,
  `el()`/`mount()` from `web/lib/dom.js`, all styles in `web/style.css`,
  `config.js` gitignored, `@supabase/supabase-js` from a pinned CDN.
- Routes: `list` (default), `group`, `profile`, `review`, `idea/<id>`,
  `friend/<id>`. `ROUTES = new Set(["profile", "review", "group"])` holds
  the plain tabs; `currentRoute()` maps the hash with prefix checks for
  `idea/` and `friend/`; `render()` dispatches; `load()` fetches per route.
- Capture on the web is `addIdea(raw)` in `web/lib/db.js` — one insert of
  `raw`, everything else downstream. The webhook fires on INSERT.
- `distance.js` is mounted from `extraction/src/` and served on Vercel
  (verified in Step 7). This route does not use it in v1.
- Live on Vercel at clouded.monoesport.com, output directory `web`, so
  `web/assets/` ships as static files.
- **Assets, in the repo:** `web/assets/scene.mp4` — the one loop, H.264
  High 1872×1052, 24 fps, 5.04 s, AAC audio, 2.95 MB, her baked into the
  scene; `web/assets/scene.jpg` — the poster, 227 KB, made from the source
  still with ffmpeg 9 (installed via winget). The 4 MB source PNG is in
  `Claude outputs/waifu-scene-source.png`, outside the deploy folder.
- `web/serve.mjs` gained `.mp4`/`.jpg` MIME types and Range support so the
  video plays locally; Vercel does both itself. The automation browser on
  this PC could not decode *any* mp4 the day this was written (a known-good
  public file also stuck at `readyState 0`), so the loop was verified by
  `ffprobe` and box inspection, and the layout was judged from the poster.

## Decisions

1. **One video, all six time bands** (2026-09-15). The band logic ships;
   only the copy varies by hour. Per-band videos come later as a data
   change: `data-tod` on the scene selects the source.
2. **No colour wash over the video.** A tint reads as a filter, not as a
   time of day. Off; a one-line CSS toggle to try.
3. **Her baked in, video everywhere.** No separate character image. The
   loop autoplays muted on every device; the poster stands in for
   `prefers-reduced-motion` and while the video loads. No phone-only stills.
4. **She acknowledges, she does not read back** (grilling, 2026-09-15). On a
   successful insert she says she has it, plus a "see it on the list" link
   to `#/idea/<id>`. No watching, no polling, no crux, no split. The
   read-back — through `cruxOf`/`distanceOf`, never re-derived — is the
   first thing to add later, and the reason `distance.js` stays reachable.
5. **The acknowledgement stays until you type again.** Typing returns the
   bubble to listening. No auto-advance.
6. **Failure is in her mouth**: "That didn't save. Try again?" in the
   bubble, the text kept in the box.
7. **No voice yet.** Openers are one or two neutral lines per band, so
   nothing written now is thrown away when the calm-or-blunt call is made.
   No name (no profile fetch), no share line, no group awareness — all
   deferred, not cut.
8. **Unlisted.** Reachable by typing `#/waifu`; no nav link. One line to
   list it later.
9. **The ~1¢ notice lives in the chrome**, beside the input, not in her copy.
10. **Layout from the actual frame.** The dark, quiet region is the open
    doorway beside her head (~37–55 % across, 5–55 % down); the lower-left
    is the lantern and lit door, not the void the first draft assumed. So:
    the bubble overlays the doorway; the input and the cost notice sit on a
    translucent dark bar along the bottom edge over the stone step; the
    video is `object-fit: cover` with `object-position: 60% 50%` so narrow
    screens keep her and the doorway and lose the house.

---

## 1. Problem

Capture on the web is a one-line text box on the list page. It works, and it is
boring, so the site does not get opened. This route is an explicitly for-fun
surface: a character in a room asks what the idea is, and you answer her. v1
stops there; her reading back what it would take is the next version.

## 2. Success criteria

1. `#/waifu` renders the scene full-screen with the loop playing, her opening
   line in a bubble, and a focused input. The other six views are unchanged.
2. Submitting creates an idea row indistinguishable from one added on the
   list page — same `addIdea`, same webhook, same extraction, private.
3. On success she acknowledges and links to the idea; the acknowledgement
   stays until the next keystroke. On failure she says so and the text stays.
4. Her opening line differs across the six bands when forced with `?band=`.
5. No route other than `#/waifu` loads the video or the poster.
6. `style.css` is unmodified. Existing files touched: `app.js` (route and
   dispatch), `index.html` (one stylesheet link), `serve.mjs` (MIME + Range,
   already done).
7. Nothing she says contains a numeric score or a time estimate.

## 3. Scope

**In:** the route and view; `web/waifu.css`; `web/lib/waifu.js` (bands and
lines); `web/assets/scene.mp4` and `scene.jpg`; `addIdea` reused;
`prefers-reduced-motion` to poster.

**Out:** any change to the other views; any schema, policy or edge-function
change; image attachment, clarification, sharing; the iOS app.

**Deferred, in order:** the read-back (Decision 4); her reacting to the
clarifying question; the share line; her knowing your name; the voice; the
nav link; per-band videos; expression variants.

## 4. Constraints

- `CLAUDE.md` invariants: no scores, no time estimates, ever, in her copy.
- No bundler, no framework; `el()` calls; match the file style.
- One insert and nothing else. Each capture costs about a cent; the notice
  says so beside the input.
- Byte budget: video ≤3 MB (2.95), poster ≤250 KB (227). Both lazy behind
  the route: nothing references them outside `waifuView()` and `waifu.css`.
- Sign-in gates this route like every other one.

## 5. Plan

**Phase A — scene and skeleton.** `"waifu"` in `ROUTES`; `waifuView()`;
`waifu.css` linked from `index.html`; the video with the poster, the bubble
over the doorway, the input bar, the cost notice. `load()` needs no branch.
*Done when:* `#/waifu` renders with the loop; the other routes are unchanged;
signing out returns to the sign-in form; a network tab on `#/` shows neither
asset.

**Phase B — capture.** Enter submits, Shift+Enter newlines; sending →
acknowledged with the link, or the failure line; typing resets the bubble.
*Done when:* one capture from here (~1¢) shows on the list with a crux, the
row identical in shape to a list-box capture.

**Phase C — bands.** `bandFor(date)` pure, `?band=` forcing, `data-tod`,
one or two neutral lines per band, checked against constraint one.
*Done when:* the boundary hours (00:59, 01:00, 04:59, 05:00, 23:00) map
right and each forced band shows its own line.

**Phase D — guards and close.** `prefers-reduced-motion` → poster, still;
keyboard focus ring visible over the bar; check on a phone; `CLAUDE.md`
layout mentions `waifu.css`, `lib/waifu.js`, `assets/`. Commit, deploy.

## 6. Open questions

None for v1. The deferred list is the next grilling.

## What was verified (2026-09-15)

Phases A–C built in one pass; D on deploy.

- `#/waifu` renders the scene with the poster, the header floated over the
  top edge, the bubble on the doorway beside her head, the input bar on the
  step with "Tell her" and the ~1¢ notice. `#/` loads neither asset (network
  tab: `waifu.css` and `lib/waifu.js` load with the app, as every module
  does; `scene.*` do not).
- One capture from the scene (~1¢): "Got it. I'll hold on to that. See it
  on the list." with the link; the box cleared and kept focus; the first
  keystroke put her opener back. The row landed extracted, clear, private,
  crux `power-budgeting`, seven capabilities — the same shape as a list-box
  capture.
- `bandFor` at 00:59 → night, 01:00 → late, 04:59 → late, 05:00 → dawn,
  20:00 → night, 23:00 → night; `?band=night` forces the band and its line
  (`data-tod="night"`); no line contains a digit or a time word (checked by
  regex over every string in `lib/waifu.js`).
- **Not verified here:** the loop actually playing, and the reduced-motion
  poster. The automation browser on this PC could not decode any mp4 that
  day (a public known-good file also stuck), so the `<video>` was checked
  for presence and `muted` only. First real look is on the deployed site,
  and on a phone.
