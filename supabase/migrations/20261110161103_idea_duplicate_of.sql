-- Duplicates: "Drop this one as a duplicate" beside a "Looks like" match on
-- the idea page. It is the existing dropped state (20261022233104) plus a
-- pointer, so the dropped idea's page can link to the one it duplicates.
-- Nothing is merged or rewritten: raw stays as captured, the reason is an
-- ordinary drop_reason, and "Back to live" undoes it like any other drop.
--
-- The pointer only means something on a dropped idea. Rather than make every
-- client clear it, the trigger below does: whenever dropped_at is null after
-- a write (back to live, marked built, or a fresh insert), duplicate_of is
-- null too. Deleting the other idea sets it null and leaves the drop.

alter table ideas
  add column duplicate_of uuid references ideas on delete set null,
  add constraint ideas_duplicate_is_dropped check (duplicate_of is null or dropped_at is not null),
  add constraint ideas_duplicate_not_self   check (duplicate_of is distinct from id);

-- A pointer may only name another of the same owner's ideas. Writes already
-- come only from "ideas: own" (user_id = auth.uid()); this closes the rest.
-- The lookup runs as the caller, under RLS, and fails with one message
-- whether the id does not exist or belongs to someone else, before the
-- foreign key is checked — so the column is not a way to learn whether an
-- idea id exists. Insert is covered too: INSERT on ideas is table-wide.
create function ideas_duplicate_rules() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.dropped_at is null then
    new.duplicate_of := null;
  elsif new.duplicate_of is not null
    and not exists (select 1 from ideas i where i.id = new.duplicate_of and i.user_id = new.user_id) then
    raise exception 'duplicate_of must name another of your own ideas';
  end if;
  return new;
end
$$;

create trigger ideas_duplicate_rules
  before insert or update on ideas
  for each row execute function ideas_duplicate_rules();

-- Joins the column-by-column update grants (init.sql, idea_lifecycle.sql).
-- Reading needs nothing new: a group mate who can read a dropped shared idea
-- sees an opaque id, and following it gets the same "not shared with you" as
-- any other id they cannot read.
grant update (duplicate_of) on ideas to authenticated;
