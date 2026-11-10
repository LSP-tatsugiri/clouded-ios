// The Ideas list's filters and sort, as the query in the hash:
// #/?sort=closest&domain=embedded&q=motor. Back from an idea page, or a
// reload, then returns to the same view.
//
// Pure, so node:test covers it (web/test/filters.test.mjs); app.js reads and
// writes location. Only what differs from DEFAULTS is written, so the plain
// list is still "#/". Anything unrecognised decodes to its default: a
// hand-edited or stale link must never break the list.

export const DEFAULTS = Object.freeze({
  sort: "newest",        // newest | closest
  lifecycle: "live",     // live | built | dropped
  domain: "",
  crux: "",              // "" | have | partial | gap — the hard part's state
  proposed: false,
  friend: false,
  q: ""
});

const ONE_OF = {
  sort: ["newest", "closest"],
  lifecycle: ["live", "built", "dropped"],
  crux: ["", "have", "partial", "gap"]
};
const FLAGS = ["proposed", "friend"];
const TEXT = { domain: 60, q: 200 };   // longest value accepted from a link

/** `state` is { sort, lifecycle, domain, crux, proposed, friend, q }. No leading "?". */
export function encodeFilters(state) {
  const p = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS)) {
    const v = state?.[k];
    if (v === undefined || v === null || v === DEFAULTS[k]) continue;
    if (FLAGS.includes(k)) { if (v === true) p.set(k, "1"); }
    else if (ONE_OF[k]) { if (ONE_OF[k].includes(v)) p.set(k, v); }
    else if (typeof v === "string" && v) p.set(k, v);
  }
  return p.toString();
}

/** The whole state, defaults filled in. Accepts the query with or without its "?". */
export function decodeFilters(query) {
  const out = { ...DEFAULTS };
  if (typeof query !== "string") return out;
  let p;
  try { p = new URLSearchParams(query.replace(/^[?]/, "")); } catch { return out; }
  for (const k of Object.keys(DEFAULTS)) {
    const v = p.get(k);
    if (v === null) continue;
    if (FLAGS.includes(k)) out[k] = v === "1";
    else if (ONE_OF[k]) { if (ONE_OF[k].includes(v)) out[k] = v; }
    else out[k] = v.slice(0, TEXT[k]);
  }
  return out;
}

// How many of the folded-away filters are on: the number in "Filter (2)".
// Search, sort and Live/Built/Dropped are always on screen, so they never count.
export function activeCount(state) {
  return (state.domain ? 1 : 0) + (state.crux ? 1 : 0) + (state.proposed ? 1 : 0) + (state.friend ? 1 : 0);
}
