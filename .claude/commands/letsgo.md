---
description: Fetch origin and merge the newest main into the current local branch
---

Fetch the latest from origin, then merge `origin/main` into whatever branch is currently checked out in this repo.

Steps:
1. Run `git status` to confirm there are no uncommitted changes that could be lost. If there are uncommitted changes, stop and tell the user instead of proceeding.
2. Run `git fetch origin`.
3. Run `git merge origin/main --no-edit`.
4. If the merge has conflicts, stop and report them to the user rather than resolving destructively.
5. Report a short summary of what was merged (or that it was already up to date).
