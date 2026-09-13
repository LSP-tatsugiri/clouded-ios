// Skill resolution: turn a proposed capability into a canonical skill_id, a
// previously-seen proposal, or a genuinely new proposal.
//
//   1. lexical  — normalise the name and compare against every skill's id, name
//                 and aliases (exact, then token overlap). Free.
//   2. semantic — one small structured call. Closed choice: a canonical id, a
//                 previously proposed slug, or "new". The model cannot invent a
//                 fourth name, which is what kills name drift.
//   3. registry — out/proposed.json accumulates every unmatched concept with the
//                 names it has been seen under, the ideas that needed it and how
//                 many runs proposed it. Review is driven from here, not per run.
//
// Embedding similarity (pgvector later) would slot in between 1 and 2; Anthropic
// has no embeddings endpoint, so the semantic call does that job for now.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { skills } from "./extract.js";

const MODEL = process.env.MODEL || "claude-sonnet-4-5-20250929";
const API = "https://api.anthropic.com/v1/messages";
const REGISTRY = new URL("../out/proposed.json", import.meta.url);

// ---------- normalisation ----------

const STOP = new Set(["a", "an", "the", "of", "for", "to", "and", "or", "with", "in", "on", "design", "designing"]);
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const tokens = (s) => new Set(slug(s).split("-").filter((t) => t && !STOP.has(t)).map(stem));
function stem(t) {
  return t.replace(/(ing|ed|es|s)$/, (m, _, i) => (t.length - m.length >= 4 ? "" : m));
}


const index = skills.map((s) => ({
  id: s.id,
  names: [s.id, s.name, ...(s.aliases || [])].map(slug),
  toks: [s.id, s.name, ...(s.aliases || [])].map(tokens)
}));

export function lexical(name) {
  const n = slug(name), t = tokens(name);
  for (const s of index) if (s.names.includes(n)) return { id: s.id, how: "exact" };
  // token match: the shorter side must be fully contained in the other, and the
  // shared part must be at least two tokens (a one-word alias like "CAD" or
  // "auth" would otherwise swallow anything that mentions it)
  let best = null, bestInter = 0, bestLen = 0;
  for (const s of index) for (const st of s.toks) {
    let inter = 0; for (const x of t) if (st.has(x)) inter++;
    const contained = inter === Math.min(t.size, st.size);
    const ok = contained && (inter >= 2 || (t.size === 1 && st.size === 1 && inter === 1));
    if (ok && (inter > bestInter || (inter === bestInter && st.size > bestLen))) { best = s.id; bestInter = inter; bestLen = st.size; }
  }
  return best ? { id: best, how: "tokens" } : null;
}

// ---------- registry ----------

export function loadRegistry() {
  return existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY)) : {};
}
export function saveRegistry(reg) {
  mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
}
function record(reg, key, name, reason, ideaId, runId) {
  const e = (reg[key] ||= { names: [], reasons: [], ideas: [], runs: [], crux_count: 0 });
  if (!e.names.includes(name)) e.names.push(name);
  if (reason && e.reasons.length < 5 && !e.reasons.includes(reason)) e.reasons.push(reason);
  if (!e.ideas.includes(ideaId)) e.ideas.push(ideaId);
  if (runId && !e.runs.includes(runId)) e.runs.push(runId);
  return e;
}

// ---------- semantic ----------

const TOOL = {
  name: "resolve_skill",
  description: "Decide what a proposed capability actually is.",
  input_schema: {
    type: "object",
    properties: {
      match: { type: "string", enum: ["canonical", "previous", "new"] },
      id: { type: ["string", "null"], description: "the canonical skill id or the previous proposal slug; null when new" },
      why: { type: "string", description: "one clause" }
    },
    required: ["match", "id", "why"]
  }
};

