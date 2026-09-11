import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { extract, skills } from "./extract.js";
import { distanceOf, classify, profile } from "./distance.js";

const ideas = JSON.parse(readFileSync(new URL("../data/ideas.json", import.meta.url)));
const CACHE = new URL("../out/extractions.json", import.meta.url);
const force = process.argv.includes("--force");

const skillName = Object.fromEntries(skills.map((s) => [s.id, s.name]));
const cache = !force && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE)) : {};

const todo = ideas.filter((i) => !cache[i.id]);
console.log(`${ideas.length} ideas · ${todo.length} to extract · ${ideas.length - todo.length} cached\n`);

if (todo.length && !process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set.\n  cp .env.example .env   and put your key in it, then run npm start");
  process.exit(1);
}

// small concurrency so a re-run is quick but we don't hammer the API
const QUEUE = [...todo];
async function worker() {
  while (QUEUE.length) {
    const idea = QUEUE.shift();
    try {
      cache[idea.id] = await extract(idea.raw);
      process.stdout.write(".");
    } catch (err) {
      console.error(`\n  ${idea.id}: ${err.message}`);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
writeFileSync(CACHE, JSON.stringify(cache, null, 2));
if (todo.length) console.log("\n");

// ---------- per-idea report, closest to buildable first ----------

const rows = ideas
  .map((i) => ({ ...i, ex: cache[i.id] }))
  .filter((r) => r.ex);

const clear = rows.filter((r) => r.ex.clear);
const vague = rows.filter((r) => !r.ex.clear);

clear.sort((a, b) => distanceOf(a.ex).score - distanceOf(b.ex).score);

for (const r of clear) {
  const d = distanceOf(r.ex);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${r.raw}`);
  console.log(`${d.gap} short${d.partial ? ` · ${d.partial} partial` : ""}${d.have ? ` · ${d.have} held` : ""}`);
  console.log("-".repeat(72));
  for (const cap of r.ex.capabilities) {
    const c = classify(cap);
    const mark = { have: "[x]", partial: "[~]", gap: "[ ]", proposed: "[?]" }[c];
    const label = cap.skill_id ? skillName[cap.skill_id] || cap.skill_id : `${cap.proposed_name}  (proposed)`;
    console.log(`  ${mark} ${label}${cap.is_crux ? "   <-- crux" : ""}`);
  }
}

if (vague.length) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`TOO VAGUE TO EXTRACT (${vague.length}) — the app should ask, not guess`);
  console.log("-".repeat(72));
  for (const r of vague) console.log(`  "${r.raw}"\n     -> ${r.ex.clarifying_question}`);
}

// ---------- the payoff: which skill unlocks the most ----------

const unlocks = {};
for (const r of clear) {
  for (const cap of r.ex.capabilities) {
    if (classify(cap) === "have") continue;
    const key = cap.skill_id || `proposed:${cap.proposed_name}`;
    (unlocks[key] ||= []).push(r.id);
  }
}

const ranked = Object.entries(unlocks).sort((a, b) => b[1].length - a[1].length).slice(0, 12);

console.log(`\n${"=".repeat(72)}`);
console.log("HIGHEST LEVERAGE — learn this, and this many ideas move");
console.log("-".repeat(72));
for (const [key, ids] of ranked) {
  const label = key.startsWith("proposed:") ? `${key.slice(9)} (proposed)` : skillName[key] || key;
  console.log(`  ${String(ids.length).padStart(2)}  ${label}`);
  console.log(`      ${ids.join(", ")}`);
}

const proposed = Object.keys(unlocks).filter((k) => k.startsWith("proposed:"));
if (proposed.length) {
  console.log(`\n${proposed.length} proposed skills need your review before they join data/skills.json:`);
  for (const p of proposed) console.log(`  - ${p.slice(9)}`);
}
console.log();
