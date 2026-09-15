# Step 7 — Sharing and the friend skill pool

Written 2026-09-15 from a grilling session that settled every branch below.
Read `CLAUDE.md` first for the invariants; `docs/step-5-plan.md` is the web
client this step extends. Nothing here is built yet. This step is built on
the **Windows PC on `main`**, entirely in `web/` and `supabase/`; the Mac is
on `step-6` (iOS capture, Phases C–E remaining) and `ios/` is not touched.

## State at handoff

- Live web client at https://clouded.monoesport.com, deploying on every
  push to `main`. Sign-up is self-serve behind `allowed_emails`
  (`20260915033902`); no friend has been invited yet.
- The sharing model already exists underneath and is verified by
  `acceptance.mjs rls` (22 checks on `main`, 29 on `step-6` with storage):
  `groups (id, name, created_by)`, `group_members (group_id, user_id)`,
  `ideas.shared_to` (one nullable group per idea), helpers `my_group_ids()`
  and `shares_group_with()`. RLS: creator adds and removes members, any
  member can leave, members see each other, `user_skills` is readable by
  anyone who shares a group with you, shared ideas and their capabilities
  are readable by group members.
- The web idea page has a share select writing `shared_to`, empty because
  no group can be created. `ideas()` in `web/lib/db.js` already returns
  friends' shared ideas mixed into the list, tagged "shared" but not by
  whom. The Step 5 filter "a friend can unblock it" is a placeholder.
- **No `profiles` table.** `auth.users` is not client-readable, so nothing
  can name a friend and the client cannot resolve an email to a user id.
  `allowed_emails` has no client policies: only the service role and the
  sign-up trigger touch it.
- `leverage(items, held)` and `classify(cap, held)` in
  `extraction/src/distance.js` take only the signed-in user's levels.
- Migration `20260915034222_media_and_source` (step-6) is applied on the
  hosted database but the file is not on `main` until the branch merges.
  Pull or merge before `supabase db push` so the CLI has it.

## What the original Step 7 was

README: "7. Sharing and the friend skill pool" — shared ideas visible to
the group and "which friend already has the capability you're missing",
with comments and the group feed deferred to after v1. Step 5 handed
forward: group creation and membership UI, the friend skill pool, "who can
unblock this", and hosting (done since). The handoff added the open
questions this session answered. Versus that: the **feed moves into
scope** (decision 12), **comments stay out**, the pool does **not** feed
the leverage ranking (decision 11), and profiles, the invite flow and the
"shared ideas only" rule are new.

## Decisions (made 2026-09-15)

