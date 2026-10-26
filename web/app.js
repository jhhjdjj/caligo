/**
 * The Caligo playground.
 *
 * Everything here is plain DOM code — no framework, no build step. The language
 * runtime is the exact same `src/` module the CLI uses, imported as an ES module.
 */

import { builtinDocs, formatAst, inspect, run, VERSION } from "../src/index.js";
import { DEFAULT_EXAMPLE, EXAMPLES } from "./examples.js";
import { escapeHtml, highlight } from "./highlight.js";

const STORAGE_KEY = "caligo.playground.source";
const MAX_OUTPUT_LINES = 600;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  editor: $("#editor"),
  highlight: $("#highlight"),
  highlightCode: $("#highlight code"),
  gutter: $("#gutter-inner"),
  output: $("#output"),
  traceVars: $("#trace-vars"),
  traceList: $("#trace-list"),
  traceNote: $("#trace-note"),
  ast: $("#ast"),
  builtins: $("#builtins"),
  builtinFilter: $("#builtin-filter"),
  examples: $("#examples"),
  run: $("#run"),
  share: $("#share"),
  toast: $("#toast"),
  cursor: $("#cursor"),
  timing: $("#timing"),
  version: $("#version"),
  repo: $("#repo-link"),
  docs: $("#docs-link"),
};

const state = {
  result: null,
  events: [],
  tab: "output",
};

let toastTimer = 0;
let saveTimer = 0;

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  elements.version.textContent = `v${VERSION}`;
  if (/Mac|iPhone|iPad/u.test(navigator.platform)) {
    const shortcut = $(".shortcut");
    if (shortcut) shortcut.textContent = "⌘ ↵";
  }

  setupLinks();
  fillExamples();
  renderBuiltins("");
  bindEvents();

  const shared = await readSharedCode();
  const stored = safeStorageGet(STORAGE_KEY);
  const fallback = EXAMPLES.find((example) => example.id === DEFAULT_EXAMPLE)?.code ?? "";
  setCode(shared ?? stored ?? fallback, { remember: false });
  execute({ silent: true });
}

function setupLinks() {
  const match = /^([a-z0-9-]+)\.github\.io$/iu.exec(location.hostname);
  const repository = location.pathname.split("/").filter(Boolean)[0];
  if (match && repository) {
    elements.repo.href = `https://github.com/${match[1]}/${repository}`;
    elements.docs.href = `https://github.com/${match[1]}/${repository}/blob/main/docs/language.md`;
  } else {
    elements.repo.href = "./README.md";
    elements.repo.textContent = "README";
  }
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

function setCode(code, { remember = true } = {}) {
  elements.editor.value = code;
  refresh();
  if (remember) rememberCode();
}

function refresh() {
  elements.highlightCode.innerHTML = highlight(elements.editor.value);
  renderGutter();
  syncScroll();
  updateCursor();
}

function renderGutter() {
  const lines = elements.editor.value.split("\n").length;
  let html = "";
  for (let line = 1; line <= lines; line += 1) html += `<div>${line}</div>`;
  elements.gutter.innerHTML = html;
}

function syncScroll() {
  elements.highlight.scrollTop = elements.editor.scrollTop;
  elements.highlight.scrollLeft = elements.editor.scrollLeft;
  elements.gutter.style.transform = `translateY(${-elements.editor.scrollTop}px)`;
}

function updateCursor() {
  const position = elements.editor.selectionStart;
  const before = elements.editor.value.slice(0, position);
  const line = before.split("\n").length;
  const column = position - before.lastIndexOf("\n");
  elements.cursor.textContent = `line ${line}, column ${column}`;
}

function lineHeight() {
  const computed = Number.parseFloat(getComputedStyle(elements.editor).lineHeight);
  return Number.isFinite(computed) ? computed : 22;
}

function scrollToLine(line) {
  const target = Math.max(0, (line - 1) * lineHeight() - 40);
  elements.editor.scrollTop = target;
  syncScroll();
}

/** Insert text at the caret, preferring the browser's own undo stack. */
function insertText(text) {
  elements.editor.focus();
  let inserted = false;
  try {
    inserted = document.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }
  if (!inserted) {
    const { selectionStart, selectionEnd } = elements.editor;
    elements.editor.setRangeText(text, selectionStart, selectionEnd, "end");
  }
  refresh();
  rememberCode();
}

function replaceRange(start, end, text) {
  elements.editor.focus();
  elements.editor.setSelectionRange(start, end);
  insertText(text);
}

function handleTab(shift) {
  const { selectionStart: start, selectionEnd: end, value } = elements.editor;
  const multiline = value.slice(start, end).includes("\n");

  if (!multiline && !shift) {
    insertText("  ");
    return;
  }

  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const block = value.slice(lineStart, end);
  const replacement = block
    .split("\n")
    .map((line) => (shift ? line.replace(/^ {1,2}/u, "") : `  ${line}`))
    .join("\n");

  replaceRange(lineStart, end, replacement);
  elements.editor.setSelectionRange(lineStart, lineStart + replacement.length);
}

function handleEnter() {
  const { selectionStart: start, value } = elements.editor;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const currentLine = value.slice(lineStart, start);
  const indent = /^[ \t]*/u.exec(currentLine)?.[0] ?? "";
  const opensBlock = /\{\s*$/u.test(currentLine);
  insertText(`\n${indent}${opensBlock ? "  " : ""}`);
}

function onEditorKeydown(event) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    execute();
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    handleTab(event.shiftKey);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    handleEnter();
  }
}

