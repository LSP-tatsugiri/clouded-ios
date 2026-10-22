// Run: node --test web/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { DROP_REASON_MAX, buildChoices, cleanReason, isLive, lifecycleOf, movedHeadline } from "../lib/lifecycle.js";

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
});
