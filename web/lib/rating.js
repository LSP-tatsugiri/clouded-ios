// The three skill levels, and what a control that sets one shows.
//
// "Not rated" is its own state: user_skills has no row for the skill. It is
// not "none", which is a row saying "I looked at this and cannot do it"
// (db.js, setSkillLevel). distance.js counts both as a gap, so the difference
// is only what the page says and what a click writes: the level chosen,
// never the one after the current.
//
// Pure, so node:test covers it (web/test/rating.test.mjs). The profile and
// the idea page build the same control from this, in this order.

export const LEVELS = ["none", "some", "solid"];
export const UNRATED = "not rated";

const known = (level) => (LEVELS.includes(level) ? level : null);

// { unrated, options: [{ level, checked }] } for a stored level, or for none.
export function levelChoices(current) {
  const at = known(current);
  return { unrated: at === null, options: LEVELS.map((level) => ({ level, checked: level === at })) };
}

// The stored level in words: the level, or "not rated".
export const levelText = (current) => known(current) ?? UNRATED;
