// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVELS, UNRATED, levelChoices, levelText } from "../lib/rating.js";

test("the levels are none, some, solid, in that order", () => {
  assert.deepEqual(LEVELS, ["none", "some", "solid"]);
  assert.deepEqual(levelChoices("some").options.map((o) => o.level), LEVELS);
});

test("an unrated skill checks nothing and is not none", () => {
  for (const missing of [undefined, null, "", "expert"]) {
    const c = levelChoices(missing);
    assert.equal(c.unrated, true);
    assert.deepEqual(c.options.map((o) => o.checked), [false, false, false]);
    assert.equal(levelText(missing), UNRATED);
  }
  assert.equal(levelChoices("none").unrated, false);
  assert.deepEqual(levelChoices("none").options.map((o) => o.checked), [true, false, false]);
  assert.equal(levelText("none"), "none");
});

test("exactly the stored level is checked", () => {
  for (const level of LEVELS) {
    const c = levelChoices(level);
    assert.equal(c.unrated, false);
    assert.deepEqual(c.options.filter((o) => o.checked).map((o) => o.level), [level]);
    assert.equal(levelText(level), level);
  }
});
