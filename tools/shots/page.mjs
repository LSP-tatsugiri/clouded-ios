// The before/after page: one HTML file plus the shots beside it, ready to
// publish as an Artifact (or open locally). Reads run.mjs's manifest.json.
//   node tools/shots/page.mjs <shots-dir> <page-dir>
// <page-dir>/files.json lists the images to publish alongside the page.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [SHOTS, PAGE] = process.argv.slice(2);
const m = JSON.parse(readFileSync(join(SHOTS, "manifest.json"), "utf8"));
for (const side of ["before", "after"]) mkdirSync(join(PAGE, side), { recursive: true });

// What changed on each screen, keyed by screen id: an optional notes.json
// in <shots-dir>, written for each change. Without it the page has no notes.
const notesFile = join(SHOTS, "notes.json");
const NOTES = existsSync(notesFile) ? JSON.parse(readFileSync(notesFile, "utf8")) : {};

const groups = new Map();
for (const s of m.shots) {
  const key = s.id.replace(/-(desktop|phone)-(light|dark)$/, "");
  if (!groups.has(key)) groups.set(key, { key, title: s.title, shots: [] });
  groups.get(key).shots.push(s);
  for (const side of ["before", "after"]) if (s[side]) copyFileSync(join(SHOTS, s[side]), join(PAGE, s[side]));
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const status = (g) => g.shots.every((s) => s.missingBefore) ? "new" : g.shots.every((s) => s.identical) ? "same" : "changed";
const label = { new: "New screen", same: "No visible change", changed: "Changed" };

const shotHtml = (s) => {
  const [, vp, th] = s.id.match(/-(desktop|phone)-(light|dark)$/);
  const pane = (side) => s[side]
    ? `<a class="pane" href="${s[side]}" target="_blank" rel="noopener"><img src="${s[side]}" alt="${esc(s.title)}, ${side}, ${vp}, ${th}" loading="lazy" decoding="async"></a>`
    : `<div class="pane empty"><span>Not on the live site</span></div>`;
  return `<figure class="shot" data-vp="${vp}" data-th="${th}" data-same="${s.identical}">
  <figcaption><span class="chip">${vp === "phone" ? "Phone 390" : "Desktop 1280"}</span><span class="chip">${th}</span>${s.identical ? '<span class="chip quiet">identical</span>' : ""}${s.cutAt ? `<span class="chip quiet">cut at ${s.cutAt}px</span>` : ""}</figcaption>
  <div class="pair ${vp}">
    <div class="side"><div class="tag before">Before · live site</div><div class="scroll">${pane("before")}</div></div>
    <div class="side"><div class="tag after">After · ${esc(m.head.ref)}</div><div class="scroll">${pane("after")}</div></div>
  </div>
</figure>`;
};

const sections = [...groups.values()].map((g) => {
  const st = status(g);
  return `<section class="screen" id="${g.key}" data-status="${st}">
  <header class="screen-head">
    <h2>${esc(g.title)}</h2><span class="status ${st}">${label[st]}</span>
  </header>
  <ul class="notes">${(NOTES[g.key] ?? []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
  ${g.shots.map(shotHtml).join("\n")}
</section>`;
}).join("\n");

const all = [...groups.values()];
const count = (st) => all.filter((g) => status(g) === st).length;
const toc = all.map((g) => `<a href="#${g.key}" class="toc-${status(g)}">${esc(g.title)}</a>`).join("");
const made = new Date(m.made).toISOString().slice(0, 10);

// named after the head branch, so several pages stay apart in a gallery:
// agent/review-leftovers -> "Review Leftovers, Before and After"
const name = m.head.ref.split("/").pop().split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const html = `<title>${esc(name)} Before and After</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap">
<style>
/* layout: a ledger of screens; each screen is a row of before/after panes that scroll together */
:root {
  --bg: #f4f5f8; --panel: #ffffff; --ink: #141826; --ink-2: #4a5165; --ink-3: #7b8296;
  --line: #e1e4ec; --accent: #3461e6; --before: #8a5a12; --before-bg: #fbf1df; --after: #1f7a4d; --after-bg: #e3f4ea;
  --new: #6b3fd6; --new-bg: #efe8fd;
  --display: "Space Grotesk", "Segoe UI", system-ui, sans-serif;
  --body: "Inter", "Segoe UI", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0d1018; --panel: #151a26; --ink: #e9ecf4; --ink-2: #b2b8c8; --ink-3: #848ba0;
  --line: #262d3d; --accent: #7c9bff; --before: #f0b45c; --before-bg: #3a2c14; --after: #6fd39d; --after-bg: #153325;
  --new: #b79bff; --new-bg: #2a2045; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #0d1018; --panel: #151a26; --ink: #e9ecf4; --ink-2: #b2b8c8; --ink-3: #848ba0;
  --line: #262d3d; --accent: #7c9bff; --before: #f0b45c; --before-bg: #3a2c14; --after: #6fd39d; --after-bg: #153325;
  --new: #b79bff; --new-bg: #2a2045; color-scheme: dark }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font: 15px/1.55 var(--body);
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.wrap { max-width: 1440px; margin: 0 auto; padding-block: 2rem 4rem; }
h1, h2 { font-family: var(--display); letter-spacing: -0.01em; text-wrap: balance; margin: 0; }
h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); line-height: 1.1; }
h2 { font-size: 1.35rem; }
.lede { color: var(--ink-2); max-width: 68ch; margin: .75rem 0 0; }
.meta { font: 12px/1.6 var(--mono); color: var(--ink-3); margin-top: .75rem; overflow-wrap: anywhere; }
.summary { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1.25rem; }
.stat { font: 500 13px var(--mono); padding: .35rem .7rem; border-radius: 999px; background: var(--panel); border: 1px solid var(--line); }
.controls { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg);
  display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: center; padding-block: .75rem; margin-top: 1.25rem; border-bottom: 1px solid var(--line); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg); }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 3px; background: var(--panel); }
.seg button { font: 500 13px var(--body); color: var(--ink-2); background: none; border: 0; border-radius: 999px; padding: .35rem .8rem; cursor: pointer; min-height: 32px; }
.seg button[aria-pressed="true"] { background: var(--ink); color: var(--bg); }
.seg button:focus-visible, .toc a:focus-visible, .pane:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.toc { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: 1rem; }
.toc a { font-size: 13px; color: var(--ink-2); text-decoration: none; padding: .25rem .6rem; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); }
.toc a.toc-same { color: var(--ink-3); }
.toc a.toc-new { border-color: var(--new); color: var(--new); }
.screen { margin-top: 2.5rem; scroll-margin-top: 5rem; }
.screen-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem .9rem; }
.status { font: 500 12px var(--mono); padding: .15rem .55rem; border-radius: 6px; }
.status.changed { background: var(--after-bg); color: var(--after); }
.status.new { background: var(--new-bg); color: var(--new); }
.status.same { background: var(--panel); color: var(--ink-3); border: 1px solid var(--line); }
.notes { margin: .6rem 0 0; padding-left: 1.1rem; color: var(--ink-2); max-width: 80ch; }
.notes li { margin: .15rem 0; }
.shot { margin: 1.1rem 0 0; }
.shot figcaption { display: flex; flex-wrap: wrap; gap: .35rem; margin-bottom: .5rem; }
.chip { font: 12px var(--mono); padding: .1rem .5rem; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); color: var(--ink-2); }
.chip.quiet { color: var(--ink-3); }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.pair.phone { max-width: 900px; }
.side { min-width: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.tag { font: 500 12px var(--mono); padding: .45rem .75rem; border-bottom: 1px solid var(--line); }
.tag.before { color: var(--before); background: var(--before-bg); }
.tag.after { color: var(--after); background: var(--after-bg); }
.scroll { max-height: 78vh; overflow: auto; overscroll-behavior: contain; }
.pane { display: block; }
.pane img { display: block; width: 100%; height: auto; max-width: 100%; }
.pane.empty { display: grid; place-items: center; min-height: 12rem; color: var(--ink-3); font: 13px var(--mono); padding: 1rem; text-align: center; }
.foot { margin-top: 3rem; color: var(--ink-3); font-size: 13px; max-width: 80ch; }
[data-hide] { display: none !important; }
@media (max-width: 720px) {
  .pair { grid-template-columns: 1fr; }
  .scroll { max-height: 70vh; }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
</style>

<div class="wrap">
  <h1>Clouded, before and after</h1>
  <p class="lede">Every screen of the web client, as the live site has it today and as ${esc(m.head.ref)} leaves it. Both sides use the same made-up data built from your real ideas, so differences are the code's, not the data's. Click a screenshot to open it full size. Paired screenshots scroll together.</p>
  <p class="meta">before: ${esc(m.base.ref)} @ ${m.base.sha.slice(0, 7)} (live) · after: ${esc(m.head.ref)} @ ${m.head.sha.slice(0, 7)} · captured ${made}</p>
  <div class="summary">
    <span class="stat">${all.length} screens</span>
    <span class="stat">${count("changed")} changed</span>
    <span class="stat">${count("new")} new</span>
    <span class="stat">${count("same")} unchanged</span>
    <span class="stat">${m.shots.length} screenshots</span>
  </div>
  <div class="controls" role="toolbar" aria-label="Filter screenshots">
    <div class="seg" data-filter="vp"><button type="button" id="vp-all" aria-pressed="true" data-v="all">Desktop + phone</button><button type="button" id="vp-desktop" aria-pressed="false" data-v="desktop">Desktop</button><button type="button" id="vp-phone" aria-pressed="false" data-v="phone">Phone</button></div>
    <div class="seg" data-filter="th"><button type="button" id="th-all" aria-pressed="true" data-v="all">Light + dark</button><button type="button" id="th-light" aria-pressed="false" data-v="light">Light</button><button type="button" id="th-dark" aria-pressed="false" data-v="dark">Dark</button></div>
    <div class="seg" data-filter="ch"><button type="button" id="ch-all" aria-pressed="true" data-v="all">All screens</button><button type="button" id="ch-changed" aria-pressed="false" data-v="changed">Changed only</button></div>
  </div>
  <nav class="toc" aria-label="Screens">${toc}</nav>
  ${sections}
  <p class="foot">Made by <code>tools/shots/run.mjs</code> in the repo. The backend is fake, so these show layout and wording, not your live data; nothing called the API. Screens marked “Not on the live site” are new in ${esc(m.head.ref)}. Very long pages are cut at 12,000px.</p>
</div>

<script>
const state = { vp: "all", th: "all", ch: "all" };
function apply() {
  for (const f of document.querySelectorAll(".shot")) {
    const hide = (state.vp !== "all" && f.dataset.vp !== state.vp) || (state.th !== "all" && f.dataset.th !== state.th)
      || (state.ch === "changed" && f.dataset.same === "true");
    f.toggleAttribute("data-hide", hide);
  }
  for (const s of document.querySelectorAll(".screen")) {
    const none = !s.querySelector(".shot:not([data-hide])") || (state.ch === "changed" && s.dataset.status === "same");
    s.toggleAttribute("data-hide", none);
  }
}
for (const seg of document.querySelectorAll(".seg")) {
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    for (const x of seg.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
    state[seg.dataset.filter] = b.dataset.v;
    try { localStorage.setItem("ba-" + seg.dataset.filter, b.dataset.v); } catch {}
    apply();
  });
  try { const v = localStorage.getItem("ba-" + seg.dataset.filter); const b = v && seg.querySelector('[data-v="' + v + '"]'); if (b) b.click(); } catch {}
}
// the two panes of a pair scroll together, by proportion, since the pages differ in length
for (const pair of document.querySelectorAll(".pair")) {
  const [a, b] = pair.querySelectorAll(".scroll");
  let lock = null;
  const sync = (from, to) => () => {
    if (lock && lock !== from) return; lock = from;
    const r = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    to.scrollTop = r * (to.scrollHeight - to.clientHeight);
    clearTimeout(from._t); from._t = setTimeout(() => { lock = null; }, 80);
  };
  a.addEventListener("scroll", sync(a, b), { passive: true });
  b.addEventListener("scroll", sync(b, a), { passive: true });
}
apply();
</script>
`;
writeFileSync(join(PAGE, "before-after.html"), html);
const files = m.shots.flatMap((s) => ["before", "after"].filter((k) => s[k]).map((k) => s[k]));
writeFileSync(join(PAGE, "files.json"), JSON.stringify(Object.fromEntries(files.map((f) => [f, f]))));
console.log("page written,", files.length, "images");
