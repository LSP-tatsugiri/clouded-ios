import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { callTool } from "./anthropic.ts";

const tool = { name: "t", description: "d", input_schema: {} };
const req = { model: "m", system: "s", tool, user: "u", maxTokens: 42 };

function withFetch(handler: (init: RequestInit) => Response, fn: () => Promise<void>) {
  return async () => {
    Deno.env.set("ANTHROPIC_API_KEY", "test-key");
    const real = globalThis.fetch;
    globalThis.fetch = ((_: unknown, init?: RequestInit) => Promise.resolve(handler(init!))) as typeof fetch;
    try { await fn(); } finally { globalThis.fetch = real; }
  };
}

Deno.test("callTool disables thinking, forces the tool, and reports stop_reason and usage", withFetch(
  (init) => {
    const sent = JSON.parse(init.body as string);
    assertEquals(sent.thinking, { type: "disabled" });
    assertEquals(sent.max_tokens, 42);
    assertEquals(sent.tool_choice, { type: "tool", name: "t" });
    assertEquals(sent.messages, [{ role: "user", content: "u" }]);
    return new Response(JSON.stringify({
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
      content: [{ type: "tool_use", name: "t", input: { partial: true } }]
    }), { status: 200 });
  },
  async () => {
    const r = await callTool<{ partial: boolean }>(req);
    assertEquals(r.input, { partial: true });
    assertEquals(r.stop_reason, "max_tokens");
    assertEquals(r.usage, { input_tokens: 10, output_tokens: 5 });
  }
));

Deno.test("callTool returns undefined input when there is no tool_use block", withFetch(
  () => new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "no" }] }), { status: 200 }),
  async () => {
    const r = await callTool(req);
    assertEquals(r.input, undefined);
    assertEquals(r.stop_reason, "end_turn");
  }
));

Deno.test("callTool throws with status and body on a non-2xx response", withFetch(
  () => new Response("credit balance too low", { status: 400 }),
  async () => {
    await assertRejects(() => callTool(req), Error, "API 400: credit balance too low");
  }
));
