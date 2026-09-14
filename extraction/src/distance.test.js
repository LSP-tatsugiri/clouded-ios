// node --test extraction/src/
//
// distance.js is the one module the Node report, the browser and these tests
// all share, so it is the one that most needs pinning.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classify, compareKeys, cruxOf, cruxStatus, distanceOf, leverage, sortKey
} from "./distance.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));

const cap = (skill_id, extra = {}) => ({ skill_id, proposed_name: null, reason: "r", is_crux: false, ...extra });
const ex = (capabilities, clear = true) => ({ clear, capabilities });

// ---------------------------------------------------------------- classify

test("classify maps a level to a status, absent counting as a gap", () => {
  const held = { a: "solid", b: "some", c: "none" };
  assert.equal(classify(cap("a"), held), "have");
  assert.equal(classify(cap("b"), held), "partial");
  assert.equal(classify(cap("c"), held), "gap");
  assert.equal(classify(cap("missing"), held), "gap");
});

test("classify treats a capability with no skill_id as proposed, whatever the profile", () => {
  assert.equal(classify({ skill_id: null, proposed_name: "x" }, { x: "solid" }), "proposed");
});

test("classify accepts held as a Map or a plain object, and copes with neither", () => {
  assert.equal(classify(cap("a"), new Map([["a", "solid"]])), "have");
  assert.equal(classify(cap("a"), { a: "solid" }), "have");
  assert.equal(classify(cap("a"), undefined), "gap");
});

// ---------------------------------------------------------------- distanceOf

test("distanceOf counts each status, with proposed folded into gap", () => {
  const held = { a: "solid", b: "some" };
  const d = distanceOf(ex([cap("a"), cap("b"), cap("z"), cap(null, { proposed_name: "p" })]), held);
  assert.deepEqual(d, { gap: 2, partial: 1, have: 1, score: 2.5 });
});

test("distanceOf scores a partial as half a gap", () => {
  assert.equal(distanceOf(ex([cap("b"), cap("b2")]), { b: "some", b2: "some" }).score, 1);
});

test("distanceOf returns null for an idea too vague to extract", () => {
  assert.equal(distanceOf(ex([], false), {}), null);
});

// ---------------------------------------------------------------- crux

test("cruxOf finds the crux under either field spelling", () => {
  assert.equal(cruxOf(ex([cap("a"), cap("b", { is_crux: true })])).skill_id, "b");
  assert.equal(cruxOf(ex([cap("a"), cap("b", { crux_rank: 1 })])).skill_id, "b");
});

test("cruxOf ignores the runner-up and returns null when nothing is marked", () => {
  assert.equal(cruxOf(ex([cap("a", { crux_rank: 2 })])), null);
  assert.equal(cruxOf(ex([cap("a")])), null);
});

test("cruxStatus classifies the crux against the profile", () => {
  assert.equal(cruxStatus(ex([cap("a", { is_crux: true })]), { a: "solid" }), "have");
  assert.equal(cruxStatus(ex([cap("a", { is_crux: true })]), {}), "gap");
});

// ---------------------------------------------------------------- the sort

test("sortKey leads with the crux status, so a held crux beats a smaller gap count", () => {
  const held = { known: "solid" };
  // four gaps, but the crux is held
  const heldCrux = ex([cap("known", { is_crux: true }), cap("g1"), cap("g2"), cap("g3"), cap("g4")]);
  // one gap, and it is the crux
  const gapCrux = ex([cap("g5", { is_crux: true })]);
  assert.ok(compareKeys(sortKey(heldCrux, held), sortKey(gapCrux, held)) < 0,
    "held crux should sort before a gap crux even with more total gaps");
});

test("sortKey falls back to gap count, then partial count", () => {
  const held = { c: "solid", p: "some" };
  const two = ex([cap("c", { is_crux: true }), cap("g1"), cap("g2")]);
  const one = ex([cap("c", { is_crux: true }), cap("g1")]);
  assert.ok(compareKeys(sortKey(one, held), sortKey(two, held)) < 0, "fewer gaps first");

  const noPartial = ex([cap("c", { is_crux: true }), cap("g1")]);
  const onePartial = ex([cap("c", { is_crux: true }), cap("g1"), cap("p")]);
  assert.ok(compareKeys(sortKey(noPartial, held), sortKey(onePartial, held)) < 0, "fewer partials first");
});

