// Seeds user_skills from extraction/data/profile.json.
//
//   node --env-file=supabase/.env supabase/scripts/seed-profile.mjs --user <uuid>
//   node --env-file=supabase/.env supabase/scripts/seed-profile.mjs --user <uuid> --dry-run
//
// profile.json is the author's local scratch, not a source of truth: once the
// web profile page exists, edit levels there. This script is for the first
// load, and for putting a known profile back after a database reset.
//
// Ids not in the skills table are skipped with a warning rather than failing,
// because a stale profile shouldn't block the seed. A level outside
// none | some | solid is an error: a typo would silently become a wrong
// distance, and wrong distances are the one thing this product can't have.

import { readFileSync } from "node:fs";

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`${k} is missing from supabase/.env`); process.exit(1); } return v; };
const BASE = need("SUPABASE_URL").replace(/\/$/, "");
const SRK = need("SUPABASE_SERVICE_ROLE_KEY");

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const USER = opt("--user");
const DRY = args.includes("--dry-run");
if (!USER) { console.error("usage: seed-profile.mjs --user <uuid> [--dry-run]"); process.exit(1); }

const root = new URL("../../", import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

async function rest(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: { apikey: SRK, authorization: `Bearer ${SRK}`, "content-type": "application/json", ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const LEVELS = new Set(["none", "some", "solid"]);
const profile = load("extraction/data/profile.json");
const known = new Set((await rest("skills?select=id")).map((s) => s.id));

const rows = [];
const skipped = [];
for (const [skill_id, level] of Object.entries(profile.skills)) {
  if (!LEVELS.has(level)) { console.error(`${skill_id}: level "${level}" is not none | some | solid`); process.exit(1); }
  if (!known.has(skill_id)) { skipped.push(skill_id); continue; }
  rows.push({ user_id: USER, skill_id, level, updated_at: new Date().toISOString() });
}

console.log(`${Object.keys(profile.skills).length} in profile.json · ${rows.length} to upsert · ${skipped.length} skipped`);
for (const s of skipped) console.log(`  skipped (not in skills): ${s}`);
for (const r of rows) console.log(`  ${r.skill_id.padEnd(24)} ${r.level}`);

// no process.exit() after a fetch: it tears down an open socket and Node on
// Windows aborts with a libuv assertion instead of exiting 0
if (DRY) {
  console.log("\n--dry-run: nothing written");
} else {
  await rest("user_skills", { method: "POST", body: rows, prefer: "resolution=merge-duplicates" });
  const after = await rest(`user_skills?select=skill_id,level&user_id=eq.${USER}&order=skill_id`);
  console.log(`\nuser_skills for ${USER}: ${after.length} rows`);
}
