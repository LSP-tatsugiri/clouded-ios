# Hosting the web client

Decided 2026-09-14 (grilled; the reasoning is in this file so it does not
have to be re-derived). The web client is static files; hosting means
serving `web/` at a URL. It lives at **https://clouded.monoesport.com** on
Vercel, next to the owner's other project on the same account.

## What was decided, and why

- **Vercel**, deploying on every push to `main`; every other branch gets a
  preview URL. Chosen over Cloudflare Pages only because the owner's other
  project is already there: one account. Nothing else here depends on the
  host.
- **`web/build.mjs` is the build.** A static host has no way to serve
  `/extraction/src/distance.js` (the dev server mounts that directory so the
  browser runs the same module the Node report uses), and no `config.js`
  (gitignored, never keys in a tracked file). The script copies the one and
  writes the other from environment variables. Both outputs are gitignored;
  the committed source of the distance logic stays one file.
- **`clouded.monoesport.com`**, one CNAME at GoDaddy, where the domain's
  DNS lives. The root domain and the other project are untouched.
- **Friends sign themselves up**, email + password, no confirmation email.
  Anyone can reach the sign-up form; only an email the owner listed first
  gets an account (`allowed_emails` + a trigger on `auth.users`, migration
  `20260915033902`). Adding a friend is `allow.mjs <email>`. Chosen over
  hand-made accounts (tedious), magic links (needs the mailer, and a deep
  link on iOS), and Google sign-in (an OAuth client, and an in-app browser
  flow on iOS). Password reset is the next thing to add; it needs the mailer.
- **No cost cap.** Every idea a signed-in user adds costs the owner ~1¢; the
  page says so on the button. Ten trusted people. A daily cap in the edge
  function is a ten-line change when it is needed; recorded as a known
  problem in `CLAUDE.md`.

## Requirements (have these before starting)

- The GitHub repo `LSP-tatsugiri/clouded-ios`, with `main` pushed.
- A Vercel account with access to that GitHub account (the existing one).
- GoDaddy access for `monoesport.com` (DNS management).
- The two values from `supabase/.env`: `SUPABASE_URL` and
  `SUPABASE_ANON_KEY`. They are public by design (RLS is the boundary) but
  still never go in a tracked file.
- The migration pushed: `supabase db push` from the Mac, then
  `supabase migration list` shows `20260915033902` on the remote.

## One-time setup (human steps, in order)

1. **Vercel → Add New → Project → import `clouded-ios`.** Framework preset
   **Other**. Leave **Root Directory** at the repo root (the build reaches
   into `extraction/`; a `web` root would need Vercel's "include files
   outside root" toggle). Build Command `node web/build.mjs`. Output
   Directory `web`. Install Command: leave empty (no dependencies).
   *You should see:* the three fields filled as above before you deploy.
2. **Environment variables**, same project screen: `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`, ticked for **Production and Preview** (previews are
   real clients against the same database; RLS is the boundary).
   *You should see:* two variables listed for both environments.
3. **Deploy.** *You should see:* the build log end with `built web/:
   extraction/src/distance.js copied, config.js written`, then a
   `*.vercel.app` URL that shows the sign-in card.
4. **Vercel → project → Settings → Domains → add `clouded.monoesport.com`.**
   *You should see:* Vercel say the domain is not yet configured and show a
   CNAME value (`cname.vercel-dns.com`).
5. **GoDaddy → `monoesport.com` → DNS → Add record:** type **CNAME**, name
   `clouded`, value `cname.vercel-dns.com`, TTL default. Do not touch the
   existing records. *You should see:* Vercel's domain page flip to valid
   within a few minutes and issue HTTPS on its own.
6. **Supabase → Authentication → URL Configuration → Site URL** =
   `https://clouded.monoesport.com`. Harmless today (password sign-in needs
   no redirect); it is where password-reset links will point later.
7. **Check:** open https://clouded.monoesport.com, sign in as the test user,
   the list loads. Open the URL in a private window, "Create an account"
   with an email that is not listed: it must refuse with "That address isn't
   invited yet".

## Day to day

- **Deploy**: push to `main`. Nothing else.
- **Preview a branch**: push it; Vercel comments the URL on the commit, or
  find it under the project's Deployments.
- **Add a friend**: `node --env-file=supabase/.env supabase/scripts/allow.mjs
  friend@example.com`, then tell them to open the URL and choose "Create an
  account". `--list` shows who is invited; `--remove` withdraws an unused
  invite (an existing account keeps working — delete it in the dashboard if
  that is the intent).
- **Roll back**: `git revert <commit>` and push; or Vercel → Deployments →
  a previous one → Promote to Production.
- **Build locally, exactly as the host does**:
  `node --env-file=supabase/.env web/build.mjs`, then `node web/serve.mjs`.
  The dev server still serves `distance.js` through its mount, not the
  copy, and the copy is byte-identical, so nothing changes locally. To see
  exactly what the host serves, use any plain static server on `web/`.

## Things that look wrong but are not

- `web/extraction/` and `web/config.js` exist after a build and never show
  in `git status`: both gitignored on purpose.
- The whole repo is cloned for each build, `extraction/.env` included if it
  were committed — it is not, and the build reads only
  `extraction/src/distance.js`. The served directory is `web/` alone.
- Hash routing (`#/profile`, `#/idea/<id>`) means no rewrite rules are
  needed; every URL is `/` to the host.
