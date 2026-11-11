// Builds tools/shots/fixture.json from the committed extraction data:
// data/ideas.json (raw text), out/extractions.json (what the model said),
// data/skills.json (the table), data/profile.json (the owner's levels) and
// out/proposed.json (the curator queue). Run it only when the fixture should
// change on purpose; before/after compare the committed file.
//
//   node tools/shots/make-fixture.mjs

import { readFileSync, writeFileSync } from "node:fs";

const at = (p) => new URL(`../../extraction/${p}`, import.meta.url);
const json = (p) => JSON.parse(readFileSync(at(p), "utf8"));
const raws = new Map(json("data/ideas.json").map((i) => [i.id, i]));
const ext = json("out/extractions.json");
const table = json("data/skills.json");
const profile = json("data/profile.json");
const proposed = json("out/proposed.json");

const ME = "88976eb5-378e-422c-8676-2bf99a9ac01e";   // the test user
const MARA = "a1a1a1a1-0000-4000-8000-000000000001";
const THEO = "a1a1a1a1-0000-4000-8000-000000000002";
const GROUP = "b2b2b2b2-0000-4000-8000-000000000001";
const idOf = (n) => `c3c3c3c3-0000-4000-8000-${String(n).padStart(12, "0")}`;

// slug, owner, days after 2026-09-12, and what happened to it since
const PICK = [
  ["knob", ME, 0, { shared: true }],
  ["todo", ME, 2],
  ["screws", ME, 4],
  ["blender-any", ME, 6],
  ["coaster", ME, 9],
  ["fishtank", ME, 13],
  ["golf-mount", ME, 17, { built: 40 }],
  ["pokemon-bin", ME, 21],
  ["gridfinity", ME, 26],
  ["gacha", ME, 30, { dropped: 44, reason: "Not the kind of thing I want to spend evenings on." }],
  ["ledger", ME, 36],
  ["dryer", ME, 42],
  ["printed", ME, 47, { pending: true }],
  ["gundam", MARA, 33, { shared: true }],
  // appended, so the ids above stay put: a second question (the batch form)
  // and an extraction that ran and failed (a dead key)
  ["rc-truck", ME, 50],
  ["birds", ME, 52, { failed: true }]
];
const day = (d, h = 20) => new Date(Date.UTC(2026, 8, 12 + d, h, 14)).toISOString();

const ideas = [], caps = [], runs = [];
const ids = new Map();
PICK.forEach(([slug, owner, d, o = {}], n) => {
  const id = idOf(n + 1);
  ids.set(slug, id);
  const r = raws.get(slug);
  const x = ext[slug];
  const pending = !!o.pending || !!o.failed;   // either way, no result on the row
  ideas.push({
    id, user_id: owner, raw: r.raw, clarification: r.clarification ?? null,
    objective: pending ? null : x.objective, domain: pending ? null : x.domain,
    is_clear: pending ? null : x.clear, clarifying_question: pending ? null : x.clarifying_question,
    assumption: pending ? null : x.assumption ?? null,
    status: o.failed ? "failed" : pending ? "pending" : "extracted",
    shared_to: o.shared ? GROUP : null, image_path: null,
    source_url: slug === "gridfinity" ? "https://gridfinity.xyz/" : null,
    created_at: day(d),
    built_at: o.built ? day(o.built, 18) : null,
    dropped_at: o.dropped ? day(o.dropped, 18) : null,
    drop_reason: o.reason ?? null, duplicate_of: null
  });
  const run = { id: `d4d4d4d4-0000-4000-8000-${String(n + 1).padStart(12, "0")}`, idea_id: id,
    created_at: new Date(Date.parse(day(d)) + 9000).toISOString(),
    model: "claude-sonnet-5", prompt_hash: "b6a035830560", error: null, clear: x.clear };
  if (o.failed) runs.push({ ...run, error: "401 invalid x-api-key", clear: null });
  if (pending) return;
  runs.push(run);
  // the database keeps one crux (cruxOf in distance.js keeps the first)
  let crux = false;
  x.capabilities.forEach((c, k) => {
    const isCrux = c.is_crux && !crux;
    if (isCrux) crux = true;
    const known = c.skill_id && table.some((s) => s.id === c.skill_id);
    caps.push({
      id: `e5e5e5e5-${String(n + 1).padStart(4, "0")}-4000-8000-${String(k + 1).padStart(12, "0")}`,
      idea_id: id, skill_id: known ? c.skill_id : null, proposed_key: known ? null : c.proposed_name,
      reason: c.reason, crux_rank: isCrux ? 1 : null,
      resolved: known ? c.resolved : "new", resolved_from: known ? null : c.proposed_name,
      resolve_why: null, iteration: c.iteration ?? null
    });
  });
});

const skills = table.map((s, i) => ({ id: s.id, name: s.name, domain: s.domain, aliases: s.aliases ?? [], hazard: !!s.hazard, sort_order: i + 1 }));
const user_skills = [
  ...Object.entries(profile.skills).map(([skill_id, level]) => ({ user_id: ME, skill_id, level })),
  ...["bldc-foc", "pid-tuning", "magnetic-encoder", "servo-control"].map((skill_id) => ({ user_id: MARA, skill_id, level: "solid" })),
  { user_id: MARA, skill_id: "blender-modeling", level: "some" },
  ...["print-tolerancing", "parametric-cad", "print-joinery"].map((skill_id) => ({ user_id: THEO, skill_id, level: "solid" }))
].filter((r) => skills.some((s) => s.id === r.skill_id));

const proposed_skills = Object.entries(proposed).map(([key, p], i) => ({
  key, names: p.names, reasons: p.reasons, idea_ids: p.ideas.map((s) => ids.get(s)).filter(Boolean),
  run_count: p.runs?.length ?? 1, crux_count: p.crux_count ?? 0,
  rejected: p.rejected ?? null, promoted: p.promoted ?? null, created_at: day(i * 3)
}));

const fixture = {
  _note: "Generated by tools/shots/make-fixture.mjs. Fake rows for the screenshot tool; never applied to a database.",
  me: ME,
  session: { user: { id: ME, email: "test@clouded.dev" }, access_token: "fake", token_type: "bearer" },
  profiles: [
    { user_id: ME, display_name: "brian" },
    { user_id: MARA, display_name: "Mara" },
    { user_id: THEO, display_name: "Theo" }
  ],
  groups: [{ id: GROUP, name: "Workbench", created_by: ME }],
  group_members: [
    { group_id: GROUP, user_id: ME, added_at: day(1) },
    { group_id: GROUP, user_id: MARA, added_at: day(3) },
    { group_id: GROUP, user_id: THEO, added_at: day(8) }
  ],
  group_invites: [{ group_id: GROUP, email: "sam@example.com", created_at: day(50) }],
  ideas, idea_capabilities: caps, extraction_runs: runs, skills, user_skills,
  idea_claims: [{ idea_id: ids.get("knob"), user_id: MARA, created_at: day(5) }],
  curators: [ME],
  proposed_skills,
  feedback: [
    { id: "f6f6f6f6-0000-4000-8000-000000000001", kind: "bug", title: "Answer box loses focus after sending", github_issue_number: 41, github_error: null, created_at: day(45) },
    { id: "f6f6f6f6-0000-4000-8000-000000000002", kind: "improvement", title: "Show which friend holds a skill on the card", github_issue_number: null, github_error: null, created_at: day(52) }
  ]
};

writeFileSync(new URL("fixture.json", import.meta.url), JSON.stringify(fixture, null, 1) + "\n");
console.log(`fixture.json: ${ideas.length} ideas, ${caps.length} capabilities, ${skills.length} skills`);
