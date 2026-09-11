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
- [What's in this repo right now](#whats-in-this-repo-right-now)
- [Running the testbed](#running-the-testbed)
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

Once shared, the gap display gains its second half: **which friend already has
the capability you're missing.** A group of ten people has a much shorter
distance to most ideas than any one of them does. This is what makes the product
worth being an app rather than a notes file.

### Views

- **Closest to buildable** — the default, and the only one that matters at first.
- Filter by domain, by crux type, by whether a friend can unblock it.
- **Leverage ranking** — which single skill unlocks the most ideas.

## Scope

### In v1

- Share Extension capture: text, voice, image
- Offline-first local save with background upload
- Capability extraction with the clarifying-question path for empty entries
- Canonical skills table with human-confirmed merges
- Distance computation against your own profile
- One list sorted by closest-to-buildable, filterable by domain
- Private-by-default sharing to the friend group
- Leverage ranking

### Deferred

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

Roughly 45 seed entries across six domains: fabrication, embedded, 3D animation,
software, gamedev, art, vision.

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

This repo is the **iOS app**. It is currently empty — that is deliberate, see
[Build order](#build-order): capture is built last, because what an entry stores
and what the list shows both fall out of what extraction actually produces.

The extraction pipeline lives in [`extraction/`](extraction) — a standalone Node
script with no dependencies. It is the part of the product that had to be proven
before anything was built around it, and it is where prompt work still happens:

| Path | What it is |
|---|---|
| `extraction/data/ideas.json` | The raw backlog — 19 real ideas, verbatim, typos included. That is the true input shape. |
| `extraction/data/skills.json` | The canonical skill table, ~45 hand-written entries. |
| `extraction/data/profile.json` | Your own skill levels. A wrong profile makes every distance wrong. |
| `extraction/src/extract.js` | The system prompt and the API call. The product is in this file. |
| `extraction/src/distance.js` | Capability + profile → gap classification. |
| `extraction/src/index.js` | Runs everything, prints the report. |
| `extraction/schema.sql` | The target Postgres schema with RLS policies. |

### Running the extraction testbed

Requires Node 20+. No dependencies.

```bash
cd extraction
cp .env.example .env     # add your Anthropic API key (console.anthropic.com)
npm start                # uses cache where available
npm run fresh            # re-extract everything after a prompt change
```

Output has three sections: every idea closest-to-buildable first with each
capability marked `[x]` held · `[~]` partial · `[ ]` gap · `[?]` proposed and the
crux flagged; the entries too vague to extract, with the question the app should
ask; and the leverage ranking.

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

From the first real run against the 19-idea backlog:

**Extraction quality is good.** On ideas with actual content, the capabilities
came out specific and checkable, and the crux identification was correct —
closed-loop BLDC control for the haptic knob, mechanical singulation for the
screw dispenser, on-device vision for the tracking Gundam head. These match a
hand analysis done independently.

**The clustering produces a real answer.** Parametric CAD appeared in every
extracted idea and is the single bottleneck across the backlog: the golf-bag
mount, the Gridfinity organizer, and the Pokémon storage bin reduce to the *same
three capabilities* (parametric CAD, tolerance fitting, material choice), and CAD
also gates the screw dispenser and the Gundam head. One weekend learning
Fusion or OnShape moves the most ideas of any single skill.

**The vagueness rule over-triggered.** The first prompt marked 15 of 19 entries
as too vague to extract, including several that are clearly extractable
("shower body dryer", "gridfinity tool cutout organizer"). Fixed by inverting the
default: extract unless the entry names no object *and* no action. Terse is not
vague.

**Proposed skills are appearing at a low rate** (3 across 4 extractions), which
is the healthy signal — the canonical table is mostly winning.

## Build order

1. ~~Extraction script against real ideas~~ ← **you are here**
2. Tune the prompt until capabilities are consistently checkable
3. Hand-curate the skills table from what the extractions produce
4. Supabase schema + the pipeline as an edge function
5. Web list view — sorted, filterable
6. iOS capture app + Share Extension
7. Sharing and the friend skill pool
8. *(later)* graph view, roadmaps, starter kits

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

**Wrong blocker.** This app assumes ideas die from missing knowledge. If they
actually die from missing *time*, then "learn these two things" is accurate but
useless, and what's needed is a prioritizer, not a tutor. Worth settling early.

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
