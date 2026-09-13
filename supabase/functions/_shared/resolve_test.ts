// Run from the repo root:
//   deno test --allow-read --allow-env supabase/functions/_shared/

import { assertEquals } from "jsr:@std/assert@1";
import type { Skill } from "./prompt.ts";
import {
  buildIndex, capabilityRows, type Capability, dueForReview, type Extraction, invalidExtraction,
  lexical, record, type Registry, resolveExtraction, type SemanticFn
} from "./resolve.ts";
// The Node original, for parity on the pure parts.
import { lexical as nodeLexical } from "../../../extraction/src/resolve.js";

const skills: Skill[] = JSON.parse(await Deno.readTextFile(new URL("../../../extraction/data/skills.json", import.meta.url)));
const index = buildIndex(skills);

Deno.test("lexical: exact id, exact alias, token containment, no match", () => {
  assertEquals(lexical(index, "parametric-cad"), { id: "parametric-cad", how: "exact" });
  assertEquals(lexical(index, "CAD"), { id: "parametric-cad", how: "exact" });
  assertEquals(lexical(index, "fusion 360 modeling"), { id: "parametric-cad", how: "tokens" });
  assertEquals(lexical(index, "xyzzy plugh"), null);
});

Deno.test("lexical: agrees with the Node original on every alias and registry name", async () => {
  const reg = JSON.parse(await Deno.readTextFile(new URL("../../../extraction/out/proposed.json", import.meta.url)));
  const names = new Set<string>([
    ...skills.flatMap((s) => [s.id, s.name, ...(s.aliases || [])]),
    ...Object.values(reg as Record<string, { names: string[] }>).flatMap((e) => e.names),
    "auth", "label design", "fetch stock prices from an api", "design a printed clamp"
  ]);
  for (const n of names) assertEquals(lexical(index, n), nodeLexical(n), `lexical("${n}")`);
});

Deno.test("record: accumulates names, caps reasons at 5, counts a run once", () => {
  const reg: Registry = new Map();
  for (let i = 0; i < 7; i++) record(reg, "k", `name${i % 2}`, `reason${i}`, "idea-a", "run-1");
  record(reg, "k", "name0", "reason9", "idea-b", "run-2");
  const e = reg.get("k")!;
  assertEquals(e.names, ["name0", "name1"]);
  assertEquals(e.reasons.length, 5);
  assertEquals(e.idea_ids, ["idea-a", "idea-b"]);
  assertEquals(e.run_count, 2);
  assertEquals(e.dirty, true);
});

function extraction(caps: Partial<Capability>[]): Extraction {
  return {
    clear: true, clarifying_question: null, objective: "x", domain: "fabrication",
    capabilities: caps.map((c) => ({ skill_id: null, proposed_name: null, reason: "r", is_crux: false, ...c }))
  };
}
const idea = { id: "idea-1", raw: "a thing" };
const never: SemanticFn = () => { throw new Error("semantic should not be called"); };

Deno.test("resolve: direct, lexical, unknown id becomes proposed, collapse keeps crux", async () => {
  const ex = extraction([
    { skill_id: "parametric-cad" },
    { proposed_name: "fusion 360 modeling", is_crux: true },   // lexical -> parametric-cad, merges into the first
    { skill_id: "not-a-real-skill" }                           // unknown id -> proposed -> semantic
  ]);
  const semantic: SemanticFn = async () => ({ match: "new", id: null, why: "nothing fits" });
  const reg: Registry = new Map();
  await resolveExtraction(ex, idea, reg, "run-1", { skills, semantic, log: () => {} });
  assertEquals(ex.capabilities.length, 2);
  assertEquals(ex.capabilities[0].skill_id, "parametric-cad");
  assertEquals(ex.capabilities[0].is_crux, true);
  assertEquals(ex.capabilities[0].merged_from, ["fusion 360 modeling"]);
  assertEquals(ex.capabilities[1].resolved, "new");
  assertEquals(ex.capabilities[1].proposed_name, "not-a-real-skill");
  assertEquals(reg.get("not-a-real-skill")?.idea_ids, ["idea-1"]);
});

