-- Two holes from the 2026-10-02 build review.
--
-- 1. invite() allowlisted any email for anyone who had created a group, and
--    creating a group needs nothing but an account. So one account could
--    mint any number of others, each spending the owner's Anthropic credit,
--    and there is no per-user cost cap behind the allowlist. Decided
--    2026-10-16: a non-curator may bring up to five new addresses; a curator
--    is not capped. Putting someone who already has an account, or whose
--    address is already listed, into a group never counts.
--
-- 2. "group_members: creator adds" let a group's creator insert any user id,
--    with no invite and no say from that user, and membership is what opens
--    their name and skill profile through shares_group_with(). No client
--    inserts into group_members directly: the creator row comes from the
--    on_group_created trigger and everyone else from invite() or
--    handle_new_user(), all security definer. So the policy and the grant go.

-- ---------------------------------------------------------------- the cap

-- Who listed the address. Null for rows from allow.mjs (the service role)
-- and for every row older than this migration, so neither counts against
-- anyone.
alter table allowed_emails
  add column added_by uuid references auth.users on delete set null;

create or replace function invite(p_group_id uuid, p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(p_email));
  v_user  uuid;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that is not an email address';
  end if;
  if not exists (select 1 from groups where id = p_group_id and created_by = auth.uid()) then
    raise exception 'only the group creator can invite';
  end if;

  select id into v_user from auth.users where lower(email) = v_email;

  -- Only a new address costs a slot: one with no account and no listing yet.
  if v_user is null
     and not exists (select 1 from allowed_emails where lower(email) = v_email) then
    if not is_curator()
       and (select count(*) from allowed_emails where added_by = auth.uid()) >= 5 then
      raise exception 'you have already invited five new people; ask the owner to invite more';
    end if;
    insert into allowed_emails (email, added_by) values (v_email, auth.uid());
  end if;

  if v_user is not null then
    insert into group_members (group_id, user_id) values (p_group_id, v_user)
    on conflict do nothing;
    delete from group_invites where group_id = p_group_id and email = v_email;
    return 'joined';
  end if;

  insert into group_invites (group_id, email, invited_by)
  values (p_group_id, v_email, auth.uid())
  on conflict do nothing;
  return 'invited';
end
$$;

revoke execute on function invite(uuid, text) from anon;

-- ---------------------------------------------------------------- consent

drop policy "group_members: creator adds" on group_members;
revoke insert on group_members from authenticated;
