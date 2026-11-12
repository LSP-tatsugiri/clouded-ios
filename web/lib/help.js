// The copy of the help page (#/help; helpView() in app.js lays it out).
//
// Kept apart from the markup so the wording can be edited without reading
// any DOM code. The claims here are the ones CLAUDE.md makes under "Known
// problems": distance is a flat count, so it is not a size and not a time
// estimate, and the leverage ranking is biased by how the skill table is
// split. No number about an idea appears here beyond those counts.
// web/test/help.test.mjs holds it to that.

// `kind` is the key of MARK in app.js, so the page prints the same glyph and
// colour the lists do.
export const MARKS = [
  { kind: "have", name: "held", text: "You rated this skill solid. It is not in your way." },
  { kind: "partial", name: "partial", text: "You rated it some. You have done a bit of this, and it counts as half a gap." },
  { kind: "gap", name: "short", text: "You rated it none, or have not rated it yet. Both count as one gap." },
  { kind: "proposed", name: "proposed", text: "The idea needs something that is not in the skill table yet. A person has to add it before it can be rated; until then it counts as one gap." },
  { kind: "friend", name: "a friend holds it", text: "On a shared idea: someone in your group rated a skill it needs solid (some does not count), or said “I can do a hard part”, which is their word, not a rating." }
];

// Each section is a heading and its paragraphs, in page order.
export const SECTIONS = [
  {
    title: "A hard part",
    body: [
      "Every idea has one capability marked a hard part, shown first with a red band: the one most likely to stop the project.",
      "The model picks it when it reads the idea, and it is sometimes wrong. If another line looks harder to you, believe yourself."
    ]
  },
  {
    title: "Distance",
    body: [
      "Distance is a count: how many of the capabilities an idea needs you do not hold yet. A skill rated solid counts nothing, some counts half, none or unrated counts one.",
      "Closer means that count went down, which happens when you raise a rating. Closest to me puts the ideas whose hard part you already hold first, then the ones with the fewest gaps."
    ]
  },
  {
    title: "What distance is not",
    body: [
      "It is not a size. An easy capability and a very hard one each count one, so a small project and a long one can show the same distance.",
      "A capability tagged needs iteration is one no existing guide walks you through, so it takes real trial and error on this project; distance still counts it one, like any other.",
      "It is not a time estimate. Nothing here says how long anything takes, because nothing here knows.",
      "And it does not settle what to learn next. In Highest leverage, a lead of one or two ideas is a tie: broadly worded skills collect more ideas just by being broad."
    ]
  }
];
