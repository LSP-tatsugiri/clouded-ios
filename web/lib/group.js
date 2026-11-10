// The Group tab's two sums: what the group holds between them, and who said
// they can do a hard part (docs/improvement-backlog.md §6).
//
// Pure, so node:test covers it (web/test/group.test.mjs); app.js does the DOM
// and db.js the reads and writes.

// The `held` map leverage() is run against for the whole group: a skill is
// held when anyone holds it at "solid". `levels` is the reader's own profile
// (skill_id -> level) and `pool` is skill_id -> [user_id] of the group mates
// who hold it solid (db.js, groupSkills). "some" does not count from anyone,
// the reader included: it is the rule friendsWhoHold() uses, and half-knowing
// a skill does not take it off the list of what the group should learn.
export function groupHeld(levels, pool) {
  const held = new Map();
  for (const [skillId, level] of levels) if (level === "solid") held.set(skillId, "solid");
  for (const [skillId, holders] of pool) if (holders.length) held.set(skillId, "solid");
  return held;
}

// How many people the groups hold between them, the reader included. A person
// in two of your groups is one person.
export function memberCount(groups) {
  return new Set(groups.flatMap((g) => g.members.map((m) => m.user_id))).size;
}

// idea_claims rows -> idea_id -> [user_id], in the order the rows came (the
// query sorts by created_at, so the first to say it is named first).
export function claimsByIdea(rows) {
  const byIdea = new Map();
  for (const r of rows) {
    if (!byIdea.has(r.idea_id)) byIdea.set(r.idea_id, []);
    if (!byIdea.get(r.idea_id).includes(r.user_id)) byIdea.get(r.idea_id).push(r.user_id);
  }
  return byIdea;
}

// The map after one person claims or takes it back. A new map, so a failed
// write leaves the old one on the page.
export function withClaim(byIdea, ideaId, userId, on) {
  const next = new Map(byIdea);
  const rest = (byIdea.get(ideaId) ?? []).filter((id) => id !== userId);
  const now = on ? [...rest, userId] : rest;
  if (now.length) next.set(ideaId, now); else next.delete(ideaId);
  return next;
}

// What a card shows about claims, for the reader `me`:
//   others   who else said they can do a hard part, to be named
//   mine     the reader said so
//   canClaim the reader may say so: a group mate's shared idea that has a
//            hard part to speak of. The insert policy checks the first two
//            again; the hard part is a client rule, since without one there
//            is nothing to claim.
export function claimState(idea, hasCrux, claimers, me) {
  const mine = claimers.includes(me);
  return {
    others: claimers.filter((id) => id !== me),
    mine,
    canClaim: !mine && !!idea.shared_to && idea.user_id !== me && hasCrux
  };
}
