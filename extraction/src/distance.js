// Capability classification and the distance sort.
//
// Pure on purpose: no file reads, no database, no environment. The caller
// supplies `held`, a lookup of skill_id -> "none" | "some" | "solid"; anything
// absent counts as "none". That one parameter is what lets the Node report,
// the browser and the tests share this module instead of each getting a copy
// (see docs/refactor-extraction-core.md).
//
// Two field spellings are accepted because the same capability arrives under
// two names: the committed baseline in out/ writes `proposed_name` and
// `is_crux`, the database writes `proposed_key` and `crux_rank`.

/** @param {Map<string,string>|Record<string,string>|undefined} held */
const levelOf = (held, id) =>
  held instanceof Map ? held.get(id) : held?.[id];

/** "have" | "partial" | "gap" | "proposed" */
export function classify(cap, held) {
  if (!cap.skill_id) return "proposed";
  const level = levelOf(held, cap.skill_id);
  if (level === "solid") return "have";
  if (level === "some") return "partial";
  return "gap";
}

// A capability is a gap unless the profile says otherwise. "solid" clears it;
// "some" counts as half, because you could get there in an evening. Proposed
// capabilities aren't in the table yet, so they can't be in the profile and
// count as unknown, which means gap.
export function distanceOf(extraction, held) {
  if (!extraction.clear) return null;
  let gap = 0, partial = 0, have = 0, proposed = 0;
  for (const cap of extraction.capabilities) {
    const c = classify(cap, held);
    if (c === "gap") gap++;
    else if (c === "partial") partial++;
    else if (c === "have") have++;
    else proposed++;
  }
  return { gap: gap + proposed, partial, have, score: gap + proposed + partial * 0.5 };
}

// Exactly one capability per idea is the crux: the part most likely to kill
// the project. crux_rank 2 is the runner-up and is deliberately ignored here.
export function cruxOf(extraction) {
  return extraction.capabilities?.find((c) => c.is_crux === true || c.crux_rank === 1) ?? null;
}

export function cruxStatus(extraction, held) {
  const crux = cruxOf(extraction);
  return crux ? classify(crux, held) : null;
}

// held first, then partial, then gap. A proposed crux ranks with gap, and an
// idea with no crux at all ranks last of the four.
const CRUX_ORDER = { have: 0, partial: 1, gap: 2, proposed: 2 };

// Sort by what actually stops you. A flat gap count treats "pick PETG for
// heat" and "mechanical singulation of small fasteners" the same; leading with
// the crux's status fixes the ordering that count gets wrong.
// Lower sorts first. Null for an idea with no extraction to rank.
export function sortKey(extraction, held) {
  const d = distanceOf(extraction, held);
  if (!d) return null;
  const status = cruxStatus(extraction, held);
  return [CRUX_ORDER[status] ?? 3, d.gap, d.partial];
}

/** Lexicographic compare of two equal-length numeric keys. */
export function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// Which skill unlocks the most ideas: for each capability not already held,
// count the ideas needing it. Returns entries sorted by that count, most
// first. `items` are { id, extraction }.
export function leverage(items, held) {
  const unlocks = new Map();
  for (const { id, extraction } of items) {
    if (!extraction?.clear) continue;
    for (const cap of extraction.capabilities) {
      if (classify(cap, held) === "have") continue;
      const proposedName = cap.proposed_name ?? cap.proposed_key ?? null;
      const key = cap.skill_id ?? `proposed:${proposedName}`;
      if (!unlocks.has(key)) {
        unlocks.set(key, { key, skillId: cap.skill_id ?? null, proposedName, ideaIds: [] });
      }
      const entry = unlocks.get(key);
      if (!entry.ideaIds.includes(id)) entry.ideaIds.push(id);
    }
  }
  return [...unlocks.values()].sort((a, b) => b.ideaIds.length - a.ideaIds.length);
}
