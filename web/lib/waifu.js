// The #/waifu scene's time bands and what she says (docs/waifu-view-plan.md).
//
// Pure: no DOM, no clock of its own. bandFor takes a Date so the boundary
// hours can be checked in Node, and the page can force a band with ?band=.
// The lines are deliberately neutral — no voice has been chosen yet — and
// none of them may ever contain a score or a time estimate (CLAUDE.md).

// distance.js by a relative path, so Node (the tests) and the browser both
// find it: from /lib/ the two dots clamp at the site root and land on the
// same /extraction/src/distance.js that app.js imports.
import { cruxOf } from "../../extraction/src/distance.js";

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

// ---- what she says once extraction lands (docs/improvement-backlog.md §7)

// A lead-in per band for an idea too vague to extract; the question follows.
export const VAGUE_LEADS = {
  late:      "Too late at night for riddles.",
  dawn:      "I'm barely awake, so help me out.",
  morning:   "One thing before the day gets going.",
  afternoon: "Hold on, one thing.",
  dusk:      "Before the light goes, one thing.",
  night:     "Mm, I can't quite picture it."
};
// The scene has no answer box (its one box captures), so the question links
// to the idea page, which has.
export const ANSWER_LINK = "Answer it on its page.";

// "Read a sensor…" -> "read a sensor…", but "PCB…", "I2C…" and "3D…" stay.
function lower(name) {
  const first = name.split(/\s/, 1)[0];
  return /[A-Z0-9]/.test(first.slice(1)) || /^\d/.test(first) ? name : name[0].toLowerCase() + name.slice(1);
}

// One line about a finished extraction, or null when there is nothing to add
// to "Got it". `x` is the idea row with its capability rows:
// { is_clear | clear, clarifying_question, capabilities }; `nameOf` maps a
// skill id to its name. A table skill is a task ("Read a sensor over I2C…"),
// so it is read back as something to do; a proposed one is only a slug
// ("label-design"), so it is read back as a thing.
export function readBack(x, nameOf, band) {
  const clear = x?.clear ?? x?.is_clear;
  if (clear === false) {
    const q = x.clarifying_question?.trim();
    return q ? `${VAGUE_LEADS[band] ?? VAGUE_LEADS.night} ${q}` : null;
  }
  if (clear !== true) return null;
  const crux = cruxOf(x);
  if (!crux) return null;
  const name = crux.skill_id ? nameOf?.(crux.skill_id)?.trim().replace(/[.?!]+$/, "") : null;
  if (name && name !== crux.skill_id) return `The hard part's having to ${lower(name)}, right?`;
  const slug = crux.skill_id ?? crux.proposed_key ?? crux.proposed_name;
  return slug ? `The hard part's the ${slug.replace(/[-_]+/g, " ").trim()}, right?` : null;
}
