import { readFileSync } from "node:fs";

const profile = JSON.parse(readFileSync(new URL("../data/profile.json", import.meta.url)));
const held = profile.skills || {};

// A capability is a gap unless the profile says otherwise.
// "solid" clears it. "some" counts as half — you could get there in an evening.
export function classify(cap) {
  if (!cap.skill_id) return "proposed";
  const level = held[cap.skill_id];
  if (level === "solid") return "have";
  if (level === "some") return "partial";
  return "gap";
}

export function distanceOf(extraction) {
  if (!extraction.clear) return null;
  let gap = 0, partial = 0, have = 0, proposed = 0;
  for (const cap of extraction.capabilities) {
    const c = classify(cap);
    if (c === "gap") gap++;
    else if (c === "partial") partial++;
    else if (c === "have") have++;
    else proposed++;
  }
  // proposed skills aren't in the profile yet, so they count as unknown => gap
  return { gap: gap + proposed, partial, have, score: gap + proposed + partial * 0.5 };
}

export { profile };
