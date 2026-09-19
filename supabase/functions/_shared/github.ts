// One call to the GitHub REST API: create an issue. Plain fetch, no client
// library, same rule as anthropic.ts. `fetchFn` is a parameter so the test
// can stand in for the network.

export type NewIssue = { title: string; body: string; labels: string[] };
export type CreatedIssue = { number: number; html_url: string };

export async function createIssue(
  { repo, token, issue }: { repo: string; token: string; issue: NewIssue },
  fetchFn: typeof fetch = fetch
): Promise<CreatedIssue> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`GITHUB_REPO is not owner/name: ${repo}`);
  const res = await fetchFn(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      "user-agent": "clouded-report"
    },
    body: JSON.stringify(issue)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`github ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as Partial<CreatedIssue>;
  if (typeof data.number !== "number" || typeof data.html_url !== "string") {
    throw new Error(`github: unexpected reply ${text.slice(0, 300)}`);
  }
  return { number: data.number, html_url: data.html_url };
}
