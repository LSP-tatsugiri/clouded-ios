#!/usr/bin/env bash
# One-shot: docs/improvement-backlog.md -> GitHub issues (docs/feedback-plan.md, Phase E).
# Run from the repo root in a shell where `gh` is signed in (Git Bash on the PC is fine):
#   bash docs/feedback-migrate.sh
# Safe to re-run: titles that already exist are skipped. Delete this file afterwards.
set -euo pipefail
gh auth status >/dev/null

B="docs/improvement-backlog.md"

# Labels: create the two new ones; add any of the five triage labels that are missing.
have=$(gh label list --limit 100 --json name --jq '.[].name')
mklabel() { grep -qx "$1" <<<"$have" || gh label create "$1" --color "$2" --description "$3"; }
mklabel bug             d73a4a "Something did the wrong thing"
mklabel improvement     a2eeef "Something could be better"
mklabel needs-triage    e4e669 "Maintainer needs to evaluate this issue"
mklabel needs-info      d876e3 "Waiting on reporter for more information"
mklabel ready-for-agent 0e8a16 "Fully specified, ready for an AFK agent"
mklabel ready-for-human 1d76db "Requires human implementation"
mklabel wontfix         ffffff "Will not be actioned"

existing=$(gh issue list --state all --limit 500 --json title --jq '.[].title')
n=0
mk() {
  if grep -qxF -- "$1" <<<"$existing"; then echo "skip (exists): $1"; return; fi
  gh issue create --label improvement --label needs-triage --title "$1" --body "$2

See \`$B\` §$3 for the reasoning." >/dev/null
  n=$((n+1)); echo "filed: $1"
}

mk "Name the invite() allowlist hole in CLAUDE.md" "Any group creator can allowlist any email. Trust-based by design; record it next to the no-cost-cap note." "0.5"
mk "\"I built this\": ideas.built_at, offer to set its capabilities solid" "Marking an idea built is the honest profile source and the list's missing end state. Confirm per capability." "1.2"
mk "Idea lifecycle: dropped_at with a reason; default the list to live ideas" "Built/dropped behind a toggle before the list reaches 80." "2"
mk "Near-duplicate detection at capture (pg_trgm + capability overlap)" "Surface \"looks like #N\" on the idea page with a merge button. No embeddings needed for the first version." "2"
mk "App Intent + Shortcut for capture" "Gives Action Button, Siri, lock-screen widget and Shortcuts in one go; the README's promised capture, cheaply." "3.1"
mk "Local outbox for the idea row (offline capture)" "Same spool pattern Uploader uses; client-chosen id makes retries idempotent. The README names this exact failure as the worst one." "3.2"
mk "Control Center / lock-screen capture widget" "A button, not a screen. After the App Intent exists." "3.3"
mk "Share-sheet action keeps the source URL and page title" "source_url exists and the extension already has both." "3.4"
mk "Replace the 2-second poll with Supabase Realtime on extraction_runs" "Removes ~60 round-trips per capture and WATCH_WINDOW_MS guesswork." "4"
mk "Scope the capabilities query to the ideas being shown" "Unbounded query today, on every list load and again on the Group tab." "4"
mk "Empty-profile cold start: rate the skills your own ideas need" "Beats a 51-row form; with zero ratings every idea is all-gaps and the sort is meaningless." "4"
mk "Mobile web layout for the Group tab and profile grid" "Mobile web is the phone's sharing UI today." "4"
mk "Batch the vague-bucket answers on one screen" "Three vague entries are three round-trips through a form today." "4"
mk "Assumption visibility: extraction emits assumption separately, UI renders it correctable" "Prompt + schema change, so it re-baselines; bundle with the parked strict:true change." "4"
mk "Held-out ideas test: 10 ideas from outside the backlog" "A low proposed rate on your own ideas proves nothing; needs a friend's ideas." "5"
mk "Crux stability: ship ranked top-2 or soften \"the hard part\"" "Committed at 16/19 same-prompt; the definite article is not yet earned." "5"
mk "Per-capability \"tutorial vs iteration\" flag" "Makes distance mean size without printing a time estimate; a checkable property of the capability." "5"
mk "Claims: \"I can do the hard part\" on a shared idea" "One row (idea_claims); doubles as the honest profile signal and the smallest version of comments." "6"
mk "Group leverage over the union of the group's skills" "Same leverage() with a different held map. Step 8 decision 11." "6"
mk "Weekly email digest as the notification path" "One scheduled function, no push infrastructure; the prerequisite for comments." "6"
mk "Waifu view reacts to the extraction result" "The crux read back in one line at the moment the person is actually looking." "7"
mk "Waifu view: band-aware line for the vague bucket" "Makes the clarifying question feel like conversation instead of a form." "7"
mk "Ventures as an idea type (deferred 2026-09-16)" "ideas.kind = build | venture, gates, business-domain skills. Parked by decision; draft PRD in the Cowork project." "8"
mk "Stopgap: a named venture never triggers a build-artifact clarifying question" "Prompt rule 2 tweak; re-baselines. Cheap while §8 stays parked." "8"

echo "done: $n issues filed"
gh issue list --label improvement --limit 50 --json number,title --jq '.[] | "#\(.number)  \(.title)"' | sort -n
