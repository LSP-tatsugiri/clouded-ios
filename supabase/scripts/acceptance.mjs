// Phase D acceptance (docs/step-4-plan.md). Node 20+, no dependencies.
// Keys come from gitignored supabase/.env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, WEBHOOK_SECRET
//
// From the repo root:
//   node --env-file=supabase/.env supabase/scripts/acceptance.mjs seed  --user <uuid>
//   node --env-file=supabase/.env supabase/scripts/acceptance.mjs wait  --user <uuid>
//   node --env-file=supabase/.env supabase/scripts/acceptance.mjs diff  --user <uuid>
//   node --env-file=supabase/.env supabase/scripts/acceptance.mjs rls   --user <uuid>
//   node --env-file=supabase/.env supabase/scripts/acceptance.mjs rerun <idea_id>
//   node --env-file=supabase/.env supabase/scripts/acceptance.mjs list  --user <uuid>
//
// seed inserts extraction/data/ideas.json under --user (skips raws already
// there); the webhook extracts them. wait polls until none are pending. diff
// compares idea_capabilities with extraction/out/extractions.json. rls creates
// three throwaway users plus one that signs up through an invite, shares one
// idea to a group, checks who sees what (RLS, profiles, invites, leaving), and
// cleans up. list prints the reference for the web list (docs/step-5-plan.md
// Phase C): the sorted order and the leverage top 10 for --user's profile,
// from the same rows and the same distance.js the browser imports. Only seed
// and rerun spend API credits.

import { readFileSync } from "node:fs";
import { compareKeys, cruxOf, cruxStatus, distanceOf, leverage, sortKey } from "../../extraction/src/distance.js";

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`${k} is missing from supabase/.env`); process.exit(1); } return v; };
const BASE = need("SUPABASE_URL").replace(/\/$/, "");
const SRK = need("SUPABASE_SERVICE_ROLE_KEY");

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const USER = opt("--user");

