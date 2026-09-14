-- Skill review: who may promote a proposed capability into the skills table.
--
-- "Never auto-create a skill" is an invariant, so a human confirms every one.
-- Until now that human had no interface: proposed_skills is readable by nobody
-- through the API (see 20260912222851), because its reasons and idea_ids
-- aggregate across users. This adds a curator role that can see it, and two
-- functions that do the promotion.
--
-- The functions are security definer on purpose. Promoting touches three
-- tables, including idea_capabilities rows belonging to other users' ideas.
-- Granting a curator blanket UPDATE there would be a much bigger privilege
-- than granting them these two narrow, auditable operations.

create table curators (
  user_id   uuid primary key references auth.users on delete cascade,
  added_at  timestamptz not null default now()
);

alter table curators enable row level security;

-- A curator can confirm they are one. Nobody can see the whole list, and
-- nobody can write it through the API: membership is granted out of band by
-- the service role (supabase/scripts/grant-curator.mjs).
create policy "curators: confirm yourself" on curators
  for select to authenticated using (user_id = auth.uid());

grant select on curators to authenticated;

create function is_curator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from curators where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------- reading

-- Curators only. The row aggregates reasons and idea ids from every user's
-- ideas, so this is not something to open to all authenticated users again.
create policy "proposed_skills: curators read" on proposed_skills
  for select to authenticated using (is_curator());

grant select on proposed_skills to authenticated;

-- ---------------------------------------------------------------- promoting

-- Adds the skill, repoints every capability that was waiting on the proposal,
-- and records the outcome on the registry row. All or nothing.
create function promote_proposed_skill(
  p_key      text,
  p_skill_id text,
  p_name     text,
  p_domain   text default null,
  p_aliases  text[] default '{}',
  p_hazard   boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_curator() then
    raise exception 'not a curator';
  end if;
  if p_skill_id is null or btrim(p_skill_id) = '' or p_name is null or btrim(p_name) = '' then
    raise exception 'a promoted skill needs an id and a name';
  end if;
  if not exists (select 1 from proposed_skills where key = p_key) then
    raise exception 'no proposal called %', p_key;
  end if;

  -- new skills go to the end; sort_order is the extraction prompt's ordering
  insert into skills (id, name, domain, aliases, hazard, sort_order)
  values (p_skill_id, p_name, p_domain, coalesce(p_aliases, '{}'), coalesce(p_hazard, false),
          (select coalesce(max(sort_order), 0) + 1 from skills))
  on conflict (id) do nothing;

  -- an idea may already hold the skill being promoted to; drop the duplicate
  -- rather than violate unique (idea_id, skill_id)
  delete from idea_capabilities ic
   where ic.proposed_key = p_key
     and ic.skill_id is null
     and exists (select 1 from idea_capabilities o
                  where o.idea_id = ic.idea_id and o.skill_id = p_skill_id);

  update idea_capabilities
     set skill_id = p_skill_id, proposed_key = null, resolved = 'semantic:promoted'
   where proposed_key = p_key and skill_id is null;

  update proposed_skills
     set promoted = p_skill_id, rejected = null, updated_at = now()
   where key = p_key;
end
$$;

-- Rejecting keeps the row: resolve.js still matches later sightings of the
-- same concept to it, which is what makes the rejection stick.
create function reject_proposed_skill(p_key text, p_why text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_curator() then
    raise exception 'not a curator';
  end if;
  if p_why is null or btrim(p_why) = '' then
    raise exception 'a rejection needs a reason, so it is not re-proposed blind';
  end if;
  update proposed_skills
     set rejected = p_why, updated_at = now()
   where key = p_key;
  if not found then
    raise exception 'no proposal called %', p_key;
  end if;
end
$$;

-- Only curators get past the guard inside, but the functions must be callable
-- to reach it. execute is revoked from anon so an unauthenticated caller
-- cannot even attempt them.
revoke execute on function promote_proposed_skill(text, text, text, text, text[], boolean) from anon;
revoke execute on function reject_proposed_skill(text, text) from anon;
revoke execute on function is_curator() from anon;
