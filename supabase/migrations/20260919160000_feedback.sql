-- Bug and improvement reports from inside the app (docs/feedback-plan.md).
--
-- GitHub Issues is the tracker. This table is the inbox that gets a report
-- there: the client inserts a row under its own RLS, a database webhook calls
-- the `report` edge function, and the function files the issue and writes the
-- number back — or the error, so a report is never lost to an unreachable
-- GitHub or a bad token. The reporter sees "sent, #N". Status lives on GitHub.
--
-- The row is the report as sent. Nothing on it is editable from a client: the
-- screenshot is uploaded first, under an id the client chose, and the row is
-- inserted with that path already set, so the webhook sees a complete report.
-- Same client-chosen-id trick the iOS capture already uses for ideas.

create table feedback (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users on delete cascade default auth.uid(),
  kind                 text not null check (kind in ('bug', 'improvement')),
  surface              text not null check (surface in ('web', 'ios', 'share-extension', 'extraction', 'other')),
  title                text not null check (btrim(title) <> '' and length(title) <= 120),
  body                 text not null check (btrim(body) <> '' and length(body) <= 4000),
  route                text,          -- web hash or iOS screen, filled in by the client
  app_version          text,          -- web: commit sha; iOS: version (build)
  device               text,          -- user agent or device model
  screenshot_path      text,          -- feedback-media/<user_id>/<id>.<ext>, private
  github_issue_number  int,           -- written by the report function
  github_error         text,          -- written instead when filing failed; cleared on retry
  created_at           timestamptz not null default now(),
  check (github_issue_number is null or github_error is null)
);
create index feedback_user_id on feedback (user_id, created_at desc);

alter table feedback enable row level security;

-- Insert and read your own. Curators (the people who triage) read everything.
-- No UPDATE or DELETE policy: a filed report cannot be unsent, and the only
-- writer of the GitHub columns is the service role, which bypasses RLS.
create policy "feedback: file your own" on feedback
  for insert to authenticated with check (user_id = auth.uid());
create policy "feedback: read your own" on feedback
  for select to authenticated using (user_id = auth.uid());
create policy "feedback: curators read all" on feedback
  for select to authenticated using (is_curator());

revoke update, delete on feedback from authenticated;

-- ---------------------------------------------------------------- bucket

-- Private. The issue on GitHub — a public repo — carries only the object
-- path, never the picture or a signed URL. A curator opens it from the
-- dashboard or through a signed URL the app makes under this SELECT policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-media', 'feedback-media', false, 10485760, '{image/jpeg,image/png,image/webp}');

-- Objects live at <user_id>/<feedback_id>.<ext>. Same prefix rule as
-- idea-media: you write under your own user id and nowhere else.
create policy "feedback-media: write under own prefix" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "feedback-media: delete under own prefix" on storage.objects
  for delete to authenticated
  using (bucket_id = 'feedback-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Reads: your own, and curators. Unlike idea-media there is no sharing
-- dimension, so the prefix check is the whole visibility rule.
create policy "feedback-media: read own or curate" on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback-media'
     and ((storage.foldername(name))[1] = auth.uid()::text or is_curator()));
