// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { leverage } from "../../extraction/src/distance.js";
import { claimState, claimsByIdea, groupHeld, memberCount, withClaim } from "../lib/group.js";

test("groupHeld is the union of solid, and only solid", () => {
  const levels = new Map([["soldering", "solid"], ["pcb-layout", "some"], ["welding", "none"]]);
  const pool = new Map([["parametric-cad", ["alex"]], ["pcb-layout", []], ["firmware", ["alex", "sam"]]]);
  const held = groupHeld(levels, pool);
  assert.deepEqual([...held].sort(), [["firmware", "solid"], ["parametric-cad", "solid"], ["soldering", "solid"]]);
});

test("groupHeld: the reader's 'some' does not count, a friend's solid over it does", () => {
  assert.equal(groupHeld(new Map([["pcb-layout", "some"]]), new Map()).has("pcb-layout"), false);
  assert.equal(groupHeld(new Map([["pcb-layout", "some"]]), new Map([["pcb-layout", ["alex"]]])).get("pcb-layout"), "solid");
  assert.equal(groupHeld(new Map(), new Map()).size, 0);
});

test("leverage over groupHeld lists what nobody holds, with the ideas it would move", () => {
  const cap = (skill_id, crux_rank = null) => ({ skill_id, crux_rank });
  const items = [
    { id: "a", extraction: { clear: true, capabilities: [cap("welding", 1), cap("soldering"), cap("firmware")] } },
    { id: "b", extraction: { clear: true, capabilities: [cap("welding"), cap("parametric-cad", 1), cap("pcb-layout")] } },
    { id: "c", extraction: { clear: false, capabilities: [cap("welding", 1)] } }   // vague: not measured
  ];
  const levels = new Map([["soldering", "solid"], ["pcb-layout", "some"]]);
  const pool = new Map([["parametric-cad", ["alex"]], ["firmware", ["sam"]]]);
  const missing = leverage(items, groupHeld(levels, pool));
  assert.deepEqual(missing.map((e) => [e.skillId, e.ideaIds]), [["welding", ["a", "b"]], ["pcb-layout", ["b"]]]);
  // against the reader alone the friends' skills are still gaps
  assert.equal(leverage(items, levels).length, 4);
});

test("memberCount counts a person once across groups", () => {
  const m = (user_id) => ({ user_id });
  assert.equal(memberCount([]), 0);
  assert.equal(memberCount([{ members: [m("me")] }]), 1);
  assert.equal(memberCount([{ members: [m("me"), m("alex")] }, { members: [m("me"), m("alex"), m("sam")] }]), 3);
});

test("claimsByIdea groups rows by idea, in the order they came", () => {
  const byIdea = claimsByIdea([
    { idea_id: "a", user_id: "alex" }, { idea_id: "b", user_id: "sam" },
    { idea_id: "a", user_id: "sam" }, { idea_id: "a", user_id: "alex" }
  ]);
  assert.deepEqual(byIdea.get("a"), ["alex", "sam"]);
  assert.deepEqual(byIdea.get("b"), ["sam"]);
  assert.equal(claimsByIdea([]).size, 0);
});

test("withClaim adds and removes without touching the map it was given", () => {
  const before = new Map([["a", ["alex"]]]);
  const added = withClaim(before, "a", "me", true);
  assert.deepEqual(added.get("a"), ["alex", "me"]);
  assert.deepEqual(before.get("a"), ["alex"]);
  assert.deepEqual(withClaim(added, "a", "me", true).get("a"), ["alex", "me"]);   // twice is once
  assert.deepEqual(withClaim(added, "a", "me", false).get("a"), ["alex"]);
  assert.equal(withClaim(before, "a", "alex", false).has("a"), false);            // the last claim leaves no entry
  assert.deepEqual(withClaim(before, "b", "me", true).get("b"), ["me"]);
});

test("claimState: only a group mate's shared idea with a hard part can be claimed", () => {
  const theirs = { user_id: "alex", shared_to: "g" };
  assert.deepEqual(claimState(theirs, true, [], "me"), { others: [], mine: false, canClaim: true });
  assert.equal(claimState(theirs, false, [], "me").canClaim, false);                          // no hard part
  assert.equal(claimState({ user_id: "me", shared_to: "g" }, true, [], "me").canClaim, false); // your own
  assert.equal(claimState({ user_id: "alex", shared_to: null }, true, [], "me").canClaim, false); // private
});

test("claimState: the reader's own claim is told apart from everyone else's", () => {
  const theirs = { user_id: "alex", shared_to: "g" };
  assert.deepEqual(claimState(theirs, true, ["sam", "me"], "me"), { others: ["sam"], mine: true, canClaim: false });
  // on your own idea you only read who claimed
  assert.deepEqual(claimState({ user_id: "me", shared_to: "g" }, true, ["sam", "alex"], "me"),
    { others: ["sam", "alex"], mine: false, canClaim: false });
});
