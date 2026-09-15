// Invites a friend: lists their email so they can create their own account
// from the sign-in page (docs/hosting.md). Nothing else is needed — no
// account is made here, they do that themselves.
//
//   node --env-file=supabase/.env supabase/scripts/allow.mjs friend@example.com
//   node --env-file=supabase/.env supabase/scripts/allow.mjs friend@example.com --remove
//   node --env-file=supabase/.env supabase/scripts/allow.mjs --list
//
// Removing an email stops new sign-ups with it; an account that already
// exists keeps working (delete it in the dashboard if that is the intent).

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`${k} is missing from supabase/.env`); process.exit(1); } return v; };
const BASE = need("SUPABASE_URL").replace(/\/$/, "");
const SRK = need("SUPABASE_SERVICE_ROLE_KEY");

const args = process.argv.slice(2);
const EMAIL = args.find((a) => a.includes("@"))?.trim().toLowerCase();
const REMOVE = args.includes("--remove");
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
  const rows = await rest("allowed_emails?select=email,added_at&order=added_at");
  console.log(`invited: ${rows.length}`);
  for (const r of rows) console.log(`  ${r.email.padEnd(36)} ${r.added_at}`);
};

if (LIST) {
  await show();
} else if (!EMAIL) {
  console.error("usage: allow.mjs <email> [--remove] | --list");
  process.exit(1);
} else if (REMOVE) {
  const gone = await rest(`allowed_emails?email=eq.${encodeURIComponent(EMAIL)}`, { method: "DELETE", prefer: "return=representation" });
  console.log(gone.length ? `removed ${EMAIL}` : `${EMAIL} was not listed`);
} else {
  await rest("allowed_emails", { method: "POST", body: { email: EMAIL }, prefer: "resolution=ignore-duplicates" });
  console.log(`invited ${EMAIL} — they can now create an account from the sign-in page`);
}
