// Runs extraction N times with the SAME prompt and reports how much the model
// wobbles on its own. Run this before judging any prompt change: a change that
// moves a crux is only meaningful if the crux was stable to begin with.
//
//   node --env-file=.env src/stability.js        # 3 runs
//   node --env-file=.env src/stability.js 5      # 5 runs
//
// Writes out/stability/run-<k>.json and prints, per idea, whether the crux and
// the skill set agree across runs.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extract, promptHash } from "./extract.js";
import { resolveExtraction, loadRegistry } from "./resolve.js";

const N = Number(process.argv[2]) || 3;
const ideas = JSON.parse(readFileSync(new URL("../data/ideas.json", import.meta.url)));
const DIR = new URL("../out/stability/", import.meta.url);
mkdirSync(DIR, { recursive: true });

async function runOnce(k) {
  const out = {};
  const queue = [...ideas];
  let failed = 0;
  async function worker() {
    while (queue.length) {
      const idea = queue.shift();
      try { out[idea.id] = await extract(idea.raw, idea.clarification); }
      catch (err) { failed++; console.error(`\n  run ${k} ${idea.id}: ${err.message}`); }
      process.stdout.write(".");
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (failed) {
    console.error(`\nrun ${k}: ${failed} of ${ideas.length} extractions failed — a partial run would make the stability numbers meaningless. Aborting; nothing written.`);
    process.exit(1);
  }
  // resolve against a copy of the real registry; stability runs don't write to it
  const reg = structuredClone(loadRegistry());
  for (const idea of ideas) if (out[idea.id]) await resolveExtraction(out[idea.id], idea, reg, `stability-${k}`);
  writeFileSync(new URL(`run-${k}.json`, DIR), JSON.stringify({ _prompt: promptHash, ...out }, null, 2));
  return out;
}

console.log(`${N} runs × ${ideas.length} ideas, prompt ${promptHash}`);
const runs = [];
for (let k = 1; k <= N; k++) { runs.push(await runOnce(k)); console.log(` run ${k} done`); }

const crux = (ex) => ex?.clear ? (ex.capabilities.find((c) => c.is_crux)?.skill_id ?? `?${ex.capabilities.find((c) => c.is_crux)?.proposed_name}`) : "VAGUE";
const skillSet = (ex) => new Set(ex?.clear ? ex.capabilities.map((c) => c.skill_id || `?${c.proposed_name}`) : []);
const jaccard = (a, b) => { const u = new Set([...a, ...b]); if (!u.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / u.size; };

let cruxStable = 0, vagueStable = 0, jacSum = 0;
console.log(`\n${"idea".padEnd(12)} ${"crux agreement".padEnd(16)} ${"skill overlap".padEnd(14)} cruxes seen`);
console.log("-".repeat(78));
for (const idea of ideas) {
  const exs = runs.map((r) => r[idea.id]).filter(Boolean);
  const cruxes = exs.map(crux);
  const distinct = [...new Set(cruxes)];
  const vagueAgree = new Set(exs.map((e) => !!e.clear)).size === 1;
  if (vagueAgree) vagueStable++;
  if (distinct.length === 1) cruxStable++;
  // mean pairwise Jaccard of the skill sets
  let pairs = 0, jac = 0;
  for (let i = 0; i < exs.length; i++) for (let j = i + 1; j < exs.length; j++) { jac += jaccard(skillSet(exs[i]), skillSet(exs[j])); pairs++; }
  const meanJac = pairs ? jac / pairs : 1;
  jacSum += meanJac;
  const flag = distinct.length === 1 ? "   " : " !!";
  console.log(`${idea.id.padEnd(12)} ${`${cruxes.filter((c) => c === distinct[0]).length}/${exs.length}`.padEnd(16)} ${meanJac.toFixed(2).padEnd(14)} ${distinct.join(" | ")}${flag}`);
}
console.log("-".repeat(78));
console.log(`crux identical across all runs: ${cruxStable}/${ideas.length}`);
console.log(`vague/clear verdict identical:  ${vagueStable}/${ideas.length}`);
console.log(`mean skill-set overlap:         ${(jacSum / ideas.length).toFixed(2)}  (1.00 = same skills every run)`);