1. **One group in practice; the schema stays many-capable.** No constraint
   anywhere. "Create group" appears only when you are in no group. The
   share control on the idea page is a **toggle** ("Shared with Brian's
   friends") when you are in exactly one group and the existing select if
   ever in more. Zero effort on multi-group affordances: no per-group
   filters, no switcher.
2. **The group has a name**, defaulted to "<display name>'s group",
   editable by the creator.
3. **The creator cannot leave.** They get "delete group": ideas shared to
   it revert to private (the existing `on delete set null`), members are
   dropped by cascade. Members can leave.
4. **`profiles (user_id, display_name)`**, one row per user, created by a
   trigger on `auth.users` insert with the email's local part as the
   default. Editable by yourself on the profile page. Readable by yourself
   and group mates (`shares_group_with`), nobody else. Not unique.
5. **Invite is one action: `invite(group_id, email)`**, a security-definer
   RPC callable only by the group's creator. It upserts the email into
   `allowed_emails` and records a pending row in `group_invites (group_id,
   email, invited_by, created_at)`. If an account with that email already
   exists, it is added to `group_members` immediately and the invite is
   consumed; otherwise a trigger on `auth.users` insert (after the
   allowlist check) consumes it at sign-up. **No accept step**: the
   invitation email is the consent. The invitee lands in the group on
   first sign-in.
6. **Only the creator invites.** Every invitee can spend the owner's
   Anthropic credit, so the cost gate stays in one pair of hands. Matches
   the existing RLS.
7. **Pending invites are listed** on the group tab as "invited, not joined
   yet". The creator can revoke one: the pending row is deleted, and the
   `allowed_emails` row too *only if no account exists for it*. The web
   never deletes an account. `supabase/scripts/allow.mjs` stays as the way
   to allowlist someone without a group invite.
8. **Removing a member, or leaving, makes their ideas private again**: a
   trigger on `group_members` delete sets `shared_to = null` on that user's
   ideas shared to that group. Today those ideas would stay visible to a
   group the person can no longer see. Account and allowlist entry stay.
9. **Friend skills are consulted only for shared ideas.** A private idea
   shows no friend marker; sharing it is how you find out who can unblock
   it — a deliberate nudge, said once on the idea page's share control
   ("share to see who can unblock it"), not on every row. **This is a
   client rule, not a security one**: `user_skills` stays readable by group
   mates under RLS, which the friend profile page (decision 13) needs.
   Written down here so nobody mistakes it for a policy.
10. **"A friend can unblock it" is graded, `solid` only.** The row marker
    on a shared idea reads "Alex holds the hard part · group covers 2 of 3
    gaps"; up to two names, then "+1". The Step 5 filter matches when the
    crux is held `solid` by a group mate, so only shared ideas can match. A
    friend's `some` does not count — you would be relying on someone
    half-capable.
11. **Leverage stays personal.** It answers "what should I learn next"; a
    friend holding a skill does not make it less worth learning, and the
    group's shorter distance is already on each row. Leverage over the
    group's union is a group roadmap, which is Step 8's problem.
12. **Two views.** Your list holds only your own ideas (a `user_id` filter
    on `ideas()`). A new **Group** tab is the feed: every member's shared
    ideas including yours, newest first, with a "closest to me" sort
    toggle. Each feed row shows the owner's name, title, crux, **the
    reader's** distance, and who in the group holds the crux ("you hold the
    hard part" included). The group's members, invite box (creator),
    pending invites, leave / delete sit below the feed on the same tab.
13. **A friend's profile page**, reached from a name on a feed row or the
    member list: display name plus their `solid` and `some` skills grouped
    by domain, read-only. No "compare with me"; no list of their ideas —
    that is the feed.
14. **Comments are not in this step.** There is no notification path, and
    a comment nobody sees is not feedback. Feed first; comments once
    someone has read it and the notification question is answered.
15. **Web only.** The iOS list will read whatever the web decides. Nothing
    here is phone-first.
16. **No API spend.** Nothing in this step calls the Anthropic API. Running
    `acceptance.mjs rls` costs nothing; `acceptance.mjs list` re-extracts
    nothing.

## Phase A — server (migration, one push)

One migration, written with a `date -u +%Y%m%d%H%M%S` timestamp, dry-run
from here, pushed from the owner's terminal, **committed and pushed in the
same step** (the step-6 file must be in this checkout first).

- `profiles`: table, RLS (select self or `shares_group_with`; update self,
  `display_name` only), trigger `create_profile` on `auth.users` insert.
  Backfill a row for every existing user.
- `group_invites`: table, RLS (creator of the group reads and deletes; no
  client insert — the RPC does it).
- `invite(group_id uuid, email text)`: security definer, refuses unless
  `auth.uid()` created the group; upserts `allowed_emails`; if a user with
  that email exists, inserts `group_members` and returns `joined`, else
  inserts `group_invites` and returns `invited`.
- `revoke_invite(group_id, email)`: security definer, creator only;
  deletes the invite and the `allowed_emails` row when no `auth.users` row
  has that email.
- `consume_invites` trigger on `auth.users` insert, after
  `allowed_email_only`: moves matching `group_invites` into
  `group_members`.
- `unshare_on_leave` trigger on `group_members` delete: `update ideas set
  shared_to = null where user_id = old.user_id and shared_to =
  old.group_id`.
- Policy change: `group_members: creator removes, or leave` gains `and
  user_id <> (select created_by from groups where id = group_id)` on the
  leave arm, so the creator cannot leave (decision 3).
- `acceptance.mjs rls` extended: invite an unlisted email → sign-up
  succeeds and the user is a member; invite an existing account → member
  immediately; revoke → allowlist row gone when no account, kept when one
  exists; a removed member's shared idea is private again; C (no group)
  cannot read B's profile; B reads A's profile; the creator cannot delete
  their own membership. Target: every existing check still passing plus
  these.
- Verified: dry-run clean, `supabase migration list` shows the file
  applied, acceptance green, committed and pushed.

**Done 2026-09-15** (`a025b34`, migration `20260915071927`). Two things
learned building it:

- Creating a group now makes the creator a member by trigger.
  `my_group_ids()` and `shares_group_with()` read `group_members` only, so
  a creator without a row would not see their friends' profiles or skills.
  The harness used to insert that row by hand.
- **GoTrue refuses an undeliverable address once the row is accepted.**
  An allowlisted `rls-d@clouded.test` gets `email_address_invalid` from
  the public sign-up endpoint (the domain has no MX), while an unlisted
  one fails earlier at the allowlist trigger, which is why the older check
  never saw it. Autoconfirm is off, so a real domain would get a real
  confirmation email. The harness therefore creates the invited user
  through the admin API, which fires the same `auth.users` trigger. The
  public path is still covered by the "unlisted refused" check and by the
  live sign-up verified in Step 5. Consequence for friends: none — they
  have real addresses — but the hosted project's built-in mailer is
  rate-limited, so invite people a few at a time rather than ten at once.

`acceptance.mjs rls`: 45/45 (22 before, 23 new). Cleanup verified: no
throwaway users, groups, shares or allowlist rows left behind.

## Phase B — group tab: create, invite, members

- Route `group` in `ROUTES`, tab "Group" in the nav.
- No group: a create form (name defaulted from your display name). One
  group: name (editable inline for the creator), member list with display
  names linking to friend profiles, invite box (creator only) calling
  `invite`, pending list with revoke, "leave" for members, "delete group"
  for the creator with a confirm, and the one sentence "joining means your
  skill levels are readable by these people".
- `db.js`: `myProfile`, `setDisplayName`, `profilesFor(ids)`, `createGroup`,
  `renameGroup`, `deleteGroup`, `invite`, `revokeInvite`, `pendingInvites`,
  `groupMembers`, `leaveGroup`, `removeMember`.
- Profile page: display name field at the top.
- Verified live with a second account: create, invite, the invitee signs
  up and sees the group; leave; the creator has no leave button; revoke
  returns the email to "not invited yet".

## Phase C — the pool in your list

- `ideas()` filtered to `user_id = me`. The idea page's share control
  becomes the toggle (decision 1) and carries the "share to see who can
  unblock it" hint while private.
- `db.js`: `groupSkills()` — every group mate's `user_skills` at `solid`,
  keyed by `skill_id` → `[user_id]`. One fetch per load.
- `distance.js` gains a pure `friendsWhoHold(extraction, pool)` returning
  `{ cruxHolders: [user_id], covered: n, gaps: n }` (`solid` only), next
  to `leverage`, so the Node script and the browser share one definition.
- Row marker on shared ideas per decision 10; filter "a friend can
  unblock" replaces the Step 5 placeholder.
- Verified: with the second account holding the crux skill of one shared
  idea, that row and only that row shows the marker and passes the filter;
  a private idea with the same crux shows nothing; `acceptance.mjs list`
  reproduces the marker from the same rows.

## Phase D — the feed and the friend profile

- Feed at the top of the Group tab (decision 12): `sharedIdeas()` returns
  every idea with `shared_to in my groups`, newest first; "closest to me"
  toggle sorts by `sortKey` against the reader's levels; rows show owner
  name, title, crux, reader distance, and crux holders including "you".
- Friend profile route `friend/<user_id>` (decision 13).
- Verified live from both accounts: each sees the other's shared idea in
  the feed with the right owner and the right reader-relative distance; a
  private idea appears in neither feed; the friend page shows `solid` and
  `some` only.

## Phase E — acceptance and close

1. `acceptance.mjs rls` green in its full form; `acceptance.mjs list`
   green.
2. The first real friend invited from the Group tab, signed up, in the
   group, one idea shared each way.
3. README: "you are here" moves on; the Sharing section's "after v1" note
   on the feed is updated; the v1 line "offline-first local save" is
   downgraded to what step-6 decision 2 delivers. `CLAUDE.md` layout and
   build order updated. Record what each phase verified here.

## Not in this step

- Comments and any notification path — decision 14.
- Leverage over the group's skills (a group roadmap) — decision 11,
  Step 8.
- Multi-group affordances, hand-over of a group — decisions 1 and 3.
- Sharing, group or feed on the phone — decision 15; the Mac's Step 6
  decision 6 says the same.
- Ranked top-2 crux and `strict: true` on the tool — one schema change and
  one baseline re-run (~$0.20), when the pool shows the crux wobble
  matters.
- Magic-link sign-in, password reset — when a friend actually needs it.
- A per-user daily cost cap in the edge function — the ten-line change
  `CLAUDE.md` names, if trust stops holding.

## Trello cards this closes

- "Step 7 · Sharing" (name to confirm on the board)
- Anything else on the board mentioning groups, friends, invites or the
  feed
