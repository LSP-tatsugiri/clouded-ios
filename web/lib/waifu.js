// The #/waifu scene's time bands and what she says (docs/waifu-view-plan.md).
//
// Pure: no DOM, no clock of its own. bandFor takes a Date so the boundary
// hours can be checked in Node, and the page can force a band with ?band=.
// The lines are deliberately neutral — no voice has been chosen yet — and
// none of them may ever contain a score or a time estimate (CLAUDE.md).

// Six bands by local hour. Night wraps midnight: 20:00 to 00:59.
export const BANDS = ["late", "dawn", "morning", "afternoon", "dusk", "night"];

export function bandFor(date) {
  const h = date.getHours();
  if (h >= 1 && h < 5) return "late";
  if (h >= 5 && h < 8) return "dawn";
  if (h >= 8 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 20) return "dusk";
  return "night";
}

// ?band=dusk in the query string (before the hash) forces one, for checking
// each band's copy without waiting for the hour. Anything unknown is ignored.
export function forcedBand(search) {
  const b = new URLSearchParams(search).get("band");
  return BANDS.includes(b) ? b : null;
}

export const OPENERS = {
  late:      ["It's late. What's the idea?", "Still up? Tell me the idea."],
  dawn:      ["Early. What's on your mind?", "Barely light out. What's the idea?"],
  morning:   ["Morning. What's the idea?", "Got one already? Tell me."],
  afternoon: ["Afternoon. What's the idea?", "Go on — what is it?"],
  dusk:      ["Evening's coming. What's the idea?", "Sun's going. What did you think of?"],
  night:     ["Evening. What's the idea?", "Quiet now. Tell me the idea."]
};

export const SAVED = "Got it. I'll hold on to that.";
export const SENDING = "…";
export const FAILED = "That didn't save. Try again?";

export function opener(band, random = Math.random) {
  const pool = OPENERS[band] ?? OPENERS.night;
  return pool[Math.floor(random() * pool.length)];
}
