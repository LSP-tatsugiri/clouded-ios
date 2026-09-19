// What the report function does with a request, and what it files. Pure, so
// report_test.ts can pin both without a database or GitHub.

export type FeedbackRow = {
  id: string;
  user_id: string;
  kind: "bug" | "improvement";
  surface: string;
  title: string;
  body: string;
  route: string | null;
  app_version: string | null;
  device: string | null;
  screenshot_path: string | null;
  github_issue_number: number | null;
  github_error: string | null;
  created_at: string;
};

export type WebhookPayload = {
  type?: "INSERT" | "UPDATE" | "DELETE";
  table?: string;
  record?: { id: string };
  feedback_id?: string;
};

export type Issue = { title: string; body: string; labels: string[] };

// Which feedback row to file, or null when this event is not ours. The
// function's own write-back of the issue number arrives as an UPDATE if the
// webhook is ever widened to updates; ignoring everything but INSERT is what
// keeps that from looping.
export function feedbackToFile(p: WebhookPayload): string | null {
  if (p.feedback_id) return p.feedback_id;
  if (p.table && p.table !== "feedback") return null;
  if (p.type === "INSERT" && p.record?.id) return p.record.id;
  return null;
}

// Labels are the triage vocabulary from docs/agents/triage-labels.md plus the
// kind. Everything else about the report goes in the body, where /triage can
// read it.
export const TRIAGE_LABEL = "needs-triage";

// The issue as it will appear on a public repo: the reporter's display name,
// never their email or user id; the screenshot's storage path, never the
// picture or a signed URL. The text is quoted verbatim — it is the report.
export function issueFor(row: FeedbackRow, reporter: string): Issue {
  const title = row.title.trim().slice(0, 120);
  const meta: [string, string | null][] = [
    ["kind", row.kind],
    ["surface", row.surface],
    ["route", row.route],
    ["version", row.app_version],
    ["device", row.device],
    ["reporter", reporter],
    ["filed", row.created_at],
    ["feedback", row.id]
  ];
  const lines = [
    "| | |",
    "|---|---|",
    ...meta.filter(([, v]) => v).map(([k, v]) => `| ${k} | ${cell(v!)} |`),
    "",
    row.body.trim(),
    ""
  ];
  if (row.screenshot_path) {
    lines.push(`screenshot: \`feedback-media/${row.screenshot_path}\` (private bucket — open from the Supabase dashboard)`, "");
  }
  lines.push("_Filed from the app by the `report` edge function. Reply here; the reporter does not see this thread._");
  return { title, body: lines.join("\n"), labels: [TRIAGE_LABEL, row.kind] };
}

// A table cell must stay on one line and must not close the row.
function cell(v: string): string {
  return v.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}
