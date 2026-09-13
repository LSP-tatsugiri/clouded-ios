// Parity: the Deno prompt must be byte-identical to extraction/src/extract.js.
// Run from the repo root:
//   deno test --allow-read --allow-env supabase/functions/_shared/

import { assertEquals } from "jsr:@std/assert@1";
import { promptHash, type Skill, systemPrompt, TOOL } from "./prompt.ts";
// Node module under Deno's node compat. It reads skills.json at import time.
import { SYSTEM as NODE_SYSTEM, TOOL as NODE_TOOL } from "../../../extraction/src/extract.js";

const skills: Skill[] = JSON.parse(await Deno.readTextFile(new URL("../../../extraction/data/skills.json", import.meta.url)));

Deno.test("system prompt matches extract.js byte for byte", () => {
  assertEquals(systemPrompt(skills), NODE_SYSTEM);
});

Deno.test("tool schema matches extract.js", () => {
  assertEquals(JSON.stringify(TOOL), JSON.stringify(NODE_TOOL));
});

Deno.test("prompt hash reproduces the committed baseline", async () => {
  // extraction/out/extractions.json entries carry _prompt: "d32dedbfd074",
  // produced on sonnet-4-5 with the default MODEL in extract.js.
  assertEquals(await promptHash("claude-sonnet-4-5-20250929", skills), "d32dedbfd074");
});
