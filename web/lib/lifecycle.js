// An idea's lifecycle (docs/superpowers/specs/2026-10-22-idea-lifecycle-design.md).
//
// Live until it is built or dropped, and either is undone by "Back to live".
// Pure, so node:test covers it (web/test/); app.js does the DOM and db.js the
// writes. The database enforces the same rules with check constraints.

export const DROP_REASON_MAX = 200;

export function lifecycleOf(idea) {
  if (idea.built_at) return "built";
  if (idea.dropped_at) return "dropped";
  return "live";
}

export const isLive = (idea) => lifecycleOf(idea) === "live";

// What "I built this" offers to set solid. A proposed capability has no skill
// to rate, and one already solid has nothing to confirm. The list starts
// unticked in the UI: a skill goes to solid only when you say you used it.
export function buildChoices(caps, levels) {
  return caps.filter((c) => c.skill_id && levels.get(c.skill_id) !== "solid");
}

// The reason as it will be stored, or null when the check constraint would
// refuse it — so the form can refuse first, in words.
export function cleanReason(text) {
  const t = (text ?? "").trim();
  return t && t.length <= DROP_REASON_MAX ? t : null;
}

// The first half of the "what moved" line. Every skill in one batch went to
// the same level, so the first one's level speaks for all of them.
export function movedHeadline(skillIds, after) {
  const level = after.get(skillIds[0]);
  return skillIds.length === 1 ? `${skillIds[0]} → ${level}.` : `${skillIds.length} skills → ${level}.`;
}