Deno.test("resolve: semantic previous / promoted / canonical / failure", async () => {
  const reg: Registry = new Map([
    ["haptic-feel", { key: "haptic-feel", names: ["haptic feel"], reasons: [], idea_ids: [], run_count: 1, crux_count: 0, rejected: null, promoted: null }],
    ["old-cad", { key: "old-cad", names: ["old cad"], reasons: [], idea_ids: [], run_count: 1, crux_count: 0, rejected: null, promoted: "parametric-cad" }]
  ]);
  const answers: Record<string, ReturnType<SemanticFn>> = {
    "detent-tuning": Promise.resolve({ match: "previous", id: "haptic-feel", why: "same concept" }),
    "cad-thing": Promise.resolve({ match: "previous", id: "old-cad", why: "promoted" }),
    "bldc-stuff": Promise.resolve({ match: "canonical", id: "bldc-foc", why: "covered" }),
    "boom": Promise.reject(new Error("API 500"))
  };
  const semantic: SemanticFn = (name) => answers[name];
  const ex = extraction([
    { proposed_name: "detent-tuning", is_crux: true },
    { proposed_name: "cad-thing" },
    { proposed_name: "bldc-stuff" },
    { proposed_name: "boom" }
  ]);
  await resolveExtraction(ex, idea, reg, "run-2", { skills, semantic, log: () => {} });
  const [a, b, c, d] = ex.capabilities;
  assertEquals([a.resolved, a.proposed_name, a.skill_id], ["semantic:previous", "haptic-feel", null]);
  assertEquals(reg.get("haptic-feel")?.crux_count, 1);
  assertEquals(reg.get("haptic-feel")?.run_count, 2);
  assertEquals([b.resolved, b.skill_id], ["semantic:promoted", "parametric-cad"]);
  assertEquals([c.resolved, c.skill_id], ["semantic:canonical", "bldc-foc"]);
  assertEquals([d.resolved, d.proposed_name], ["new", "boom"]);   // failure falls through to new
  assertEquals(reg.get("old-cad")?.dirty, undefined);            // promoted entries are not touched
});

Deno.test("resolve: unclear extraction is left alone", async () => {
  const ex = extraction([{ proposed_name: "anything" }]);
  ex.clear = false;
  const reg: Registry = new Map();
  await resolveExtraction(ex, idea, reg, "run-3", { skills, semantic: never });
  assertEquals(ex.capabilities[0].resolved, undefined);
  assertEquals(reg.size, 0);
});

Deno.test("capabilityRows: one crux, no duplicate proposed keys, nulls filled", () => {
  const rows = capabilityRows("idea-1", "run-1", [
    { skill_id: "parametric-cad", proposed_name: null, reason: "a", is_crux: true, resolved: "direct" },
    { skill_id: "bldc-foc", proposed_name: null, reason: "b", is_crux: true, resolved: "direct" },
    { skill_id: null, proposed_name: "new-thing", reason: "c", is_crux: false, resolved: "new" },
    { skill_id: null, proposed_name: "new-thing", reason: "c again", is_crux: false, resolved: "semantic:previous" }
  ]);
  assertEquals(rows.length, 3);
  assertEquals(rows.map((r) => r.crux_rank), [1, null, null]);
  assertEquals(rows[2].proposed_key, "new-thing");
  assertEquals(rows[2].skill_id, null);
  assertEquals(rows[0].resolved_from, null);
});

Deno.test("invalidExtraction: accepts a good record, rejects the shapes Sonnet 5 has produced", () => {
  const cap = { skill_id: "parametric-cad", proposed_name: null, reason: "r", is_crux: true };
  assertEquals(invalidExtraction({ clear: true, clarifying_question: null, objective: "o", domain: "d", capabilities: [cap] }), null);
  assertEquals(invalidExtraction({ clear: false, clarifying_question: "q?", objective: null, domain: null, capabilities: [] }), null);
  // the whole record double-encoded as a string inside capabilities
  assertEquals(invalidExtraction({ capabilities: "{\"clear\": true, \"capabilities\": [" }), "clear is not a boolean");
  assertEquals(invalidExtraction({ clear: true, capabilities: "[]" }), "capabilities is not an array");
  // a clear idea with nothing to build
  assertEquals(invalidExtraction({ clear: true, capabilities: [] }), "clear extraction with no capabilities");
  assertEquals(invalidExtraction(undefined), "no tool input");
  assertEquals(invalidExtraction("text"), "no tool input");
});

Deno.test("dueForReview: 2+ ideas or 2+ runs, never rejected or promoted", () => {
  const reg: Registry = new Map([
    ["a", { key: "a", names: [], reasons: [], idea_ids: ["1", "2"], run_count: 1, crux_count: 0, rejected: null, promoted: null }],
    ["b", { key: "b", names: [], reasons: [], idea_ids: ["1"], run_count: 3, crux_count: 0, rejected: null, promoted: null }],
    ["c", { key: "c", names: [], reasons: [], idea_ids: ["1"], run_count: 1, crux_count: 0, rejected: null, promoted: null }],
    ["d", { key: "d", names: [], reasons: [], idea_ids: ["1", "2"], run_count: 5, crux_count: 0, rejected: "no", promoted: null }]
  ]);
  assertEquals(dueForReview(reg).map((e) => e.key), ["b", "a"]);
});
