// Grants or revokes the curator role, which is what lets someone see proposed
// skills and promote them into the table.
//
//   node --env-file=supabase/.env supabase/scripts/grant-curator.mjs --user <uuid>
//   node --env-file=supabase/.env supabase/scripts/grant-curator.mjs --user <uuid> --revoke
//   node --env-file=supabase/.env supabase/scripts/grant-curator.mjs --list
//
// Membership is granted here rather than through the app on purpose: the
// curators table has no insert policy, so the only way in is the service role,
// which means a curator cannot quietly appoint another one.

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`${k} is missing from supabase/.env`); process.exit(1); } return v; };
const BASE = need("SUPABASE_URL").replace(/\/$/, "");
const SRK = need("SUPABASE_SERVICE_ROLE_KEY");

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const USER = opt("--user");
const REVOKE = args.includes("--revoke");
const LIST = args.includes("--list");

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

const show = async () => {
  const rows = await rest("curators?select=user_id,added_at&order=added_at");
  console.log(`curators: ${rows.length}`);
  for (const r of rows) console.log(`  ${r.user_id}  ${r.added_at}`);
};

if (LIST) {
  await show();
} else if (!USER) {
  console.error("usage: grant-curator.mjs --user <uuid> [--revoke] | --list");
  process.exitCode = 1;
} else if (REVOKE) {
  await rest(`curators?user_id=eq.${USER}`, { method: "DELETE" });
  console.log(`revoked ${USER}`);
  await show();
} else {
  await rest("curators", { method: "POST", body: { user_id: USER }, prefer: "resolution=merge-duplicates" });
  console.log(`granted ${USER}`);
  await show();
}
