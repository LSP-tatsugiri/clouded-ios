# clouded

**An idea database that tells you how far each idea is from something you could actually build.**

Status: pre-build. The extraction pipeline — the part that has to work before the
rest is worth writing — exists as a script in this repo and runs against a real
19-idea backlog. No app yet, on purpose.

---

## Table of contents

- [The problem](#the-problem)
- [The core idea: a distance, not a score](#the-core-idea-a-distance-not-a-score)
- [How the system works](#how-the-system-works)
- [Feature specification](#feature-specification)
- [Scope](#scope)
- [Architecture](#architecture)
- [Data model](#data-model)
- [The skill taxonomy](#the-skill-taxonomy)
- [Repository layout](#repository-layout)
- [Running the extraction testbed](#running-the-extraction-testbed)
- [Findings so far](#findings-so-far)
- [Build order](#build-order)
- [Known risks](#known-risks)
- [Decision log](#decision-log)
- [Non-goals](#non-goals)

---

## The problem

Everyone has a notes file full of one-line project ideas. The reason none of them
get built is not that they are badly organized — it is that they are
indistinguishable from each other.

> "smart mirror that shows my bus times"
> "distributed job scheduler"

These two lines look identical sitting next to each other. One is a weekend. One
is six months. Nothing in the note tells you which, so the list becomes a source
of guilt rather than a source of work.

Sorting by date doesn't help. Tagging doesn't help. Rating them out of ten
definitely doesn't help. The missing information is not *about the idea* — it's
about the distance between the idea and the person holding it.

## The core idea: a distance, not a score

The obvious version of this app asks an AI to rate ideas out of ten. That is a
dead end. A language model cannot tell a good idea from a bad one, so it rates
everything a 7, and you stop believing it by the second week. Worse, the first
time it rates a genuinely good idea a 4, you either lose trust in the tool or —
much worse — you trust it and drop the idea.

What a model **can** do reliably is read an idea and name the concrete
capabilities it would require. Match those against what you already know, and
what's left over is the only honest number in the system:

> **How far is this idea from me, right now?**

Everything else in the product exists to serve that number.

### Capabilities are checkable tasks, never depth labels

This is the single most important rule in the system.

| Bad | Good |
|---|---|
| "Intermediate CAD" | "Model a part parametrically from measured dimensions" |
| "Advanced embedded" | "Run closed-loop BLDC motor control with field-oriented control" |
| "Expert UX design" | "Run a usability test and turn the findings into a revised flow" |

A depth adjective has no ground truth. The model anchors it on how elaborately
you happened to describe the idea — write two sentences and get "Basic," write
two paragraphs about the same project and get "Advanced." A checkable task can be
answered yes or no without hedging, which means the distance built on top of it
means something.

### Learning compounds across ideas

Because capabilities are shared between ideas, the system can answer a question
no notes file can:

> Learn this one thing, and **four** of your ideas move closer at once.

That is the output the whole product exists to produce.

## How the system works

```
   capture  →  ingest  →  extract  →  resolve  →  compare  →  surface
   (phone)     (server)   (model)    (skills)   (profile)    (both)
```

1. **Capture** — text, voice, or an image, from the phone, in seconds. Saves
   locally and returns immediately; uploads whenever there's network.
2. **Ingest** — voice is transcribed, images are stored, the entry lands with
   status `pending`.
3. **Extract** — a vision-and-text pass pulls out the objective, the domain, and
   the concrete capabilities the idea requires. Terse entries get extracted with
   a stated assumption; entries with no object and no action (a bare category
   like "3d printed") get **one clarifying question** instead of a fabricated
   answer.
4. **Resolve** — each extracted capability is matched against a canonical skills
   table. Close matches link to the existing skill. Anything unmatched is filed
   as `proposed` for human review — never silently created.
5. **Compare** — required capabilities minus your skill profile. That difference
   is the distance.
6. **Surface** — pushed back to the phone, live on the web, sorted by
   closest-to-buildable.

## Feature specification

### Capture

Capture is the step that decides whether this app survives. Ideas arrive while
you're walking to class, not while you're at a laptop with a browser open.

- **Share Extension** — a screenshot goes from the screenshot preview straight
  into the app with a one-line note attached. Two taps. This is the highest-value
  capture surface, because screenshots are the majority of real inspiration.
- **Voice** — Action Button or lock-screen widget, transcribed server-side.
- **Text** — plain, with no required syntax. Any format requirement is friction,
  and friction at capture is where ideas die.
- **Mixed** — one entry can carry text, image, and audio together. Often a
  screenshot *is* the idea and one sentence of context is all it needs.
- **Offline-first** — writes locally and returns instantly, always. An idea lost
  because you were in a basement is the worst failure this product can have.
- **One-line minimum** — an image with no text is a bookmark, not an idea, and
  goes in a separate bucket so it doesn't pollute the skill analysis.

### Extraction

Structured output, enforced via a tool schema rather than free-text JSON:

```
{
  clear: boolean,
  clarifying_question: string | null,
  objective: string | null,
  domain: string | null,
  capabilities: [
    { skill_id, proposed_name, reason, is_crux }
  ]
}
```

- 3–7 capabilities per idea.
- Exactly one may be marked `is_crux` — the part most likely to kill the project.
  For the screw dispenser, the crux is mechanical singulation, not the database.
  Naming the crux is often more useful than the distance itself.
- The canonical skill list is passed **into** the prompt, so the model picks from
  a closed set rather than inventing names. Reuse beats precision here.

### Skill resolution

The canonical skills table is the spine of the system. Extracted capabilities are
matched to it by ID first, embedding similarity second, and anything left over
becomes a `proposed` skill requiring confirmation.

This is not an AI problem you can prompt your way out of. It needs a canonical
table, an alias map, similarity matching, and a human confirming merges.

### Distance

| Profile level | Meaning | Counts as |
|---|---|---|
| `solid` | you've done this | held |
| `some` | you could get there in an evening | half a gap |
| `none` / absent | you haven't | full gap |

`distance = gaps + (partials × 0.5)`

Deliberately simple. The ranking matters; the precision does not.

### Sharing

Ideas are **private by default**, with one tap to share to the friend group.

This ordering is not a privacy nicety — it's load-bearing. The product depends on
you dumping half-formed, slightly embarrassing thoughts at 1am, and nobody does
that into a feed their friends are already reading.

Sharing serves three purposes, in this order:

1. **Feedback.** A shared idea is something friends can react to and comment
   on — "this exists already", "I'd use this", "the hard part is X, not Y".
   The extraction gives you the machine's read; the group gives you the human
   one.
2. **Knowing what each other is thinking.** The group's shared ideas are a feed
   of what your friends are chewing on. Seeing what they're thinking is
   inspiration for your own ideas, and the reverse — half the point of sharing
   is sparking something in someone else.
3. **Skill matchmaking.** Once shared, the gap display gains its second half:
   **which friend already has the capability you're missing.** A group of ten
   people has a much shorter distance to most ideas than any one of them does.

The third is the one the data model does for free. The second landed with it
in Step 7 as the group feed, once the URL was live; the first, comments, comes
right after v1 (see [Deferred](#deferred)) because it needs a way for anyone
to notice a comment. All three are what make the product worth being an app
rather than a notes file.

### Views

- **Closest to buildable** — the default, and the only one that matters at first.
- Filter by domain, by crux type, by whether a friend can unblock it.
- **Leverage ranking** — which single skill unlocks the most ideas.
- **Group feed** — what friends have shared, newest first or closest to
  you, each idea measured against *your* profile with who in the group holds
  its crux. Read-mostly; this is the inspiration surface. Comments come later.

## Scope

### In v1

- Share Extension capture: text, voice, image
- Background upload that finishes when connectivity returns (a local queue
  was cut in Step 6; see `docs/step-6-plan.md` decision 2)
- Capability extraction with the clarifying-question path for empty entries
- Canonical skills table with human-confirmed merges
- Distance computation against your own profile
- One list sorted by closest-to-buildable, filterable by domain
- Private-by-default sharing to the friend group, invites by email, and
  the friend skill pool: which friend holds what a shared idea needs
- The group feed
- Leverage ranking

### Deferred

- **Comments on shared ideas** — the feedback half of sharing. The feed
  ships in v1 (Step 7); reacting to what is in it comes right after, once
  there is a way for anyone to notice a comment (there is no notification
  path at all today). Nothing in the data model has to change: comments are
  a new table keyed on `ideas.id`.
- **The idea web / graph view** — needs roughly 80 ideas before it means
  anything. With 12 ideas nothing connects and it looks broken; the edges should
  be *shared skills*, not thematic similarity, and that only gets interesting at
  volume. Build the skills as first-class rows now and the graph becomes a query
  later.
- Step-by-step roadmaps
- Generated starter kits (business canvas, boilerplate, wireframes)

### Cut

- **Numeric idea scores** — see above. A model can't rate ideas.
- **Market and trend checks** — "does this already exist" is a different product,
  and for a personal tool the answer rarely changes what you do.
- **Time estimates** — any "~2 weeks" this app prints is a lie. Estimates read as
  authoritative and are systematically wrong, so it never prints one.

## Architecture

Two clients, one managed backend.

| Surface | Role | Character |
|---|---|---|
| iPhone (SwiftUI) | capture & triage | fast, one-handed, mostly writing |
| Web | evaluation & planning | big screen, keyboard, mostly reading |
| Supabase | source of truth | Postgres, auth, storage, RLS |

Keeping that split honest is what stops every feature from being built twice.
**Build on the web first; port to the phone only what you actually reach for
while out.** Capture is the only part that is phone-first by nature.

### Why Supabase

1. **Row-level security expresses the sharing model once, in the database.**
   Both clients inherit it. Written in application code instead, the same
   permission logic gets implemented twice and is subtly wrong in one of them.
2. **pgvector is built in.** Near-duplicate detection and capability matching run
   in the same database as everything else.
3. **Server-side processing means the extraction prompt can be re-run over every
   idea ever captured.** This matters more than it sounds: the first month of
   prompts will be bad, and on-device processing would leave early ideas
   permanently stuck with the worst version.

### Why not a graph database, and why not a vector database

Both were considered and both are unnecessary.

- The "idea web" is a join table. `idea_capabilities` linking ideas to skills
  *is* the graph, and Postgres traverses it fine at this scale (hundreds of
  ideas, not millions).
- Vector search is one extension away in the same Postgres instance. A separate
  vector store would mean two systems to keep in sync for no benefit.

Adding either would be architecture as decoration.

## Data model

Full DDL in [`schema.sql`](schema.sql). The shape:

```sql
skills            -- canonical capability table, id is a slug
ideas             -- one row per captured thought, raw text preserved verbatim
idea_capabilities -- join table: which idea needs which skill (this is the graph)
user_skills       -- per-person profile: none | some | solid
```

Two decisions worth calling out:

- **Every row carries `user_id` from the first migration**, even though there is
  one user today. Retrofitting multi-tenancy is genuinely painful; adding the
  column now is free.
- **`ideas.raw` is never overwritten.** Extraction output lives alongside it, so
  re-running a better prompt never destroys what was actually captured.

## The skill taxonomy

51 entries across seven domains: fabrication, embedded, 3D animation, software,
gamedev, art, vision.

Rules for adding one:

1. **It must be a checkable task.** If you can't answer "can you do this?"
   without hedging, it's written wrong.
2. **It must be reusable.** A skill that appears in exactly one idea forever is
   noise. Prefer the general form.
3. **Aliases are mandatory.** `parametric-cad` also answers to "CAD", "3D
   modeling", "Fusion 360", "enclosure design". Without aliases the table
   fragments and the leverage ranking becomes meaningless.
4. **Proposed skills are reviewed, never auto-merged.** The model proposes; a
   human confirms.

Hazardous skills carry a `hazard` flag (e.g. `mains-safety`) so the UI can warn
rather than cheerfully suggesting you wire a heating element into a shower.

## Repository layout

The **iOS app** lives in [`ios/`](ios) — SwiftUI, a Share Extension, built
last on purpose (see [Build order](#build-order)): what an entry stores and
what the list shows both fell out of what extraction actually produces.
`docs/step-6-plan.md` records what it does and how it was verified.

The extraction pipeline lives in [`extraction/`](extraction) — a standalone Node
script with no dependencies. It is the part of the product that had to be proven
before anything was built around it, and it is where prompt work still happens:

| Path | What it is |
|---|---|
| `extraction/data/ideas.json` | The raw backlog — 19 real ideas, verbatim, typos included. That is the true input shape. An optional `clarification` field holds the answer to a clarifying question; `raw` is never edited. |
| `extraction/data/skills.json` | The canonical skill table, 51 hand-written entries. |
| `extraction/data/profile.json` | Your own skill levels. A wrong profile makes every distance wrong. |
| `extraction/src/extract.js` | The system prompt and the API call. The product is in this file. |
| `extraction/src/distance.js` | Capability + profile → gap classification. |
| `extraction/src/resolve.js` | Skill resolution: matches proposed capabilities to the table (lexical, then one semantic call), and keeps the proposal registry. |
| `extraction/src/stability.js` | Runs the same prompt N times and reports how much the crux and skill sets wobble. |
| `extraction/src/index.js` | Runs everything, prints the report. |
| `extraction/out/extractions.json` | Output of the last run, committed so a prompt change ships with its result. |
| `extraction/out/proposed.json` | The proposal registry: every unmatched concept, the names it was seen under, which ideas, how many runs, and its review outcome. |
| `extraction/schema.sql` | The target Postgres schema with RLS policies. |

### Running the extraction testbed

Requires Node 20+. No dependencies.

```bash
cd extraction
cp .env.example .env     # add your Anthropic API key (console.anthropic.com)
npm start                # uses cache; a prompt or skills-table change invalidates it
npm run fresh            # force re-extraction of everything
node --env-file=.env src/stability.js 3   # same prompt, 3 runs, how much does it wobble
```

Output has five sections: every idea closest-to-buildable first with each
capability marked `[x]` held · `[~]` partial · `[ ]` gap · `[?]` proposed and the
crux flagged; the entries too vague to extract, with the question the app should
ask; the leverage ranking; how each capability got its skill id (direct, lexical,
semantic); and the proposed skills due for review — only those seen for two or
more ideas, or in two or more runs.

Review a proposal by editing its entry in `out/proposed.json`: add
`"rejected": "<why>"` and it never surfaces again, or add the skill to
`skills.json` and set `"promoted": "<skill_id>"` so later matches resolve
straight to it.

### Re-running extraction in Supabase

The same pipeline runs as the `extract` edge function (`supabase/functions/`),
fired by a database webhook when an idea is inserted. `ideas.status` is one of
`pending`, `extracted`, `failed`, and every attempt leaves a row in
`extraction_runs` with either `output` or `error`. Nothing reads `status` back,
so a failed idea needs no reset — just run it again:

- **Direct call**, the normal way: POST to `/functions/v1/extract` with the
  `x-webhook-secret` header and body `{"idea_id": "<uuid>"}`. Works for any
  idea, mutates nothing, and is how the history re-run and Phase D acceptance
  drive the function.
- **Change `clarification`** on the row. This is the only UPDATE the function
  acts on; it ignores every other column, including its own status writes, so
  it cannot loop. Use it when there is a real clarification to add, since the
  text goes into the prompt.
- **Fresh insert** also works but leaves the failed row behind.

Setup, secrets and the webhook definition are in `docs/step-4-plan.md`, Phase C.

### Running the web client

[`web/`](web) is the list, the idea page and the profile page: plain ES
modules, no bundler, `@supabase/supabase-js` from a pinned CDN. It imports
`extraction/src/distance.js` directly, so there is one copy of the distance
logic; `web/serve.mjs` mounts `/extraction/src/` read-only to make that work.

```bash
cp web/config.example.js web/config.js   # project URL + anon key from supabase/.env
node web/serve.mjs                       # http://localhost:5173
```

Sign in with email and password. The acceptance checks behind the list are in
`supabase/scripts/acceptance.mjs` (`list` prints the reference order and
leverage ranking for a user; `rls` verifies who can see what); the decisions
and what each phase verified are in `docs/step-5-plan.md`.

### Running it hosted

The same files are served at https://clouded.monoesport.com from Vercel,
deploying on every push to `main`. `web/build.mjs` is the whole build: it
copies `extraction/src/distance.js` into `web/` (a static host has no mount)
and writes `config.js` from two environment variables, so no key is ever
in a tracked file. Friends create their own accounts from the sign-in card,
but only an invited email gets one:

```bash
node --env-file=supabase/.env supabase/scripts/allow.mjs friend@example.com
```

Setup, the DNS record, rollback and the reasoning are in `docs/hosting.md`.

### The development loop

Edit the prompt in `extraction/src/extract.js`, run `npm run fresh`, read the output, repeat.
Two things to watch:

- **Are the capabilities checkable?** If you cannot answer yes or no without
  hedging, the prompt needs work.
- **Do the same skill IDs recur across ideas?** If every idea invents new
  `[?]` proposed skills, the canonical table is losing and the leverage ranking
  is meaningless. This failure is silent and everything downstream depends on it.

Move on to building the app when the leverage ranking tells you something you
did not already know.

## Findings so far

From the full runs against the 19-idea backlog (September 2026):

**Extraction quality is good.** On ideas with actual content, the capabilities
came out specific and checkable, and the crux identification was correct —
closed-loop BLDC control for the haptic knob, mechanical singulation for the
screw dispenser, on-device vision for the tracking Gundam head. These match a
hand analysis done independently.

**The clustering produces a real answer.** Parametric CAD appears in 7 of 16
extracted ideas and is the single highest-leverage skill in the backlog: the
golf-bag mount, the Gridfinity organizer, and the Pokémon storage bin share it
with fit-to-measured-object and material choice, and CAD also gates the screw
dispenser, the dryer and the Gundam head. One weekend learning Fusion or OnShape
moves the most ideas of any single skill. Caveat: the ranking is biased by how
finely the table splits a domain — 15 embedded skills vs 7 fabrication — so a
broad skill wins partly by construction.

**The vagueness rule over-triggered.** The first prompt marked 15 of 19 entries
as too vague to extract, including several that are clearly extractable
("shower body dryer", "gridfinity tool cutout organizer"). Fixed by inverting the
default: extract unless the entry names no object *and* no action. Terse is not
vague. A second miss: "personal todo list app idea" was treated as vague because
it named no platform. Fixed by stating that missing *preferences* are never a
reason to ask — only a missing object is. 16 of 19 now extract; the three that
don't ("blender animation", "3d printed", "rc truck") genuinely name nothing.

**Terse entries get confidently misread.** "pcb coaster" was extracted as
decorative PCB art. It is a weight-sensing smart coaster. The objective sentence
stated the assumption, but nothing flagged it as a guess. Assumptions have to be
visible in the UI, not buried in prose — and the `clarification` field on
`ideas.json` is the testbed's stand-in for the user correcting it.

**Proposed skills were the main problem, not a healthy signal.** The first full
run produced 10 proposed skills across 15 ideas, and 4 cruxes landed on skills
the table didn't have. Across seven runs the model kept proposing the same ~8
concepts under a different name each time — "label design" got five slugs,
"fetch stock prices from an API" got four. Three of the eight were existing
skills it had failed to recognise. Aliases helped but did not force it. This is
what `src/resolve.js` exists for: lexical matching, then one closed-choice
semantic call (canonical id, previous proposal, or new), plus a registry that
counts concepts rather than names. After it, the last full run had 77
capabilities and zero new proposals; four table additions came out of the review
(`print-joinery`, `third-party-api`, `haptic-profiles`, `vibration-mount`).

**The crux is the least stable output.** Three fresh runs with the same prompt
agreed on the vague/clear verdict 19/19 and on skill sets about three-quarters of
the time, but on the crux only 13/19. Where two capabilities are both plausible
project-killers (airflow vs waterproofing for the dryer, mechanism vs vision for
the Gundam head), the model picks either. Until this is settled — a ranked top-2,
or majority-of-three — the UI should present the crux as *a* hard part, not
*the* hard part. Stability with the resolve step in place has not yet been
measured.

**A flat gap count is not size.** Every gap counts 1 and the model is capped at
3–7 capabilities, so "pick PETG for heat" weighs the same as "mechanical
singulation of small fasteners". The web list now sorts by crux status first
(held / partial / gap), then by gap count, which fixes the ordering the count
gets wrong; the count itself is still not a size.

## Build order

1. ~~Extraction script against real ideas~~
2. ~~Tune the prompt until capabilities are consistently checkable~~
3. ~~Hand-curate the skills table from what the extractions produce~~ (ongoing via the registry)
4. ~~Supabase schema + the pipeline as an edge function~~
5. ~~Web list view — sorted, filterable~~
6. ~~iOS capture app + Share Extension~~ (`docs/step-6-plan.md`)
7. ~~Sharing and the friend skill pool~~ (web; `docs/step-7-plan.md`)
8. *(later)* graph view, roadmaps, starter kits
9. *(later, unscheduled)* phone ports of sharing, the feed, the profile —
   only what use shows is reached for while out

Capture is built last despite being the most important feature, because
everything about it — what an entry stores, what the list shows, what a tap
reveals — falls out of what extraction actually produces. Build the phone UI
against a guess and you'll rebuild it.

## Known risks

**Skill identity resolution.** The model will write `React`, `React.js`, and
`frontend development` for the same capability across three ideas, and the skill
graph shatters into orphans. Nothing downstream works if this step doesn't, and
the failure is invisible — the app looks fine while producing a useless graph.
Budget more time for this than for the entire UI.

**Volume.** The design scales with idea count. Most people produce three or four
real ideas a month, which is ~35 after a year — a volume at which organization
isn't a problem a text file can't solve. If that's the case, the evaluation half
is the whole product and the sorting views can wait.

**Wrong blocker — settled (2026-09-13).** An earlier draft worried that ideas
die from missing *time* rather than missing knowledge, in which case a
prioritizer beats a tutor. The answer, from actual use: the first thing ideas
die of is never being written down. Inspiration arrives as a split-second
thought from something on the internet, in a conversation, or seen in passing,
and the failure is having nowhere frictionless to put it. So the primary job is
an *unclouded* capture workflow — see [Capture](#capture) — and the knowledge
gap is the secondary job: it has to be readable at a glance, because "what
would I need to learn" is what turns the backlog into a study list. Time
prioritization stays out of scope.

**Stale profiles.** Self-reported skill levels are wrong in both directions and
nobody maintains them. Long-term, the profile should be inferred from what people
actually build and confirm, not left as a form to fill in.

## Decision log

| Decision | Reasoning |
|---|---|
| Distance instead of a score | Models can't rate idea quality; they can enumerate requirements |
| Checkable tasks instead of depth labels | Adjectives have no ground truth and drift with prompt length |
| Closed skill list passed into the prompt | Free-text capability names fragment the graph silently |
| Proposed skills need human confirmation | The alternative is a table that grows garbage automatically |
| Private by default | Shared-by-default capture changes what people are willing to write |
| Sharing is for feedback and inspiration first, skill matching second | Skill matching falls out of the data model; feedback and seeing what friends are thinking are why anyone reads a shared idea. v1 scope unchanged — comments and feed follow v1 |
| Capture friction is the primary blocker, knowledge gap secondary | Ideas die first from not being written down; the gap-at-a-glance is what makes the backlog a study list |
| Graph view deferred | Meaningless below ~80 ideas; it's a query, not a subsystem |
| Postgres only — no graph or vector DB | A join table is the graph; pgvector is one extension away |
| `user_id` from day one | Retrofitting multi-tenancy is painful; the column is free now |
| Server-side extraction | So a better prompt can be re-run over the whole history |
| Web before iOS | Faster iteration, and capture's design depends on extraction's output |
| Script before app | The core had to be proven before anything was built around it |

## Non-goals

- Not a startup. No growth, revenue, or public users.
- Not a note-taking app. It does not want to be your second brain.
- Not a project manager. It ends where work begins.
- Not a social network. Sharing is opt-in, among people who already know each other.
