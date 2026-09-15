-- Step 7: sharing becomes usable (docs/step-7-plan.md, Phase A).
--
-- Until now groups, group_members and ideas.shared_to existed with RLS but
-- nothing could create a group or add a member, because auth.users is not
-- client-readable: the client cannot turn an email into a user id and has no
-- name to show for a friend. This migration adds the two things that were
-- missing, names and invites, and the three rules the grilling settled:
-- the creator is a member and cannot leave, leaving takes your ideas with
-- you, and inviting is one action that both allowlists and joins.

-- ---------------------------------------------------------------- profiles

-- One row per user, made by trigger at sign-up with the email's local part
-- as the default name. Readable by yourself and by anyone who shares a group
-- with you; that is the same audience that can already read your skills.
create table profiles (
  user_id       uuid primary key references auth.users on delete cascade,
  display_name  text not null
                check (btrim(display_name) <> '' and length(display_name) <= 60),
  updated_at    timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: self and group mates read" on profiles
  for select to authenticated
  using (user_id = auth.uid() or shares_group_with(user_id));
create policy "profiles: edit your own" on profiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Default privileges grant full update; narrow it to the one editable column,
-- the way init.sql does for ideas.
grant select on profiles to authenticated;
revoke update on profiles from authenticated;
grant update (display_name) on profiles to authenticated;

-- Everyone who already has an account.
insert into profiles (user_id, display_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------- invites

-- A pending invite: an email the creator has invited that has not signed up
-- yet. Consumed by handle_new_user() when the account appears, or by invite()
-- itself when the account already exists. Only the group's creator sees them;
-- writes go through the functions below.
create table group_invites (
  group_id    uuid not null references groups on delete cascade,
  email       text not null,
  invited_by  uuid not null references auth.users on delete cascade default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (group_id, email)
);

alter table group_invites enable row level security;

create policy "group_invites: creator reads" on group_invites
  for select to authenticated
  using (exists (select 1 from groups g where g.id = group_id and g.created_by = auth.uid()));

grant select on group_invites to authenticated;

-- The creator invites by email. Allowlists the address (so the friend can
-- sign up at all), then either joins them now (account exists) or leaves a
-- pending invite (it does not). Security definer because it writes
-- allowed_emails and reads auth.users, neither of which a client may touch.
create function invite(p_group_id uuid, p_email text) returns text
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

  insert into allowed_emails (email) values (v_email) on conflict do nothing;

  select id into v_user from auth.users where lower(email) = v_email;
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

-- Takes back a pending invite. The allowlist row goes too, but only when no
-- account has that email: the web never removes an existing account's access.
create function revoke_invite(p_group_id uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if not exists (select 1 from groups where id = p_group_id and created_by = auth.uid()) then
    raise exception 'only the group creator can revoke an invite';
  end if;
  delete from group_invites where group_id = p_group_id and email = v_email;
  if not exists (select 1 from auth.users where lower(email) = v_email) then
    delete from allowed_emails where lower(email) = v_email;
  end if;
end
$$;

revoke execute on function invite(uuid, text) from anon;
revoke execute on function revoke_invite(uuid, text) from anon;

-- After the allowlist check has let the row in: give the new user a profile
-- and put them in every group that invited them. No accept step; the
-- invitation was the consent.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (user_id) do nothing;

  insert into group_members (group_id, user_id)
  select group_id, new.id from group_invites where email = lower(new.email)
  on conflict do nothing;
  delete from group_invites where email = lower(new.email);

  return new;
end
$$;

create trigger on_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------- membership

-- my_group_ids() and shares_group_with() read group_members only, so a
-- creator without a row of their own could not see their friends' profiles
-- or skills. Creating a group makes you its first member.
create function add_creator_as_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id) values (new.id, new.created_by)
  on conflict do nothing;
  return new;
end
$$;

create trigger on_group_created
  after insert on groups
  for each row execute function add_creator_as_member();

-- The creator cannot leave; they delete the group instead. Members can leave
-- and the creator can remove them.
drop policy "group_members: creator removes, or leave" on group_members;
create policy "group_members: creator removes, or leave" on group_members
  for delete to authenticated
  using (
    user_id <> (select g.created_by from groups g where g.id = group_id)
    and (user_id = auth.uid()
      or exists (select 1 from groups g where g.id = group_id and g.created_by = auth.uid()))
  );

-- Leaving, or being removed, makes your ideas private again. Without this
-- they would stay visible to a group you can no longer see. Security definer
-- because the remover is not the ideas' owner.
create function unshare_on_leave() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update ideas set shared_to = null
   where user_id = old.user_id and shared_to = old.group_id;
  return old;
end
$$;

create trigger on_member_left
  after delete on group_members
  for each row execute function unshare_on_leave();