async function semantic(name, reason, ideaRaw, previous) {
  const key = process.env.ANTHROPIC_API_KEY;
  const canon = skills.map((s) => `- ${s.id}: ${s.name}${s.aliases?.length ? ` [${s.aliases.join(", ")}]` : ""}`).join("\n");
  const prev = previous.length ? previous.map((p) => `- ${p.key}: ${p.names.join(" / ")} — ${p.reasons[0] || ""}${p.rejected ? "   [REJECTED by the owner: not a skill]" : ""}`).join("\n") : "(none yet)";
  const system = `You resolve a proposed capability against a skill table. A skill is a reusable,
checkable task; the same skill appears across many different projects.

Rules, in order:
1. If a CANONICAL skill's task or aliases would cover the work, answer canonical
   with that id — even if the proposal is narrower or worded differently.
   "golf bag attachment" is covered by a skill about measuring an object and
   designing a part that fits it. Prefer the canonical match when it fits.
   It must be the SAME MEDIUM as the idea: a hand drawing is not a Blender
   scene, a web app is not an iOS app, a printed part is not a PCB. A skill
   from the wrong medium is never a match, however similar the words.
2. Otherwise, if a PREVIOUS proposal is the same underlying capability under a
   different name, answer previous with that slug. Same concept, not same words.
3. Only if neither: answer new. A project-specific detail ("label the bins",
   "attach to a golf bag") is still "new" here — it gets reviewed later.
A previous proposal marked REJECTED is still the right answer for the same
concept — answer previous with it, so the rejection sticks.

CANONICAL:
${canon}

PREVIOUS PROPOSALS:
${prev}`;

  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1024, thinking: { type: "disabled" }, system, tools: [TOOL],
      tool_choice: { type: "tool", name: "resolve_skill" },
      messages: [{ role: "user", content: `Proposed capability: "${name}"\nWhy the idea needs it: ${reason}\nThe idea: "${ideaRaw}"` }]
    })
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const block = (await res.json()).content.find((b) => b.type === "tool_use");
  return block?.input;
}

// ---------- entry point ----------

// Mutates `extraction` in place: fills skill_id where a match is found, and
// annotates each capability with how it was resolved. Returns the registry.
export async function resolveExtraction(extraction, idea, reg, runId) {
  if (!extraction?.clear) return reg;
  const validIds = new Set(skills.map((s) => s.id));
  for (const cap of extraction.capabilities) {
    // the model sometimes writes an id that isn't in the table; treat as proposed
    if (cap.skill_id && !validIds.has(cap.skill_id)) { cap.proposed_name = cap.proposed_name || cap.skill_id; cap.skill_id = null; }
    if (cap.skill_id) { cap.resolved = "direct"; continue; }
    const name = cap.proposed_name || "unnamed";
    const lex = lexical(name);
    if (lex) { cap.skill_id = lex.id; cap.resolved = `lexical:${lex.how}`; cap.resolved_from = name; continue; }
    const previous = Object.entries(reg).map(([key, e]) => ({ key, ...e }));
    let r;
    try { r = await semantic(name, cap.reason, idea.raw, previous); }
    catch (err) { console.error(`\n  resolve ${idea.id}/${name}: ${err.message}`); }
    if (r?.match === "canonical" && validIds.has(r.id)) {
      cap.skill_id = r.id; cap.resolved = "semantic:canonical"; cap.resolved_from = name; cap.resolve_why = r.why;
    } else if (r?.match === "previous" && reg[r.id]?.promoted && validIds.has(reg[r.id].promoted)) {
      cap.skill_id = reg[r.id].promoted; cap.resolved = "semantic:promoted"; cap.resolved_from = name; cap.resolve_why = r.why;
    } else if (r?.match === "previous" && reg[r.id]) {
      cap.resolved = "semantic:previous"; cap.resolved_from = name; cap.proposed_name = r.id; cap.resolve_why = r.why;
      const e = record(reg, r.id, name, cap.reason, idea.id, runId); if (cap.is_crux) e.crux_count++;
    } else {
      const key = slug(name);
      cap.resolved = "new"; cap.proposed_name = key;
      const e = record(reg, key, name, cap.reason, idea.id, runId); if (cap.is_crux) e.crux_count++;
    }
  }
  // two capabilities that resolved to the same skill collapse into one (keep crux)
  const seen = new Map();
  extraction.capabilities = extraction.capabilities.filter((cap) => {
    if (!cap.skill_id) return true;
    const prev = seen.get(cap.skill_id);
    if (!prev) { seen.set(cap.skill_id, cap); return true; }
    if (cap.is_crux) prev.is_crux = true;
    prev.merged_from = [...(prev.merged_from || []), cap.resolved_from || cap.proposed_name].filter(Boolean);
    return false;
  });
  return reg;
}

// Which registry entries have earned a human look: seen for 2+ ideas, or 2+ runs.
// Review outcomes live in out/proposed.json as fields on the entry:
//   "rejected": "<why>"      — not a skill; keeps accumulating, never surfaces again
//   "promoted": "<skill_id>" — added to skills.json under that id; later matches
//                              to this entry resolve straight to the skill
export function dueForReview(reg) {
  return Object.entries(reg)
    .filter(([, e]) => !e.rejected && !e.promoted && (e.ideas.length >= 2 || e.runs.length >= 2))
    .sort((a, b) => b[1].ideas.length + b[1].runs.length - (a[1].ideas.length + a[1].runs.length));
}
