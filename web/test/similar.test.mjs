// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { similarIdeas } from "../lib/similar.js";

const cap = (idea_id, skill_id, proposed_key = null) => ({ idea_id, skill_id, proposed_key });

test("near-identical sentences match, unrelated ones do not", () => {
  const a = { id: "a", raw: "slider", objective: "Build a motorised camera slider driven by a stepper motor" };
  const ideas = [
    a,
    { id: "b", raw: "x", objective: "Build a motorized camera slider  driven by a Stepper motor." },
    { id: "c", raw: "x", objective: "Bake sourdough bread with a home-grown starter" }
  ];
  const got = similarIdeas(a, ideas, []);
  assert.deepEqual(got.map((r) => r.id), ["b"]);
  assert.equal(got[0].why, "similar wording");
  assert.ok(got[0].score >= 0.45 && got[0].score <= 1);
});

test("raw stands in when there is no objective", () => {
  const a = { id: "a", raw: "A desk lamp that follows the sun", objective: null };
  const b = { id: "b", raw: "a desk lamp that follows the sun!", objective: null };
  assert.deepEqual(similarIdeas(a, [a, b], []).map((r) => r.id), ["b"]);
  // two ideas with no text at all are not "alike"
  assert.deepEqual(similarIdeas({ id: "x", raw: "" }, [{ id: "y", raw: "" }], []), []);
});

test("three shared skills match whatever the wording; two do not", () => {
  const a = { id: "a", raw: "Weather station on the balcony" };
  const b = { id: "b", raw: "Automatic plant waterer" };
  const c = { id: "c", raw: "Bike computer" };
  const caps = [
    cap("a", "soldering"), cap("a", "pcb-layout"), cap("a", "firmware-c"), cap("a", null, "weatherproofing"),
    cap("b", "soldering"), cap("b", "pcb-layout"), cap("b", "firmware-c"), cap("b", "parametric-cad"),
    cap("c", "soldering"), cap("c", "pcb-layout"), cap("c", null, "weatherproofing")
  ];
  const got = similarIdeas(a, [a, b, c], caps);
  assert.deepEqual(got.map((r) => r.id), ["b"]);
  assert.equal(got[0].why, "3 skills in common");
  assert.equal(got[0].score, 3 / 4);   // 3 shared of 4 distinct skills between them
  // a shared proposal is not a shared skill: c has two skills and the same proposed_key
  assert.equal(similarIdeas(a, [c], caps).length, 0);
  assert.deepEqual(similarIdeas(a, [a, b, c], caps, { minShared: 2 }).map((r) => r.id), ["b", "c"]);
});

test("never returns the idea itself, skips dropped ideas, keeps built ones", () => {
  const text = "Laser-cut enclosure for a Raspberry Pi cluster";
  const a = { id: "a", raw: text };
  const ideas = [
    a,
    { id: "a", raw: text },   // the same row arriving twice
    { id: "dropped", raw: text, dropped_at: "2026-10-22T10:00:00Z", drop_reason: "bought one" },
    { id: "built", raw: text, built_at: "2026-10-22T10:00:00Z" }
  ];
  assert.deepEqual(similarIdeas(a, ideas, []).map((r) => r.id), ["built"]);
});

test("best first, three at most, both reasons named", () => {
  const a = { id: "a", raw: "Sort mixed screws by size with a vibrating feeder" };
  const ideas = [
    { id: "e", raw: "Sort mixed screws by size with a vibrating bowl feeder" },
    { id: "d", raw: "Sort mixed screws by size with a vibrating feeder" },
    { id: "c", raw: "Sort mixed screws by size using a vibrating feeder" },
    { id: "b", raw: "Sort mixed bolts by size with a vibrating feeder" }
  ];
  const caps = ["a", "d"].flatMap((id) => [cap(id, "s1"), cap(id, "s2"), cap(id, "s3")]);
  const got = similarIdeas(a, ideas, caps);
  assert.equal(got.length, 3);
  assert.equal(got[0].id, "d");
  assert.equal(got[0].score, 1);
  assert.equal(got[0].why, "similar wording · 3 skills in common");
  for (let i = 1; i < got.length; i++) assert.ok(got[i - 1].score >= got[i].score);
  assert.equal(similarIdeas(a, ideas, caps, { limit: 1 }).length, 1);
});
