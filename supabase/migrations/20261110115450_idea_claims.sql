-- Claims: "I can do a hard part" (docs/improvement-backlog.md §6).
--
-- A group mate says they can do the crux of an idea someone shared. One row
-- per person per idea, and that is all it is: no text, no level, no count
-- anywhere. The feed prints the names. It is the smallest thing that makes
-- the feed a loop rather than a display, and it needs no notification path
-- because the owner sees it the next time they open the Group tab.
--
-- A claim is said to a group about an idea shared to it, so it lives exactly
-- as long as that is true: the idea stops being shared there, or the claimer
-- stops being a member, and the row goes. Without that, a claim would outlast
-- the claimer's own right to see it (and so to take it back), and a removed
-- member's name would stay on the group's cards.

create table idea_claims (
  idea_id     uuid not null references ideas on delete cascade,
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (idea_id, user_id)
);
-- the primary key leads with idea_id; this is for the two deletes by person
-- (the auth.users cascade and the leave trigger below)
create index idea_claims_user_id on idea_claims (user_id);

alter table idea_claims enable row level security;

-- Reads follow the idea, the way idea_capabilities does: its owner, and the
-- members of the group it is shared to. So the owner sees who claimed, every
-- member sees the same names, and nobody outside the group sees anything.
create policy "idea_claims: follow their idea" on idea_claims
  for select to authenticated
  using (exists (
    select 1 from ideas i
    where i.id = idea_id
      and (i.user_id = auth.uid() or i.shared_to in (select my_group_ids()))
  ));

-- You claim as yourself, on an idea shared to a group you are in, and never
-- on your own: "I can do the hard part of my own idea" is what the skill
-- profile is for. `shared_to in (...)` is false for a private idea (null) and
-- for one shared to a group you are not in, so an id guessed or kept from an
-- old link gets nowhere.
create policy "idea_claims: claim a group mate's shared idea" on idea_claims
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from ideas i
      where i.id = idea_id
        and i.user_id <> auth.uid()
        and i.shared_to in (select my_group_ids())
    )
  );

-- Taking it back is the only edit. The idea's owner cannot remove someone
-- else's claim, and there is no UPDATE policy: a claim has nothing to change.
create policy "idea_claims: take back your own" on idea_claims
  for delete to authenticated using (user_id = auth.uid());

-- Privileges spelled out rather than left to the default grants: the anon key
-- gets nothing, and a client may read, insert and delete. Insert is granted on
-- the two key columns only, so created_at is always the database's clock.
revoke all on idea_claims from anon, authenticated;
grant select, delete on idea_claims to authenticated;
grant insert (idea_id, user_id) on idea_claims to authenticated;

-- ---------------------------------------------------------------- cleanup

-- The idea is unshared, or moved to another group: the claims were made to
-- the group it has left. This also runs when a member leaves (unshare_on_leave
-- sets shared_to to null) and when a group is deleted (the foreign key's
-- "on delete set null" is an update, and fires this). Security definer
-- because the person unsharing does not own the claims.
create function drop_claims_on_unshare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from idea_claims where idea_id = new.id;
  return new;
end
$$;

create trigger on_idea_unshared
  after update of shared_to on ideas
  for each row when (old.shared_to is distinct from new.shared_to)
  execute function drop_claims_on_unshare();

-- The claimer leaves, or is removed: what they said to that group goes with
-- them, the same rule as their shared ideas. Security definer because the
-- remover is not the claims' owner.
create function drop_claims_on_leave() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from idea_claims c
   using ideas i
   where c.user_id = old.user_id
     and i.id = c.idea_id
     and i.shared_to = old.group_id;
  return old;
end
$$;

create trigger on_member_left_claims
  after delete on group_members
  for each row execute function drop_claims_on_leave();
