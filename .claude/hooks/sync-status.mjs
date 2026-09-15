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

import { execSync } from "node:child_process";

const git = (args) => execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const lines = (s) => (s ? s.split("\n") : []);
const BRANCHES = ["main", "step-6"];

try {
  try { git("fetch -q origin"); } catch { console.log("[sync] could not fetch origin (offline?) — the picture below may be stale"); }

  const head = git("rev-parse --abbrev-ref HEAD");
  const out = [];

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
