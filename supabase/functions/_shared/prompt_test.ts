// Parity: the Deno prompt must be byte-identical to extraction/src/extract.js.
// Run from the repo root:
//   deno test --allow-read --allow-env supabase/functions/_shared/

import { assertEquals } from "jsr:@std/assert@1";
import { promptHash, type Skill, systemPrompt, TOOL } from "./prompt.ts";
// Node module under Deno's node compat. It reads skills.json at import time.
import { MODEL as NODE_MODEL, promptHash as NODE_HASH, SYSTEM as NODE_SYSTEM, TOOL as NODE_TOOL } from "../../../extraction/src/extract.js";

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
  assertEquals(await promptHash(NODE_MODEL, skills), NODE_HASH);
});
