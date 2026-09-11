-- Supabase schema. Not needed to run the script — this is where the pipeline
-- lands once the script's output is good enough to keep.
--
-- Two things are deliberate here:
--   1. every row carries user_id from day one, even though there is one user
--   2. capabilities are a join table, not a text column. That join IS the graph.

create extension if not exists vector;

create table skills (
  id            text primary key,              -- 'parametric-cad'
  name          text not null,                 -- a checkable task, never a depth label
  domain        text,
  aliases       text[] default '{}',
  embedding     vector(1536),
  status        text not null default 'canonical',  -- canonical | proposed
  proposed_by   uuid references auth.users,
  created_at    timestamptz default now()
);

create table ideas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users default auth.uid(),
  raw           text not null,                 -- exactly what was captured
  image_path    text,                          -- storage key, screenshots
  audio_path    text,
  transcript    text,
  objective     text,                          -- filled by extraction
  domain        text,
  is_clear      boolean,                       -- false => needs a question, not a guess
  clarifying_question text,
  embedding     vector(1536),                  -- near-duplicate detection
  shared        boolean not null default false,-- private until promoted, on purpose
  status        text not null default 'pending',
  created_at    timestamptz default now()
);

create table idea_capabilities (
  idea_id       uuid references ideas on delete cascade,
  skill_id      text references skills,
  reason        text,
  is_crux       boolean default false,
  primary key (idea_id, skill_id)
);

create table user_skills (
  user_id       uuid references auth.users default auth.uid(),
  skill_id      text references skills,
  level         text not null check (level in ('none','some','solid')),
  updated_at    timestamptz default now(),
  primary key (user_id, skill_id)
);

-- Sharing lives here, once, and both clients inherit it.
alter table ideas enable row level security;
alter table idea_capabilities enable row level security;
alter table user_skills enable row level security;

create policy "own ideas" on ideas
  for all using (user_id = auth.uid());

create policy "shared ideas are readable" on ideas
  for select using (shared = true);

create policy "capabilities follow their idea" on idea_capabilities
  for select using (exists (
    select 1 from ideas i
    where i.id = idea_id and (i.user_id = auth.uid() or i.shared)
  ));

create policy "own skill profile" on user_skills
  for all using (user_id = auth.uid());

create policy "skill levels are visible for shared matching" on user_skills
  for select using (true);
