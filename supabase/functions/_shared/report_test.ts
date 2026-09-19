import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { createIssue } from "./github.ts";
import { type FeedbackRow, feedbackToFile, issueFor } from "./report.ts";

const id = "22222222-2222-2222-2222-222222222222";

const row: FeedbackRow = {
  id, user_id: "33333333-3333-3333-3333-333333333333", kind: "bug", surface: "web",
  title: "  Crux reveal fires twice  ", body: "Open an idea while extraction is running.\nThe split-flap plays, then plays again.",
  route: "#/idea/abc", app_version: "89e81b7", device: "Mozilla/5.0 (Macintosh)", screenshot_path: null,
  github_issue_number: null, github_error: null, created_at: "2026-09-19T15:00:00Z"
};

// ---------------------------------------------------------------- routing

Deno.test("insert on feedback files", () => {
  assertEquals(feedbackToFile({ type: "INSERT", table: "feedback", record: { id } }), id);
});

Deno.test("manual retry files", () => {
  assertEquals(feedbackToFile({ feedback_id: id }), id);
});

Deno.test("the function's own write-back does not loop, other tables and junk are ignored", () => {
  assertEquals(feedbackToFile({ type: "UPDATE", table: "feedback", record: { id } }), null);
  assertEquals(feedbackToFile({ type: "DELETE", table: "feedback", record: { id } }), null);
  assertEquals(feedbackToFile({ type: "INSERT", table: "ideas", record: { id } }), null);
  assertEquals(feedbackToFile({}), null);
});

// ---------------------------------------------------------------- the issue

Deno.test("labels are the triage entry point plus the kind", () => {
  assertEquals(issueFor(row, "brian").labels, ["needs-triage", "bug"]);
  assertEquals(issueFor({ ...row, kind: "improvement" }, "brian").labels, ["needs-triage", "improvement"]);
});

Deno.test("title is trimmed and capped", () => {
  assertEquals(issueFor(row, "brian").title, "Crux reveal fires twice");
  assertEquals(issueFor({ ...row, title: "x".repeat(200) }, "brian").title.length, 120);
});

Deno.test("body carries the context and the text verbatim", () => {
  const b = issueFor(row, "brian").body;
  for (const s of ["| surface | web |", "| route | #/idea/abc |", "| version | 89e81b7 |", "| reporter | brian |", `| feedback | ${id} |`]) {
    assertStringIncludes(b, s);
  }
  assertStringIncludes(b, "Open an idea while extraction is running.\nThe split-flap plays, then plays again.");
});

Deno.test("nothing identifying beyond the display name reaches a public repo", () => {
  const b = issueFor(row, "brian").body;
  assert(!b.includes(row.user_id), "user id leaked");
  assert(!b.includes("@"), "looks like an email leaked");
});

Deno.test("empty context rows are left out", () => {
  const b = issueFor({ ...row, route: null, app_version: null, device: null }, "brian").body;
  assert(!b.includes("| route |"));
  assert(!b.includes("| version |"));
  assert(!b.includes("| device |"));
});

Deno.test("a screenshot is referenced by path, never linked", () => {
  const without = issueFor(row, "brian").body;
  assert(!without.includes("screenshot"));
  const withShot = issueFor({ ...row, screenshot_path: `${row.user_id}/${id}.png` }, "brian").body;
  assertStringIncludes(withShot, `feedback-media/${row.user_id}/${id}.png`);
  assert(!withShot.includes("http"), "a URL to the picture leaked");
});

Deno.test("a pipe or newline in a context value cannot break the table", () => {
  const b = issueFor({ ...row, device: "a|b\nc" }, "brian").body;
  assertStringIncludes(b, "| device | a\\|b c |");
});

// ---------------------------------------------------------------- github

Deno.test("createIssue posts to the repo with the token and reads the number back", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchFn = ((url: string, init: RequestInit) => {
    seen = { url, init };
    return Promise.resolve(new Response(JSON.stringify({ number: 42, html_url: "https://github.com/o/r/issues/42" }), { status: 201 }));
  }) as unknown as typeof fetch;
  const made = await createIssue({ repo: "o/r", token: "t", issue: { title: "t", body: "b", labels: ["bug"] } }, fetchFn);
  assertEquals(made, { number: 42, html_url: "https://github.com/o/r/issues/42" });
  assertEquals(seen!.url, "https://api.github.com/repos/o/r/issues");
  const h = seen!.init.headers as Record<string, string>;
  assertEquals(h.authorization, "Bearer t");
  assertEquals(JSON.parse(seen!.init.body as string), { title: "t", body: "b", labels: ["bug"] });
});

Deno.test("createIssue surfaces a GitHub error with the status", async () => {
  const fetchFn = (() => Promise.resolve(new Response('{"message":"Bad credentials"}', { status: 401 }))) as unknown as typeof fetch;
  const err = await assertRejects(() => createIssue({ repo: "o/r", token: "t", issue: { title: "t", body: "b", labels: [] } }, fetchFn), Error);
  assertStringIncludes(err.message, "github 401");
  assertStringIncludes(err.message, "Bad credentials");
});

Deno.test("createIssue refuses a repo that is not owner/name", async () => {
  await assertRejects(() => createIssue({ repo: "not a repo", token: "t", issue: { title: "t", body: "b", labels: [] } }));
});
