// Waiting for an extraction, and what an idea with no result yet is.
//
// Pure, so node:test covers it (web/test/wait.test.mjs); app.js owns the
// timers and db.js the channel and the reads. Nothing here, and nothing that
// drives it, writes: the two writes that start an extraction (addIdea,
// setClarification) are only ever made by a form submit.

// The wait is a race, not a switch. A Realtime subscription and a poll run
// side by side and whichever sees the run first ends it. While the channel
// is connecting, or once it has failed, the poll keeps today's 2 s cadence;
// once it is subscribed the poll slows to a safety net, because the channel
// may be up and still silent (the table not yet in the publication).
export const TICK_MS = 2000;          // the clock: progress on screen, and the fast poll
export const SLOW_MS = 8000;          // the poll while the channel is live
export const SUBSCRIBE_MS = 6000;     // a channel not subscribed by then is given up on
export const WINDOW_MS = 120000;      // the whole wait, as long as it always was

export const startWait = () => ({ phase: "connecting", elapsed: 0, polledAt: 0, done: false });

// step(state, event) -> { s, acts }
//   events  "subscribed" | "sub-error" | "row" | "tick" | "timeout"
//   acts    "poll"      read runsFor now
//           "close"     drop the channel; the poll carries on alone
//           "progress"  repaint the seconds
//           "finish"    a run arrived: stop everything, take it
//           "give-up"   the window ran out: stop everything, stall
// Once done, every event is ignored, so a late row or a late status from a
// closing channel cannot finish a wait twice.
export function step(s, ev) {
  if (s.done) return { s, acts: [] };
  if (ev === "row") return { s: { ...s, done: true }, acts: ["finish"] };
  if (ev === "timeout") return { s: { ...s, done: true }, acts: ["give-up"] };
  if (ev === "subscribed") return { s: s.phase === "connecting" ? { ...s, phase: "live" } : s, acts: [] };
  if (ev === "sub-error") {
    // also what a channel that closes mid-wait reports: back to the fast poll
    return s.phase === "fallback" ? { s, acts: [] } : { s: { ...s, phase: "fallback" }, acts: ["close"] };
  }
  if (ev !== "tick") return { s, acts: [] };

  const elapsed = s.elapsed + TICK_MS;
  if (elapsed >= WINDOW_MS) return { s: { ...s, elapsed, done: true }, acts: ["give-up"] };
  const acts = ["progress"];
  let phase = s.phase;
  if (phase === "connecting" && elapsed >= SUBSCRIBE_MS) { phase = "fallback"; acts.push("close"); }
  let polledAt = s.polledAt;
  if (elapsed - polledAt >= (phase === "live" ? SLOW_MS : TICK_MS)) { polledAt = elapsed; acts.push("poll"); }
  return { s: { ...s, phase, elapsed, polledAt }, acts };
}

// What the list shows for one of your ideas.
//   "clear"    extracted, the full card
//   "vague"    extraction ran and asked a question: the answer box
//   "pending"  no result yet, inside the wait window: being watched
//   "stale"    no result and the window is past: the webhook never came
//   "failed"   extraction ran and errored (a dead key looks like this)
//   "answering" an answer was sent and no run newer than it has landed: the
//              question on screen is the old one, already answered
//   "draft"    saved without extracting: nothing has run, nothing is waited on
// `run` is the latest extraction_runs row when the caller has one, else null.
// `answeredAt` is when this session sent an answer (an ISO string), else
// null. Only "vague" may offer an answer box: an answer is a paid re-run, and
// for the others it would be answering a question nobody asked, or the same
// question twice while the first answer may still land.
export function resultOf(idea, run, now, windowMs = WINDOW_MS, answeredAt = null) {
  if (idea.status === "draft") return "draft";
  if (idea.is_clear === true) return "clear";
  if (answerPending(answeredAt, run)) return "answering";
  if (idea.is_clear === false) return "vague";
  if (idea.status === "failed" || run?.error) return "failed";
  return now - Date.parse(queuedSince(idea)) < windowMs ? "pending" : "stale";
}

// Whether an answer sent at `answeredAt` is still waiting on its re-run,
// given the latest run known (or null). A run created after the answer
// settles it, whatever it said: a new question, a result or an error.
// Nothing in the rows records when a clarification was written (ideas has
// no updated_at, a run does not store its input), so only the session that
// sent the answer knows; after a reload this is false and the box is back.
export function answerPending(answeredAt, run) {
  if (!answeredAt) return false;
  return !(run && Date.parse(run.created_at) > Date.parse(answeredAt));
}

// When an idea's extraction was asked for: the insert, or for a draft the
// moment "Extract now" moved it to pending, which may be weeks later.
export const queuedSince = (idea) => idea.queued_at ?? idea.created_at;

// The answers a batch form will send: one per idea, only those filled in,
// trimmed, in the order the form lists them.
export function filledAnswers(ids, drafts) {
  return ids.map((id) => ({ id, text: (drafts.get(id) ?? "").trim() })).filter((a) => a.text);
}

// "1 answer, 1 re-run" — said before the submit, in the single box's words.
export const costLine = (n) =>
  `Answering re-runs extraction, about a cent each. ${n} ${n === 1 ? "answer" : "answers"}, ${n} ${n === 1 ? "re-run" : "re-runs"}.`;

// The batch form's cost line and Send button for `n` filled answers: what
// Send will do, said before it is pressed. Worked out from the drafts on
// every render and every keystroke, so the two can never disagree.
export function batchSubmit(n, sending = false) {
  return {
    cost: n ? costLine(n) : "Answering re-runs extraction, about a cent each. Fill in the ones you can; empty ones are left as they are.",
    label: sending ? "Sending…" : n ? `Send ${n} ${n === 1 ? "answer" : "answers"}` : "Send answers"
  };
}
