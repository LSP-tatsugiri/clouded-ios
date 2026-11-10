-- Realtime on extraction_runs, so the web client hears a run land instead of
-- polling runsFor() every 2 s (docs/improvement-backlog.md §4). The client
-- keeps a slower poll running alongside, so nothing breaks before this is
-- applied or when the websocket is blocked.
--
-- Who hears what. Postgres Changes checks every change against the
-- subscriber's own RLS before sending it, with the same policies a select
-- would use. The only select policy on extraction_runs is "extraction_runs:
-- owner reads" (20260912215850_init.sql): a run is visible when its idea's
-- user_id is auth.uid(). So a signed-in subscriber hears runs for their own
-- ideas and nothing else — not a group mate's, not even for an idea shared
-- to them (that policy has no shared_to branch, same as a plain select), and
-- the anon key hears nothing (every policy is `to authenticated`). The event
-- carries the whole row, output included, which the owner can already read.
-- The exception is DELETE: Realtime does not apply RLS to deletions and sends
-- only the primary key, to every subscriber of the table. Runs are deleted
-- only by the cascade when an idea is deleted, and the client subscribes to
-- INSERT alone (watchRuns in web/lib/db.js), so it never asks for them.
-- No policy is added or changed here.
--
-- Guarded so a re-run, or a project where the table is already a member,
-- does not fail.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'extraction_runs'
     ) then
    alter publication supabase_realtime add table public.extraction_runs;
  end if;
end
$$;
