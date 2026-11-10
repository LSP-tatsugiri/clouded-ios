// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assumptionOf, iterationTag } from "../lib/extracted.js";

test("assumptionOf: a clear idea's reading, trimmed, without its last full stop", () => {
  assert.equal(assumptionOf({ is_clear: true, assumption: "  read as decorative PCB art, not a coaster that senses the cup. " }),
    "read as decorative PCB art, not a coaster that senses the cup");
  assert.equal(assumptionOf({ is_clear: true, assumption: "an ordinary phone app, e.g. iOS" }), "an ordinary phone app, e.g. iOS");
});

test("assumptionOf: nothing for an unambiguous, vague, or pre-2026-11-10 idea", () => {
  assert.equal(assumptionOf({ is_clear: true, assumption: null }), null);
  assert.equal(assumptionOf({ is_clear: true }), null);                       // column not fetched or not there
  assert.equal(assumptionOf({ is_clear: true, assumption: " . " }), null);
  assert.equal(assumptionOf({ is_clear: false, assumption: "something" }), null);
  assert.equal(assumptionOf({ is_clear: null, assumption: "something" }), null); // not extracted yet
  assert.equal(assumptionOf(null), null);
});

test("iterationTag: only 'iteration' is tagged, and the tag is no number and no time", () => {
  assert.equal(iterationTag({ iteration: "iteration" }), "needs iteration");
  assert.equal(iterationTag({ iteration: "tutorial" }), null);
  assert.equal(iterationTag({ iteration: null }), null);
  assert.equal(iterationTag({}), null);
  assert.equal(iterationTag(undefined), null);
  assert.doesNotMatch(iterationTag({ iteration: "iteration" }), /\d|hour|day|week|month/i);
});
