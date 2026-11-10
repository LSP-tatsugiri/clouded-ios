// How the idea page words two extraction fields added 2026-11-10
// (migration 20261110161336_assumption_and_iteration.sql). Pure, so the
// wording is testable: web/test/extracted.test.mjs.

// The reading the model took, as the page prints it after "Assumed: ", or
// null when there is nothing to show. Only for a clear idea: a vague one has
// a question instead, and a stale assumption under it would contradict it.
// One trailing full stop goes, because the line continues with " — not right?".
export function assumptionOf(idea) {
  if (idea?.is_clear !== true || typeof idea.assumption !== "string") return null;
  const text = idea.assumption.trim().replace(/\.$/, "").trim();
  return text || null;
}

// The quiet tag beside a capability. Only "iteration" gets one: a tutorial
// capability is the ordinary case, and a row predating the field (null) says
// nothing rather than guessing. Not a size and not a time, which the help
// page says too.
export function iterationTag(cap) {
  return cap?.iteration === "iteration" ? "needs iteration" : null;
}
