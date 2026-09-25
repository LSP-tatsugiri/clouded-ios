// Dictation for the capture box: speak an idea instead of typing it.
//
// The engine is the browser's own SpeechRecognition (webkitSpeechRecognition in
// Chrome, Edge and Safari; Firefox has none, and there the button is simply not
// drawn). It streams the audio to the browser's own vendor to transcribe, which
// cuts against "ideas are private by default" — so the box says so in a line
// under the mic, the way it already states the extraction cost, and nothing is
// recorded until the button is pressed. Chosen by the owner on 2026-09-25 over a
// paid transcription API and an on-device-only engine; all three are weighed in
// docs/handoff-2026-09-25-speech.md.

import { el } from "./dom.js";

const Engine = window.SpeechRecognition ?? window.webkitSpeechRecognition;

export const canDictate = () => !!Engine;

// What the user is told before they press, and what replaces it while the mic
// is live. The disclosure is the point of the first one: say where the audio
// goes while there is still time not to speak.
const DISCLOSURE = "mic: your browser transcribes the audio on its own servers, not clouded's";
const LISTENING = "listening — press the mic again to stop";

// Keyed by code, not err.message: Chrome leaves the message empty.
const TROUBLE = {
  "not-allowed": "Microphone blocked. Allow it for this site, then press the mic again.",
  "service-not-allowed": "This browser would not start its speech service. Type the idea instead.",
  "audio-capture": "No microphone found.",
  network: "The browser's speech service could not be reached. Type the idea instead."
};

// el() cannot make namespaced SVG elements, so the glyph is static markup, the
// same trick brandMark() uses in app.js. currentColor, so the on state inverts.
function micGlyph() {
  const t = document.createElement("template");
  t.innerHTML =
    `<svg class="mic-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/>` +
    `<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`;
  return t.content.firstElementChild;
}

// Collapse what the engine hands back to single spaces. It returns chunks with
// leading spaces, and joining them raw doubles up.
const tidy = (s) => s.replace(/\s+/g, " ").trimStart();

// Returns the two elements the capture box mounts and a stop() for its submit
// handler. Build it once per session, like searchBox in app.js: render()
// repaints the list every 2 s while an idea extracts, and a rebuilt button
// would drop a recognition already running.
export function dictation(target) {
  const note = el("p", { class: "mic-note" }, DISCLOSURE);
  const button = el("button", {
    type: "button", class: "mic",
    onclick: () => (rec ? stop() : start())
  }, micGlyph());

  let rec = null;        // the live recogniser; null means idle
  let opened = "";       // the box exactly as the mic found it
  let base = "";         // the same, with the space the dictation is added onto
  let settled = "";      // transcripts the engine has called final
  let written = "";      // the value the box last held with our knowledge
  let trouble = false;   // an error line is showing and should survive the stop

  // Never overwrite an edit we did not make: if the value has moved since we
  // last saw it, the user typed or the form was submitted, and they win. Both
  // happen after the engine has been told to stop but before it says it has,
  // so the check has to hold at the very end too. The dispatched event is what
  // calls grow() — the textarea's own oninput.
  const write = (text) => {
    if (target.value !== written) return false;
    target.value = text;
    written = text;
    target.dispatchEvent(new Event("input"));
    return true;
  };

  const say = (text, bad = false) => {
    note.textContent = text;
    note.classList.toggle("bad", bad);
  };

  const setOn = (on) => {
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
    const label = on ? "Stop dictating" : "Dictate the idea";
    button.setAttribute("aria-label", label);
    button.title = label;
  };
  setOn(false);

  function start() {
    rec = new Engine();
    rec.continuous = true;      // a whole idea, not one phrase
    rec.interimResults = true;  // so the words appear while they are said
    rec.lang = document.documentElement.lang || navigator.language || "en";
    // dictate onto the end of whatever is already typed, with one space
    opened = target.value;
    base = opened.trim() ? `${opened.replace(/\s+$/, "")} ` : "";
    settled = "";
    written = opened;
    trouble = false;

    rec.onresult = (e) => {
      if (!button.isConnected) return stop();   // navigated off the list mid-sentence
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) settled += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (!write(base + tidy(settled + interim))) stop();
    };
    // no-speech and aborted are how a normal stop reads; they are not problems
    rec.onerror = (e) => {
      if (e.error === "aborted" || e.error === "no-speech") return;
      trouble = true;
      say(TROUBLE[e.error] ?? "Dictation stopped.", true);
    };
    rec.onend = () => {
      rec = null;
      // drop a trailing interim guess; a pass that heard nothing leaves the
      // box exactly as it found it, rather than adding base's trailing space
      write(settled ? base + tidy(settled) : opened);
      setOn(false);
      if (!trouble) say(DISCLOSURE);
      if (button.isConnected) target.focus();
    };

    try { rec.start(); } catch { rec = null; return; }   // already running
    setOn(true);
    say(LISTENING);
  }

  function stop() {
    const r = rec;
    if (!r) return;
    try { r.stop(); } catch { r.onend(); }   // onend does the cleanup either way
  }

  // Typing under a live dictation would fight it, and the two would interleave
  // mid-word. The keystroke wins; assigning .value does not fire this.
  target.addEventListener("beforeinput", () => stop());

  return { button, note, stop };
}
