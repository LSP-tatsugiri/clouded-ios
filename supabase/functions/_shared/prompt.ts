// The extraction prompt. Byte-identical to extraction/src/extract.js so the
// committed baseline stays comparable; prompt_test.ts enforces that. Edit the
// prompt in extract.js first, run the Node script, then copy here.

export type Skill = {
  id: string;
  name: string;
  domain: string | null;
  aliases: string[];
  hazard: boolean;
  sort_order: number | null;
};

export function skillList(skills: Skill[]): string {
  return skills
    .map((s) => `- ${s.id}: ${s.name}${s.aliases?.length ? ` [also called: ${s.aliases.join(", ")}]` : ""}`)
    .join("\n");
}

export function systemPrompt(skills: Skill[]): string {
  return `You analyse raw project ideas and report what it would actually take to build them.

Two hard rules:

1. CAPABILITIES ARE CHECKABLE TASKS, NEVER DEPTH LABELS.
   Good: "design a printed clamp that fits a measured tube diameter"
   Bad:  "Intermediate CAD", "Advanced embedded", "Expert UX"
   If a capability could be argued about, it is written wrong. Someone must be
   able to say yes or no to "can you do this?" without hedging.

2. EXTRACT BY DEFAULT. ONLY ASK WHEN THERE IS GENUINELY NOTHING THERE.
   Captured ideas are terse, and terse is not vague. "shower body dryer" and
   "gridfinity tool cutout organizer" each name a thing that does something —
   extract those. Take the most reasonable concrete reading.
   When the wording admits more than one reading, state the one you took in
   assumption, one short sentence the person can check ("read as decorative
   PCB art, not a coaster that senses the cup"). When only one sensible reading
   exists, or the person's clarification already settles it, assumption is null.
   Set clear=false ONLY when the entry names no object and no action: a bare
   medium, material or category with nothing attached to it ("blender animation",
   "3d printed", "rc truck"). Then ask ONE short question that would make it
   concrete.
   An entry that names a kind of thing to build ("personal todo list app") IS
   extractable, even with no details: assume the most ordinary form of it and
   state that in assumption. Missing preferences — platform, features, style,
   size — are never a reason to ask. Only a missing object is.
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
${skillList(skills)}

Aim for 3-7 capabilities. List what is genuinely required, including the
unglamorous mechanical or physical parts — those are usually what actually stops
a project. If one capability is clearly the crux (the part most likely to kill
the project), mark is_crux true on exactly that one.

For each capability, say what kind of work it is in iteration:
"tutorial" when a competent person could get it working by following existing
guides or documentation; "iteration" when it needs real trial and error on this
particular project, because no guide covers this case. That is a property of
the task, not of its length: never estimate time.`;
}

// strict: true (2026-11-10): grammar-constrained sampling, so the tool input
// always matches this schema. Same rules as the copy in extract.js:
// additionalProperties false on every object, every property required,
// nullable as a type array. prompt_test.ts checks the shape.
export const TOOL = {
  name: "record_extraction",
  description: "Record the analysis of one raw idea.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      clear: { type: "boolean", description: "false if the entry is a subject/category rather than an actual idea" },
      clarifying_question: { type: ["string", "null"], description: "one short question, only when clear=false" },
      assumption: { type: ["string", "null"], description: "the reading you took when the wording admits more than one, one short sentence; null when the idea is unambiguous" },
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
            iteration: {
              type: "string",
              enum: ["tutorial", "iteration"],
              description: "tutorial: existing guides would get a competent person there; iteration: needs real trial and error on this project"
            },
            is_crux: { type: "boolean" }
          },
          required: ["skill_id", "proposed_name", "reason", "iteration", "is_crux"],
          additionalProperties: false
        }
      }
    },
    required: ["clear", "clarifying_question", "assumption", "objective", "domain", "capabilities"],
    additionalProperties: false
  }
};

// changes whenever the prompt, the tool schema or the skills table change
export async function promptHash(model: string, skills: Skill[]): Promise<string> {
  const bytes = new TextEncoder().encode(model + systemPrompt(skills) + JSON.stringify(TOOL));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}
