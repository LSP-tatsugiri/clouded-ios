# Design review and positioning

Written 2026-09-11, from a review of `README.md` against the code in
`extraction/`. Two parts: what the review found, and the answers to the two
questions friends asked about why this should exist at all.

---

## Part 1 — README review

**Verdict: worth building.** Proving extraction with a script before building an
app, measuring distance instead of giving a score, using a closed skill list,
never overwriting raw input, and running extraction server-side are all the right
calls. The concerns are about what the core number measures and how strong the
evidence is so far.

### 1. The problem and the metric measure different things

The problem described is size: a weekend project vs a six-month one. Distance
measures the skill gap, which is a different axis. A distributed job scheduler,
for someone who already knows distributed systems, has distance 0 and still takes
six months.

Every gap also counts 1, and each idea is capped at 3–7 capabilities. So "pick
PETG for heat" weighs the same as "mechanical singulation of small fasteners",
and the screw dispenser (4 short) and the golf mount (2 short) look closer
together than they are.

Fix: sort by crux status first (held / partial / gap), then by gap count. Add a
per-capability flag for whether it can be learned from a tutorial or needs real
trial and error.

### 2. The CAD result may be partly an artifact of the taxonomy

`skills.json` has 15 embedded skills but only 6 fabrication skills, and the
prompt says to map "even loosely — reuse beats precision". Broad skills pick up
more ideas, so they win the leverage ranking automatically, while embedded work
is split 15 ways and can't.

The low proposed-skill rate (3 in 4) is forced by the prompt, not proof the table
is good. The failure mode moves from skills fragmenting to unrelated skills being
merged, which is just as silent.

The table was also written with this backlog in mind, and the README's own exit
criterion — "the ranking tells you something you didn't know" — isn't met yet,
since about 8 ideas were already known to be CAD.

Tests: run ideas the table wasn't written around; split `parametric-cad` into
2–3 skills and see whether the ranking changes.

### 3. The evidence is thin

The script findings come from 4 extractions, and there is no saved output (`out/`
is gitignored). Re-run all 19. Screenshots, described as the main input, are
untested — `extract.js` only handles text. Try about 10 real ones before
designing capture.

### 4. v1 is too big

Share Extension, voice, images, offline-first sync, a proposed-skill review UI,
sharing, and the leverage ranking. Offline sync alone is its own project. For ~10
users, an iOS Shortcut in the share sheet posting to a Supabase edge function
covers capture without a Swift app.

### 5. The friend pool has the hardest cold start

It needs ~10 people to fill out 47-skill profiles, and the README already
predicts nobody maintains a profile. Build profiles from claims instead ("I can
do this" on a shared idea). Marking an idea as built should promote its
capabilities in your own profile — that keeps profiles current and gives the app
a signal when a project finishes.

### 6. Schema security

See the list in `CLAUDE.md`. Shared ideas and all skill profiles are currently
world-readable to anyone holding the anon key, which contradicts the
"never strangers" non-goal.

### Suggested order

1. Re-run all 19 ideas, plus screenshots.
2. Held-out idea test and the CAD-split test.
3. Crux-first sort.
4. Then the Supabase schema, with the RLS fixes.

---

## Part 2 — "Why not just use an LLM?"

A chat can do the analysis. Paste 19 ideas and a skill profile into Claude and
ask what to learn and which skill unlocks the most, and the answer is decent. The
model does the hard part in both cases; clouded is a wrapper around the same
extraction. So the difference is not the analysis. It is what accumulates:

1. **Consistency over months.** Ask in March and again in June and you get "CAD",
   then "3D modeling", then "enclosure design". The shared skill list and the
   leverage ranking only work if names stay fixed. A chat returns prose that
   varies; the app returns data you can count.
2. **It knows what friends can do.** A chat has no idea one friend has done motor
   control and another knows Blender. "Which friend can unblock this" needs
   everyone's skills in one place. No individual's chat has that.
3. **It updates itself.** In a chat you must re-paste and re-ask. In the app,
   each new idea updates the ranking, and finishing a project moves every other
   idea's distance.
4. **Capture.** A chat is somewhere you go to think. The app is where an idea
   lands in two taps from a screenshot at 1am.

Honest weak spot: 1 and 3 only matter at volume, and 2 only matters if friends
actually use it. At 19 ideas and one user, a chat is good enough. That is the
volume risk in another form.

**How to settle it:** paste the 19 ideas and `profile.json` into a fresh chat,
ask for the same output, and compare it with the script. Then do it again in a
second fresh chat and see whether the skill names and ranking hold. If a single
chat matches and stays stable, the evaluation half is not the differentiator and
the effort belongs in capture and the friend pool.

## Part 3 — "Why not Notion plus Claude Code?"

Notion plus Claude closes most of the gaps above: an Ideas table related to a
Skills table gives persistent structured data and mostly-consistent names, a
shared workspace covers friends, and Notion's mobile app captures from the share
sheet. For a technical person that is a real substitute.

clouded doesn't do anything that setup can't. What it offers is less effort, in
specific places:

1. **It runs by itself.** With Notion plus Claude Code, nothing is analyzed until
   you sit down and run it, so it gets batched and goes stale. Automating it
   means Notion automations plus a script — building the pipeline anyway, on
   someone else's database.
2. **Friends set nothing up.** Each would need a Notion account, workspace
   access, their own Claude subscription and connector, and the conventions. Most
   won't. The app uses one server-side key and a friend just installs it.
3. **Rules are enforced, not agreed on.** "Pick from the closed list, never
   create a skill, a human confirms merges" is a convention in Notion and a
   constraint in the app — and cross-person skill consistency is what the friend
   matching depends on.
4. **Private by default with one-tap sharing.** Notion's per-page permissions are
   clunky for dumping a half-formed idea privately and sharing it later.
5. **Purpose-built views.** "Closest to buildable", "which friend can unblock
   this", and group-wide leverage are awkward as rollups and harder across
   several people.

All five are about convenience and adoption, not capability. That is fine for a
tool for one person and ~10 friends, but it should be said out loud.

**Suggested test, in the spirit of "prove the core first":** build the prototype
in Notion. Ideas and Skills databases, the extraction prompt as a Claude
instruction, 3–4 friends, one month.

- If friends add ideas and use "who can unblock this", the riskiest part (volume
  and the friend pool) is validated, and you know which frictions the real app
  must remove.
- If they don't, a nicer app probably wouldn't have fixed that, and you've saved
  building an iOS app, Supabase, and sync.

There is also a reason to build it that has nothing to do with Notion: building a
SwiftUI app on Supabase with a real model pipeline is worthwhile experience on
its own. That's a fine reason, as long as it's named as the reason.
