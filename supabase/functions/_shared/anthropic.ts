// One structured call to the Messages API. Plain fetch, no SDK, same headers
// and shape as extraction/src/extract.js and resolve.js.
//
// Thinking is disabled on purpose. Sonnet 5 runs adaptive thinking when the
// request says nothing, thinking tokens count against max_tokens, and the
// baseline was produced without thinking. With thinking on and a small
// max_tokens the tool call comes back truncated or double-encoded.

const API = "https://api.anthropic.com/v1/messages";

export type ToolCall = {
  model: string;
  system: string;
  tool: { name: string; description: string; input_schema: unknown };
  user: string;
  maxTokens: number;
};

export type ToolResult<T> = {
  input: T | undefined;             // the tool_use block's input, possibly partial
  stop_reason: string | null;       // "tool_use" when complete; "max_tokens" when cut off
  usage?: { input_tokens: number; output_tokens: number };
};

export async function callTool<T = unknown>(c: ToolCall): Promise<ToolResult<T>> {
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
      thinking: { type: "disabled" },
      system: c.system,
      tools: [c.tool],
      tool_choice: { type: "tool", name: c.tool.name },
      messages: [{ role: "user", content: c.user }]
    })
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

  const body = await res.json();
  const block = body.content?.find((b: { type: string }) => b.type === "tool_use");
  return {
    input: block?.input as T | undefined,
    stop_reason: body.stop_reason ?? null,
    usage: body.usage ? { input_tokens: body.usage.input_tokens, output_tokens: body.usage.output_tokens } : undefined
  };
}
