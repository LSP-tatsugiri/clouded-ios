// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKS, SECTIONS } from "../lib/help.js";

const everything = [
  ...MARKS.map((m) => `${m.name} ${m.text}`),
  ...SECTIONS.flatMap((s) => [s.title, ...s.body])
].join("\n");

test("every mark the app prints is explained, once, in one sentence or two", () => {
  // the keys of MARK in app.js
  assert.deepEqual(MARKS.map((m) => m.kind).sort(), ["friend", "gap", "have", "partial", "proposed"]);
  for (const m of MARKS) {
    assert.ok(m.name && m.text.endsWith("."), m.kind);
    assert.ok(m.text.length < 200, m.kind);
  }
});

test("the page says what distance is and what it is not", () => {
  assert.match(everything, /Distance is a count/);
  assert.match(everything, /some counts half/);
  assert.match(everything, /not a size/);
  assert.match(everything, /not a time estimate/);
  assert.match(everything, /is a tie/);
  assert.match(everything, /sometimes wrong/);
  // the idea page's "needs iteration" tag (lib/extracted.js), and that it does not move distance
  assert.match(everything, /needs iteration[^.]*still counts it one/);
  for (const s of SECTIONS) assert.ok(s.title && s.body.length > 0);
});

test("no score and no duration anywhere in the copy", () => {
  assert.doesNotMatch(everything, /\d/);
  assert.doesNotMatch(everything, /\b(minutes?|hours?|days?|weeks?|months?|weekend|evening|percent|score[ds]?|points?|out of)\b/i);
});
