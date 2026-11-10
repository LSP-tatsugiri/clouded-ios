# Idea lifecycle: built and dropped — design

Improvement backlog §1.2 and the lifecycle half of §2, approved by the owner
2026-10-22. Near-duplicate detection (the other half of §2) is a separate
design, not this one. Branch: `agent/idea-lifecycle`.

## Why

`ideas` has no state except extraction status. As the list grows it fills
with ideas that are done, dropped, or the same idea twice, and every distance,
the leverage ranking and "what moved" keep counting them. "I built this" is
also the honest profile source the design review asked for: building
something is the checkable evidence that you hold its skills.

## Decisions (owner, 2026-10-22)

- Lifecycle ships first, on its own; duplicates get their own design.
- "I built this" offers a checklist of the idea's skills, **all unticked**.
  You tick each one you actually used; ticked skills go to `solid`. Nothing is
  rated by default — the claim must be checkable, same rule as the taxonomy.
- Group feed: a **built** shared idea stays, tagged; a **dropped** shared idea
  leaves the feed but stays shared and reachable by link. Dropping never
  unshares.

## Schema — one migration, `<timestamp>_idea_lifecycle.sql`

```sql
alter table ideas
  add column built_at    timestamptz,
  add column dropped_at  timestamptz,
  add column drop_reason text,
  add constraint ideas_built_or_dropped check (built_at is null or dropped_at is null),
  add constraint ideas_drop_has_reason  check ((dropped_at is null) = (drop_reason is null)),
  add constraint ideas_drop_reason_line check (drop_reason is null or length(btrim(drop_reason)) between 1 and 200);

grant update (built_at, dropped_at, drop_reason) on ideas to authenticated;
```

- An idea is **live** when both timestamps are null. Built and dropped are
  mutually exclusive.
- Owner-only writes come from the existing `ideas: own` policy; friends hold
  only the select policy, so they cannot mark a friend's idea.
- Undo is setting the columns back to null — "Back to live".
- No new table, no edge-function change, no Anthropic spend.
- Applied by the owner (`supabase db push`); the agent runs `--dry-run` and
  commits the file on this branch in the same step.

## Web

### `web/lib/db.js`

- Add `built_at, dropped_at, drop_reason` to the column lists in `ideas()`,
  `sharedIdeas()` and `idea()`.
- `setBuilt(id, on)` — `built_at = on ? now : null`, also clears
  `dropped_at`/`drop_reason`.
- `setDropped(id, reason)` — `reason` string sets `dropped_at = now`,
  `drop_reason = reason.trim()`, clears `built_at`; `null` clears both.

### Idea page (owner only, with the share and delete controls)

- Live idea: two quiet actions, **I built this** and **Drop it**.
- **I built this** expands a checklist of the idea's capabilities that have a
  `skill_id` and are not already `solid` for you; proposed capabilities are
  left out (they cannot be rated). All unticked. Confirm stamps `built_at`,
  then sets each ticked skill to `solid`, then shows one "what moved" line for
  the whole batch. Cancel collapses it. With nothing left to tick the
  checklist is replaced by one line saying so, and confirm just stamps.
- **Drop it** expands a one-line input (required, ≤200 chars) and a confirm.
- Built or dropped idea: a banner at the top of the card —
  "Built 22 Oct" or "Dropped 22 Oct — <reason>" — with **Back to live**.
- **Back to live** clears the mark only. Skills raised to `solid` by "I built this" stay solid — you did use them, and reverting a rating silently would be a second, invisible write.
- Friends viewing a built or dropped shared idea see the banner, no actions.

### `whatMoved`

Generalised from one skill to a set: `whatMoved(skillIds, before, after)`.
Single-skill callers pass `[skillId]`. The headline names one skill
(`parametric-cad → solid.`) or counts several (`3 skills → solid.`). The
before/after distances count **live ideas only**.

### Ideas list

- A `Live · Built · Dropped` segmented control beside the sort, default
  **Live**, held in `state.filters.lifecycle`. The "N of M shown" count is
  within the chosen set.
- Built and dropped cards carry a tag (`built` / `dropped`); the dropped card
  shows its reason.
- "Closest to me" bands, the leverage panel and "what moved" use live ideas
  only, whatever the control shows. The ideas currently being extracted are
  always live.

### Group feed and friend pages

- Dropped ideas are filtered out; built ideas stay with a `built` tag.

## Out of scope

- iOS. Its selects name columns explicitly, so the new columns change
  nothing; the phone keeps showing every idea, which suits a capture-first
  app. Porting the lifecycle is a later decision.
- Near-duplicate detection and merge.
- Any change to extraction, `ideas.raw`, or the edge function.

## Verification

- `supabase db push --dry-run` lists exactly this migration.
- After the owner's push, `supabase migration list` shows it applied.
- In the browser against the hosted project, as the test user, using an
  existing idea (no new idea, no API spend): build with two ticks → banner,
  two skills `solid`, one "what moved" line, idea gone from Live and present
  under Built, leverage panel unchanged by it; Back to live; drop with a
  reason → feed hides it if shared; Back to live. Empty reason is refused by
  both the form and the check constraint.
- Restore the test user's skill levels afterwards.

## Docs to update in the same branch

- `CLAUDE.md` web layout paragraph: the lifecycle columns and the
  live-by-default list.
- `docs/improvement-backlog.md`: strike §1.2 and the lifecycle part of §2.
