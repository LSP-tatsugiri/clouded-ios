// Run: node --test web/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { BANDS, VAGUE_LEADS, readBack } from "../lib/waifu.js";

const NAMES = {
  "i2c-spi-io": "Read a sensor over I2C or SPI from a microcontroller",
  "ota-update": "OTA update a device in the field.",
  "rest-api": "Build a REST API with authentication"
};
const nameOf = (id) => NAMES[id] ?? id;
const cap = (skill_id, extra = {}) => ({ skill_id, proposed_key: null, crux_rank: null, ...extra });
const clear = (...capabilities) => ({ is_clear: true, clarifying_question: null, capabilities });

test("she reads the crux back as something to do, lower-cased", () => {
  const x = clear(cap("rest-api"), cap("i2c-spi-io", { crux_rank: 1 }));
  assert.equal(readBack(x, nameOf, "night"),
    "The hard part's having to read a sensor over I2C or SPI from a microcontroller, right?");
});

test("the runner-up (crux_rank 2) is never the one read back", () => {
  const x = clear(cap("i2c-spi-io", { crux_rank: 2 }), cap("rest-api", { crux_rank: 1 }));
  assert.equal(readBack(x, nameOf, "night"), "The hard part's having to build a REST API with authentication, right?");
});

test("a name that opens on an acronym keeps its capitals, and loses its full stop", () => {
  const x = clear(cap("ota-update", { crux_rank: 1 }));
  assert.equal(readBack(x, nameOf, "dawn"), "The hard part's having to OTA update a device in the field, right?");
});

test("a proposed crux is a slug, read back as a thing", () => {
  assert.equal(readBack(clear(cap(null, { proposed_key: "label-design", crux_rank: 1 })), nameOf, "dusk"),
    "The hard part's the label design, right?");
  // the committed baseline's spelling of the same row
  const baseline = { clear: true, capabilities: [{ skill_id: null, proposed_name: "motor-control", is_crux: true }] };
  assert.equal(readBack(baseline, nameOf, "dusk"), "The hard part's the motor control, right?");
});

test("a skill id the table does not know is read as a slug too", () => {
  const x = clear(cap("gone-skill", { crux_rank: 1 }));
  assert.equal(readBack(x, nameOf, "night"), "The hard part's the gone skill, right?");
  assert.equal(readBack(x, undefined, "night"), "The hard part's the gone skill, right?");
});

test("each band leads into the clarifying question in its own words", () => {
  const x = { is_clear: false, clarifying_question: " What is the 3D printed thing? ", capabilities: [] };
  assert.deepEqual(Object.keys(VAGUE_LEADS), BANDS);
  const lines = BANDS.map((b) => readBack(x, nameOf, b));
  BANDS.forEach((b, i) => assert.equal(lines[i], `${VAGUE_LEADS[b]} What is the 3D printed thing?`));
  assert.equal(new Set(lines).size, BANDS.length);
  // an unknown band still asks
  assert.equal(readBack(x, nameOf, "noon"), `${VAGUE_LEADS.night} What is the 3D printed thing?`);
});

test("nothing to say: no result, no crux, vague with no question", () => {
  assert.equal(readBack(null, nameOf, "night"), null);
  assert.equal(readBack({ is_clear: null, capabilities: [] }, nameOf, "night"), null);
  assert.equal(readBack(clear(cap("rest-api")), nameOf, "night"), null);
  assert.equal(readBack({ is_clear: false, clarifying_question: "  ", capabilities: [] }, nameOf, "night"), null);
  assert.equal(readBack({ is_clear: false, clarifying_question: null }, nameOf, "night"), null);
});

test("no line of hers carries a score or a time estimate", () => {
  const said = [...Object.values(VAGUE_LEADS), readBack(clear(cap("i2c-spi-io", { crux_rank: 1 })), nameOf, "night")];
  for (const s of said) assert.doesNotMatch(s, /\d\s*(%|\/\s*\d|min|hour|day|week|month)|score|rating/i);
});
