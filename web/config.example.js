// Copy to web/config.js and fill in. config.js is gitignored.
//
// Both values are public by design — they ship in any browser client, and RLS
// is the boundary, not secrecy (verified: the anon key alone reads nothing).
// They still stay out of tracked files, so that rule holds for every key.
//
// Dashboard → Project Settings → API Keys → Legacy API keys, or:
//   supabase projects api-keys --project-ref <ref>

export const SUPABASE_URL = "https://<project-ref>.supabase.co";
export const SUPABASE_ANON_KEY = "<anon key>";
