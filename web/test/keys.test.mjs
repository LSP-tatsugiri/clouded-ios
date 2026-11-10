// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHORTCUTS, isTyping, keyAction, nextIndex } from "../lib/keys.js";

const key = (k, more = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, target: { tagName: "BODY" }, ...more });

test("each key maps to its action", () => {
  assert.equal(keyAction(key("/")), "search");
  assert.equal(keyAction(key("n")), "capture");
  assert.equal(keyAction(key("j")), "next");
  assert.equal(keyAction(key("k")), "prev");
  assert.equal(keyAction(key("?", { shiftKey: true })), "help");
  for (const other of ["a", "N", "J", "Enter", " ", "Escape", "Tab", "toString", "constructor"]) {
    assert.equal(keyAction(key(other)), null, other);
  }
});

test("arrow keys move between cards only when a card has focus", () => {
  assert.equal(keyAction(key("ArrowDown")), null);
  assert.equal(keyAction(key("ArrowUp")), null);
  assert.equal(keyAction(key("ArrowDown"), { onCard: true }), "next");
  assert.equal(keyAction(key("ArrowUp"), { onCard: true }), "prev");
  assert.equal(keyAction(key("ArrowLeft"), { onCard: true }), null);
});

test("never while typing", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input", "textarea"]) {
    for (const k of ["/", "n", "j", "k", "?", "ArrowDown"]) {
      assert.equal(keyAction(key(k, { target: { tagName } }), { onCard: true }), null, `${k} in ${tagName}`);
    }
  }
  assert.equal(keyAction(key("n", { target: { tagName: "DIV", isContentEditable: true } })), null);
  assert.equal(keyAction(key("n", { isComposing: true })), null);
  // a button or a link is not typing
  assert.equal(keyAction(key("n", { target: { tagName: "BUTTON" } })), "capture");
  assert.equal(keyAction(key("j", { target: { tagName: "A", isContentEditable: false } })), "next");
  assert.equal(isTyping(null), false);
  assert.equal(isTyping({}), false);
});

test("never with a modifier held", () => {
  for (const mod of ["ctrlKey", "metaKey", "altKey"]) {
    for (const k of ["/", "n", "j", "k", "?"]) assert.equal(keyAction(key(k, { [mod]: true })), null, `${mod}+${k}`);
    assert.equal(keyAction(key("ArrowDown", { [mod]: true }), { onCard: true }), null);
  }
  assert.equal(keyAction(null), null);
});

test("nextIndex walks the cards and stops at the ends", () => {
  assert.equal(nextIndex(-1, 3, "next"), 0);
  assert.equal(nextIndex(-1, 3, "prev"), 0);
  assert.equal(nextIndex(0, 3, "next"), 1);
  assert.equal(nextIndex(2, 3, "next"), 2);
  assert.equal(nextIndex(2, 3, "prev"), 1);
  assert.equal(nextIndex(0, 3, "prev"), 0);
  assert.equal(nextIndex(7, 3, "next"), 0);   // a stale index starts again
  assert.equal(nextIndex(-1, 0, "next"), -1);
  assert.equal(nextIndex(0, 0, "prev"), -1);
});

test("the help lists every key that does something", () => {
  const listed = SHORTCUTS.map(([k]) => k).join(" ");
  for (const k of ["/", "n", "j", "k", "?", "Enter"]) assert.ok(listed.includes(k), k);
});
