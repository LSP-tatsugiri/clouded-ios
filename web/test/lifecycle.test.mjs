// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DROP_REASON_MAX, buildChoices, cleanReason, isLive, lifecycleOf, movedHeadline, skillsNeeded, skillsNeededList } from "../lib/lifecycle.js";

test("lifecycleOf reads the two timestamps", () => {
  assert.equal(lifecycleOf({ built_at: null, dropped_at: null }), "live");
  assert.equal(lifecycleOf({}), "live");   // a row selected before the migration
  assert.equal(lifecycleOf({ built_at: "2026-10-22T10:00:00Z", dropped_at: null }), "built");
  assert.equal(lifecycleOf({ built_at: null, dropped_at: "2026-10-22T10:00:00Z" }), "dropped");
  assert.equal(isLive({ built_at: null, dropped_at: null }), true);
  assert.equal(isLive({ built_at: "2026-10-22T10:00:00Z" }), false);
});

test("buildChoices offers rateable skills not already solid", () => {
  const caps = [
    { skill_id: "parametric-cad" },
    { skill_id: "soldering" },
    { skill_id: null, proposed_key: "kiln-firing" },
    { skill_id: "pcb-layout" }
  ];
  const levels = new Map([["soldering", "solid"], ["pcb-layout", "some"]]);
  assert.deepEqual(buildChoices(caps, levels).map((c) => c.skill_id), ["parametric-cad", "pcb-layout"]);
  assert.deepEqual(buildChoices([], levels), []);
});

test("skillsNeeded counts distinct skills across live ideas", () => {
  const ideas = [
    { id: "a" },
    { id: "b", built_at: null, dropped_at: null },
    { id: "built", built_at: "2026-10-22T10:00:00Z" },
    { id: "dropped", dropped_at: "2026-10-22T10:00:00Z" }
  ];
  const caps = [
    { idea_id: "a", skill_id: "soldering" },
    { idea_id: "a", skill_id: "pcb-layout" },
    { idea_id: "a", skill_id: null, proposed_key: "kiln-firing" },   // nothing to rate
    { idea_id: "b", skill_id: "soldering" },                         // counted once
    { idea_id: "b", skill_id: "parametric-cad" },
    { idea_id: "built", skill_id: "welding" },
    { idea_id: "dropped", skill_id: "sewing" },
    { idea_id: "someone-elses", skill_id: "glassblowing" }
  ];
  assert.equal(skillsNeeded(ideas, caps), 3);
  assert.equal(skillsNeeded(ideas, []), 0);
  assert.equal(skillsNeeded([], caps), 0);
});

test("skillsNeededList orders the same skills by how many live ideas need each", () => {
  const ideas = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "built", built_at: "2026-10-22T10:00:00Z" }];
  const caps = [
    { idea_id: "a", skill_id: "soldering" },
    { idea_id: "a", skill_id: "soldering" },                          // one idea, counted once
    { idea_id: "a", skill_id: "pcb-layout" },
    { idea_id: "b", skill_id: "soldering" },
    { idea_id: "b", skill_id: "parametric-cad" },
    { idea_id: "c", skill_id: "parametric-cad" },
    { idea_id: "c", skill_id: "soldering" },
    { idea_id: "c", skill_id: null, proposed_key: "kiln-firing" },    // nothing to rate
    { idea_id: "built", skill_id: "welding" },
    { idea_id: "someone-elses", skill_id: "glassblowing" }
  ];
  assert.deepEqual(skillsNeededList(ideas, caps), [
    { skill_id: "soldering", ideas: 3 },
    { skill_id: "parametric-cad", ideas: 2 },
    { skill_id: "pcb-layout", ideas: 1 }
  ]);
  // a tie is broken by id, whatever order the rows arrive in
  const tie = [{ idea_id: "a", skill_id: "welding" }, { idea_id: "a", skill_id: "anodising" }];
  assert.deepEqual(skillsNeededList(ideas, tie).map((s) => s.skill_id), ["anodising", "welding"]);
  assert.deepEqual(skillsNeededList(ideas, [...tie].reverse()).map((s) => s.skill_id), ["anodising", "welding"]);
  assert.equal(skillsNeededList(ideas, caps).length, skillsNeeded(ideas, caps));
  assert.deepEqual(skillsNeededList([], caps), []);
});

test("cleanReason trims and refuses empty or over-long reasons", () => {
  assert.equal(cleanReason("  bought one instead "), "bought one instead");
  assert.equal(cleanReason("   "), null);
  assert.equal(cleanReason(""), null);
  assert.equal(cleanReason(null), null);
  assert.equal(cleanReason("x".repeat(DROP_REASON_MAX)), "x".repeat(DROP_REASON_MAX));
  assert.equal(cleanReason("x".repeat(DROP_REASON_MAX + 1)), null);
});

test("movedHeadline names one skill or counts several", () => {
  const after = new Map([["parametric-cad", "solid"], ["soldering", "solid"], ["pcb-layout", "solid"]]);
  assert.equal(movedHeadline(["parametric-cad"], after), "parametric-cad → solid.");
  assert.equal(movedHeadline(["parametric-cad", "soldering", "pcb-layout"], after), "3 skills → solid.");
  // the page passes skillName(), so the line shows the name and never the id
  const names = { "parametric-cad": "Model a part parametrically from measured dimensions" };
  assert.equal(movedHeadline(["parametric-cad"], after, (id) => names[id] ?? id),
    "Model a part parametrically from measured dimensions → solid.");
  assert.equal(movedHeadline(["soldering"], after, (id) => names[id] ?? id), "soldering → solid.");
});
