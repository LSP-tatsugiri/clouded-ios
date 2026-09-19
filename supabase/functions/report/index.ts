// report: files one feedback row as a GitHub issue.
//
// Called two ways:
//   1. Database webhook on feedback (INSERT). Payload: { type, table, record }.
//   2. Directly, for retries: { "feedback_id": "<uuid>" }.
// Both carry the shared secret in the x-webhook-secret header; verify_jwt is
// off for this function (see supabase/config.toml), same as extract.
//
// The row is the record and the issue is a copy of it. Filing writes
// github_issue_number back, or github_error, and a failure never reaches the
// reporter: the report is in the table either way and a direct call retries
// it. Rows that already carry an issue number are left alone, so a webhook
// redelivery or a second retry cannot file the same report twice.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createIssue } from "../_shared/github.ts";
import { feedbackToFile, type FeedbackRow, issueFor, type WebhookPayload } from "../_shared/report.ts";
import { authorized } from "../_shared/secret.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const REPO = Deno.env.get("GITHUB_REPO") ?? "LSP-tatsugiri/clouded-ios";

function service(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

function ok<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export async function file(id: string, db = service()): Promise<void> {
  const row = ok<FeedbackRow>(await db.from("feedback").select("*").eq("id", id).single(), "getFeedback");
  if (row.github_issue_number) return;   // already filed

  // Display name only. profiles is one row per user, made at sign-up; a
  // missing row is not a reason to fail the report.
  const prof = await db.from("profiles").select("display_name").eq("user_id", row.user_id).maybeSingle();
  const reporter = prof.data?.display_name ?? "a friend";

  const token = Deno.env.get("GITHUB_TOKEN");
  try {
    if (!token) throw new Error("GITHUB_TOKEN is not set");
    const made = await createIssue({ repo: REPO, token, issue: issueFor(row, reporter) });
    ok(await db.from("feedback").update({ github_issue_number: made.number, github_error: null }).eq("id", id), "markFiled");
    console.log(`report ${id}: filed #${made.number}`);
  } catch (err) {
    const error = (err as Error).message;
    console.error(`report ${id}: ${error}`);
    ok(await db.from("feedback").update({ github_error: error }).eq("id", id), "markError");
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });

  let payload: WebhookPayload;
  try { payload = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const id = feedbackToFile(payload);
  if (!id) return new Response(null, { status: 204 });

  // Ack first, file after: the webhook client times out in seconds and a
  // GitHub round trip can take longer than that on a bad day.
  const work = file(id).catch((err) => console.error(`report ${id}: ${(err as Error).message}`));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;

  return new Response(JSON.stringify({ queued: id }), {
    status: 202, headers: { "content-type": "application/json" }
  });
});
