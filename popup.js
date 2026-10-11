// Peekword popup.
// Reads the text selected on the active tab, looks it up, and shows the entry.

const DICTIONARY_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const WIKTIONARY_API = "https://en.wiktionary.org/api/rest_v1/page/definition/";
const MAX_WORD_LENGTH = 60;
// Longer words get a smaller heading so they stay on one line beside the two voice buttons.
const LONG_WORD_LENGTH = 11;
const LONGER_WORD_LENGTH = 15;
const MAX_SENSES = 10; // meanings the reader can step through
const MAX_SENSES_PER_POS = 3; // per part of speech, so nouns and verbs both appear
const DICTIONARY_TIMEOUT_MS = 4000; // short, so a down service falls through to Wiktionary quickly
const WIKTIONARY_TIMEOUT_MS = 8000;

const $ = (id) => document.getElementById(id);

const els = {
  result: $("result"),
  word: $("word"),
  sub: $("sub"),
  meta: $("meta"),
  pos: $("part-of-speech"),
  phonetic: $("phonetic"),
  meaning: $("meaning"),
  example: $("example"),
  voice: $("voice"),
  listenBtn: $("listenBtn"),
  slowBtn: $("slowBtn"),
  pager: $("pager"),
  pagerLabel: $("pagerLabel"),
  prevBtn: $("prevBtn"),
  nextBtn: $("nextBtn"),
  credit: $("credit"),
  creditLink: $("creditLink"),
  status: $("status"),
  statusTitle: $("statusTitle"),
  statusText: $("statusText"),
  form: $("searchForm"),
  input: $("searchInput"),
};

// Page selection -------------------------------------------------------

// Runs inside the page, so it must be self-contained.
function readSelectionInPage() {
  const selected = String(window.getSelection() || "").trim();
  if (selected) return selected;

  // Text selected inside an input or textarea is not part of the page selection.
  const el = document.activeElement;
  try {
    if (el && typeof el.selectionStart === "number" && el.selectionEnd > el.selectionStart) {
      return el.value.slice(el.selectionStart, el.selectionEnd).trim();
    }
  } catch {
    // Some input types do not expose a selection.
  }
  return "";
}

async function readPageSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return "";

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: readSelectionInPage,
  });

  const hit = results.find((r) => typeof r.result === "string" && r.result.trim());
  return hit ? hit.result : "";
}

// Drops surrounding quotes and punctuation, so “word,” becomes word.
function cleanWord(raw) {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

// Dictionary data -----------------------------------------------------

function formatPhonetic(raw) {
  const text = (raw || "").replace(/^\/+|\/+$/g, "").trim();
  return text ? `/${text}/` : "";
}

// An entry is { source, word, phonetic, senses: [{ partOfSpeech, meaning, example }] }.
// Per-part-of-speech limits stop one busy verb from crowding out the noun senses.
function limitSenses(perPartOfSpeech) {
  return perPartOfSpeech.flatMap((group) => group.slice(0, MAX_SENSES_PER_POS)).slice(0, MAX_SENSES);
}

function pickDictionaryEntry(data) {
  if (!Array.isArray(data) || !data.length) return null;

  const groups = [];
  for (const entry of data) {
    for (const meaning of entry.meanings || []) {
      groups.push(
        (meaning.definitions || [])
          .filter((d) => d.definition)
          .map((d) => ({
            partOfSpeech: meaning.partOfSpeech || "",
            meaning: d.definition,
            example: d.example || "",
          })),
      );
    }
  }

  const senses = limitSenses(groups);
  if (!senses.length) return null;

  const phonetic =
    data.map((e) => e.phonetic || (e.phonetics || []).map((p) => p.text).find(Boolean)).find(Boolean) || "";

  return {
    source: "dictionaryapi",
    word: data[0].word,
    phonetic: formatPhonetic(phonetic),
    senses,
  };
}

// Wiktionary returns definitions as HTML, so reduce them to plain text.
function plainText(node) {
  const copy = node.cloneNode(true);
  // Nested sub-senses and footnote marks are not part of the headline meaning.
  copy.querySelectorAll("ol, ul, sup, style").forEach((n) => n.remove());
  return copy.textContent.replace(/\s+/g, " ").trim();
}

function definitionText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = plainText(doc.body);
  if (text) return text;

  // Some entries are only a list of senses; use the first one.
  const firstSense = doc.querySelector("li");
  return firstSense ? plainText(firstSense) : "";
}

