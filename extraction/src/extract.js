import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const MODEL = process.env.MODEL || "claude-sonnet-4-5-20250929";
const API = "https://api.anthropic.com/v1/messages";

const skills = JSON.parse(readFileSync(new URL("../data/skills.json", import.meta.url)));

const skillList = skills
  .map((s) => `- ${s.id}: ${s.name}${s.aliases?.length ? ` [also called: ${s.aliases.join(", ")}]` : ""}`)
  .join("\n");

const SYSTEM = `You analyse raw project ideas and report what it would actually take to build them.

Two hard rules:

1. CAPABILITIES ARE CHECKABLE TASKS, NEVER DEPTH LABELS.
   Good: "design a printed clamp that fits a measured tube diameter"
   Bad:  "Intermediate CAD", "Advanced embedded", "Expert UX"
   If a capability could be argued about, it is written wrong. Someone must be
   able to say yes or no to "can you do this?" without hedging.

2. EXTRACT BY DEFAULT. ONLY ASK WHEN THERE IS GENUINELY NOTHING THERE.
   Captured ideas are terse, and terse is not vague. "shower body dryer" and
   "gridfinity tool cutout organizer" each name a thing that does something —
   extract those. Take the most reasonable concrete reading and say what you
   assumed in the objective.
   Set clear=false ONLY when the entry names no object and no action: a bare
   medium, material or category with nothing attached to it ("blender animation",
   "3d printed", "rc truck"). Then ask ONE short question that would make it
   concrete.
   An entry that names a kind of thing to build ("personal todo list app") IS
   extractable, even with no details: assume the most ordinary form of it and
   state that assumption in the objective. Missing preferences — platform,
   features, style, size — are never a reason to ask. Only a missing object is.
   When in doubt, extract. A wrong guess is visible and easy to correct; a
   question about something the person already told you is just friction.

Map each required capability to a skill_id from this canonical list wherever one
fits, even loosely — reuse beats precision, because the whole point is that the
same skill shows up across different ideas. Before proposing a new skill, re-read
the list: if an existing skill's task or aliases would cover the work, use it,
even if your wording would have been more specific. A proposed skill must not
overlap an existing one. Only when nothing on the list covers it, leave skill_id
null and set proposed_name to a kebab-case slug in the same style as the list
("vehicle-rigging", not "label design for organizers").

CANONICAL SKILLS:
${skillList}

Aim for 3-7 capabilities. List what is genuinely required, including the
unglamorous mechanical or physical parts — those are usually what actually stops
a project. If one capability is clearly the crux (the part most likely to kill
the project), mark is_crux true on exactly that one.`;

const TOOL = {
  name: "record_extraction",
  description: "Record the analysis of one raw idea.",
  input_schema: {
    type: "object",
    properties: {
      clear: { type: "boolean", description: "false if the entry is a subject/category rather than an actual idea" },
      clarifying_question: { type: ["string", "null"], description: "one short question, only when clear=false" },
      objective: { type: ["string", "null"], description: "one sentence: what the finished thing does" },
      domain: { type: ["string", "null"] },
      capabilities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            skill_id: { type: ["string", "null"] },
            proposed_name: {
              type: ["string", "null"],
              pattern: "^[a-z0-9]+(-[a-z0-9]+){0,4}$",
              description: "kebab-case slug, 2-5 words, same style as the canonical ids; null when skill_id is set"
            },
            reason: { type: "string", description: "why this idea needs it, one clause" },
            is_crux: { type: "boolean" }
          },
          required: ["skill_id", "proposed_name", "reason", "is_crux"]
        }
      }
    },
    required: ["clear", "clarifying_question", "objective", "domain", "capabilities"]
  }
};

export async function extract(raw, clarification) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.");

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      // Sonnet 5 thinks by default and thinking counts against max_tokens; at
      // 1500 the tool call came back truncated. The baseline never used
      // thinking. Kept in lockstep with supabase/functions/_shared/anthropic.ts.
      max_tokens: 4096,
      thinking: { type: "disabled" },
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_extraction" },
      messages: [{ role: "user", content: `Raw captured idea:\n\n"${raw}"${clarification ? `\n\nThe person later clarified: "${clarification}"` : ""}` }]
    })
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

  const body = await res.json();
  const block = body.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("model did not return structured output");
  return block.input;
}

// changes whenever the prompt, the tool schema or the skills table change
export const promptHash = createHash("sha256")
  .update(MODEL + SYSTEM + JSON.stringify(TOOL))
  .digest("hex")
  .slice(0, 12);

export { skills };
// exported for the edge function's parity test (supabase/functions/_shared/prompt_test.ts)
export { SYSTEM, TOOL };
