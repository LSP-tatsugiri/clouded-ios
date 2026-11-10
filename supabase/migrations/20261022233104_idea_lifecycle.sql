-- Idea lifecycle: built and dropped (docs/superpowers/specs/2026-10-22-idea-lifecycle-design.md).
-- An idea is live while both timestamps are null. Built and dropped exclude
-- each other, and "back to live" is setting all three to null again, so
-- nothing here is one-way. Owner-only writes come from "ideas: own"; a group
-- mate holds only the select policy and cannot mark someone else's idea.

alter table ideas
  add column built_at    timestamptz,
  add column dropped_at  timestamptz,
  add column drop_reason text,           -- one line, why; a fact, not a score
  add constraint ideas_built_or_dropped check (built_at is null or dropped_at is null),
  add constraint ideas_drop_has_reason  check ((dropped_at is null) = (drop_reason is null)),
  add constraint ideas_drop_reason_line check (drop_reason is null or length(btrim(drop_reason)) between 1 and 200);

-- init.sql revoked update on ideas and granted it column by column; these
-- three join clarification, image_path, audio_path, transcript and shared_to.
grant update (built_at, dropped_at, drop_reason) on ideas to authenticated;
