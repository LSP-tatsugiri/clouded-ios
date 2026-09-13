// Skill resolution, ported from extraction/src/resolve.js. Same three steps:
//
//   1. lexical  — normalise the name and compare against every skill's id, name
//                 and aliases (exact, then token overlap). Free.
//   2. semantic — one small structured call. Closed choice: a canonical id, a
//                 previously proposed slug, or "new". The model cannot invent a
//                 fourth name, which is what kills name drift.
//   3. registry — proposed_skills rows accumulate every unmatched concept with
//                 the names it has been seen under, the ideas that needed it and
//                 how many runs proposed it. Review is driven from there.
//
// Differences from the Node version: the registry is a Map of table rows
// instead of a JSON file, the skill index is built per call from the table, and
// the semantic call is injectable so tests never touch the network.

import { callTool } from "./anthropic.ts";
import type { Skill } from "./prompt.ts";

export type Capability = {
  skill_id: string | null;
  proposed_name: string | null;
  reason: string;
  is_crux: boolean;
  resolved?: string;
  resolved_from?: string;
  resolve_why?: string;
  merged_from?: string[];
};

export type Extraction = {
  clear: boolean;
  clarifying_question: string | null;
  objective: string | null;
  domain: string | null;
  capabilities: Capability[];
};

// One proposed_skills row, plus bookkeeping for this invocation.
export type RegistryEntry = {
  key: string;
  names: string[];
  reasons: string[];
  idea_ids: string[];
  run_count: number;
  crux_count: number;
  rejected: string | null;
  promoted: string | null;
  dirty?: boolean;
  _runs?: Set<string>; // runs counted during this invocation
};

export type Registry = Map<string, RegistryEntry>;

// ---------- normalisation ----------

const STOP = new Set(["a", "an", "the", "of", "for", "to", "and", "or", "with", "in", "on", "design", "designing"]);
export const slug = (s: unknown) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const tokens = (s: string) => new Set(slug(s).split("-").filter((t) => t && !STOP.has(t)).map(stem));
function stem(t: string) {
  return t.replace(/(ing|ed|es|s)$/, (m) => (t.length - m.length >= 4 ? "" : m));
}

// ---------- lexical ----------

export type Index = { id: string; names: string[]; toks: Set<string>[] }[];

export function buildIndex(skills: Skill[]): Index {
  return skills.map((s) => ({
    id: s.id,
    names: [s.id, s.name, ...(s.aliases || [])].map(slug),
    toks: [s.id, s.name, ...(s.aliases || [])].map(tokens)
  }));
}

export function lexical(index: Index, name: string): { id: string; how: "exact" | "tokens" } | null {
  const n = slug(name), t = tokens(name);
  for (const s of index) if (s.names.includes(n)) return { id: s.id, how: "exact" };
  // token match: the shorter side must be fully contained in the other, and the
  // shared part must be at least two tokens (a one-word alias like "CAD" or
  // "auth" would otherwise swallow anything that mentions it)
  let best: string | null = null, bestInter = 0, bestLen = 0;
  for (const s of index) for (const st of s.toks) {
    let inter = 0; for (const x of t) if (st.has(x)) inter++;
    const contained = inter === Math.min(t.size, st.size);
    const ok = contained && (inter >= 2 || (t.size === 1 && st.size === 1 && inter === 1));
    if (ok && (inter > bestInter || (inter === bestInter && st.size > bestLen))) { best = s.id; bestInter = inter; bestLen = st.size; }
  }
  return best ? { id: best, how: "tokens" } : null;
}

// ---------- registry ----------

export function record(reg: Registry, key: string, name: string, reason: string, ideaId: string, runId: string): RegistryEntry {
  let e = reg.get(key);
  if (!e) {
    e = { key, names: [], reasons: [], idea_ids: [], run_count: 0, crux_count: 0, rejected: null, promoted: null };
    reg.set(key, e);
  }
  e.dirty = true;
  if (!e.names.includes(name)) e.names.push(name);
  if (reason && e.reasons.length < 5 && !e.reasons.includes(reason)) e.reasons.push(reason);
  if (!e.idea_ids.includes(ideaId)) e.idea_ids.push(ideaId);
  e._runs ??= new Set();
  if (runId && !e._runs.has(runId)) { e._runs.add(runId); e.run_count++; }
  return e;
}

// ---------- semantic ----------

