// One structured call to the Messages API. Plain fetch, no SDK, same headers
// and shape as extraction/src/extract.js and resolve.js.

const API = "https://api.anthropic.com/v1/messages";

export type ToolCall = {
  model: string;
  system: string;
  tool: { name: string; description: string; input_schema: unknown };
  user: string;
  maxTokens: number;
};

export async function callTool<T = unknown>(c: ToolCall): Promise<T | undefined> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set. supabase secrets set ANTHROPIC_API_KEY=...");

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: c.model,
      max_tokens: c.maxTokens,
      system: c.system,
      tools: [c.tool],
      tool_choice: { type: "tool", name: c.tool.name },
      messages: [{ role: "user", content: c.user }]
    })
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

  const body = await res.json();
  const block = body.content.find((b: { type: string }) => b.type === "tool_use");
  return block?.input as T | undefined;
}
