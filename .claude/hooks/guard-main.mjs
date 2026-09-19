// PreToolUse hook (Bash | PowerShell): refuse any `git push` that would land
// on main. A push to main deploys the live site, and since 2026-09-19 the
// owner reviews agent work on a branch first (CLAUDE.md, "Agent work goes to
// a branch"). The rule in prose is the policy; this is the seatbelt.
//
// Blocked: `git push origin main`, `git push -u origin main`, `git push
// origin HEAD:main`, `git push origin :main` (deleting it), `--force` forms,
// and a bare `git push` while main is checked out. Anything else passes.
// Never fails open on its own errors except when it cannot parse the input,
// where there is nothing to judge.

import { execSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;

let command = "";
try { command = JSON.parse(input)?.tool_input?.command ?? ""; } catch { process.exit(0); }
if (!/\bgit\b/.test(command)) process.exit(0);

// Prose is not a command: drop heredoc bodies and quoted strings first, so a
// commit message that mentions "git push origin main" does not trip this.
const code = command
  .replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\s*\2\b/g, " ")
  .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, " ");
// each simple command in the string: `a && b`, `a; b`, `a | b`, newlines
const parts = code.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);

function currentBranch() {
  try { return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

function pushesMain(part) {
  const m = part.match(/\bgit\b(?:\s+(?:-C\s+\S+|-c\s+\S+|--[\w-]+(?:=\S+)?))*\s+push\b(.*)$/);
  if (!m) return false;
  const args = m[1].split(/\s+/).filter(Boolean);
  const positional = args.filter((a) => !a.startsWith("-"));
  const refspecs = positional.slice(1);          // after the remote
  if (refspecs.length === 0) {
    // `git push` / `git push origin` push the current branch (push.default simple)
    return currentBranch() === "main";
  }
  return refspecs.some((r) => {
    const dst = r.includes(":") ? r.split(":").pop() : r;
    return dst.replace(/^\+/, "").replace(/^refs\/heads\//, "") === "main";
  });
}

if (parts.some(pushesMain)) {
  const reason = "Refused: that pushes to main, which deploys the live site. Agent work goes to a branch (agent/<topic>) for the owner to review and merge — see CLAUDE.md. Push the branch instead.";
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason }
  }));
}
process.exit(0);
