// The Ideas list's keyboard shortcuts: which key does what, and where j/k go.
//
// Pure, so node:test covers it (web/test/keys.test.mjs); app.js owns the
// listener and the DOM. A shortcut never fires while a modifier is held (the
// browser's and the OS's own shortcuts) or while typing, where the key is
// just a letter.

// What the "?" help lists, in order.
export const SHORTCUTS = [
  ["/", "Search your ideas"],
  ["n", "Write a new idea"],
  ["j or ↓", "Next idea"],
  ["k or ↑", "Previous idea"],
  ["Enter", "Open the idea in focus"],
  ["?", "Show or hide this list"]
];

const KEYS = { "/": "search", n: "capture", j: "next", k: "prev", "?": "help" };
const ARROWS = { ArrowDown: "next", ArrowUp: "prev" };   // only from a card: elsewhere they scroll the page
const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** `target` is the event's target, or anything with { tagName, isContentEditable }. */
export function isTyping(target) {
  return !!target && (TYPING.has(String(target.tagName ?? "").toUpperCase()) || target.isContentEditable === true);
}

/**
 * "search" | "capture" | "next" | "prev" | "help" | null.
 * `e` is a keydown event (key, ctrlKey, metaKey, altKey, target); `onCard`
 * says whether focus is inside an idea card. Shift is allowed: "?" needs it.
 */
export function keyAction(e, { onCard = false } = {}) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || isTyping(e.target)) return null;
  if (Object.hasOwn(KEYS, e.key)) return KEYS[e.key];
  return onCard && Object.hasOwn(ARROWS, e.key) ? ARROWS[e.key] : null;
}

/**
 * The card j/k lands on: `current` is the focused card's index, -1 for none.
 * Stops at either end, no wrap-around; with nothing focused both keys start
 * at the top. -1 when there are no cards.
 */
export function nextIndex(current, count, action) {
  if (!(count > 0)) return -1;
  if (!(current >= 0 && current < count)) return 0;
  return Math.min(count - 1, Math.max(0, current + (action === "prev" ? -1 : 1)));
}
