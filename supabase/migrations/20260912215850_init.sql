-- clouded: initial schema.
--
-- Derived from extraction/schema.sql with the Phase B fixes from
-- docs/step-4-plan.md. Decisions applied 2026-09-12:
--   * crux is `crux_rank smallint` (1 primary, 2 secondary, null otherwise),
--     not a boolean. Exactly one rank-1 row per idea, enforced by index.
--   * distance sort (crux status first, then gap count) is app-side and
--     does not appear here.
--   * no vector columns yet; add with pgvector when the semantic call needs it.
--
-- Rows under an idea (capabilities, runs) get their owner through ideas.user_id.
-- Clients write ideas, user_skills and groups. The edge function writes
-- extraction output under the service role, which bypasses RLS.

-- ---------------------------------------------------------------- groups

create table groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid not null references auth.users default auth.uid(),
  created_at  timestamptz not null default now()
);

create table group_members (
  group_id    uuid not null references groups on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- RLS helpers. security definer so a policy can consult membership without
-- recursing into group_members' own policies.
create function my_group_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select group_id from group_members where user_id = auth.uid()
$$;

create function shares_group_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members a
    join group_members b using (group_id)
    where a.user_id = auth.uid() and b.user_id = other
  )
$$;

-- ---------------------------------------------------------------- skills

-- Canonical only. Unmatched capabilities live in proposed_skills until a human
-- promotes them, which means adding a row here. Never auto-created.
create table skills (
  id          text primary key,                -- 'parametric-cad'
  name        text not null,                   -- a checkable task, never a depth label
  domain      text,
  aliases     text[] not null default '{}',
  hazard      boolean not null default false,  -- e.g. mains-safety
  created_at  timestamptz not null default now()
);

create table user_skills (
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  skill_id    text not null references skills,
  level       text not null check (level in ('none', 'some', 'solid')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, skill_id)
);
create index user_skills_skill_id on user_skills (skill_id);

-- ---------------------------------------------------------------- ideas

create table ideas (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users on delete cascade default auth.uid(),
  raw                 text not null,           -- exactly what was captured; immutable
  clarification       text,                    -- the user's answer to clarifying_question
  image_path          text,                    -- storage key, screenshots
  audio_path          text,
  transcript          text,
  objective           text,                    -- filled by extraction
  domain              text,
  is_clear            boolean,                 -- false => needs a question, not a guess
  clarifying_question text,
  shared_to           uuid references groups on delete set null,  -- null = private
  status              text not null default 'pending'
                      check (status in ('pending', 'extracted', 'failed')),
  created_at          timestamptz not null default now()
);
create index ideas_user_id on ideas (user_id);
create index ideas_shared_to on ideas (shared_to) where shared_to is not null;

create function ideas_raw_immutable() returns trigger
language plpgsql as $$
begin
  if new.raw is distinct from old.raw then
    raise exception 'ideas.raw is immutable';
  end if;
  return new;
end
$$;
create trigger ideas_raw_immutable
  before update of raw on ideas
  for each row execute function ideas_raw_immutable();

-- Every extraction ever, raw. Re-running a better prompt over history is a
-- query over this table, and it is the stability data for free.
create table extraction_runs (
  id           uuid primary key default gen_random_uuid(),
  idea_id      uuid not null references ideas on delete cascade,
  model        text not null,
  prompt_hash  text not null,
  output       jsonb,                          -- the tool call as returned
  error        text,                           -- set instead of output on failure
  created_at   timestamptz not null default now(),
  check (output is not null or error is not null)
);
create index extraction_runs_idea_id on extraction_runs (idea_id, created_at desc);

-- Current capabilities for an idea. Rewritten from the latest run.
create table idea_capabilities (
  id             uuid primary key default gen_random_uuid(),
  idea_id        uuid not null references ideas on delete cascade,
  run_id         uuid references extraction_runs on delete set null,
  skill_id       text references skills,       -- null while proposed
  proposed_key   text,                         -- proposed_skills.key when skill_id is null
  reason         text,
  crux_rank      smallint check (crux_rank in (1, 2)),
  resolved       text not null check (resolved in (
                   'direct', 'lexical:exact', 'lexical:tokens',
                   'semantic:canonical', 'semantic:previous', 'semantic:promoted', 'new')),
  resolved_from  text,
  resolve_why    text,
  check (skill_id is not null or proposed_key is not null),
  unique (idea_id, skill_id),
  unique (idea_id, proposed_key)
);
create index idea_capabilities_skill_id on idea_capabilities (skill_id);
-- exactly one crux per idea
create unique index idea_capabilities_one_crux
  on idea_capabilities (idea_id) where crux_rank = 1;
create unique index idea_capabilities_one_secondary
  on idea_capabilities (idea_id) where crux_rank = 2;

-- The proposal registry (extraction/out/proposed.json) as rows. Shared across
-- users: a proposal is about the taxonomy, not about one person's ideas.
create table proposed_skills (
  key         text primary key,
  names       text[] not null default '{}',
  reasons     text[] not null default '{}',
  idea_ids    uuid[] not null default '{}',
  run_count   int not null default 0,
  crux_count  int not null default 0,
  rejected    text,                            -- why, set by a human
  promoted    text references skills,          -- set by a human after adding the skill
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS

alter table groups             enable row level security;
alter table group_members      enable row level security;
alter table skills             enable row level security;
alter table user_skills        enable row level security;
alter table ideas              enable row level security;
alter table extraction_runs    enable row level security;
alter table idea_capabilities  enable row level security;
alter table proposed_skills    enable row level security;

-- Every policy is `to authenticated`. The anon key sees nothing.

create policy "groups: members and creator read" on groups
  for select to authenticated
  using (created_by = auth.uid() or id in (select my_group_ids()));
create policy "groups: create your own" on groups
  for insert to authenticated with check (created_by = auth.uid());
create policy "groups: creator edits" on groups
  for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "groups: creator deletes" on groups
  for delete to authenticated using (created_by = auth.uid());

create policy "group_members: members see each other" on group_members
  for select to authenticated using (group_id in (select my_group_ids()));
create policy "group_members: creator adds" on group_members
  for insert to authenticated
  with check (exists (select 1 from groups g where g.id = group_id and g.created_by = auth.uid()));
create policy "group_members: creator removes, or leave" on group_members
  for delete to authenticated
  using (user_id = auth.uid()
      or exists (select 1 from groups g where g.id = group_id and g.created_by = auth.uid()));

-- skills: read only from the client. Seeded by migration.
create policy "skills: readable" on skills
  for select to authenticated using (true);

create policy "user_skills: own profile" on user_skills
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_skills: visible to group mates" on user_skills
  for select to authenticated using (shares_group_with(user_id));

create policy "ideas: own" on ideas
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ideas: shared to my group" on ideas
  for select to authenticated using (shared_to in (select my_group_ids()));

-- Clients may edit what they captured, never what extraction produced.
revoke update on ideas from authenticated;
grant update (clarification, image_path, audio_path, transcript, shared_to)
  on ideas to authenticated;

create policy "extraction_runs: owner reads" on extraction_runs
  for select to authenticated
  using (exists (select 1 from ideas i where i.id = idea_id and i.user_id = auth.uid()));

create policy "idea_capabilities: follow their idea" on idea_capabilities
  for select to authenticated
  using (exists (
    select 1 from ideas i
    where i.id = idea_id
      and (i.user_id = auth.uid() or i.shared_to in (select my_group_ids()))
  ));

create policy "proposed_skills: readable" on proposed_skills
  for select to authenticated using (true);
