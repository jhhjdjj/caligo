/**
 * The Caligo lexer.
 *
 * Produces a flat token list with absolute source spans. Newlines are emitted as
 * explicit `nl` tokens (collapsed to at most one in a row) so the parser can
 * decide where a line break is a statement separator and where it is noise.
 *
 * Strings support `${expression}` interpolation. The lexer keeps the raw source
 * of every interpolation together with its absolute position, and the parser
 * re-enters a nested lexer/parser for that snippet. Spans therefore stay valid
 * even for expressions inside strings, which is what lets error carets point at
 * the right column.
 */

import { lexError } from "./errors.js";

export const KEYWORDS = new Set([
  "let",
  "const",
  "fn",
  "if",
  "else",
  "while",
  "for",
  "in",
  "match",
  "return",
  "break",
  "continue",
  "true",
  "false",
  "nil",
]);

const OPERATORS = [
  "...",
  "|>",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "+=",
  "-=",
  "*=",
  "/=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "!",
  "=",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ":",
  ";",
  ".",
];

const IDENT_START = /^[\p{L}_]$/u;
const IDENT_PART = /^[\p{L}\p{N}_]$/u;

const isDigit = (character) => character >= "0" && character <= "9";

/** @typedef {{ type: string, value: string, start: number, end: number, line: number, column: number, parts?: Array<object> }} Token */

/**
 * @param {string} source
 * @param {{ offset?: number, line?: number, column?: number }} [base] position of `source` inside a larger document
 * @returns {Token[]}
 */
export function tokenize(source, base = {}) {
  return new Lexer(source, base).run();
}

export class Lexer {
  /**
   * @param {string} source
   * @param {{ offset?: number, line?: number, column?: number }} [base]
   */
  constructor(source, base = {}) {
    this.source = source;
    this.index = 0;
    this.offset = base.offset ?? 0;
    this.line = base.line ?? 1;
    this.column = base.column ?? 1;
    /** @type {Token[]} */
    this.tokens = [];
    this.options = { comments: base.comments === true };
  }

  get absolute() {
    return this.offset + this.index;
  }

  mark() {
    return { offset: this.absolute, line: this.line, column: this.column };
  }

  peek(distance = 0) {
    return this.source[this.index + distance];
  }

  advance() {
    const character = this.source[this.index];
    this.index += 1;
    if (character === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return character;
  }

  push(type, value, mark, extra) {
    /** @type {Token} */
    const token = {
      type,
      value,
      start: mark.offset,
      end: this.absolute,
      line: mark.line,
      column: mark.column,
    };
    if (extra) Object.assign(token, extra);
    this.tokens.push(token);
    return token;
  }

  run() {
    if (this.index === 0 && this.offset === 0 && this.source.startsWith("#!")) {
      while (this.index < this.source.length && this.peek() !== "\n") this.advance();
    }

    while (this.index < this.source.length) {
      const character = this.peek();

      if (character === " " || character === "\t" || character === "\r" || character === "\f") {
        this.advance();
        continue;
      }

      if (character === "\n") {
        const mark = this.mark();
        this.advance();
        const previous = this.tokens[this.tokens.length - 1];
        if (!previous || previous.type !== "nl") this.push("nl", "\n", mark);
        continue;
      }

      if (character === "/" && this.peek(1) === "/") {
        const mark = this.mark();
        while (this.index < this.source.length && this.peek() !== "\n") this.advance();
        if (this.options.comments) {
          this.push("comment", this.source.slice(mark.offset - this.offset, this.index), mark);
        }
        continue;
      }

      if (isDigit(character)) {
        this.readNumber();
        continue;
      }

      if (character === '"') {
        this.readString();
        continue;
      }

      if (IDENT_START.test(character)) {
        this.readIdentifier();
        continue;
      }

      if (!this.readOperator()) {
        const hint = character === "'" ? "strings use double quotes, like \"caligo\"" : undefined;
        throw Object.assign(lexError(`unexpected character ${JSON.stringify(character)}`, this.absolute, this.absolute + 1), {
          hint,
        });
      }
    }

    const mark = this.mark();
    this.push("eof", "", mark);
    return this.tokens;
  }

  readNumber() {
    const mark = this.mark();
    const rest = this.source.slice(this.index);
    const match = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (!match) throw lexError("invalid number", this.absolute, this.absolute + 1);
    for (let i = 0; i < match[0].length; i += 1) this.advance();
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      throw Object.assign(lexError(`number ${match[0]} is too large`, mark.offset, this.absolute), {
        hint: "Caligo numbers are IEEE-754 doubles",
      });
    }
    this.push("num", match[0], mark, { number: value });
  }

  readIdentifier() {
    const mark = this.mark();
    while (this.index < this.source.length && IDENT_PART.test(this.peek())) this.advance();
    const value = this.source.slice(mark.offset - this.offset, this.index);
    this.push(KEYWORDS.has(value) ? "kw" : "ident", value, mark);
  }

