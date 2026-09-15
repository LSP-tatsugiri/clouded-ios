// The Supabase client and every query the app makes.
//
// Runs as the signed-in user through the anon key, so RLS is what decides what
// comes back: no read here filters by user_id, and none should. If a query
// starts returning someone else's rows, that is a policy bug, not a bug here.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config.js";

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function ok({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------- auth

export async function signIn(email, password) {
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

// Self-serve, gated server-side: a trigger on auth.users refuses any email
// not in allowed_emails (docs/hosting.md). Email confirmation is off, so a
// successful sign-up is also a sign-in.
export async function signUp(email, password) {
  const { error } = await db.auth.signUp({ email, password });
  if (error) {
    // The trigger raises "this address is not invited yet", but under the auth
    // API version supabase-js sends, GoTrue hides database errors behind
    // "Database error saving new user". That is the only database error a
    // sign-up can hit here, so name the likely cause without claiming it.
    if (/not invited|database error saving new user/i.test(error.message)) {
      throw new Error("Couldn't create the account. The usual reason: this address isn't invited yet — ask for an invite, then try again.");
    }
    throw new Error(error.message);
  }
}

export const signOut = () => db.auth.signOut();

export async function session() {
  const { data } = await db.auth.getSession();
  return data.session;
}

// ---------------------------------------------------------------- reads

// Every idea the signed-in user can see: their own, plus anything shared to a
// group they belong to.
export async function ideas() {
  return ok(await db.from("ideas")
    .select("id, user_id, raw, objective, domain, is_clear, clarifying_question, status, shared_to, created_at")
    .order("created_at", { ascending: true }), "ideas");
}

export async function capabilities() {
  return ok(await db.from("idea_capabilities")
    .select("idea_id, skill_id, proposed_key, reason, crux_rank, resolved"), "capabilities");
}

// RLS hides rows rather than refusing them, so a stranger's link and a
// mistyped id both come back as no row, not an error.
export async function idea(id) {
  const row = ok(await db.from("ideas")
    .select("id, user_id, raw, clarification, objective, domain, is_clear, clarifying_question, status, shared_to, created_at")
    .eq("id", id).maybeSingle(), "idea");
  if (!row) throw new Error("No such idea, or it is not shared with you.");
  return row;
}

// resolved_from and resolve_why are only fetched here, on the one page that
// shows how a capability got its skill id.
export async function capabilitiesFor(ideaId) {
  return ok(await db.from("idea_capabilities")
    .select("id, skill_id, proposed_key, reason, crux_rank, resolved, resolved_from, resolve_why")
    .eq("idea_id", ideaId), "capabilitiesFor");
}

// Every attempt ever, newest first. `since` finds the run an answer triggered:
// the webhook does not reset status, so a new row is the only reliable signal.
export async function runsFor(ideaId, since) {
  // `clear` is the run's own verdict, pulled out of the stored tool output.
  // The page needs it to tell when the idea row has caught up with the run.
  let q = db.from("extraction_runs")
    .select("id, created_at, model, prompt_hash, error, clear:output->clear")
    .eq("idea_id", ideaId).order("created_at", { ascending: false });
  if (since) q = q.gt("created_at", since);
  return ok(await q, "runsFor");
}

// The groups the signed-in user belongs to. Creating one makes you a member
// by trigger, so "created" is a subset of "member of".
export async function myGroups() {
  return ok(await db.from("groups").select("id, name, created_by").order("name"), "myGroups");
}

// ---------------------------------------------------------------- profiles

// One row per user, made at sign-up. Readable for yourself and for anyone
// who shares a group with you, which is the same audience as user_skills.
export async function myProfile(userId) {
  return ok(await db.from("profiles").select("user_id, display_name").eq("user_id", userId).single(),
    "myProfile");
}

export async function profilesFor(ids) {
  if (!ids.length) return [];
  return ok(await db.from("profiles").select("user_id, display_name").in("user_id", ids), "profilesFor");
}

// display_name is the only column the client may update: sending updated_at
// too is "permission denied for table profiles", so it is not maintained.
export async function setDisplayName(userId, displayName) {
  return ok(await db.from("profiles")
    .update({ display_name: displayName })
    .eq("user_id", userId).select("display_name").single(), "setDisplayName");
}

// ---------------------------------------------------------------- groups

export async function createGroup(name) {
  return ok(await db.from("groups").insert({ name }).select("id, name, created_by").single(), "createGroup");
}

export async function renameGroup(id, name) {
  return ok(await db.from("groups").update({ name }).eq("id", id).select("id").single(), "renameGroup");
}

// Ideas shared to the group go back to private (on delete set null) and the
// members go with it (cascade). Only the creator's delete gets past RLS.
export async function deleteGroup(id) {
  const { error } = await db.from("groups").delete().eq("id", id);
  if (error) throw new Error(`deleteGroup: ${error.message}`);
}

export async function groupMembers(groupId) {
  return ok(await db.from("group_members").select("user_id, added_at")
    .eq("group_id", groupId).order("added_at"), "groupMembers");
}

// Leaving is removing yourself. The policy refuses the creator either way:
// they delete the group instead.
export async function removeMember(groupId, userId) {
  const { error } = await db.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
  if (error) throw new Error(`removeMember: ${error.message}`);
}

// Only the group's creator can read these; everyone else gets an empty list.
export async function pendingInvites(groupId) {
  return ok(await db.from("group_invites").select("email, created_at")
    .eq("group_id", groupId).order("created_at"), "pendingInvites");
}

// Security definer functions: inviting allowlists the address and either
// joins an existing account now or leaves a pending invite for sign-up.
// Returns "joined" or "invited".
export async function invite(groupId, email) {
  const { data, error } = await db.rpc("invite", { p_group_id: groupId, p_email: email });
  if (error) throw new Error(error.message);
  return data;
}

export async function revokeInvite(groupId, email) {
  const { error } = await db.rpc("revoke_invite", { p_group_id: groupId, p_email: email });
  if (error) throw new Error(error.message);
}

export async function skills() {
  return ok(await db.from("skills")
    .select("id, name, domain, aliases, hazard, sort_order")
    .order("sort_order"), "skills");
}

// The signed-in user's own levels. Group mates' rows are readable too, so the
// filter to self is a product choice, not a security one.
export async function mySkills(userId) {
  return ok(await db.from("user_skills")
    .select("skill_id, level")
    .eq("user_id", userId), "user_skills");
}

// ---------------------------------------------------------------- writes

// Insert is the capture path. user_id defaults to auth.uid() in the schema and
// the policy rejects anything else, so it is not sent.
export async function addIdea(raw) {
  return ok(await db.from("ideas").insert({ raw }).select("id").single(), "addIdea");
}

// The only UPDATE the webhook acts on, so writing this re-runs extraction and
// costs an API call. `raw` is never touched: a trigger rejects that outright.
export async function setClarification(id, clarification) {
  return ok(await db.from("ideas").update({ clarification }).eq("id", id).select("id").single(),
    "setClarification");
}

// null puts the idea back to private. UPDATE on ideas is revoked and granted
// column by column, so these are the only two columns this client can change.
export async function setShare(id, groupId) {
  return ok(await db.from("ideas").update({ shared_to: groupId }).eq("id", id).select("id").single(),
    "setShare");
}

// ---------------------------------------------------------------- curation

// True when the signed-in user may review proposed skills. The policy only
// lets you see your own row, so an empty result means "not a curator" rather
// than "the table is empty".
export async function amCurator(userId) {
  const { data, error } = await db.from("curators").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`amCurator: ${error.message}`);
  return data !== null;
}

// Curators only; the policy returns nothing to anyone else.
export async function proposedSkills() {
  return ok(await db.from("proposed_skills")
    .select("key, names, reasons, idea_ids, run_count, crux_count, rejected, promoted, created_at")
    .order("run_count", { ascending: false }), "proposedSkills");
}

// Both of these are security definer functions: promoting touches skills,
// idea_capabilities and proposed_skills together, and a curator is not granted
// write access to those tables directly.
export async function promoteSkill({ key, skillId, name, domain, aliases, hazard }) {
  const { error } = await db.rpc("promote_proposed_skill", {
    p_key: key, p_skill_id: skillId, p_name: name,
    p_domain: domain || null, p_aliases: aliases ?? [], p_hazard: !!hazard
  });
  if (error) throw new Error(error.message);
}

export async function rejectSkill(key, why) {
  const { error } = await db.rpc("reject_proposed_skill", { p_key: key, p_why: why });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- writes

// A level of "none" is written rather than deleting the row. classify() treats
// an absent row and "none" identically, so this is only about honesty: a row
// says the skill was rated, no row says it was never looked at.
export async function setSkillLevel(userId, skillId, level) {
  return ok(await db.from("user_skills")
    .upsert({ user_id: userId, skill_id: skillId, level, updated_at: new Date().toISOString() },
            { onConflict: "user_id,skill_id" })
    .select("skill_id, level").single(), "setSkillLevel");
}
