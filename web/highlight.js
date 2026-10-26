/**
 * Turn a Caligo program into highlighted HTML.
 *
 * Uses the real lexer (with comments enabled) instead of a pile of regexes, so
 * the colours always agree with what the language actually accepts. If the
 * program is mid-edit and does not lex yet, the raw text is shown unhighlighted
 * rather than flashing an error while typing.
 */

import { tokenize } from "../src/lexer.js";
import { builtinNames } from "../src/builtins.js";

const BUILTINS = new Set(builtinNames());

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text) {
  return text.replace(/[&<>"']/gu, (character) => HTML_ESCAPES[character]);
}

function classNameFor(token, nextToken) {
  switch (token.type) {
    case "kw":
      return "kw";
    case "str":
      return "str";
    case "num":
      return "num";
    case "comment":
      return "comment";
    case "op":
      return "op";
    case "ident":
      if (BUILTINS.has(token.value)) return "builtin";
      if (nextToken && nextToken.type === "op" && nextToken.value === "(") return "call";
      return "ident";
    default:
      return "ident";
  }
}

/**
 * @param {string} source
 * @returns {string} HTML with `<span class="tok-*">` wrappers
 */
export function highlight(source) {
  /** @type {import("../src/lexer.js").Token[]} */
  let tokens;
  try {
    tokens = tokenize(source, { comments: true });
  } catch {
    return escapeHtml(source);
  }

  let html = "";
  let cursor = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "nl" || token.type === "eof") continue;
    if (token.start < cursor) continue;

    html += escapeHtml(source.slice(cursor, token.start));
    const className = classNameFor(token, tokens[index + 1]);
    html += `<span class="tok-${className}">${escapeHtml(source.slice(token.start, token.end))}</span>`;
    cursor = token.end;
  }

  html += escapeHtml(source.slice(cursor));
  return html;
}
