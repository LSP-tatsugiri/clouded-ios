// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { SLOW_MS, SUBSCRIBE_MS, TICK_MS, WINDOW_MS, batchSubmit, costLine, filledAnswers, resultOf, startWait, step } from "../lib/wait.js";

// feed events through step(), collecting every act with the event that caused it
function drive(events, s = startWait()) {
  const log = [];
  for (const ev of events) {
    const r = step(s, ev);
    s = r.s;
    for (const a of r.acts) log.push(`${ev}:${a}`);
  }
  return { s, log, polls: log.filter((l) => l.endsWith(":poll")).length };
}
const ticks = (n) => Array(n).fill("tick");

test("connecting polls at the old 2 s cadence", () => {
  const { s, polls } = drive(ticks(2));
  assert.equal(s.phase, "connecting");
  assert.equal(polls, 2);
});

test("subscribed slows the poll to a safety net", () => {
  const { s, polls } = drive(["subscribed", ...ticks(SLOW_MS / TICK_MS * 3)]);
  assert.equal(s.phase, "live");
  assert.equal(polls, 3);
});

test("a channel never subscribed falls back and is closed, once", () => {
  const n = SUBSCRIBE_MS / TICK_MS;
  const { s, log, polls } = drive(ticks(n + 3));
  assert.equal(s.phase, "fallback");
  assert.deepEqual(log.filter((l) => l.endsWith(":close")), ["tick:close"]);
  assert.equal(polls, n + 3);   // every tick, as before Realtime
});

test("an error mid-wait goes back to the fast poll; a second error is ignored", () => {
  const { s, log, polls } = drive(["subscribed", ...ticks(4), "sub-error", "sub-error", ...ticks(3)]);
  assert.equal(s.phase, "fallback");
  assert.equal(log.filter((l) => l.endsWith(":close")).length, 1);
  assert.equal(polls, 1 + 3);   // one slow poll at 8 s, then every tick
});

test("subscribed after falling back stays in fallback", () => {
  const { s } = drive([...ticks(SUBSCRIBE_MS / TICK_MS), "subscribed"]);
  assert.equal(s.phase, "fallback");
});

test("a row finishes the wait, and nothing after it acts", () => {
  const { s, log } = drive(["subscribed", "tick", "row", "row", "tick", "timeout", "sub-error"]);
  assert.equal(s.done, true);
  assert.deepEqual(log.filter((l) => !l.endsWith(":progress")), ["row:finish"]);
});

test("the poll finding the row first finishes the same way", () => {
  const { log } = drive(["tick", "row"]);
  assert.deepEqual(log, ["tick:progress", "tick:poll", "row:finish"]);
});

test("the window runs out by ticks or by the timeout event", () => {
  const byTicks = drive(["subscribed", ...ticks(WINDOW_MS / TICK_MS + 5)]);
  assert.equal(byTicks.s.done, true);
  assert.equal(byTicks.log.filter((l) => l.endsWith(":give-up")).length, 1);
  const byEvent = drive(["tick", "timeout", "row"]);
  assert.deepEqual(byEvent.log.slice(-1), ["timeout:give-up"]);
});

// the 60th tick is the end of the window, so it gives up rather than polls
test("the poll count over a whole wait: 59 without Realtime, 14 with it", () => {
  assert.equal(drive(ticks(WINDOW_MS / TICK_MS)).polls, WINDOW_MS / TICK_MS - 1);
  assert.equal(drive(["subscribed", ...ticks(WINDOW_MS / TICK_MS)]).polls, Math.floor((WINDOW_MS - 1) / SLOW_MS));
});

test("resultOf tells a question from no result", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const at = (min) => new Date(now - min * 60000).toISOString();
  assert.equal(resultOf({ is_clear: true, status: "extracted", created_at: at(60) }, null, now), "clear");
  assert.equal(resultOf({ is_clear: false, status: "extracted", clarifying_question: "What?", created_at: at(60) }, null, now), "vague");
  assert.equal(resultOf({ is_clear: null, status: "pending", created_at: at(1) }, null, now), "pending");
  assert.equal(resultOf({ is_clear: null, status: "pending", created_at: at(3) }, null, now), "stale");
  assert.equal(resultOf({ is_clear: null, status: "failed", created_at: at(3) }, null, now), "failed");
  assert.equal(resultOf({ is_clear: null, status: "pending", created_at: at(3) }, { error: "401" }, now), "failed");
  // a vague verdict stands even when an older run had failed
  assert.equal(resultOf({ is_clear: false, status: "extracted", created_at: at(3) }, { error: "x" }, now), "vague");
  assert.equal(resultOf({ is_clear: null, status: "pending", created_at: at(1) }, null, now, 30000), "stale");
});

test("filledAnswers keeps only what was typed, trimmed, in order", () => {
  const drafts = new Map([["a", "  a lamp "], ["b", "   "], ["c", "a shelf"]]);
  assert.deepEqual(filledAnswers(["c", "b", "a", "d"], drafts), [{ id: "c", text: "a shelf" }, { id: "a", text: "a lamp" }]);
  assert.deepEqual(filledAnswers([], drafts), []);
});

test("costLine counts", () => {
  assert.equal(costLine(1), "Answering re-runs extraction, about a cent each. 1 answer, 1 re-run.");
  assert.match(costLine(3), /3 answers, 3 re-runs\.$/);
});

test("batchSubmit says what Send will send", () => {
  const drafts = new Map([["a", "a lamp"], ["b", "  "], ["c", "a shelf"]]);
  const n = filledAnswers(["a", "b", "c"], drafts).length;
  assert.deepEqual(batchSubmit(n), { cost: costLine(2), label: "Send 2 answers" });
  assert.equal(batchSubmit(1).label, "Send 1 answer");
  assert.equal(batchSubmit(0).label, "Send answers");
  assert.doesNotMatch(batchSubmit(0).cost, /\d/);
  assert.equal(batchSubmit(2, true).label, "Sending…");
});
