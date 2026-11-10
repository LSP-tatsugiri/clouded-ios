-- Two extraction fields (docs/improvement-backlog.md §4 "Assumption
-- visibility" and §5 "learnable from a tutorial vs needs real iteration",
-- approved 2026-11-10). Both are written by the extract edge function, which
-- runs as the service role, so no grant changes and no RLS changes: they are
-- read under the existing select policies on ideas and idea_capabilities.
--
-- Every existing row gets null. Neither is backfilled: a value comes only
-- from an extraction run under the new prompt, and older runs never asked.

-- The reading the model took when the idea's wording admits more than one,
-- one sentence; null when the idea was unambiguous. Alongside raw, never
-- instead of it, like objective.
alter table ideas
  add column assumption text;

-- What kind of work a capability is: 'tutorial' (existing guides would get a
-- competent person there) or 'iteration' (needs real trial and error on this
-- project). A property of the task, not a size and not a time. Distance does
-- not read it yet (extraction/src/distance.js says why).
alter table idea_capabilities
  add column iteration text,
  add constraint idea_capabilities_iteration check (iteration is null or iteration in ('tutorial', 'iteration'));
