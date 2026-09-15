-- Self-serve sign-up, gated by an allowlist (docs/hosting.md).
--
-- The web client is public at a URL, and every idea a signed-in user adds
-- costs the owner an API call. So anyone can sign up, but only an email the
-- owner has listed first gets an account: a trigger on auth.users refuses
-- the rest before the row exists. Adding a friend is one row here
-- (supabase/scripts/allow.mjs), then they create their own account.
--
-- No policies: the table is read and written only by the service role and by
-- the trigger, which runs as the function owner. Clients never see it.
--
-- The trigger cannot tell a self-serve sign-up from an admin-API create (both
-- arrive from the auth server), so it gates both: an account created from the
-- dashboard or a script needs its email listed first too. acceptance.mjs rls
-- lists its throwaway users before creating them and checks that an unlisted
-- one is refused.

create table allowed_emails (
  email     text primary key,
  added_at  timestamptz not null default now()
);

alter table allowed_emails enable row level security;

-- Emails are compared case-insensitively and trimmed, since Supabase Auth
-- lowercases addresses and a list edited by hand will not always match.
create function enforce_allowed_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from allowed_emails
     where lower(email) = lower(trim(new.email))
  ) then
    raise exception 'this address is not invited yet'
      using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger allowed_email_only
  before insert on auth.users
  for each row execute function enforce_allowed_email();

-- The existing test user, so nothing that signs in today changes.
insert into allowed_emails (email) values ('test@clouded.dev')
  on conflict do nothing;