function pickWiktionaryEntry(word, data) {
  const sections = data && Array.isArray(data.en) ? data.en : [];

  const groups = sections.map((section) => {
    const partOfSpeech = (section.partOfSpeech || "").toLowerCase();
    return (section.definitions || [])
      .map((d) => {
        const withExample = (d.parsedExamples || []).find((e) => e.example);
        return {
          partOfSpeech,
          meaning: definitionText(d.definition || ""),
          example: withExample ? definitionText(withExample.example) : "",
        };
      })
      .filter((sense) => sense.meaning);
  });

  const senses = limitSenses(groups);
  if (!senses.length) return null;

  return {
    source: "wiktionary",
    word,
    phonetic: "", // Wiktionary's definition endpoint has no pronunciation text
    senses,
  };
}

// Pronunciation -------------------------------------------------------

const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
const NORMAL_RATE = 0.85; // already a touch slow, easier for learners to catch
const SLOW_RATE = 0.5;
let speaking = null; // { utterance, button } for what is being spoken right now

function pickVoice() {
  const voices = synth.getVoices();
  return (
    voices.find((v) => v.lang === "en-US" && v.localService) ||
    voices.find((v) => v.lang === "en-US") ||
    voices.find((v) => v.lang.startsWith("en")) ||
    null
  );
}

// Marks which button is playing (or none), so only that one looks active.
function markSpeaking(button) {
  for (const btn of [els.listenBtn, els.slowBtn]) {
    const on = btn === button;
    btn.classList.toggle("is-speaking", on);
    btn.setAttribute("aria-pressed", String(on));
  }
}

function stopSpeech() {
  if (!synth) return;
  speaking = null;
  synth.cancel();
  markSpeaking(null);
}

// Each button plays the word at its own speed. Pressing the one that is
// playing stops it; pressing the other switches to that speed.
function speak(button, rate) {
  if (!synth || !current.entry) return;

  const wasThisButton = speaking !== null && speaking.button === button;
  stopSpeech();
  if (wasThisButton) return;

  const utterance = new SpeechSynthesisUtterance(current.entry.word);
  utterance.lang = "en-US";
  utterance.rate = rate;
  const voice = pickVoice();
  if (voice) utterance.voice = voice;

  const done = () => {
    // A stale utterance must not switch off a newer one.
    if (speaking !== null && speaking.utterance === utterance) {
      speaking = null;
      markSpeaking(null);
    }
  };
  utterance.onend = done;
  utterance.onerror = done;

  speaking = { utterance, button };
  markSpeaking(button);
  synth.speak(utterance);
}

// Rendering -----------------------------------------------------------

function setVisible(el, visible) {
  el.hidden = !visible;
}

// The entry on screen and which of its meanings is showing.
let current = { entry: null, index: 0 };

function renderSense() {
  const { entry, index } = current;
  const sense = entry.senses[index];

  els.pos.textContent = sense.partOfSpeech;
  els.meaning.textContent = sense.meaning;
  els.example.textContent = sense.example ? `“${sense.example}”` : "";

  setVisible(els.pos, Boolean(sense.partOfSpeech));
  setVisible(els.meta, Boolean(sense.partOfSpeech || entry.phonetic));
  setVisible(els.example, Boolean(sense.example));

  const many = entry.senses.length > 1;
  setVisible(els.pager, many);
  // The row only exists when it has something to hold.
  setVisible(els.sub, Boolean(sense.partOfSpeech || entry.phonetic || many));
  els.pagerLabel.textContent = `${index + 1} of ${entry.senses.length}`;
}

function stepSense(delta) {
  if (!current.entry) return;
  const count = current.entry.senses.length;
  current.index = (current.index + delta + count) % count;
  renderSense();
}

function showResult(entry) {
  stopSpeech();
  current = { entry, index: 0 };

  els.word.textContent = entry.word;
  els.word.classList.toggle("is-long", entry.word.length > LONG_WORD_LENGTH);
  els.word.classList.toggle("is-longer", entry.word.length > LONGER_WORD_LENGTH);
  els.phonetic.textContent = entry.phonetic;
  setVisible(els.phonetic, Boolean(entry.phonetic));
  renderSense();

  // CC BY-SA requires credit, and a link to the page the text came from.
  const fromWiktionary = entry.source === "wiktionary";
  if (fromWiktionary) {
    els.creditLink.href = `https://en.wiktionary.org/wiki/${encodeURIComponent(entry.word)}`;
  }
  setVisible(els.credit, fromWiktionary);

  setVisible(els.result, true);
  setVisible(els.status, false);
  setVisible(els.form, false);
}

