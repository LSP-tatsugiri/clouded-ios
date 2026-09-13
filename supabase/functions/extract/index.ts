// extract: runs the extraction pipeline for one idea.
//
// Called two ways:
//   1. Database webhook on ideas (INSERT, and UPDATE when clarification
//      changes). Payload: { type, table, record, old_record }.
//   2. Directly, for re-runs: { "idea_id": "<uuid>" }.
// Both carry the shared secret in the x-webhook-secret header; verify_jwt is
// off for this function (see supabase/config.toml).
//
// Order of writes is the point: extraction_runs first, then idea_capabilities,
// then the idea's status, then the proposal registry. A failure after the run
// row exists never loses the raw model output.

import { callTool } from "../_shared/anthropic.ts";
import { Db } from "../_shared/db.ts";
import { promptHash, systemPrompt, TOOL } from "../_shared/prompt.ts";
import { capabilityRows, type Extraction, makeSemantic, resolveExtraction } from "../_shared/resolve.ts";
import { ideaToRun, type WebhookPayload } from "../_shared/webhook.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const MODEL = Deno.env.get("MODEL") ?? "claude-sonnet-5";

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Compare digests, not raw strings: fixed length, no early exit on the secret.
async function authorized(req: Request): Promise<boolean> {
  const expected = Deno.env.get("WEBHOOK_SECRET");
  const given = req.headers.get("x-webhook-secret");
  if (!expected || !given) return false;
  return (await sha256(expected)) === (await sha256(given));
}

export async function run(ideaId: string, db = new Db()): Promise<void> {
  const idea = await db.getIdea(ideaId);
  const skills = await db.loadSkills();
  const system = systemPrompt(skills);
  const prompt_hash = await promptHash(MODEL, skills);

  let output: Extraction | undefined;
  try {
    output = await callTool<Extraction>({
      model: MODEL, system, tool: TOOL, maxTokens: 1500,
      user: `Raw captured idea:\n\n"${idea.raw}"${idea.clarification ? `\n\nThe person later clarified: "${idea.clarification}"` : ""}`
    });
    if (!output) throw new Error("model did not return structured output");
  } catch (err) {
    const error = (err as Error).message;
    console.error(`extract ${ideaId}: ${error}`);
    await db.writeRun({ idea_id: ideaId, model: MODEL, prompt_hash, error });
    await db.markIdea(ideaId, { status: "failed" });
    return;
  }

  // raw output is on disk before anything else happens to it
  const runId = await db.writeRun({ idea_id: ideaId, model: MODEL, prompt_hash, output: structuredClone(output) });

  try {
    const reg = await db.loadRegistry();
    await resolveExtraction(output, idea, reg, runId, { skills, semantic: makeSemantic(MODEL, skills) });
    await db.writeCapabilities(ideaId, capabilityRows(ideaId, runId, output.capabilities));
    await db.markIdea(ideaId, {
      objective: output.objective, domain: output.domain, is_clear: output.clear,
      clarifying_question: output.clarifying_question, status: "extracted"
    });
    await db.saveRegistry(reg);
  } catch (err) {
    console.error(`resolve ${ideaId} (run ${runId}): ${(err as Error).message}`);
    await db.markIdea(ideaId, { status: "failed" });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });

  let payload: WebhookPayload;
  try { payload = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const ideaId = ideaToRun(payload);
  if (!ideaId) return new Response(null, { status: 204 });

  // The webhook client times out in seconds; extraction takes longer. Ack now,
  // keep working. Falls back to awaiting where waitUntil is unavailable.
  const work = run(ideaId).catch((err) => console.error(`run ${ideaId}: ${(err as Error).message}`));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;

  return new Response(JSON.stringify({ queued: ideaId }), {
    status: 202, headers: { "content-type": "application/json" }
  });
});
