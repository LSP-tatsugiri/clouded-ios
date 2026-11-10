# tools/shots — before/after screenshots of the web client

Shoots every screen in `screens.json` on two git refs and writes them side by
side for comparison:

    node tools/shots/run.mjs main agent/some-branch <out-dir>

`<out-dir>` defaults to `tools/shots/out/` (gitignored). It gets `before/*.png`,
`after/*.png` and `manifest.json` (per shot: route, viewport, theme, both paths,
`identical` = byte-equal, `missingBefore`/`missingAfter`, console errors).
Flags: `--only=list,profile` for some screens, `--keep` to keep the exported
sources in `<out-dir>/src/`, `--fonts` to let Google Fonts load, `--webp` for
lossy shots about a fifth of the PNG size.

**The page.** `node tools/shots/page.mjs <out-dir> <page-dir>` turns the
manifest into one HTML page with every pair side by side (filters for
desktop/phone, light/dark, changed only; paired shots scroll together) and
copies the shots beside it; `<page-dir>/files.json` lists them for publishing
as an Artifact. Write `<out-dir>/notes.json` first, `{ "<screen id>": ["what
changed", ...] }`, to put a few plain lines above each screen. The usual run
for a change:

    node tools/shots/run.mjs main agent/<topic> <out-dir> --fonts --webp
    node tools/shots/page.mjs <out-dir> <page-dir>

**Fake backend.** Neither side talks to Supabase. Each ref's `web/` and
`extraction/src/` are exported with `git archive` (the checkout is never
touched), and its `web/lib/db.js` is replaced by one generated from that ref's
own export list, answering from `fixture.json` (`fake.js`). Writes resolve and
do nothing. So the shots show layout and copy against the same data on both
sides, not live data, and nothing calls the Anthropic API. `config.js` gets
placeholders; no real key is read.

**Browser.** A local Chrome, Edge, Chromium or Brave, found under Program Files
or `/Applications` (or `SHOTS_BROWSER=<binary>`), run headless over the
DevTools protocol with Node's own `WebSocket`. Node 22+. Nothing is downloaded.
Requests to anything but localhost are answered empty inside the browser, so
without `--fonts` text falls back to local fonts on both sides. Reduced motion
is emulated, carets are hidden and videos paused at frame 0; the waifu scene
still differs between runs now and then (video decode timing), and its
greeting follows the clock.

**Fixture.** `fixture.json` is committed so every comparison uses the same
rows. Regenerate it from the committed extraction data with
`node tools/shots/make-fixture.mjs` — only when the data should change.

**Screens.** Edit `screens.json`: `hash`, `signedOut`, `dark`, `fullPage:
false`, `needsRoute` / `needsSelector` (recorded as missing on a ref that lacks
them), and `steps` (`click`, `key`, `type`, `wait`).