  readOperator() {
    for (const length of [3, 2, 1]) {
      const candidate = this.source.slice(this.index, this.index + length);
      if (candidate.length === length && OPERATORS.includes(candidate)) {
        const mark = this.mark();
        for (let i = 0; i < length; i += 1) this.advance();
        this.push("op", candidate, mark);
        return true;
      }
    }
    return false;
  }

  readString() {
    const mark = this.mark();
    this.advance(); // opening quote
    /** @type {Array<object>} */
    const parts = [];
    let buffer = "";

    for (;;) {
      if (this.index >= this.source.length) {
        throw lexError("unterminated string", mark.offset, this.absolute);
      }
      const character = this.peek();

      if (character === "\n") {
        throw lexError("unterminated string (strings cannot span lines)", mark.offset, this.absolute);
      }

      if (character === '"') {
        this.advance();
        break;
      }

      if (character === "\\") {
        buffer += this.readEscape(mark);
        continue;
      }

      if (character === "$" && this.peek(1) === "{") {
        if (buffer) {
          parts.push({ type: "text", value: buffer });
          buffer = "";
        }
        const interpolationStart = this.absolute;
        this.advance(); // $
        this.advance(); // {
        const inner = this.mark();
        const expressionStart = this.index;
        this.scanInterpolation(interpolationStart);
        const raw = this.source.slice(expressionStart, this.index - 1);
        if (!raw.trim()) throw lexError("empty interpolation `${}`", interpolationStart, this.absolute);
        parts.push({ type: "expr", source: raw, start: inner.offset, line: inner.line, column: inner.column });
        continue;
      }

      buffer += character;
      this.advance();
    }

    if (buffer) parts.push({ type: "text", value: buffer });
    if (!parts.length) parts.push({ type: "text", value: "" });
    const value = parts.every((part) => part.type === "text") ? parts.map((part) => part.value).join("") : null;
    this.push("str", value, mark, { parts });
  }

  /** Skip the body of a `${ ... }` interpolation, stopping after its closing brace. */
  scanInterpolation(interpolationStart) {
    let depth = 1;
    while (this.index < this.source.length) {
      const character = this.peek();
      if (character === '"') {
        this.skipStringInsideInterpolation(interpolationStart);
        continue;
      }
      if (character === "{") {
        depth += 1;
        this.advance();
        continue;
      }
      if (character === "}") {
        depth -= 1;
        this.advance();
        if (depth === 0) return;
        continue;
      }
      if (character === "\n") {
        throw lexError("unterminated interpolation", interpolationStart, this.absolute);
      }
      this.advance();
    }
    throw lexError("unterminated interpolation", interpolationStart, this.absolute);
  }

  skipStringInsideInterpolation(interpolationStart) {
    this.advance(); // opening quote
    while (this.index < this.source.length) {
      const character = this.peek();
      if (character === "\\") {
        this.advance();
        if (this.index < this.source.length) this.advance();
        continue;
      }
      if (character === '"') {
        this.advance();
        return;
      }
      if (character === "\n") break;
      this.advance();
    }
    throw lexError("unterminated string inside interpolation", interpolationStart, this.absolute);
  }

  readEscape(stringMark) {
    const start = this.absolute;
    this.advance(); // backslash
    const character = this.peek();
    if (character === undefined) throw lexError("unterminated escape sequence", start, this.absolute);
    this.advance();
    switch (character) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "0":
        return "\0";
      case "\\":
        return "\\";
      case '"':
        return '"';
      case "'":
        return "'";
      case "$":
        return "$";
      case "u":
        return this.readUnicodeEscape(start, stringMark);
      default:
        throw Object.assign(lexError(`unknown escape sequence \\${character}`, start, this.absolute), {
          hint: "supported escapes: \\n \\t \\r \\0 \\\\ \\\" \\$ \\u{1F600}",
        });
    }
  }

  readUnicodeEscape(start, stringMark) {
    let hex = "";
    if (this.peek() === "{") {
      this.advance();
      while (this.index < this.source.length && this.peek() !== "}") {
        hex += this.peek();
        this.advance();
      }
      if (this.peek() !== "}") throw lexError("unterminated unicode escape", start, this.absolute);
      this.advance();
    } else {
      for (let i = 0; i < 4; i += 1) {
        const character = this.peek();
        if (character === undefined || !/[0-9a-fA-F]/.test(character)) {
          throw lexError("unicode escape needs 4 hex digits, like \\u00e9", start, this.absolute);
        }
        hex += character;
        this.advance();
      }
    }
    const codePoint = Number.parseInt(hex, 16);
    if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) {
      throw lexError(`invalid unicode code point \\u${hex}`, start, this.absolute);
    }
    void stringMark;
    return String.fromCodePoint(codePoint);
  }
}
