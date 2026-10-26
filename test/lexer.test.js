import test from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { CaligoError } from "../src/errors.js";

const kinds = (source) => tokenize(source).map((token) => `${token.type}:${token.value}`);

test("tokenizes a small program", () => {
  assert.deepEqual(kinds('let x = 1 + 2\nprint("hi")'), [
    "kw:let",
    "ident:x",
    "op:=",
    "num:1",
    "op:+",
    "num:2",
    "nl:\n",
    "ident:print",
    "op:(",
    "str:hi",
    "op:)",
    "eof:",
  ]);
});

test("collapses consecutive newlines into one token", () => {
  const tokens = tokenize("1\n\n\n2");
  assert.equal(tokens.filter((token) => token.type === "nl").length, 1);
});

test("ignores comments and keeps the newline", () => {
  assert.deepEqual(kinds("// a comment\n1 // trailing"), ["nl:\n", "num:1", "eof:"]);
});

test("skips a shebang line", () => {
  assert.deepEqual(kinds("#!/usr/bin/env caligo\n1"), ["nl:\n", "num:1", "eof:"]);
});

test("reads integers, decimals and exponents", () => {
  const tokens = tokenize("1 2.5 1e3 2.5e-2");
  assert.deepEqual(
    tokens.filter((token) => token.type === "num").map((token) => token.number),
    [1, 2.5, 1000, 0.025],
  );
});

test("keeps absolute positions", () => {
  const tokens = tokenize("let x", { offset: 10, line: 2, column: 3 });
  const x = tokens[1];
  assert.equal(x.value, "x");
  assert.equal(x.start, 14);
  assert.equal(x.end, 15);
  assert.equal(x.line, 2);
  assert.equal(x.column, 7);
});

test("decodes escapes", () => {
  const [string] = tokenize('"a\\tb\\nc\\\\d\\"e\\u{1F600}"');
  assert.equal(string.value, 'a\tb\nc\\d"e😀');
});

test("keeps interpolation parts with their own source and position", () => {
  const [string] = tokenize('"hi ${name}"');
  assert.equal(string.parts.length, 2);
  assert.deepEqual(string.parts[0], { type: "text", value: "hi " });
  assert.equal(string.parts[1].source, "name");
  assert.equal(string.parts[1].start, 6);
  assert.equal(string.value, null);
});

test("supports expressions containing strings and braces inside interpolation", () => {
  const [string] = tokenize('"${ { a: "}" }.a }"');
  const expression = string.parts.find((part) => part.type === "expr");
  assert.equal(expression.source, ' { a: "}" }.a ');
});

test("accepts unicode identifiers", () => {
  const tokens = tokenize("let 名字 = 1");
  assert.equal(tokens[1].value, "名字");
});

test("rejects unterminated strings", () => {
  assert.throws(
    () => tokenize('"abc'),
    (error) => error instanceof CaligoError && error.kind === "lex" && /unterminated string/.test(error.message),
  );
});

test("rejects unknown escapes", () => {
  assert.throws(
    () => tokenize('"\\q"'),
    (error) => error instanceof CaligoError && /unknown escape sequence/.test(error.message),
  );
});

test("rejects empty interpolation", () => {
  assert.throws(
    () => tokenize('"${}"'),
    (error) => error instanceof CaligoError && /empty interpolation/.test(error.message),
  );
});

test("rejects unterminated interpolation", () => {
  assert.throws(
    () => tokenize('"${ 1 + 2"'),
    (error) => error instanceof CaligoError && /unterminated/.test(error.message),
  );
});

test("rejects stray characters with a hint for single quotes", () => {
  assert.throws(
    () => tokenize("'hi'"),
    (error) => error instanceof CaligoError && /unexpected character/.test(error.message) && /double quotes/.test(error.hint),
  );
});
