// The shared-secret check every webhook-driven function makes: extract/ and
// report/ both import it.

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Compare digests, not raw strings: fixed length, no early exit on the secret.
export async function authorized(req: Request): Promise<boolean> {
  const expected = Deno.env.get("WEBHOOK_SECRET");
  const given = req.headers.get("x-webhook-secret");
  if (!expected || !given) return false;
  return (await sha256(expected)) === (await sha256(given));
}
