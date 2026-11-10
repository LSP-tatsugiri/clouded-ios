// Parity: the Deno prompt must be byte-identical to extraction/src/extract.js.
// Run from the repo root:
//   deno test --allow-read --allow-env supabase/functions/_shared/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { promptHash, type Skill, systemPrompt, TOOL } from "./prompt.ts";
import { RESOLVE_TOOL } from "./resolve.ts";
// Node module under Deno's node compat. It reads skills.json at import time.
import { MODEL as NODE_MODEL, promptHash as NODE_HASH, SYSTEM as NODE_SYSTEM, TOOL as NODE_TOOL } from "../../../extraction/src/extract.js";
import { RESOLVE_TOOL as NODE_RESOLVE_TOOL } from "../../../extraction/src/resolve.js";

const skills: Skill[] = JSON.parse(await Deno.readTextFile(new URL("../../../extraction/data/skills.json", import.meta.url)));

Deno.test("system prompt matches extract.js byte for byte", () => {
  assertEquals(systemPrompt(skills), NODE_SYSTEM);
});

Deno.test("tool schema matches extract.js", () => {
  assertEquals(JSON.stringify(TOOL), JSON.stringify(NODE_TOOL));
});

Deno.test("prompt hash matches extract.js", async () => {
  // Compared with each other rather than with a pinned literal: the hash is
  // meant to move whenever the skill table or the prompt does, and the
  // literal this used to pin went stale the first time skills.json changed
  // (red from 2026-09-15). Whether the committed baseline in out/ is current
  // is a separate question, answered by npm start re-extracting or not.
  //
  // It moved on 2026-11-10 from b6a035830560 to 57810805f527 (claude-sonnet-5), for
  // three reasons at once: the assumption field, the per-capability
  // iteration field, and strict: true on the tool (with
  // additionalProperties: false). Not pinned, for the reason above; written
  // down so the re-baseline that follows can be matched to this commit.
  assertEquals(await promptHash(NODE_MODEL, skills), NODE_HASH);
});

// Strict tool use (grammar-constrained sampling) accepts a subset of JSON
// Schema; a schema outside it is a 400 on every call, which the web client
// would show as every idea failing. The rules checked here are the ones in
// https://platform.claude.com/docs/en/build-with-claude/structured-outputs
// (JSON Schema limitations), read 2026-11-10: additionalProperties must be
// false on every object; every property is listed in required (optional ones
// count against a limit of 24 and lose their place in the output order); no
// numeric or string-length constraints, no minItems above 1, no maxItems; at
// most 16 union-typed properties per request.
const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems", "uniqueItems", "patternProperties"];

function strictProblems(s: Record<string, unknown>, at: string, out: string[], unions: { n: number }): string[] {
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (Array.isArray(s.type) || s.anyOf) unions.n++;
  for (const k of UNSUPPORTED) if (k in s) out.push(`${at}: ${k} is not supported`);
  if (typeof s.minItems === "number" && s.minItems > 1) out.push(`${at}: minItems above 1`);
  if (typeof s.pattern === "string" && /\\[bB]|\(\?[=!<]|\\\d/.test(s.pattern)) out.push(`${at}: pattern uses an unsupported construct`);
  if (types.includes("object")) {
    const props = (s.properties ?? {}) as Record<string, Record<string, unknown>>;
    if (s.additionalProperties !== false) out.push(`${at}: additionalProperties is not false`);
    const req = new Set((s.required ?? []) as string[]);
    for (const k of Object.keys(props)) {
      if (!req.has(k)) out.push(`${at}.${k}: not in required`);
      strictProblems(props[k], `${at}.${k}`, out, unions);
    }
    for (const k of req) if (!(k in props)) out.push(`${at}: required names unknown ${k}`);
  }
  if (types.includes("array") && s.items) strictProblems(s.items as Record<string, unknown>, `${at}[]`, out, unions);
  return out;
}

Deno.test("record_extraction meets the strict-mode schema rules", () => {
  assertEquals(TOOL.strict, true);
  const unions = { n: 0 };
  assertEquals(strictProblems(TOOL.input_schema, "input", [], unions), []);
  assert(unions.n <= 16, `${unions.n} union-typed properties`);
});

Deno.test("resolve_skill meets the strict-mode schema rules and matches resolve.js", () => {
  assertEquals(RESOLVE_TOOL.strict, true);
  assertEquals(strictProblems(RESOLVE_TOOL.input_schema, "input", [], { n: 0 }), []);
  assertEquals(JSON.stringify(RESOLVE_TOOL), JSON.stringify(NODE_RESOLVE_TOOL));
});

Deno.test("the two new fields are in the schema with the values the migration allows", () => {
  const top = TOOL.input_schema.properties;
  assertEquals(top.assumption.type, ["string", "null"]);
  const item = top.capabilities.items.properties;
  // idea_capabilities_iteration in 20261110161336_assumption_and_iteration.sql
  assertEquals(item.iteration.enum, ["tutorial", "iteration"]);
  // the shapes the checker must catch, so a pass above means something
  assertEquals(strictProblems({ type: "object", properties: { a: { type: "string" } } }, "x", [], { n: 0 }),
    ["x: additionalProperties is not false", "x.a: not in required"]);
  assertEquals(strictProblems({ type: "array", items: { type: "object", properties: {}, additionalProperties: true }, maxItems: 7 }, "y", [], { n: 0 }),
    ["y: maxItems is not supported", "y[]: additionalProperties is not false"]);
});