const RESOLVE_TOOL = {
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

export type SemanticResult = { match: "canonical" | "previous" | "new"; id: string | null; why: string };
export type SemanticFn = (name: string, reason: string, ideaRaw: string, previous: RegistryEntry[]) => Promise<SemanticResult | undefined>;

export function makeSemantic(model: string, skills: Skill[]): SemanticFn {
  const canon = skills.map((s) => `- ${s.id}: ${s.name}${s.aliases?.length ? ` [${s.aliases.join(", ")}]` : ""}`).join("\n");
  return async (name, reason, ideaRaw, previous) => {
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

    return await callTool<SemanticResult>({
      model, system, tool: RESOLVE_TOOL, maxTokens: 300,
      user: `Proposed capability: "${name}"\nWhy the idea needs it: ${reason}\nThe idea: "${ideaRaw}"`
    });
  };
}

// ---------- entry point ----------

export type ResolveContext = {
  skills: Skill[];
  semantic: SemanticFn;
  log?: (msg: string) => void;
};

// Mutates `extraction` in place: fills skill_id where a match is found, and
// annotates each capability with how it was resolved. Returns the registry.
export async function resolveExtraction(
  extraction: Extraction,
  idea: { id: string; raw: string },
  reg: Registry,
  runId: string,
  ctx: ResolveContext
): Promise<Registry> {
  if (!extraction?.clear) return reg;
  const log = ctx.log ?? console.error;
  const index = buildIndex(ctx.skills);
  const validIds = new Set(ctx.skills.map((s) => s.id));
  for (const cap of extraction.capabilities) {
    // the model sometimes writes an id that isn't in the table; treat as proposed
    if (cap.skill_id && !validIds.has(cap.skill_id)) { cap.proposed_name = cap.proposed_name || cap.skill_id; cap.skill_id = null; }
    if (cap.skill_id) { cap.resolved = "direct"; continue; }
    const name = cap.proposed_name || "unnamed";
    const lex = lexical(index, name);
    if (lex) { cap.skill_id = lex.id; cap.resolved = `lexical:${lex.how}`; cap.resolved_from = name; continue; }
    const previous = [...reg.values()];
    let r: SemanticResult | undefined;
    try { r = await ctx.semantic(name, cap.reason, idea.raw, previous); }
    catch (err) { log(`resolve ${idea.id}/${name}: ${(err as Error).message}`); }
    const prevEntry = r?.id ? reg.get(r.id) : undefined;
    if (r?.match === "canonical" && r.id && validIds.has(r.id)) {
      cap.skill_id = r.id; cap.resolved = "semantic:canonical"; cap.resolved_from = name; cap.resolve_why = r.why;
    } else if (r?.match === "previous" && prevEntry?.promoted && validIds.has(prevEntry.promoted)) {
      cap.skill_id = prevEntry.promoted; cap.resolved = "semantic:promoted"; cap.resolved_from = name; cap.resolve_why = r.why;
    } else if (r?.match === "previous" && prevEntry) {
      cap.resolved = "semantic:previous"; cap.resolved_from = name; cap.proposed_name = prevEntry.key; cap.resolve_why = r.why;
      const e = record(reg, prevEntry.key, name, cap.reason, idea.id, runId); if (cap.is_crux) { e.crux_count++; e.dirty = true; }
    } else {
      const key = slug(name);
      cap.resolved = "new"; cap.proposed_name = key;
      const e = record(reg, key, name, cap.reason, idea.id, runId); if (cap.is_crux) { e.crux_count++; e.dirty = true; }
    }
  }
  // two capabilities that resolved to the same skill collapse into one (keep crux)
  const seen = new Map<string, Capability>();
  extraction.capabilities = extraction.capabilities.filter((cap) => {
    if (!cap.skill_id) return true;
    const prev = seen.get(cap.skill_id);
    if (!prev) { seen.set(cap.skill_id, cap); return true; }
    if (cap.is_crux) prev.is_crux = true;
    prev.merged_from = [...(prev.merged_from || []), cap.resolved_from || cap.proposed_name].filter((x): x is string => Boolean(x));
    return false;
  });
  return reg;
}

// ---------- rows ----------

export type CapabilityRow = {
  idea_id: string;
  run_id: string;
  skill_id: string | null;
  proposed_key: string | null;
  reason: string;
  crux_rank: 1 | null;
  resolved: string;
  resolved_from: string | null;
  resolve_why: string | null;
};

// idea_capabilities rows for one idea. Enforces what the unique indexes
// require: one row per skill, one per proposed key, at most one crux.
// crux_rank 2 is reserved for when the prompt returns a ranked top-2.
export function capabilityRows(ideaId: string, runId: string, caps: Capability[]): CapabilityRow[] {
  const rows: CapabilityRow[] = [];
  const seenProposed = new Set<string>();
  let cruxTaken = false;
  for (const cap of caps) {
    const proposedKey = cap.skill_id ? null : (cap.proposed_name ?? "unnamed");
    if (proposedKey) {
      if (seenProposed.has(proposedKey)) continue;
      seenProposed.add(proposedKey);
    }
    const crux = cap.is_crux && !cruxTaken;
    if (crux) cruxTaken = true;
    rows.push({
      idea_id: ideaId,
      run_id: runId,
      skill_id: cap.skill_id,
      proposed_key: proposedKey,
      reason: cap.reason,
      crux_rank: crux ? 1 : null,
      resolved: cap.resolved ?? (cap.skill_id ? "direct" : "new"),
      resolved_from: cap.resolved_from ?? null,
      resolve_why: cap.resolve_why ?? null
    });
  }
  return rows;
}

// Which registry entries have earned a human look: seen for 2+ ideas, or 2+ runs.
export function dueForReview(reg: Registry): RegistryEntry[] {
  return [...reg.values()]
    .filter((e) => !e.rejected && !e.promoted && (e.idea_ids.length >= 2 || e.run_count >= 2))
    .sort((a, b) => b.idea_ids.length + b.run_count - (a.idea_ids.length + a.run_count));
}
