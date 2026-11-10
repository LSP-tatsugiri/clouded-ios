// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, activeCount, decodeFilters, encodeFilters, needsExtraction } from "../lib/filters.js";

test("defaults encode to the empty string and decode back", () => {
  assert.equal(encodeFilters(DEFAULTS), "");
  assert.equal(encodeFilters({ ...DEFAULTS }), "");
  assert.deepEqual(decodeFilters(""), { ...DEFAULTS });
  assert.deepEqual(decodeFilters("?"), { ...DEFAULTS });
});

test("only what differs from the defaults is written", () => {
  assert.equal(encodeFilters({ ...DEFAULTS, sort: "closest", domain: "embedded", q: "motor" }),
    "sort=closest&domain=embedded&q=motor");
  assert.equal(encodeFilters({ ...DEFAULTS, friend: true }), "friend=1");
  assert.equal(encodeFilters({ sort: "closest" }), "sort=closest");   // a partial state is fine
});

test("every state round-trips", () => {
  const states = [
    { ...DEFAULTS, sort: "closest" },
    { ...DEFAULTS, lifecycle: "built" },
    { ...DEFAULTS, lifecycle: "dropped", q: "3d printer" },
    { ...DEFAULTS, domain: "fabrication", crux: "gap", proposed: true, friend: true },
    { ...DEFAULTS, crux: "have", q: "a&b=c ?#/ 50% é 日本" },
    { ...DEFAULTS, skill: "pcb-layout" },
    { ...DEFAULTS, sort: "closest", skill: "proposed:wind a coil by hand", q: "motor" },
    { sort: "closest", lifecycle: "live", domain: "R&D / lab", crux: "partial", proposed: true, friend: false, skill: "", q: "  spaced  " }
  ];
  for (const s of states) {
    assert.deepEqual(decodeFilters(encodeFilters(s)), s);
    assert.deepEqual(decodeFilters(`?${encodeFilters(s)}`), s);
  }
});

test("garbage decodes to defaults, field by field", () => {
  for (const junk of [null, undefined, 42, {}, "%%%", "&&&=&", "sort", "sort=", "sort=best&lifecycle=dead&crux=maybe",
    "proposed=yes&friend=true", "access_token=abc&type=recovery", "sort=closest%"]) {
    const got = decodeFilters(junk);
    assert.deepEqual(Object.keys(got), Object.keys(DEFAULTS));
    assert.equal(typeof got.q, "string");
  }
  assert.deepEqual(decodeFilters("sort=best&lifecycle=dead&crux=maybe&proposed=yes"), { ...DEFAULTS });
  // one bad field does not take the good ones with it; unknown keys are ignored
  assert.deepEqual(decodeFilters("sort=nope&domain=embedded&x=1"), { ...DEFAULTS, domain: "embedded" });
  assert.equal(decodeFilters(`q=${"x".repeat(500)}`).q.length, 200);
  assert.equal(decodeFilters(`skill=${"x".repeat(500)}`).skill.length, 80);
  // and bad values are never written
  assert.equal(encodeFilters({ sort: "best", lifecycle: 7, crux: "maybe", proposed: "yes", domain: 3, skill: 9, q: null }), "");
  assert.equal(encodeFilters(null), "");
});

test("activeCount counts the folded-away filters only", () => {
  assert.equal(activeCount(DEFAULTS), 0);
  assert.equal(activeCount({ ...DEFAULTS, q: "motor", sort: "closest", lifecycle: "built" }), 0);
  assert.equal(activeCount({ ...DEFAULTS, skill: "pcb-layout" }), 0);   // a chip under the bar, not in the panel
  assert.equal(activeCount({ ...DEFAULTS, domain: "embedded", friend: true }), 2);
  assert.equal(activeCount({ ...DEFAULTS, domain: "embedded", crux: "gap", proposed: true, friend: true }), 4);
});

test("the skill filter is written between the flags and the search", () => {
  assert.equal(encodeFilters({ ...DEFAULTS, friend: true, skill: "pcb-layout", q: "motor" }), "friend=1&skill=pcb-layout&q=motor");
  assert.equal(decodeFilters("skill=proposed%3Awind+a+coil").skill, "proposed:wind a coil");
});

test("needsExtraction: only the filters a vague idea cannot pass", () => {
  assert.equal(needsExtraction(DEFAULTS), false);
  assert.equal(needsExtraction({ ...DEFAULTS, q: "motor", sort: "closest", lifecycle: "dropped" }), false);
  for (const on of [{ domain: "embedded" }, { crux: "have" }, { proposed: true }, { friend: true }, { skill: "pcb-layout" }]) {
    assert.equal(needsExtraction({ ...DEFAULTS, ...on }), true, JSON.stringify(on));
  }
});
