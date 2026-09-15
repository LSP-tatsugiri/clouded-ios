-- Media and source link for capture (Step 6, docs/step-6-plan.md Phase A).
--
-- The idea is always a sentence in `raw`; a picture or a link is the
-- inspiration that came with it, attached for context. Extraction never sees
-- either, so nothing here touches the pipeline: `source_url` is written at
-- insert and read by the idea page, `image_path` (already a column) points
-- into a private bucket whose visibility follows the idea row exactly.

alter table ideas add column source_url text;  -- shared link; shown, never extracted

-- No new grant: INSERT on ideas is table-wide (only UPDATE is column-limited),
-- so a client may set source_url on its own rows. acceptance.mjs rls checks it.

-- ---------------------------------------------------------------- bucket

-- Private. Every read goes through a signed URL or an authenticated GET, both
-- of which run the SELECT policy below. Capture re-encodes to JPEG at a
-- longest side of 2048 px, so a 10 MiB cap and one mime type are generous.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('idea-media', 'idea-media', false, 10485760, '{image/jpeg}');

-- Objects live at <user_id>/<idea_id>.jpg. This reads the idea id back out,
-- or null when the path is not in that shape, so a stray object can never
-- make a policy raise instead of deny.
create function idea_media_idea_id(object_name text) returns uuid
language sql immutable as $$
  select case
    when split_part(split_part(object_name, '/', 2), '.', 1)
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(split_part(object_name, '/', 2), '.', 1)::uuid
  end
$$;

-- ---------------------------------------------------------------- policies

-- Writes: only under your own prefix. The upload happens after the row
-- exists, and a failed upload is allowed to leave an idea without its image.
create policy "idea-media: write under own prefix" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'idea-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "idea-media: replace under own prefix" on storage.objects
  for update to authenticated
  using (bucket_id = 'idea-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'idea-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "idea-media: delete under own prefix" on storage.objects
  for delete to authenticated
  using (bucket_id = 'idea-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Reads: whoever can see the idea can see its picture. The subquery runs
-- under the caller's own RLS on ideas, so this is the ideas visibility by
-- construction — own rows plus rows shared to a group they belong to — and
-- cannot drift from it when those policies change.
create policy "idea-media: read what you can see" on storage.objects
  for select to authenticated
  using (bucket_id = 'idea-media'
     and exists (select 1 from ideas i where i.id = idea_media_idea_id(name)));