/* ------------------------------------------------------------------ */
/* Running                                                             */
/* ------------------------------------------------------------------ */

function execute({ silent = false } = {}) {
  const source = elements.editor.value;
  const events = [];
  const started = performance.now();
  const result = run(source, {
    filename: "playground.caligo",
    maxSteps: 200_000,
    onStep: (event) => events.push(event),
  });
  const elapsed = performance.now() - started;

  state.result = result;
  state.events = events;

  renderOutput(result);
  renderTrace(result);
  renderAst(result);

  elements.timing.textContent = result.ok
    ? `ran in ${elapsed.toFixed(1)} ms · ${Number(result.steps).toLocaleString("en-US")} steps`
    : `stopped after ${elapsed.toFixed(1)} ms`;

  if (!silent) {
    elements.run.classList.add("is-running");
    window.setTimeout(() => elements.run.classList.remove("is-running"), 320);
  }
}

function renderOutput(result) {
  const output = elements.output;
  output.innerHTML = "";

  if (!result.ok) {
    output.appendChild(errorCard(result.error));
    selectTab("output");
    return;
  }

  const lines = result.output.slice(0, MAX_OUTPUT_LINES);
  for (const line of lines) {
    const node = document.createElement("div");
    node.className = "output-line";
    node.textContent = line;
    output.appendChild(node);
  }

  if (result.output.length > MAX_OUTPUT_LINES) {
    const note = document.createElement("div");
    note.className = "output-note";
    note.textContent = `… ${result.output.length - MAX_OUTPUT_LINES} more lines hidden`;
    output.appendChild(note);
  }

  if (result.value !== null) {
    const node = document.createElement("div");
    node.className = "output-line output-value";
    node.textContent = `=> ${inspect(result.value)}`;
    output.appendChild(node);
  }

  if (!result.output.length && result.value === null) {
    const hint = document.createElement("p");
    hint.className = "output-empty";
    hint.textContent = "The program ran without producing a value. Try print(\"hello\") or end with an expression.";
    output.appendChild(hint);
  }
}

function errorCard(diagnostic) {
  const card = document.createElement("div");
  card.className = "error-card";

  const frames = (diagnostic.frames ?? [])
    .map((frame) => {
      const where = frame.line === null ? "" : ` (line ${frame.line}:${frame.column})`;
      return `<div class="error-frame">in ${escapeHtml(frame.name)}${where}</div>`;
    })
    .join("");

  card.innerHTML = `
    <div class="error-title">
      <span class="error-kind">${escapeHtml(diagnostic.kind)}</span>
      ${escapeHtml(diagnostic.title)}
    </div>
    <div class="error-location">${escapeHtml(diagnostic.location)}</div>
    <pre class="error-snippet">${escapeHtml(diagnostic.snippet)}</pre>
    ${diagnostic.hint ? `<div class="error-hint">${escapeHtml(diagnostic.hint)}</div>` : ""}
    ${frames ? `<div class="error-frames">${frames}</div>` : ""}
  `;
  return card;
}

/* ------------------------------------------------------------------ */
/* Trace & AST                                                         */
/* ------------------------------------------------------------------ */

function renderTrace(result) {
  const events = state.events;
  elements.traceList.innerHTML = "";
  elements.traceVars.textContent = "Run the program to record its steps.";
  elements.traceNote.hidden = true;

  if (!events.length) return;

  const fragment = document.createDocumentFragment();
  events.forEach((event, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "trace-row";
    row.dataset.index = String(index);
    row.innerHTML = `<span class="trace-line">${event.line ?? "·"}</span><span class="trace-label">${escapeHtml(event.label)}</span>`;
    row.addEventListener("click", () => showTraceEvent(index));
    fragment.appendChild(row);
  });
  elements.traceList.appendChild(fragment);
  showTraceEvent(events.length - 1, { scroll: false });

  if (result.eventsTruncated) {
    elements.traceNote.hidden = false;
    elements.traceNote.textContent = `Showing the first ${events.length} steps. Later steps were not recorded.`;
  }
}

