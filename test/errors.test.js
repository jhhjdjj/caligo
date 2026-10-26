import test from "node:test";
import assert from "node:assert/strict";
import { formatDiagnostic, lineStarts, positionAt, suggestName } from "../src/errors.js";
import { run } from "../src/index.js";

test("positionAt turns offsets into 1-based line/column pairs", () => {
  const source = "abc\ndef\n";
  assert.deepEqual(positionAt(source, 0), { line: 1, column: 1 });
  assert.deepEqual(positionAt(source, 3), { line: 1, column: 4 });
  assert.deepEqual(positionAt(source, 4), { line: 2, column: 1 });
  assert.deepEqual(positionAt(source, 9), { line: 3, column: 1 });
  assert.deepEqual(lineStarts(source), [0, 4, 8]);
});

test("diagnostics point at the offending token", () => {
  const source = "let total = 1\nprint(totl)";
  const { error } = run(source);
  assert.equal(error.line, 2);
  assert.equal(error.column, 7);
  assert.equal(error.caretStart, 6);
  assert.equal(error.caretWidth, 4);
  assert.equal(error.lineText, "print(totl)");
  assert.match(error.hint, /did you mean `total`/);
  assert.equal(error.snippet.split("\n").length, 3);
});

test("diagnostics keep carets aligned when the line uses tabs", () => {
  const source = "\tprint(totl)";
  const { error } = run(source);
  assert.equal(error.lineText.startsWith("  print"), true);
  assert.equal(error.caretStart, 8);
});

test("diagnostics window very long lines", () => {
  const source = `${"x".repeat(220)} + nope`;
  const { error } = run(source);
  assert.match(error.snippet, /…/u);
  assert.ok(error.snippet.split("\n")[1].length < 200);
});

test("diagnostics include a call stack", () => {
  const source = "fn inner() { boom }\nfn outer() { inner() }\nouter()";
  const { error } = run(source);
  assert.deepEqual(
    error.frames.map((frame) => frame.name),
    ["inner", "outer"],
  );
});

test("formatDiagnostic renders text and optional colour", () => {
  const source = "print(nope)";
  const { error } = run(source, { filename: "demo.caligo" });
  const plain = formatDiagnostic(error);
  assert.match(plain, /^error: undefined variable `nope`/mu);
  assert.match(plain, /--> demo\.caligo:1:7/u);
  assert.match(plain, /\^/u);

  const coloured = formatDiagnostic(error, { color: true });
  assert.match(coloured, /\u001b\[31m/u);
  assert.match(coloured, /\u001b\[0m/u);
});

test("typo suggestions only trigger on close names", () => {
  assert.equal(suggestName("pirnt", ["print", "map", "len"]), "print");
  assert.equal(suggestName("x", ["print", "map"]), null);
  assert.equal(suggestName("totl", ["total"]), "total");
  assert.equal(suggestName("value", ["values"]), "values");
});

test("internal errors become diagnostics instead of crashing", () => {
  const error = run("1", {});
  assert.equal(error.ok, true);
});
