// Near-duplicate ideas, found in the client: every row is already loaded, so
// there is no migration and no embedding call.
//
//   similarIdeas(idea, ideas, caps, opts?) -> [{ id, score, why }]
//
//   idea   the idea to compare, { id, objective, raw, ... }
//   ideas  the candidates (the idea itself may be among them; it is skipped)
//   caps   capability rows for all of them: { idea_id, skill_id, proposed_key }
//   opts   { minText = 0.45, minShared = 3, limit = 3 }
//
// Another idea "looks like" this one when the wording is close (Jaccard over
// character trigrams of `objective`, or `raw` when there is no objective, at
// or above minText) OR the two need minShared or more of the same skills
// (same non-null skill_id; proposed capabilities have no skill and never
// count). Dropped ideas are skipped; built ones are kept, since "you already
// built something like this" is worth knowing.
//
// Returned best first, at most `limit`:
//   id     the other idea's id
//   score  0..1, for ordering only — the larger of the wording similarity and
//          the skill-set overlap. Not a rating of either idea; do not show it.
//   why    words for the page: "similar wording", "3 skills in common", or
//          both joined with " · "
//
// Pure, so node:test covers it (web/test/similar.test.mjs).

const textOf = (idea) => (idea.objective || idea.raw || "").toLowerCase().replace(/\s+/g, " ").trim();

function trigrams(s) {
  const out = new Set();
  if (s.length && s.length < 3) out.add(s);
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

export function similarIdeas(idea, ideas, caps, { minText = 0.45, minShared = 3, limit = 3 } = {}) {
  const skillsOf = new Map();   // idea_id -> Set of skill ids
  for (const c of caps ?? []) {
    if (!c.skill_id) continue;
    if (!skillsOf.has(c.idea_id)) skillsOf.set(c.idea_id, new Set());
    skillsOf.get(c.idea_id).add(c.skill_id);
  }
  const none = new Set();
  const myGrams = trigrams(textOf(idea));
  const mySkills = skillsOf.get(idea.id) ?? none;

  const found = [];
  for (const other of ideas ?? []) {
    if (other.id === idea.id || other.dropped_at) continue;
    const text = jaccard(myGrams, trigrams(textOf(other)));
    const theirs = skillsOf.get(other.id) ?? none;
    let shared = 0;
    for (const s of mySkills) if (theirs.has(s)) shared++;
    const byText = text >= minText;
    const bySkills = shared >= minShared;
    if (!byText && !bySkills) continue;
    const overlap = bySkills ? shared / (mySkills.size + theirs.size - shared) : 0;
    found.push({
      id: other.id,
      score: Math.max(byText ? text : 0, overlap),
      why: [byText && "similar wording", bySkills && `${shared} skills in common`].filter(Boolean).join(" · ")
    });
  }
  // id as the tie-break, so the order never depends on the order rows arrived in
  found.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  return found.slice(0, limit);
}