const root = new URL("../../", import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

async function call(url, { method = "GET", body, token = SRK, apikey = SRK, prefer } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      apikey, authorization: `Bearer ${token}`, "content-type": "application/json",
      ...(prefer ? { prefer } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.replace(BASE, "")} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const rest = (path, o) => call(`${BASE}/rest/v1/${path}`, o);
const auth = (path, o) => call(`${BASE}/auth/v1/${path}`, o);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const requireUser = () => { if (!USER) { console.error("--user <uuid> is required"); process.exit(1); } };

// ---------------------------------------------------------------- seed

async function seed() {
  requireUser();
  const ideas = load("extraction/data/ideas.json");
  const existing = await rest(`ideas?select=raw&user_id=eq.${USER}`);
  const have = new Set(existing.map((r) => r.raw));
  // PostgREST bulk insert requires identical keys on every object
  const rows = ideas.filter((i) => !have.has(i.raw)).map((i) => ({
    user_id: USER, raw: i.raw, clarification: i.clarification ?? null
  }));
  if (!rows.length) { console.log(`nothing to insert: all ${ideas.length} ideas already present`); return; }
  const inserted = await rest("ideas", { method: "POST", body: rows, prefer: "return=representation" });
  console.log(`inserted ${inserted.length}, skipped ${ideas.length - inserted.length} already present`);
  for (const r of inserted) console.log(`  ${r.id}  ${r.raw}`);
}

// ---------------------------------------------------------------- wait

async function wait() {
  requireUser();
  const started = Date.now();
  for (;;) {
    const rows = await rest(`ideas?select=id,raw,status&user_id=eq.${USER}`);
    const by = {};
    for (const r of rows) (by[r.status] ||= []).push(r);
    const pending = by.pending?.length || 0;
    process.stdout.write(`\r${Math.round((Date.now() - started) / 1000)}s  pending ${pending}  extracted ${by.extracted?.length || 0}  failed ${by.failed?.length || 0}   `);
    if (!pending) { console.log(); break; }
    if (Date.now() - started > 6 * 60_000) { console.log("\ntimed out"); break; }
    await sleep(5000);
  }
  const failed = await rest(`ideas?select=id,raw&status=eq.failed&user_id=eq.${USER}`);
  for (const f of failed) {
    const runs = await rest(`extraction_runs?select=error,created_at&idea_id=eq.${f.id}&order=created_at.desc&limit=1`);
    console.log(`FAILED ${f.id}  ${f.raw}\n   ${runs[0]?.error?.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------- diff

// The crux comes from the shared module rather than a loop here. It has to:
// the model marks two cruxes on roughly one idea in ten, and picking the last
// on one side while the database keeps the first reported a disagreement that
// was never there.
function summarise(caps, { skillKey, propKey }) {
  const skills = new Set(), proposed = new Set();
  for (const c of caps) {
    if (c[skillKey]) skills.add(c[skillKey]); else if (c[propKey]) proposed.add(c[propKey]);
  }
  const crux = cruxOf({ capabilities: caps });
  return { skills, proposed, crux: crux ? (crux[skillKey] || crux[propKey]) : null };
}

async function diff() {
  requireUser();
  const ideas = load("extraction/data/ideas.json");
  const base = load("extraction/out/extractions.json");
  const rows = await rest(`ideas?select=id,raw,status,is_clear&user_id=eq.${USER}`);
  const byRaw = new Map(rows.map((r) => [r.raw, r]));
  const ids = rows.map((r) => r.id).join(",");
  const caps = await rest(`idea_capabilities?select=idea_id,skill_id,proposed_key,crux_rank&idea_id=in.(${ids})`);
  const capsBy = {};
  for (const c of caps) (capsBy[c.idea_id] ||= []).push(c);

  let clearOk = 0, exact = 0, cruxOk = 0, compared = 0, overlapSum = 0;
  console.log("idea          clear      skills (same/baseline  +new  -missing)                     crux baseline -> db");
  console.log("-".repeat(110));
  for (const idea of ideas) {
    const b = base[idea.id], db = byRaw.get(idea.raw);
    if (!b || !db) { console.log(`${idea.id.padEnd(13)} ${!b ? "no baseline" : "NOT IN DB"}`); continue; }
    const clearMatch = b.clear === db.is_clear;
    if (clearMatch) clearOk++;
    if (!b.clear || !db.is_clear) {
      console.log(`${idea.id.padEnd(13)} ${String(b.clear).padEnd(5)}/${String(db.is_clear).padEnd(5)} ${clearMatch ? "=" : "≠"}  (vague)`);
      continue;
    }
    const B = summarise(b.capabilities, { skillKey: "skill_id", propKey: "proposed_name" });
    const D = summarise(capsBy[db.id] || [], { skillKey: "skill_id", propKey: "proposed_key" });
    const same = [...B.skills].filter((s) => D.skills.has(s));
    const added = [...D.skills].filter((s) => !B.skills.has(s));
    const missing = [...B.skills].filter((s) => !D.skills.has(s));
    const union = new Set([...B.skills, ...D.skills]);
    compared++; overlapSum += union.size ? same.length / union.size : 1;
    if (!added.length && !missing.length) exact++;
    const cx = B.crux === D.crux;
    if (cx) cruxOk++;
    const prop = [...D.proposed].length ? `  proposed: ${[...D.proposed].join(",")}` : "";
    console.log(
      `${idea.id.padEnd(13)} ${String(b.clear).padEnd(5)}/${String(db.is_clear).padEnd(5)} ${clearMatch ? "=" : "≠"}  ` +
      `${String(same.length).padStart(2)}/${String(B.skills.size).padEnd(2)} +[${added.join(",")}] -[${missing.join(",")}]`.padEnd(62) +
      `${B.crux} -> ${D.crux} ${cx ? "ok" : "DIFF"}${prop}`
    );
  }
  console.log("-".repeat(110));
  console.log(`clear/vague verdict agrees: ${clearOk}/${ideas.length}`);
  console.log(`exact skill set:            ${exact}/${compared}`);
  console.log(`mean skill overlap:         ${(overlapSum / compared * 100).toFixed(0)}%`);
  console.log(`crux agrees:                ${cruxOk}/${compared}`);
  const reg = await rest("proposed_skills?select=key,names,idea_ids,run_count,crux_count,rejected,promoted&order=run_count.desc");
  console.log(`\nproposed_skills rows: ${reg.length}`);
  for (const r of reg) console.log(`  ${r.key.padEnd(28)} runs ${r.run_count}  ideas ${r.idea_ids.length}  crux ${r.crux_count}  names: ${r.names.join(" / ")}`);
}

// ---------------------------------------------------------------- rls

async function rls() {
  requireUser();
  const ANON = need("SUPABASE_ANON_KEY");
  const results = [];
  const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
  const pw = () => crypto.randomUUID() + "Aa1!";
  // since 20260915033902 auth.users refuses any email not in allowed_emails,
  // admin creates included, so the throwaway users are listed first
  const allow = (email) => rest("allowed_emails", { method: "POST", body: { email }, prefer: "resolution=ignore-duplicates" });
  const disallow = (email) => rest(`allowed_emails?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
  const mkUser = async (email) => {
    const password = pw();
    await allow(email);
    const u = await auth("admin/users", { method: "POST", body: { email, password, email_confirm: true } });
    return { id: u.id, email, password };
  };
  const signIn = async (u) => (await auth("token?grant_type=password", { method: "POST", body: { email: u.email, password: u.password }, token: ANON, apikey: ANON })).access_token;
  const as = (token) => (path) => rest(path, { token, apikey: ANON });
  const denied = async (p) => { try { await p; return false; } catch (e) { return /40[13]|permission denied|42501/.test(e.message); } };

  let B, C, D, gid, gid2, ideaId, aName;
  const stamp = Date.now();
  const dEmail = `rls-d-${stamp}@clouded.test`;   // invited, then signs up
  const fEmail = `rls-f-${stamp}@clouded.test`;   // invited, then revoked
  try {
    B = await mkUser(`rls-b-${stamp}@clouded.test`);
    C = await mkUser(`rls-c-${stamp}@clouded.test`);
    [{ id: gid }] = await rest("groups", { method: "POST", body: { name: "rls-test", created_by: USER }, prefer: "return=representation" });
    // since 20260915071927 creating a group makes the creator a member
    await rest("group_members", { method: "POST", body: { group_id: gid, user_id: B.id } });
    const [idea] = await rest(`ideas?select=id,raw&user_id=eq.${USER}&status=eq.extracted&is_clear=eq.true&limit=1`);
    ideaId = idea.id;
    await rest(`ideas?id=eq.${ideaId}`, { method: "PATCH", body: { shared_to: gid } });
    await rest("user_skills", { method: "POST", body: { user_id: USER, skill_id: "parametric-cad", level: "solid" }, prefer: "resolution=merge-duplicates" });

    const bTok = await signIn(B);
    const b = as(bTok), c = as(await signIn(C)), anon = as(ANON);

    // B: group mate
    const bIdeas = await b("ideas?select=id");
    check("B sees exactly the one shared idea", bIdeas.length === 1 && bIdeas[0].id === ideaId, `${bIdeas.length} rows`);
    const bCaps = await b("idea_capabilities?select=idea_id");
    check("B sees that idea's capabilities and no others", bCaps.length > 0 && bCaps.every((r) => r.idea_id === ideaId), `${bCaps.length} rows`);
    const bSkills = await b("user_skills?select=user_id,skill_id");
    check("B sees A's skill profile (shared group)", bSkills.some((r) => r.user_id === USER && r.skill_id === "parametric-cad"), `${bSkills.length} rows`);
    check("B can read the skills table", (await b("skills?select=id&limit=1")).length === 1);
    // since 20260914063115 authenticated has select behind is_curator(): a
    // non-curator gets an empty result, not a permission error
    check("B (not a curator) reads no proposed_skills", (await b("proposed_skills?select=key")).length === 0);
    check("B cannot read extraction_runs", (await b("extraction_runs?select=id")).length === 0);
    check("B cannot insert an idea as A", await denied(rest("ideas", { method: "POST", body: { user_id: USER, raw: "forged" }, token: bTok, apikey: ANON })));

    // C: stranger
    check("C sees no ideas", (await c("ideas?select=id")).length === 0);
    check("C sees no capabilities", (await c("idea_capabilities?select=idea_id")).length === 0);
    check("C sees no skill profiles", (await c("user_skills?select=user_id")).length === 0);
    check("C sees no group", (await c("groups?select=id")).length === 0);
    check("C can read the skills table", (await c("skills?select=id&limit=1")).length === 1);

    // anon key alone
    for (const t of ["ideas", "idea_capabilities", "user_skills", "skills", "groups", "group_members", "extraction_runs"]) {
      check(`anon sees nothing in ${t}`, (await anon(`${t}?select=*&limit=1`)).length === 0);
    }
    check("anon cannot read proposed_skills", await denied(anon("proposed_skills?select=key")));
    check("anon cannot read allowed_emails", (await anon("allowed_emails?select=email").catch(() => [])).length === 0);

    // self-serve sign-up through the public endpoint, as the web form does
    const unlisted = `rls-x-${Date.now()}@clouded.test`;
    const signUp = (email) => call(`${BASE}/auth/v1/signup`, { method: "POST", body: { email, password: pw() }, token: ANON, apikey: ANON });
    check("sign-up with an unlisted email is refused", await (async () => {
      try { await signUp(unlisted); return false; } catch (e) { return /not invited/.test(e.message); }
    })());

    // ---- Step 7 (20260915071927): profiles, invites, membership rules
    const A = { email: need("TEST_USER_EMAIL"), password: need("TEST_USER_PASSWORD") };
    const aTok = await signIn(A);
    const a = as(aTok);
    aName = (await rest(`profiles?select=display_name&user_id=eq.${USER}`))[0]?.display_name;
    const rpc = (token, fn, body) => call(`${BASE}/rest/v1/rpc/${fn}`, { method: "POST", body, token, apikey: ANON });

    check("creating a group made A a member", (await rest(`group_members?select=user_id&group_id=eq.${gid}&user_id=eq.${USER}`)).length === 1);
    const bProfiles = await b("profiles?select=user_id,display_name");
    check("B reads A's profile (shared group)", bProfiles.some((r) => r.user_id === USER));
    check("B's default name is the email's local part", bProfiles.some((r) => r.user_id === B.id && r.display_name === B.email.split("@")[0]));
    check("C reads only their own profile", (await c("profiles?select=user_id")).every((r) => r.user_id === C.id));
    check("A cannot rename B", (await rest(`profiles?user_id=eq.${B.id}`, { method: "PATCH", body: { display_name: "hijacked" }, token: aTok, apikey: ANON, prefer: "return=representation" })).length === 0);
    check("A can rename themself", (await rest(`profiles?user_id=eq.${USER}`, { method: "PATCH", body: { display_name: "rls-a" }, token: aTok, apikey: ANON, prefer: "return=representation" })).length === 1);

    check("B (not the creator) cannot invite", await rpc(bTok, "invite", { p_group_id: gid, p_email: dEmail }).then(() => false, (e) => /only the group creator/.test(e.message)));
    check("inviting an existing account joins it now", (await rpc(aTok, "invite", { p_group_id: gid, p_email: C.email })) === "joined");
    check("C now sees the shared idea", (await c("ideas?select=id")).some((r) => r.id === ideaId));
    check("inviting an unlisted email leaves a pending invite", (await rpc(aTok, "invite", { p_group_id: gid, p_email: dEmail })) === "invited");
    check("A sees the pending invite", (await a(`group_invites?select=email&group_id=eq.${gid}`)).some((r) => r.email === dEmail));
    check("B does not see it", (await b(`group_invites?select=email`)).length === 0);
    // The invite already allowlisted dEmail, so this is the sign-up itself,
    // minus the public endpoint: GoTrue refuses a .test address as
    // undeliverable once the row is accepted, and a real domain would get a
    // real confirmation email. The admin create fires the same auth.users
    // trigger, which is what is under test.
    D = { email: dEmail, password: pw() };
    D.id = (await auth("admin/users", { method: "POST", body: { email: dEmail, password: D.password, email_confirm: true } })).id;
    check("the invited email can sign up", !!D.id);
    check("and lands in the group with no accept step", (await rest(`group_members?select=user_id&group_id=eq.${gid}&user_id=eq.${D.id}`)).length === 1);
    check("the pending invite is consumed", (await rest(`group_invites?select=email&email=eq.${encodeURIComponent(dEmail)}`)).length === 0);
    check("D has a profile", (await rest(`profiles?select=user_id&user_id=eq.${D.id}`)).length === 1);

    await rpc(aTok, "invite", { p_group_id: gid, p_email: fEmail });
    await rpc(aTok, "revoke_invite", { p_group_id: gid, p_email: fEmail });
    check("revoking an unsigned-up invite removes the allowlist row", (await rest(`allowed_emails?select=email&email=eq.${encodeURIComponent(fEmail)}`)).length === 0);
    await rpc(aTok, "revoke_invite", { p_group_id: gid, p_email: C.email });
    check("revoking on an existing account keeps its allowlist row", (await rest(`allowed_emails?select=email&email=eq.${encodeURIComponent(C.email)}`)).length === 1);

    check("the creator cannot leave", (await rest(`group_members?group_id=eq.${gid}&user_id=eq.${USER}`, { method: "DELETE", token: aTok, apikey: ANON, prefer: "return=representation" })).length === 0
      && (await rest(`group_members?select=user_id&group_id=eq.${gid}&user_id=eq.${USER}`)).length === 1);

    // a second group B created, which A joins, shares to, then leaves
    [{ id: gid2 }] = await rest("groups", { method: "POST", body: { name: "rls-test-2", created_by: B.id }, prefer: "return=representation" });
    await rest("group_members", { method: "POST", body: { group_id: gid2, user_id: USER } });
    await rest(`ideas?id=eq.${ideaId}`, { method: "PATCH", body: { shared_to: gid2 } });
    check("a member can leave", (await rest(`group_members?group_id=eq.${gid2}&user_id=eq.${USER}`, { method: "DELETE", token: aTok, apikey: ANON, prefer: "return=representation" })).length === 1);
    check("leaving made their shared idea private again", (await rest(`ideas?select=shared_to&id=eq.${ideaId}`))[0].shared_to === null);

    for (const t of ["profiles", "group_invites"]) {
      check(`anon sees nothing in ${t}`, (await anon(`${t}?select=*&limit=1`).catch(() => [])).length === 0);
    }
  } finally {
    console.log("\ncleaning up");
    if (ideaId) await rest(`ideas?id=eq.${ideaId}`, { method: "PATCH", body: { shared_to: null } }).catch((e) => console.error(e.message));
    await rest(`user_skills?user_id=eq.${USER}&skill_id=eq.parametric-cad`, { method: "DELETE" }).catch((e) => console.error(e.message));
    for (const g of [gid, gid2]) if (g) await rest(`groups?id=eq.${g}`, { method: "DELETE" }).catch((e) => console.error(e.message));
    if (aName) await rest(`profiles?user_id=eq.${USER}`, { method: "PATCH", body: { display_name: aName } }).catch((e) => console.error(e.message));
    for (const u of [B, C, D]) if (u?.id) await auth(`admin/users/${u.id}`, { method: "DELETE" }).catch((e) => console.error(e.message));
    for (const email of [B?.email, C?.email, dEmail, fEmail]) if (email) await disallow(email).catch((e) => console.error(e.message));
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exit(1);
}

// ---------------------------------------------------------------- list

// The same computation web/app.js does, through the service role instead of
// the signed-in session, so the browser can be checked against it by eye.
async function list() {
  requireUser();
  const [ideas, allCaps, mine, skills] = await Promise.all([
    rest(`ideas?select=id,raw,objective,domain,is_clear,status&user_id=eq.${USER}&order=created_at.asc`),
    rest("idea_capabilities?select=idea_id,skill_id,proposed_key,crux_rank"),
    rest(`user_skills?select=skill_id,level&user_id=eq.${USER}`),
    rest("skills?select=id,name")
  ]);
  const ids = new Set(ideas.map((i) => i.id));
  const capsById = new Map();
  for (const c of allCaps) {
    if (!ids.has(c.idea_id)) continue;
    if (!capsById.has(c.idea_id)) capsById.set(c.idea_id, []);
    capsById.get(c.idea_id).push(c);
  }
  const held = new Map(mine.map((r) => [r.skill_id, r.level]));
  const name = new Map(skills.map((s) => [s.id, s.name]));
  const title = (i) => i.objective || i.raw;
  const skillLabel = (id, proposed) => id ? name.get(id) ?? id : `proposed: ${proposed}`;

  const rows = ideas.map((idea) => ({
    idea, extraction: { clear: idea.is_clear === true, capabilities: capsById.get(idea.id) ?? [] }
  }));
  const clear = rows.filter((r) => r.idea.is_clear === true);
  const vague = rows.filter((r) => r.idea.is_clear !== true);
  clear.sort((a, b) =>
    compareKeys(sortKey(a.extraction, held), sortKey(b.extraction, held)) ||
    title(a.idea).localeCompare(title(b.idea)));

  const mark = { have: "held", partial: "partial", gap: "gap", proposed: "gap?" };
  console.log(`profile: ${mine.length} rated skills\n\nclear ideas in list order (${clear.length}):`);
  for (const [n, r] of clear.entries()) {
    const d = distanceOf(r.extraction, held);
    const crux = cruxOf(r.extraction);
    const flag = r.extraction.capabilities.some((c) => !c.skill_id) ? "  [?]" : "";
    console.log(`  ${String(n + 1).padStart(2)}. ${title(r.idea).slice(0, 44).padEnd(44)}  ${(mark[cruxStatus(r.extraction, held)] ?? "-").padEnd(7)}  ${d.gap} short · ${d.partial} partial · ${d.have} held  ${r.idea.domain ?? ""}${flag}`);
    console.log(`      crux: ${crux ? skillLabel(crux.skill_id, crux.proposed_key) : "(none)"}`);
  }
  console.log(`\nvague or unranked (${vague.length}):`);
  for (const r of vague) console.log(`  ${r.idea.status.padEnd(9)} ${title(r.idea).slice(0, 60)}`);

  console.log("\nhighest leverage (top 10):");
  const top = leverage(clear.map((r) => ({ id: r.idea.id, extraction: r.extraction })), held).slice(0, 10);
  for (const e of top) console.log(`  ${String(e.ideaIds.length).padStart(2)}  ${skillLabel(e.skillId, e.proposedName)}`);
}

// ---------------------------------------------------------------- rerun

async function rerun() {
  const ideaId = args[1];
  if (!ideaId) { console.error("rerun <idea_id>"); process.exit(1); }
  const secret = need("WEBHOOK_SECRET");
  const res = await fetch(`${BASE}/functions/v1/extract`, {
    method: "POST", headers: { "x-webhook-secret": secret, "content-type": "application/json" },
    body: JSON.stringify({ idea_id: ideaId })
  });
  console.log(res.status, await res.text());
}

const cmds = { seed, wait, diff, rls, rerun, list };
if (!cmds[cmd]) { console.error(`usage: acceptance.mjs <${Object.keys(cmds).join("|")}>`); process.exit(1); }
await cmds[cmd]();
