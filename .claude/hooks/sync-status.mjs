// SessionStart hook: tell this session what the other machine has done.
//
// Two machines (a Windows PC on main, a Mac on step-6) push to one repo and
// one Supabase project. What its stdout says lands in the session's context,
// so every session starts knowing: new commits on origin it does not have,
// migration files on other branches it does not have (the case that bit us:
// a migration applied to the shared database before it was pulled here), and
// uncommitted local work the other machine cannot see. Git only — no
// Supabase CLI, which needs a login and is slow. Node so it runs the same
// from PowerShell and from a Mac shell. Never fails the session: any error
// prints one line and exits 0.

//
// Three modes, wired in .claude/settings.json:
//   --before  UserPromptSubmit: what the OTHER machine pushed since last look.
//             Fetches at most once a minute; silent when there is nothing new,
//             so a session only hears about it when it matters.
//   --after   Stop: what THIS machine has not shared yet (unpushed commits,
//             uncommitted files), as a one-line status. Never pushes: a push
//             to main deploys the live site, so pushing stays a deliberate act.
//   (none)    the full report, for running by hand.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const git = (args) => execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const lines = (s) => (s ? s.split("\n") : []);
const BRANCHES = ["main", "step-6"];
const MODE = process.argv[2] ?? "";
const FETCH_EVERY_MS = 60_000;

// Fetch unless we fetched within the last minute. The stamp lives inside
// .git so it is never a tracked file.
function fetchThrottled() {
  const stamp = `${git("rev-parse --git-dir")}/sync-status-fetched`;
  try { if (Date.now() - Number(readFileSync(stamp, "utf8")) < FETCH_EVERY_MS) return true; } catch {}
  try { git("fetch -q origin"); writeFileSync(stamp, String(Date.now())); return true; } catch { return false; }
}

try {
  const head = git("rev-parse --abbrev-ref HEAD");

  if (MODE === "--after") {
    // no fetch: this is about local state only, and it runs after every turn
    const dirty = lines(git("status --porcelain")).filter((l) => !l.startsWith("??")).length;
    let unpushed = 0;
    try { unpushed = lines(git(`log --oneline origin/${head}..HEAD`)).length; } catch { unpushed = -1; } // no upstream yet
    const parts = [];
    if (unpushed > 0) parts.push(`${unpushed} commit(s) on ${head} not pushed`);
    if (unpushed < 0) parts.push(`${head} has no upstream yet`);
    if (dirty) parts.push(`${dirty} file(s) uncommitted`);
    if (parts.length) console.log(JSON.stringify({ systemMessage: `[sync] the other machine cannot see: ${parts.join(", ")}` }));
    process.exit(0);
  }

  const fetched = fetchThrottled();
  const out = [];
  if (!fetched) out.push("could not fetch origin (offline?) — the picture below may be stale");

  for (const b of BRANCHES) {
    let ahead;
    try { ahead = lines(git(`log --oneline HEAD..origin/${b}`)); } catch { continue; } // branch absent on origin
    if (ahead.length) out.push(`origin/${b} has ${ahead.length} commit(s) this checkout lacks:\n  ${ahead.slice(0, 8).join("\n  ")}${ahead.length > 8 ? "\n  …" : ""}`);
  }

  const local = new Set(lines(git("ls-files supabase/migrations")).map((p) => p.split("/").pop()));
  for (const b of BRANCHES) {
    let files;
    try { files = lines(git(`ls-tree -r --name-only origin/${b} -- supabase/migrations`)).map((p) => p.split("/").pop()); } catch { continue; }
    const missing = files.filter((f) => !local.has(f));
    if (missing.length) out.push(`migration file(s) on origin/${b} not in this checkout — pull before \`supabase db push\`:\n  ${missing.join("\n  ")}`);
  }

  if (MODE === "--before") {
    // before a task: only what the other machine did matters; local state is
    // the --after report's job. Silent when there is nothing new.
    if (out.length) console.log(`[sync] before you start — on ${head}:\n${out.join("\n")}`);
    process.exit(0);
  }

  const dirty = lines(git("status --porcelain")).filter((l) => !l.startsWith("??"));
  if (dirty.length) out.push(`${dirty.length} uncommitted change(s) here that the other machine cannot see`);
  const unpushed = lines(git(`log --oneline origin/${head}..HEAD`).trim() || "");
  if (unpushed.length) out.push(`${unpushed.length} local commit(s) on ${head} not pushed yet`);

  console.log(out.length
    ? `[sync] on ${head}.\n${out.join("\n")}`
    : `[sync] on ${head}, in step with origin (${BRANCHES.join(", ")}).`);
} catch (e) {
  console.log(`[sync] check skipped: ${String(e.message).split("\n")[0]}`);
}
