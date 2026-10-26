/**
 * Errors, spans and pretty diagnostics.
 *
 * Every token and AST node carries an absolute character span (`{ start, end }`).
 * Keeping spans as plain character offsets keeps the lexer/parser simple and
 * makes it trivial to render a caret under the offending source line — which is
 * half of what makes a toy language feel like a real one.
 */

export class CaligoError extends Error {
  /**
   * @param {string} message
   * @param {{ span?: { start: number, end: number } | null, kind?: string, hint?: string | null }} [options]
   */
  constructor(message, { span = null, kind = "runtime", hint = null } = {}) {
    super(message);
    this.name = "CaligoError";
    /** @type {"lex" | "parse" | "runtime" | "internal"} */
    this.kind = kind;
    /** @type {{ start: number, end: number } | null} */
    this.span = span;
    /** @type {string | null} */
    this.hint = hint;
    /** @type {Array<{ name: string, span: { start: number, end: number } | null }>} */
    this.frames = [];
  }
}

export function lexError(message, start, end) {
  return new CaligoError(message, { span: { start, end }, kind: "lex" });
}

export function parseError(message, span, hint = null) {
  return new CaligoError(message, { span, kind: "parse", hint });
}

export function runtimeError(message, span, hint = null) {
  return new CaligoError(message, { span, kind: "runtime", hint });
}

export function isCaligoError(value) {
  return value instanceof CaligoError;
}

/** @returns {number[]} absolute offset of the first character of every line */
export function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** Convert an absolute offset into a 1-based line/column pair. */
export function positionAt(source, offset, starts = lineStarts(source)) {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= clamped) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: clamped - starts[lo] + 1 };
}

/** Return the text of a 1-based line, without its newline. */
export function lineAt(source, line, starts = lineStarts(source)) {
  const start = starts[Math.max(0, Math.min(line - 1, starts.length - 1))] ?? 0;
  const end = source.indexOf("\n", start);
  return { start, end: end === -1 ? source.length : end, text: source.slice(start, end === -1 ? source.length : end) };
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                         */
/* ------------------------------------------------------------------ */

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Pick the closest candidate name, if it is close enough to be a plausible typo. */
export function suggestName(name, candidates) {
  if (!name) return null;
  const lower = name.toLowerCase();
  const limit = name.length <= 4 ? 1 : name.length <= 7 ? 2 : 3;
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    if (candidate === name) continue;
    const score = editDistance(lower, candidate.toLowerCase());
    if (score < bestScore && score <= limit) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

const MAX_SNIPPET_WIDTH = 180;
const TAB_SIZE = 2;

function expandTabs(text) {
  let out = "";
  for (const character of text) out += character === "\t" ? " ".repeat(TAB_SIZE) : character;
  return out;
}

/**
 * Turn an error plus its source into a structured diagnostic that both the
 * terminal and the browser playground can render.
 *
 * @param {unknown} error
 * @param {string} source
 * @param {{ filename?: string | null }} [options]
 */
export function toDiagnostic(error, source, { filename = null } = {}) {
  const isCaligo = error instanceof CaligoError;
  const kind = isCaligo ? error.kind : "internal";
  const title = isCaligo ? error.message : `internal error: ${error instanceof Error ? error.message : String(error)}`;
  const hint = isCaligo ? error.hint : null;
  const span = isCaligo && error.span ? error.span : { start: 0, end: 0 };
  const starts = lineStarts(source);
  const startPos = positionAt(source, span.start ?? 0, starts);
  const endPos = positionAt(source, Math.max(span.start ?? 0, (span.end ?? (span.start ?? 0) + 1) - 1), starts);
  const { text: rawLine } = lineAt(source, startPos.line, starts);
  const expanded = expandTabs(rawLine);
  const displayStart = expandTabs(rawLine.slice(0, startPos.column - 1)).length;
  const rawWidth =
    endPos.line === startPos.line ? Math.max(1, endPos.column - startPos.column + 1) : Math.max(1, expanded.length - displayStart);

  // Window very long lines around the caret so the snippet stays readable.
  let visible = expanded;
  let offset = 0;
  let prefix = "";
  let suffix = "";
  if (expanded.length > MAX_SNIPPET_WIDTH) {
    const windowStart = Math.max(0, Math.min(displayStart - 60, expanded.length - MAX_SNIPPET_WIDTH));
    const windowEnd = Math.min(expanded.length, windowStart + MAX_SNIPPET_WIDTH);
    visible = expanded.slice(windowStart, windowEnd);
    offset = windowStart;
    prefix = windowStart > 0 ? "…" : "";
    suffix = windowEnd < expanded.length ? "…" : "";
  }

  const caretStart = Math.max(0, displayStart - offset) + prefix.length;
  const available = Math.max(1, visible.length + prefix.length - caretStart);
  const caretWidth = Math.max(1, Math.min(rawWidth, available));

  const gutterWidth = String(startPos.line).length;
  const gutter = " ".repeat(gutterWidth);
  const snippet = [
    `${gutter} |`,
    `${String(startPos.line).padStart(gutterWidth)} | ${prefix}${visible}${suffix}`,
    `${gutter} | ${" ".repeat(caretStart)}${"^".repeat(caretWidth)}`,
  ].join("\n");

  const frames = (isCaligo ? error.frames : []).slice(0, 6).map((frame) => {
    const position = frame.span ? positionAt(source, frame.span.start, starts) : null;
    return {
      name: frame.name,
      line: position?.line ?? null,
      column: position?.column ?? null,
    };
  });

  return {
    kind,
    title,
    hint,
    filename,
    line: startPos.line,
    column: startPos.column,
    lineText: expanded,
    caretStart,
    caretWidth,
    snippet,
    frames,
    location: `${filename ? `${filename}:` : ""}${startPos.line}:${startPos.column}`,
  };
}

const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const CYAN = "\u001b[36m";

function paint(text, code, enabled) {
  return enabled ? `${code}${text}${RESET}` : text;
}

/** Render a diagnostic as plain text (optionally with ANSI colours). */
export function formatDiagnostic(diagnostic, { color = false } = {}) {
  const lines = [];
  lines.push(`${paint("error", RED, color)}: ${diagnostic.title}`);
  lines.push(`${paint("  -->", DIM, color)} ${diagnostic.location}`);
  const [bar, codeLine, caretLine] = diagnostic.snippet.split("\n");
  lines.push(paint(bar, DIM, color));
  lines.push(paint(codeLine, DIM, color));
  if (color) {
    const caretIndex = caretLine.indexOf("^");
    const head = caretLine.slice(0, caretIndex);
    const carets = /^\^+/.exec(caretLine.slice(caretIndex))?.[0] ?? "";
    const tail = caretLine.slice(caretIndex + carets.length);
    lines.push(`${DIM}${head}${RESET}${RED}${carets}${RESET}${tail}`);
  } else {
    lines.push(caretLine);
  }
  if (diagnostic.hint) lines.push(`${paint("  hint:", YELLOW, color)} ${diagnostic.hint}`);
  for (const frame of diagnostic.frames) {
    const where = frame.line === null ? "" : ` (line ${frame.line}:${frame.column})`;
    lines.push(`${paint("  in:", CYAN, color)} ${frame.name}${where}`);
  }
  return lines.join("\n");
}
