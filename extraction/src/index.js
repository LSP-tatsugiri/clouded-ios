import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { extract, skills, promptHash } from "./extract.js";
import { distanceOf, classify, profile } from "./distance.js";
import { resolveExtraction, loadRegistry, saveRegistry, dueForReview } from "./resolve.js";

const ideas = JSON.parse(readFileSync(new URL("../data/ideas.json", import.meta.url)));
const CACHE = new URL("../out/extractions.json", import.meta.url);
const force = process.argv.includes("--force");

const skillName = Object.fromEntries(skills.map((s) => [s.id, s.name]));
// cache entries are keyed by idea id but stamped with the prompt hash, so a
// prompt or skills-table change invalidates them without needing --force
const stored = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE)) : {};
const cache = {};
if (!force) for (const [id, ex] of Object.entries(stored)) if (ex._prompt === promptHash) cache[id] = ex;

const todo = ideas.filter((i) => !cache[i.id]);
console.log(`${ideas.length} ideas · ${todo.length} to extract · ${ideas.length - todo.length} cached\n`);

if (todo.length && !process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set.\n  cp .env.example .env   and put your key in it, then run npm start");
  process.exit(1);
}

// small concurrency so a re-run is quick but we don't hammer the API
const QUEUE = [...todo];
const failed = [];
async function worker() {
  while (QUEUE.length) {
    const idea = QUEUE.shift();
    try {
      cache[idea.id] = { ...(await extract(idea.raw, idea.clarification)), _prompt: promptHash };
      process.stdout.write(".");
    } catch (err) {
      failed.push(idea.id);
      console.error(`\n  ${idea.id}: ${err.message}`);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);

// ---------- resolve proposed capabilities against the table ----------
// sequential on purpose: each resolution can see what earlier ones proposed
const runId = new Date().toISOString().slice(0, 16);
const registry = loadRegistry();
const fresh = new Set(todo.map((i) => i.id));
if (todo.length) console.log("\n");
if (failed.length) {
  // A partial cache written over the committed baseline is the same problem as
  // an empty one: out/ is the baseline, so a run that lost any idea writes nothing.
  console.error(`${failed.length} of ${ideas.length} ideas FAILED to extract: ${failed.join(", ")}`);
  console.error(`out/extractions.json and out/proposed.json NOT written; fix the cause and run again. Report below is from the ${Object.keys(cache).length} that succeeded.\n`);
} else {
  for (const idea of ideas) if (fresh.has(idea.id) && cache[idea.id]) await resolveExtraction(cache[idea.id], idea, registry, runId);
  saveRegistry(registry);
  writeFileSync(CACHE, JSON.stringify(cache, null, 2));
}

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

// ---------- resolution summary ----------

const how = {};
for (const r of clear) for (const cap of r.ex.capabilities) how[cap.resolved || "?"] = (how[cap.resolved || "?"] || 0) + 1;
console.log(`\n${"=".repeat(72)}`);
console.log("RESOLUTION — how each capability got its skill id");
console.log("-".repeat(72));
for (const [k, n] of Object.entries(how).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
const rescued = clear.flatMap((r) => r.ex.capabilities.filter((c) => c.resolved_from && c.skill_id).map((c) => `${r.id}: ${c.resolved_from} -> ${c.skill_id}`));
if (rescued.length) { console.log("  proposed by the model, matched to an existing skill:"); for (const x of rescued) console.log(`    ${x}`); }

const due = dueForReview(registry);
const rejected = Object.values(registry).filter((e) => e.rejected).length;
const promoted = Object.values(registry).filter((e) => e.promoted).length;
const once = Object.keys(registry).length - due.length - rejected - promoted;
console.log(`\n${"=".repeat(72)}`);
console.log(`PROPOSED SKILLS DUE FOR REVIEW (${due.length}) — seen for 2+ ideas or in 2+ runs`);
console.log("-".repeat(72));
for (const [key, e] of due) {
  console.log(`  ${key}   ideas: ${e.ideas.join(", ")}   runs: ${e.runs.length}${e.crux_count ? `   crux ×${e.crux_count}` : ""}`);
  if (e.names.length > 1) console.log(`      also seen as: ${e.names.filter((n) => n !== key).join(", ")}`);
  console.log(`      ${e.reasons[0]}`);
}
if (!due.length) console.log("  (none yet)");
console.log(`\n${once} more proposal${once === 1 ? "" : "s"} seen only once — not listed; they surface if they recur. ${rejected} rejected, ${promoted} promoted to skills.\n`);
