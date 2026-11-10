// What to say when something fails.
//
//   explain(err) -> { text, detail }
//
//   text    a sentence for the page: what failed and what to do about it
//   detail  the raw message, for the "Details" fold and the console; null
//           when the message was already written for the reader
//
// db.js throws either a sentence ("Wrong email or password. …") or
// "<function>: <PostgREST message>" ("deleteIdea: new row violates row-level
// security policy"). The first passes through; the second is named in words.
// Pure, so node:test covers it (web/test/errors.test.mjs).

// db.js writes, by the name they throw under. Anything else there is a read.
const WRITES = {
  addIdea: "save the idea",
  deleteIdea: "delete the idea",
  setClarification: "save your answer",
  setShare: "change who the idea is shared with",
  setBuilt: "update the idea",
  setDropped: "drop the idea",
  setSkillLevel: "save that rating",
  setDisplayName: "save your name",
  createGroup: "create the group",
  renameGroup: "rename the group",
  deleteGroup: "delete the group",
  removeMember: "remove that member",
  uploadFeedbackShot: "upload the screenshot",
  addFeedback: "send the report"
};

const OFFLINE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;
const SESSION = /jwt|not authenticated|invalid claim|refresh token/i;
const REFUSED = /row-level security|permission denied|not authorized/i;
// a database or PostgREST message that reached the page without a db.js name
// a unique violation: the row is already there, so trying again cannot help
const EXISTS = /duplicate key|\b23505\b/i;
const TECHNICAL = /violates|constraint|duplicate key|schema cache|PGRST|JSON object requested|relation "|column "|syntax error/i;

export function explain(err) {
  const raw = String(err?.message ?? err ?? "").trim();
  if (!raw) return { text: "Something went wrong. Try again.", detail: null };
  if (OFFLINE.test(raw)) return { text: "The connection failed. Check that you are online, then try again.", detail: raw };
  if (SESSION.test(raw)) return { text: "Your session has ended. Reload the page and sign in again.", detail: raw };

  const named = raw.match(/^([a-z][A-Za-z]*): /);
  const exists = EXISTS.test(raw) || String(err?.code ?? "") === "23505";
  if (!named && !exists && !REFUSED.test(raw) && !TECHNICAL.test(raw)) return { text: raw, detail: null };

  const write = named && WRITES[named[1]];
  const what = write || (named ? "load this page" : "do that");
  if (exists) {
    return { text: `Could not ${write || "do that"}: it already exists. Reload the page to see it.`, detail: raw };
  }
  if (REFUSED.test(raw)) {
    return { text: `Could not ${what}: this account is not allowed to. Reload the page; if it still fails, report it with the link at the bottom.`, detail: raw };
  }
  return {
    text: named && !write
      ? "Could not load this page. Reload to try again; if it keeps failing, report it with the link at the bottom."
      : `Could not ${what}. Try again; if it keeps failing, report it with the link at the bottom.`,
    detail: raw
  };
}
