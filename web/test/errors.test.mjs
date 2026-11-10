// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { explain, explainRun } from "../lib/errors.js";

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
  const bare = explain(new Error("insert or update on table \"ideas\" violates foreign key constraint \"ideas_shared_to_fkey\""));
  assert.match(bare.text, /^Could not do that\. Try again/);
  assert.ok(bare.detail);
});

test("a row that already exists is not something to try again", () => {
  const dup = "duplicate key value violates unique constraint \"groups_name_key\"";
  const coded = Object.assign(new Error("createGroup: conflict"), { code: "23505" });
  for (const [err, start] of [
    [new Error(`createGroup: ${dup}`), "Could not create the group: it already exists."],
    [new Error(dup), "Could not do that: it already exists."],
    [new Error(`capabilitiesFor: ${dup}`), "Could not do that: it already exists."],
    [coded, "Could not create the group: it already exists."]
  ]) {
    const { text, detail } = explain(err);
    assert.ok(text.startsWith(start), text);
    assert.doesNotMatch(text, /try again/i);
    assert.equal(detail, err.message);
  }
});

test("nothing to go on still says something", () => {
  assert.equal(explain(undefined).detail, null);
  assert.ok(explain(new Error("")).text.length > 0);
  assert.equal(explain("plain string").text, "plain string");
});

test("a failed run says what broke and whether trying again can help", () => {
  const cases = [
    ['API 401: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', /key was refused\. Trying again will not help — tell the owner\./],
    ["ANTHROPIC_API_KEY is not set. supabase secrets set ANTHROPIC_API_KEY=...", /key was refused/],
    ['API 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}', /out of credit\. Trying again will not help/],
    ['API 429: {"type":"error","error":{"type":"rate_limit_error","message":"…"}}', /was busy\..*trying again later can help/],
    ['API 529: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', /was busy/],
    ["output truncated (stop_reason=max_tokens)", /could not be read\..*trying again can help/],
    ["capabilities is not an array", /could not be read/],
    ["no tool input", /could not be read/]
  ];
  for (const [raw, want] of cases) {
    const { text, detail } = explainRun(raw);
    assert.match(text, /^Extraction failed: /);
    assert.match(text, want);
    assert.equal(detail, raw);
    // the raw string is under Details, never in the sentence
    assert.doesNotMatch(text, /API \d|\{|stop_reason|x-api-key/);
  }
});

test("a run error nobody recognises still gets a sentence, and an empty one no Details", () => {
  const raw = "writeRun: canceling statement due to statement timeout on relation";
  assert.match(explainRun("writeRun: something odd").text, /^Extraction failed\. Trying again may help/);
  assert.equal(explainRun("writeRun: something odd").detail, "writeRun: something odd");
  assert.match(explainRun(raw).text, /was busy/);   // a timeout is a timeout wherever it happened
  assert.deepEqual(explainRun(null), { text: explainRun("").text, detail: null });
  assert.match(explainRun(undefined).text, /^Extraction failed\./);
});