function showTraceEvent(index, { scroll = true } = {}) {
  const event = state.events[index];
  if (!event) return;

  $$(".trace-row").forEach((row) => {
    row.classList.toggle("is-active", Number(row.dataset.index) === index);
  });

  const variables = event.variables ?? [];
  const head = `<div class="trace-head">#${event.index} · line ${event.line ?? "?"} · ${escapeHtml(event.label)}</div>`;
  const body = variables.length
    ? `<div class="vars">${variables
        .map(
          (variable) =>
            `<span class="var"><span class="var-name">${escapeHtml(variable.name)}</span><span class="var-value">${escapeHtml(variable.value)}</span></span>`,
        )
        .join("")}</div>`
    : `<div class="trace-empty">no variables in scope</div>`;

  elements.traceVars.innerHTML = head + body;
  if (scroll && event.line) scrollToLine(event.line);
}

function renderAst(result) {
  if (!result.ast) {
    elements.ast.textContent = "The program does not parse yet, so there is no tree to show.";
    return;
  }
  elements.ast.textContent = formatAst(result.ast);
}

/* ------------------------------------------------------------------ */
/* Builtins panel                                                      */
/* ------------------------------------------------------------------ */

function renderBuiltins(query) {
  const normalized = query.trim().toLowerCase();
  const docs = builtinDocs().filter((entry) => {
    if (!normalized) return true;
    return `${entry.signature} ${entry.doc}`.toLowerCase().includes(normalized);
  });

  if (!docs.length) {
    elements.builtins.innerHTML = `<p class="output-empty">No builtin matches “${escapeHtml(query)}”.</p>`;
    return;
  }

  elements.builtins.innerHTML = docs
    .map(
      (entry) => `
        <article class="builtin">
          <h3 class="builtin-signature">${escapeHtml(entry.signature)}</h3>
          <p class="builtin-doc">${escapeHtml(entry.doc)}</p>
        </article>`,
    )
    .join("");
}

/* ------------------------------------------------------------------ */
/* Tabs, examples, sharing                                             */
/* ------------------------------------------------------------------ */

function selectTab(name) {
  state.tab = name;
  $$(".tab").forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $$(".panel").forEach((panel) => {
    const active = panel.dataset.panel === name;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
}

function fillExamples() {
  elements.examples.innerHTML = EXAMPLES.map(
    (example) => `<option value="${escapeHtml(example.id)}">${escapeHtml(example.title)}</option>`,
  ).join("");

  const initial = EXAMPLES.some((example) => example.id === DEFAULT_EXAMPLE) ? DEFAULT_EXAMPLE : EXAMPLES[0]?.id;
  if (initial) elements.examples.value = initial;

  elements.examples.addEventListener("change", () => {
    const example = EXAMPLES.find((entry) => entry.id === elements.examples.value);
    if (!example) return;
    setCode(example.code);
    execute({ silent: true });
    selectTab("output");
    toast(`Loaded “${example.title}”`);
  });
}

async function share() {
  const encoded = await encodeCode(elements.editor.value);
  const url = new URL(location.href);
  url.hash = `code=${encoded}`;
  if (url.toString().length > 8000) {
    toast("This program is too long to share as a link");
    return;
  }
  history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url.toString());
    toast("Share link copied to clipboard");
  } catch {
    toast("Share link is now in the address bar");
  }
}

async function encodeCode(code) {
  const bytes = new TextEncoder().encode(code);
  if (typeof CompressionStream === "function") {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return `z${base64Url(compressed)}`;
  }
  return `u${base64Url(bytes)}`;
}

async function decodeCode(payload) {
  const marker = payload[0];
  const bytes = fromBase64Url(payload.slice(1));
  if (marker === "z") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

async function readSharedCode() {
  const hash = location.hash.replace(/^#/u, "");
  if (!hash.startsWith("code=")) return null;
  try {
    return await decodeCode(hash.slice("code=".length));
  } catch {
    toast("That share link could not be read");
    return null;
  }
}

function base64Url(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function fromBase64Url(text) {
  const normalized = text.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
}

/* ------------------------------------------------------------------ */
/* Persistence & events                                                */
/* ------------------------------------------------------------------ */

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rememberCode() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, elements.editor.value);
    } catch {
      /* storage can be unavailable in private windows — the playground still works */
    }
  }, 400);
}

function bindEvents() {
  elements.editor.addEventListener("input", refresh);
  elements.editor.addEventListener("scroll", syncScroll);
  elements.editor.addEventListener("keydown", onEditorKeydown);
  elements.editor.addEventListener("click", updateCursor);
  elements.editor.addEventListener("keyup", updateCursor);
  elements.editor.addEventListener("select", updateCursor);

  elements.run.addEventListener("click", () => execute());
  elements.share.addEventListener("click", share);

  elements.builtinFilter.addEventListener("input", (event) => renderBuiltins(event.target.value));

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      execute();
    }
  });
}

boot();
