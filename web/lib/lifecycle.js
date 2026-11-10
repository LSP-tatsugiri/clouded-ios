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

// How many different skills your live ideas need between them: the number the
// list leads with while nothing is rated. `caps` are capability rows
// ({ idea_id, skill_id }); a proposed capability has no skill to rate, and a
// built or dropped idea is not something left to measure.
export function skillsNeeded(ideas, caps) {
  const live = new Set(ideas.filter(isLive).map((i) => i.id));
  return new Set(caps.filter((c) => c.skill_id && live.has(c.idea_id)).map((c) => c.skill_id)).size;
}

// The same skills as a list, each with how many live ideas need it:
// [{ skill_id, ideas }], most-needed first, ties by id so the order holds
// still between loads. Two capabilities of one idea on the same skill count
// that idea once. The profile leads with the ones not rated yet.
export function skillsNeededList(ideas, caps) {
  const live = new Set(ideas.filter(isLive).map((i) => i.id));
  const by = new Map();   // skill id -> Set of idea ids
  for (const c of caps) {
    if (!c.skill_id || !live.has(c.idea_id)) continue;
    if (!by.has(c.skill_id)) by.set(c.skill_id, new Set());
    by.get(c.skill_id).add(c.idea_id);
  }
  return [...by]
    .map(([skill_id, set]) => ({ skill_id, ideas: set.size }))
    .sort((a, b) => b.ideas - a.ideas || (a.skill_id < b.skill_id ? -1 : 1));
}

// The reason as it will be stored, or null when the check constraint would
// refuse it — so the form can refuse first, in words.
export function cleanReason(text) {
  const t = (text ?? "").trim();
  return t && t.length <= DROP_REASON_MAX ? t : null;
}

// The first half of the "what moved" line. Every skill in one batch went to
// the same level, so the first one's level speaks for all of them. `nameOf`
// turns a skill id into the name the page shows, so the line never prints
// an id the reader has not seen.
export function movedHeadline(skillIds, after, nameOf = (id) => id) {
  const level = after.get(skillIds[0]);
  return skillIds.length === 1 ? `${nameOf(skillIds[0])} → ${level}.` : `${skillIds.length} skills → ${level}.`;
}
