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
    .select("id, user_id, raw, objective, domain, is_clear, clarifying_question, status, shared_to, image_path, created_at")
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
    .select("id, user_id, raw, clarification, objective, domain, is_clear, clarifying_question, status, shared_to, image_path, source_url, created_at")
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

// A short-lived URL for an idea's picture. The bucket is private and its
// SELECT policy is the ideas visibility, so asking for a URL you may not have
// fails here rather than leaking; the page shows the idea without it.
export async function mediaUrl(path) {
  return ok(await db.storage.from("idea-media").createSignedUrl(path, 600), "mediaUrl").signedUrl;
}

// Empty until Step 7 builds group management; the share control says so.
export async function myGroups() {
  return ok(await db.from("groups").select("id, name").order("name"), "myGroups");
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
