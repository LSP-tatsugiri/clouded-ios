// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { explain } from "../lib/errors.js";

test("a sentence written for the reader passes through", () => {
  for (const text of [
    "Wrong email or password. If you have not made an account yet, switch to Create account.",
    "No such idea, or it is not shared with you.",
    "The screenshot is over 10 MB. Crop or resize it first."
  ]) assert.deepEqual(explain(new Error(text)), { text, detail: null });
});

test("a refused write says what failed and keeps the raw message", () => {
  const raw = "deleteIdea: new row violates row-level security policy for table \"ideas\"";
  const { text, detail } = explain(new Error(raw));
  assert.match(text, /^Could not delete the idea: this account is not allowed to\./);
  assert.doesNotMatch(text, /row-level|deleteIdea/);
  assert.equal(detail, raw);
});

test("a failed write and a failed read read differently", () => {
  const write = explain(new Error("setSkillLevel: canceling statement due to statement timeout"));
  assert.match(write.text, /^Could not save that rating\. Try again/);
  assert.equal(write.detail, "setSkillLevel: canceling statement due to statement timeout");
  const read = explain(new Error("capabilitiesFor: something broke"));
  assert.match(read.text, /^Could not load this page\. Reload/);
  assert.equal(read.detail, "capabilitiesFor: something broke");
});

test("a dropped connection says so, whatever threw it", () => {
  for (const raw of ["Failed to fetch", "TypeError: Failed to fetch", "addIdea: TypeError: Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
    const { text, detail } = explain(new Error(raw));
    assert.match(text, /^The connection failed\./);
    assert.equal(detail, raw);
  }
});

test("an expired session and a bare database message are named", () => {
  assert.match(explain(new Error("ideas: JWT expired")).text, /session has ended/);
  const bare = explain(new Error("duplicate key value violates unique constraint \"group_invites_pkey\""));
  assert.match(bare.text, /^Could not do that\./);
  assert.ok(bare.detail);
});

test("nothing to go on still says something", () => {
  assert.equal(explain(undefined).detail, null);
  assert.ok(explain(new Error("")).text.length > 0);
  assert.equal(explain("plain string").text, "plain string");
});