function showStatus(title, text, { form = false, prefill = "" } = {}) {
  stopSpeech();
  els.statusTitle.textContent = title;
  els.statusText.textContent = text;
  els.statusText.hidden = !text;

  setVisible(els.result, false);
  setVisible(els.status, true);
  setVisible(els.form, form);

  if (form) {
    els.input.value = prefill;
    els.input.focus();
    els.input.select();
  }
}

function showEmpty(pageBlocked) {
  showStatus(
    "Select a word to look up",
    pageBlocked
      ? "Peekword can’t read this page. Type a word below instead."
      : "Highlight a word on the page, then open Peekword. Or type one below.",
    { form: true },
  );
}

function showNotFound(word) {
  const quoted = word.length > 40 ? `${word.slice(0, 40)}…` : word;
  const hint = /\s/.test(word)
    ? "Peekword looks up one word at a time. Try a single word."
    : "Check the spelling and try again.";
  showStatus(`We couldn’t find “${quoted}”`, hint, { form: true });
}

function showError(word) {
  showStatus("Couldn’t look that up", "Check your connection and try again.", {
    form: true,
    prefill: word,
  });
}

// Lookup --------------------------------------------------------------

// Each source returns an entry, null when the word is not there, or throws
// when the service is unreachable.
async function fromDictionaryApi(word) {
  const res = await fetch(DICTIONARY_API + encodeURIComponent(word), {
    signal: AbortSignal.timeout(DICTIONARY_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`dictionaryapi.dev HTTP ${res.status}`);
  return pickDictionaryEntry(await res.json());
}

async function fromWiktionary(word) {
  // Wiktionary is case-sensitive and most common words are lowercase pages.
  const candidates = [...new Set([word.toLowerCase(), word])];

  for (const candidate of candidates) {
    const res = await fetch(WIKTIONARY_API + encodeURIComponent(candidate), {
      signal: AbortSignal.timeout(WIKTIONARY_TIMEOUT_MS),
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Wiktionary HTTP ${res.status}`);

    const entry = pickWiktionaryEntry(candidate, await res.json());
    if (entry) return entry;
  }
  return null;
}

async function findEntry(word) {
  try {
    const entry = await fromDictionaryApi(word);
    if (entry) return entry;
  } catch {
    // Service down or slow; fall through to Wiktionary.
  }
  return fromWiktionary(word);
}

let lookupId = 0;

async function lookup(word) {
  const id = ++lookupId;
  showStatus("Looking up…", word);

  if (word.length > MAX_WORD_LENGTH) {
    showNotFound(word);
    return;
  }

  try {
    const entry = await findEntry(word);
    if (id !== lookupId) return;
    if (entry) showResult(entry);
    else showNotFound(word);
  } catch {
    if (id === lookupId) showError(word);
  }
}

// Start ---------------------------------------------------------------

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const word = cleanWord(els.input.value);
  if (word) lookup(word);
});

// Browsers without speech synthesis simply do not get the buttons.
if (synth) {
  els.listenBtn.addEventListener("click", () => speak(els.listenBtn, NORMAL_RATE));
  els.slowBtn.addEventListener("click", () => speak(els.slowBtn, SLOW_RATE));
} else {
  els.voice.hidden = true;
}

els.prevBtn.addEventListener("click", () => stepSense(-1));
els.nextBtn.addEventListener("click", () => stepSense(1));

document.addEventListener("keydown", (event) => {
  if (els.result.hidden || event.target === els.input) return;
  if (event.key === "ArrowLeft") stepSense(-1);
  if (event.key === "ArrowRight") stepSense(1);
});

async function init() {
  let selected = "";
  let pageBlocked = false;

  try {
    selected = await readPageSelection();
  } catch {
    // chrome:// pages, the Web Store and the PDF viewer refuse script injection.
    pageBlocked = true;
  }

  const word = cleanWord(selected);
  if (word) lookup(word);
  else showEmpty(pageBlocked);
}

init();
