// The fake backend, in the browser. run.mjs copies this next to a generated
// web/lib/db.js in each exported ref; that db.js re-exports f.fn(name) for
// every name the ref's real db.js exports. Reads answer from the fixture,
// writes resolve and change nothing, and nothing leaves the page.
//
// window.__SHOTS__ (set by run.mjs before the page loads) carries
// { signedOut } for the landing screens.

import F from "./__shots_fixture.js";

const opts = () => globalThis.__SHOTS__ ?? {};
const me = F.me;
const byCreated = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at);
const LIST_COLS = ["id", "user_id", "raw", "objective", "domain", "is_clear", "clarifying_question", "status",
  "shared_to", "image_path", "created_at", "built_at", "dropped_at", "drop_reason"];
const LIST_CAP = ["idea_id", "skill_id", "proposed_key", "reason", "crux_rank", "resolved"];
const pick = (row, cols) => Object.fromEntries(cols.map((c) => [c, row[c] ?? null]));
const capsOf = (ids) => F.idea_capabilities.filter((c) => ids.has(c.idea_id)).map((c) => pick(c, LIST_CAP));

// shape: "split" -> { ideas, caps } (the branch), "rows" -> [ideas] (main)
function list(rows, shape) {
  const out = rows.map((r) => pick(r, LIST_COLS));
  return shape === "split" ? { ideas: out, caps: capsOf(new Set(rows.map((r) => r.id))) } : out;
}

const sess = () => (opts().signedOut ? null : F.session);

export function fake({ shapes = {} } = {}) {
  const IMPL = {
    session: async () => sess(),
    signIn: async () => {}, signUp: async () => ({ confirm: true }), signOut: async () => ({ error: null }),
    ideas: async (uid) => list(F.ideas.filter((i) => i.user_id === uid).sort(byCreated), shapes.ideas),
    sharedIdeas: async () => list(F.ideas.filter((i) => i.shared_to).sort(byCreated).reverse(), shapes.sharedIdeas),
    capabilities: async () => F.idea_capabilities.map((c) => pick(c, LIST_CAP)),
    idea: async (id) => {
      const row = F.ideas.find((i) => i.id === id);
      if (!row) throw new Error("No such idea, or it is not shared with you.");
      return { ...row };
    },
    capabilitiesFor: async (id) => F.idea_capabilities.filter((c) => c.idea_id === id).map((c) => ({ ...c })),
    runsFor: async (id, since) => F.extraction_runs
      .filter((r) => r.idea_id === id && (!since || Date.parse(r.created_at) > Date.parse(since)))
      .sort(byCreated).reverse()
      .map(({ idea_id: _, ...r }) => r),
    watchRuns: (_id, _since, { onStatus } = {}) => { queueMicrotask(() => onStatus?.("SUBSCRIBED")); return () => {}; },
    mediaUrl: async () => "assets/mark.svg",
    skills: async () => F.skills.map((s) => ({ ...s })),
    mySkills: async (uid) => F.user_skills.filter((r) => r.user_id === uid).map(({ skill_id, level }) => ({ skill_id, level })),
    skillsFor: async (uid) => F.user_skills.filter((r) => r.user_id === uid).map(({ skill_id, level }) => ({ skill_id, level })),
    groupSkills: async (uid) => {
      const pool = new Map();
      for (const r of F.user_skills) {
        if (r.level !== "solid" || r.user_id === uid) continue;
        if (!pool.has(r.skill_id)) pool.set(r.skill_id, []);
        pool.get(r.skill_id).push(r.user_id);
      }
      return pool;
    },
    myProfile: async (uid) => ({ ...F.profiles.find((p) => p.user_id === uid) }),
    profilesFor: async (ids) => F.profiles.filter((p) => ids.includes(p.user_id)).map((p) => ({ ...p })),
    myGroups: async () => F.groups.map((g) => ({ ...g })),
    groupMembers: async (gid) => F.group_members.filter((m) => m.group_id === gid).map(({ user_id, added_at }) => ({ user_id, added_at })),
    pendingInvites: async (gid) => F.group_invites.filter((i) => i.group_id === gid).map(({ email, created_at }) => ({ email, created_at })),
    claimsFor: async (ids) => F.idea_claims.filter((c) => ids.includes(c.idea_id)).map((c) => ({ ...c })),
    amCurator: async (uid) => F.curators.includes(uid),
    proposedSkills: async () => F.proposed_skills.map((p) => ({ ...p })).sort((a, b) => b.run_count - a.run_count),
    myFeedback: async () => F.feedback.map((r) => ({ ...r }))
  };
  const WRITE = /^(add|set|delete|remove|create|rename|invite|revoke|promote|reject|upload)/;
  return {
    db: fakeClient(),
    fn(name) {
      if (IMPL[name]) return IMPL[name];
      if (WRITE.test(name)) return async (...args) => { console.log(`[shots] write ignored: ${name}`, args); return { id: args[0] ?? "fake" }; };
      return async () => { console.log(`[shots] no fake for ${name}; returning []`); return []; };
    }
  };
}

// Stands in for the supabase client the real db.js exports as `db`. auth is
// what app.js calls directly; anything else is a chain that resolves empty.
function fakeClient() {
  const chain = () => new Proxy(function () {}, {
    get: (_t, k) => k === "then" ? (res) => res({ data: [], error: null }) : chain(),
    apply: () => chain()
  });
  const auth = {
    getSession: async () => ({ data: { session: sess() }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({ error: null }),
    signUp: async () => ({ data: { session: null }, error: null })
  };
  return new Proxy({ auth }, { get: (t, k) => (k in t ? t[k] : k === "then" ? undefined : chain()) });
}
