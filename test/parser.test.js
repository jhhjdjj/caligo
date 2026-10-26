import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser.js";
import { CaligoError } from "../src/errors.js";

const first = (source) => parse(source).body[0];

test("multiplication binds tighter than addition", () => {
  const node = first("1 + 2 * 3");
  assert.equal(node.type, "Binary");
  assert.equal(node.operator, "+");
  assert.equal(node.right.operator, "*");
});

test("parentheses override precedence", () => {
  const node = first("(1 + 2) * 3");
  assert.equal(node.operator, "*");
  assert.equal(node.left.operator, "+");
});

test("pipe is the loosest binary operator and associates left", () => {
  const node = first("a + b |> f()");
  assert.equal(node.operator, "|>");
  assert.equal(node.left.operator, "+");
  const chained = first("a |> f() |> g()");
  assert.equal(chained.operator, "|>");
  assert.equal(chained.left.operator, "|>");
});

test("a line starting with a pipe continues the expression", () => {
  const program = parse("items\n  |> map(f)\n  |> filter(g)\n");
  assert.equal(program.body.length, 1);
  assert.equal(program.body[0].operator, "|>");
});

test("a line starting with a minus starts a new statement", () => {
  const program = parse("x\n-1");
  assert.equal(program.body.length, 2);
  assert.equal(program.body[1].type, "Unary");
});

test("line breaks inside brackets are ignored", () => {
  assert.equal(first("[\n  1,\n  2,\n]").items.length, 2);
  assert.equal(first("{\n  a: 1,\n}").entries.length, 1);
  assert.equal(first("f(\n  1,\n  2\n)").args.length, 2);
});

test("blocks belong to keywords; braces alone are maps", () => {
  assert.equal(first("if x { 1 }").consequent.type, "Block");
  assert.equal(first("{ a: 1 }").type, "MapExpr");
});

test("if/else if/else nests through the alternate branch", () => {
  const node = first("if a { 1 } else if b { 2 } else { 3 }");
  assert.equal(node.type, "If");
  assert.equal(node.alternate.type, "If");
  assert.equal(node.alternate.alternate.type, "Block");
});

test("match arms are parsed with patterns and bodies", () => {
  const node = first('match x { 1 => "one", [a, ...rest] => a, {k: v} => v }');
  assert.equal(node.arms.length, 3);
  assert.equal(node.arms[0].pattern.type, "PatternLiteral");
  assert.equal(node.arms[1].pattern.type, "PatternList");
  assert.equal(node.arms[1].pattern.rest, "rest");
  assert.equal(node.arms[2].pattern.type, "PatternMap");
});

test("match arms can have block bodies", () => {
  const node = first("match x { _ => { 1 } }");
  assert.equal(node.arms[0].body.type, "Block");
});

test("assignments record their operator", () => {
  assert.equal(first("x += 1").operator, "+=");
  assert.equal(first("x = 1").operator, "=");
});

test("member access and indexing chain", () => {
  const node = first("a.b[0].c");
  assert.equal(node.type, "Member");
  assert.equal(node.property, "c");
  assert.equal(node.object.type, "Index");
});

test("function declarations carry names and parameters", () => {
  const node = first("fn add(a, b) { a + b }");
  assert.equal(node.type, "FnDecl");
  assert.equal(node.name, "add");
  assert.deepEqual(node.params, ["a", "b"]);
});

test("anonymous functions can still be named for recursion", () => {
  const node = first("fn fact(n) { n }");
  assert.equal(node.type, "FnDecl");
  const expression = first("let f = fn g(n) { n }");
  assert.equal(expression.value.type, "Fn");
  assert.equal(expression.value.name, "g");
});

test("reports the position of a syntax error", () => {
  assert.throws(
    () => parse("let x = 1\nprint(x))"),
    (error) => {
      assert.ok(error instanceof CaligoError);
      assert.equal(error.kind, "parse");
      assert.equal(error.span.start, 18);
      return true;
    },
  );
});

test("missing closing braces are reported", () => {
  assert.throws(
    () => parse("fn f() {\n  1\n"),
    (error) => error instanceof CaligoError && /missing `}`/.test(error.message),
  );
});

test("duplicate parameters are rejected", () => {
  assert.throws(
    () => parse("fn f(a, a) { a }"),
    (error) => error instanceof CaligoError && /duplicate parameter/.test(error.message),
  );
});

test("rest patterns must come last", () => {
  assert.throws(
    () => parse("match x { [...a, b] => 1 }"),
    (error) => error instanceof CaligoError && /must be the last item/.test(error.message),
  );
});

test("map keys have a helpful error", () => {
  assert.throws(
    () => parse("{ 1: 2 }"),
    (error) => error instanceof CaligoError && /map key/.test(error.message),
  );
});

test("assignment to a non-variable is rejected", () => {
  assert.throws(
    () => parse("[1, 2][0] = 3"),
    (error) => error instanceof CaligoError && /immutable/.test(error.message),
  );
});
