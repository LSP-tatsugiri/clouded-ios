// Decides whether a request to the extract function should run anything.

export type WebhookPayload = {
  type?: "INSERT" | "UPDATE" | "DELETE";
  table?: string;
  record?: { id: string; clarification?: string | null };
  old_record?: { clarification?: string | null } | null;
  idea_id?: string;
};

// Which idea to run, or null when this event is not ours to act on. The
// function's own status writes arrive here as UPDATEs and must be ignored,
// otherwise every run triggers another run. Only a changed clarification
// re-runs an existing idea.
export function ideaToRun(p: WebhookPayload): string | null {
  if (p.idea_id) return p.idea_id;
  if (p.table && p.table !== "ideas") return null;
  if (p.type === "INSERT" && p.record?.id) return p.record.id;
  if (p.type === "UPDATE" && p.record?.id) {
    const before = p.old_record?.clarification ?? null;
    const after = p.record.clarification ?? null;
    return before !== after ? p.record.id : null;
  }
  return null;
}