test("sortKey ranks a proposed crux with a gap crux, and no crux last", () => {
  const held = {};
  const proposedCrux = sortKey(ex([cap(null, { proposed_name: "p", is_crux: true })]), held);
  const noCrux = sortKey(ex([cap("g")]), held);
  const gapCrux = sortKey(ex([cap("g", { is_crux: true })]), held);
  assert.equal(proposedCrux[0], gapCrux[0], "proposed crux ranks with gap");
  assert.ok(compareKeys(gapCrux, noCrux) < 0, "an idea with no crux sorts last");
});

test("sortKey returns null for a vague idea, which has nothing to rank", () => {
  assert.equal(sortKey(ex([], false), {}), null);
});

test("compareKeys is lexicographic and returns 0 for equal keys", () => {
  assert.ok(compareKeys([0, 1, 2], [0, 1, 3]) < 0);
  assert.ok(compareKeys([1, 0, 0], [0, 9, 9]) > 0);
  assert.equal(compareKeys([1, 2, 3], [1, 2, 3]), 0);
});

// ---------------------------------------------------------------- leverage

test("leverage counts ideas per unheld capability, most first", () => {
  const held = { known: "solid" };
  const items = [
    { id: "i1", extraction: ex([cap("known"), cap("x"), cap("y")]) },
    { id: "i2", extraction: ex([cap("x")]) },
    { id: "i3", extraction: ex([cap("x"), cap("y")]) }
  ];
  const r = leverage(items, held);
  assert.deepEqual(r.map((e) => [e.key, e.ideaIds.length]), [["x", 3], ["y", 2]]);
  assert.equal(r.find((e) => e.key === "known"), undefined, "held skills are not leverage");
});

test("leverage keys proposed capabilities separately and skips vague ideas", () => {
  const items = [
    { id: "i1", extraction: ex([cap(null, { proposed_name: "p" })]) },
    { id: "i2", extraction: ex([cap(null, { proposed_key: "p" })]) },
    { id: "i3", extraction: ex([cap("x")], false) }
  ];
  const r = leverage(items, {});
  assert.deepEqual(r.map((e) => e.key), ["proposed:p"]);
  assert.deepEqual(r[0].ideaIds, ["i1", "i2"]);
});

test("leverage counts an idea once even if it needs the skill twice", () => {
  const r = leverage([{ id: "i1", extraction: ex([cap("x"), cap("x")]) }], {});
  assert.deepEqual(r[0].ideaIds, ["i1"]);
});

// ---------------------------------------------------------------- baseline

// Anchored to the committed sonnet-5 baseline. If these move, either the
// baseline was re-run or distance changed meaning; both deserve a second look.
test("the committed baseline still classifies the way the report prints it", () => {
  const held = load("../data/profile.json").skills;
  const all = load("../out/extractions.json");

  assert.equal(Object.keys(all).length, 19);
  assert.equal(Object.values(all).filter((e) => !e.clear).length, 3, "three ideas too vague to extract");

  assert.deepEqual(distanceOf(all.birds, held), { gap: 1, partial: 0, have: 0, score: 1 });
  assert.equal(cruxOf(all.birds).skill_id, "illustration-fundamentals");

  const ledger = distanceOf(all.ledger, held);
  assert.equal(ledger.gap, 2);
  assert.equal(ledger.have, 3);
  assert.equal(cruxOf(all.ledger).skill_id, "third-party-api");

  // CLAUDE.md says exactly one capability per idea is the crux. The model does
  // not always comply: it marks two on roughly one idea in ten. Every clear
  // idea has at least one, and cruxOf resolves to the first, which is the same
  // one capabilityRows() keeps for the database. Pinned so that if the model,
  // the prompt or the baseline changes, this says so.
  const doubles = [];
  for (const [id, e] of Object.entries(all)) {
    if (!e.clear) continue;
    const marked = e.capabilities.filter((c) => c.is_crux === true || c.crux_rank === 1);
    assert.ok(marked.length >= 1, `${id} has no crux`);
    if (marked.length > 1) doubles.push(id);
    assert.equal(cruxOf(e), marked[0], `${id}: cruxOf must resolve to the first marked crux`);
  }
  assert.deepEqual(doubles, ["dryer"], "known double-marked ideas in the committed baseline");
});

test("the highest-leverage skill in the baseline is parametric CAD", () => {
  const held = load("../data/profile.json").skills;
  const all = load("../out/extractions.json");
  const items = Object.entries(all).map(([id, extraction]) => ({ id, extraction }));
  const top = leverage(items, held)[0];
  assert.equal(top.key, "parametric-cad");
  assert.ok(top.ideaIds.length >= 5, `expected 5+ ideas, got ${top.ideaIds.length}`);
});
