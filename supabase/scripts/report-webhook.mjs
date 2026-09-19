// Creates the database webhook that files feedback rows as GitHub issues:
// an AFTER INSERT trigger on public.feedback that calls the report edge
// function with the shared secret, the same trigger the dashboard makes
// for extract on ideas (docs/feedback-plan.md, Phase A).
//
//   node --env-file=supabase/.env supabase/scripts/report-webhook.mjs
//
// Owner's step: it changes the shared database. The secret is read from the
// gitignored .env and written to a temporary SQL file that is removed after
// the query runs, so it is never committed. Safe to re-run: the trigger is
// dropped and recreated.

import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`${k} is not set; run with --env-file=supabase/.env`); process.exit(1); }
  return v;
};
const url = `${need("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/report`;
const headers = JSON.stringify({ "Content-type": "application/json", "x-webhook-secret": need("WEBHOOK_SECRET") });
const q = (s) => `'${s.replace(/'/g, "''")}'`;

const sql =
  `drop trigger if exists "report-on-feedback" on public.feedback;\n` +
  `create trigger "report-on-feedback" after insert on public.feedback for each row ` +
  `execute function supabase_functions.http_request(${q(url)}, 'POST', ${q(headers)}, '{}', '5000');\n`;

const file = "report-webhook.tmp.sql";
writeFileSync(file, sql);
try {
  execFileSync("supabase", ["db", "query", "--linked", "-f", file], { stdio: "inherit", shell: true });
  console.log("created trigger report-on-feedback on public.feedback");
} finally {
  unlinkSync(file);
}
