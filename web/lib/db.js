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
    .select("id, user_id, raw, objective, domain, is_clear, clarifying_question, status, shared_to, created_at")
    .order("created_at", { ascending: true }), "ideas");
}

export async function capabilities() {
  return ok(await db.from("idea_capabilities")
    .select("idea_id, skill_id, proposed_key, reason, crux_rank, resolved"), "capabilities");
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

// A level of "none" is written rather than deleting the row. classify() treats
// an absent row and "none" identically, so this is only about honesty: a row
// says the skill was rated, no row says it was never looked at.
export async function setSkillLevel(userId, skillId, level) {
  return ok(await db.from("user_skills")
    .upsert({ user_id: userId, skill_id: skillId, level, updated_at: new Date().toISOString() },
            { onConflict: "user_id,skill_id" })
    .select("skill_id, level").single(), "setSkillLevel");
}
