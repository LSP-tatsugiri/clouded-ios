-- Save an idea without extracting it (owner's request, 2026-11-11).
--
-- A row inserted with status 'draft' is kept as captured and never sent to
-- the model: the extract function's ideaToRun() ignores every webhook event
-- for a draft (supabase/functions/_shared/webhook.ts). Extraction starts
-- when the owner asks for it, through extract_draft(), which moves the row
-- to 'pending'; that UPDATE is the webhook event the function acts on, and
-- the one paid call.
--
-- INSERT on ideas is table-wide, so the client sends status = 'draft' on
-- insert. UPDATE stays column-limited (init.sql): status is not granted,
-- because a client that could write it could also mark an idea 'extracted'.
-- The function below makes the one transition a client may make.
--
-- Deploy order: this migration, then `supabase functions deploy extract`,
-- then the web client. Before the new function is live, a draft is
-- extracted on insert like any idea (a cent, nothing lost).

alter table ideas drop constraint ideas_status_check;
alter table ideas add constraint ideas_status_check
  check (status in ('draft', 'pending', 'extracted', 'failed'));

-- When extraction was asked for, for a draft that has been. The web client
-- waits from this, not from created_at, which may be weeks earlier.
alter table ideas add column queued_at timestamptz;

create function extract_draft(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update ideas set status = 'pending', queued_at = now()
   where id = p_id and user_id = auth.uid() and status = 'draft';
  if not found then
    raise exception 'not a draft of yours' using errcode = 'P0002';
  end if;
end
$$;

revoke execute on function extract_draft(uuid) from public, anon;
grant execute on function extract_draft(uuid) to authenticated;
