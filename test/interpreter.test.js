import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, failure, printed, value } from "./helpers.js";

test("evaluates arithmetic with precedence", () => {
  assert.equal(value("1 + 2 * 3"), 7);
  assert.equal(value("(1 + 2) * 3"), 9);
  assert.equal(value("10 - 3 - 2"), 5);
  assert.equal(value("7 % 4"), 3);
  assert.equal(value("2 * -3"), -6);
});

test("concatenates strings and lists", () => {
  assert.equal(value('"foo" + "bar"'), "foobar");
  assert.deepEqual(value("[1] + [2, 3]"), [1, 2, 3]);
});

test("compares values structurally", () => {
  assert.equal(value("[1, [2]] == [1, [2]]"), true);
  assert.equal(value("{ a: 1 } == { a: 1 }"), true);
  assert.equal(value("{ a: 1 } == { a: 2 }"), false);
  assert.equal(value('"a" < "b"'), true);
  assert.equal(value("3 >= 3"), true);
});

test("only nil and false are falsy", () => {
  assert.equal(value('if 0 { "truthy" } else { "falsy" }'), "truthy");
  assert.equal(value('if "" { "truthy" } else { "falsy" }'), "truthy");
  assert.equal(value('if nil { "truthy" } else { "falsy" }'), "falsy");
  assert.equal(value('if false { "truthy" } else { "falsy" }'), "falsy");
});

test("logical operators return their operands", () => {
  assert.equal(value("nil || 5"), 5);
  assert.equal(value('false || "fallback"'), "fallback");
  assert.equal(value("1 && 2"), 2);
  assert.equal(value("nil && 2"), null);
  assert.equal(value("!nil"), true);
});

test("blocks and if expressions produce values", () => {
  assert.equal(value("if 1 < 2 { 10 } else { 20 }"), 10);
  assert.equal(value("let x = if true { 1 } else { 2 }\nx"), 1);
  assert.equal(value("if false { 1 }"), null);
  assert.equal(value("fn f() { 1\n2 }\nf()"), 2);
});

test("assignments update outer bindings", () => {
  assert.equal(value("let x = 1\nx = x + 2\nx"), 3);
  assert.equal(value("let x = 1\nx += 2\nx"), 3);
  assert.equal(value("let x = 10\nx /= 2\nx"), 5);
});

test("blocks have their own scope", () => {
  assert.equal(value("let x = 1\nif true { let x = 2 }\nx"), 1);
  assert.equal(value("let x = 1\nif true { x = 2 }\nx"), 2);
});

test("functions close over their defining scope", () => {
  assert.equal(
    value("fn counter() {\n  let n = 0\n  fn() { n = n + 1\n n }\n}\nlet c = counter()\nc()\nc()"),
    2,
  );
  assert.equal(value("fn add(a, b) { a + b }\nadd(2, 3)"), 5);
  assert.equal(value("let double = fn(x) { x * 2 }\ndouble(21)"), 42);
});

test("supports recursion, including named function expressions", () => {
  assert.equal(value("fn fib(n) { if n < 2 { n } else { fib(n - 1) + fib(n - 2) } }\nfib(15)"), 610);
  assert.equal(
    value("let fact = fn f(n) { if n <= 1 { 1 } else { n * f(n - 1) } }\nfact(5)"),
    120,
  );
});

test("return exits early", () => {
  assert.equal(value('fn f(n) { if n > 0 { return "pos" }\n "non-pos" }\nf(1)'), "pos");
  assert.equal(value("fn f() { return }\nf()"), null);
  assert.equal(
    value("fn indexOf(xs, target) {\n  for i, x in xs { if x == target { return i } }\n  -1\n}\nindexOf([5, 6, 7], 6)"),
    1,
  );
});

test("pipes pass the left value as the first argument", () => {
  assert.deepEqual(value("[1, 2, 3] |> map(fn(x) { x * x })"), [1, 4, 9]);
  assert.equal(value('"caligo" |> upper()'), "CALIGO");
  assert.equal(value("fn add(a, b) { a + b }\n2 |> add(3) |> add(4)"), 9);
  assert.equal(value("[1, 2, 3] |> filter(fn(x) { x > 1 }) |> len()"), 2);
});

test("matches literals, bindings, wildcards, lists and maps", () => {
  assert.equal(value('match 3 { 1 => "one", 3 => "three", _ => "other" }'), "three");
  assert.equal(value("match [1, 2] { [a, b] => a + b, _ => 0 }"), 3);
  assert.equal(value("match [1, 2, 3] { [a, b] => a + b, _ => 0 }"), 0);
  assert.deepEqual(value("match [1, 2, 3] { [head, ...tail] => tail, _ => [] }"), [2, 3]);
  assert.equal(value('match { name: "caligo", age: 3 } { { name: n } => n, _ => "?" }'), "caligo");
  assert.equal(value("match [1, { a: 2 }] { [x, { a: y }] => x + y, _ => 0 }"), 3);
  assert.equal(value('match -1 { -1 => "negative one", _ => "other" }'), "negative one");
});

test("match arms can run blocks", () => {
  assert.equal(value('let x = 2\nmatch x { 0 => "zero", _ => { let y = x * 2\n y } }'), 4);
});

test("a match without a matching arm is a runtime error", () => {
  const error = failure('match 5 { 1 => "one" }');
  assert.match(error.title, /no match arm matched/);
  assert.match(error.hint, /wildcard/);
});

test("for loops walk lists, maps and strings", () => {
  assert.equal(value("let total = 0\nfor x in [1, 2, 3] { total += x }\ntotal"), 6);
  assert.deepEqual(value("let seen = []\nfor i, x in [10, 20] { seen = append(seen, i + x) }\nseen"), [10, 21]);
  assert.deepEqual(value('let m = { a: 1, b: 2 }\nlet keys = []\nfor k in m { keys = append(keys, k) }\nkeys'), [
    "a",
    "b",
  ]);
  assert.equal(value('let n = 0\nfor ch in "abc" { n += 1 }\nn'), 3);
});

test("loop variables are fresh per iteration", () => {
  assert.deepEqual(
    value("let fns = []\nfor x in [10, 20] { fns = append(fns, fn() { x }) }\nmap(fns, fn(f) { f() })"),
    [10, 20],
  );
});

test("break and continue work inside loops", () => {
  assert.equal(value("let i = 0\nwhile true { i += 1\n if i > 3 { break } }\ni"), 4);
  assert.equal(value("let total = 0\nfor x in [1, 2, 3, 4] { if x % 2 == 0 { continue }\n total += x }\ntotal"), 4);
});

test("indexes lists, strings and maps", () => {
  assert.equal(value("[10, 20, 30][1]"), 20);
  assert.equal(value("[10, 20, 30][-1]"), 30);
  assert.equal(value('"abc"[1]'), "b");
  assert.equal(value('"a😀b"[1]'), "😀");
  assert.equal(value('{ name: "caligo" }.name'), "caligo");
  assert.equal(value('let m = { "two words": 2 }\nm["two words"]'), 2);
});

test("collections are immutable", () => {
  assert.deepEqual(value("let a = [1, 2]\nlet b = setAt(a, 0, 9)\n[a, b]"), [
    [1, 2],
    [9, 2],
  ]);
  assert.deepEqual(value("let a = [1]\nlet b = append(a, 2)\n[a, b]"), [[1], [1, 2]]);
  assert.equal(value('let m = { a: 1 }\nlet n = put(m, "b", 2)\ntoJson(m)'), '{"a":1}');
});

test("string interpolation uses display form", () => {
  assert.equal(value('"hi, ${upper("caligo")}!"'), "hi, CALIGO!");
  assert.equal(value('"sum: ${1 + 2}"'), "sum: 3");
  assert.equal(value('"list: ${[1, 2]}"'), "list: [1, 2]");
});

test("the args global holds the argv tail", () => {
  assert.deepEqual(value("args", { args: ["a", "b"] }), ["a", "b"]);
});

test("reports undefined variables with a suggestion", () => {
  const error = failure("let count = 1\nprint(cuont)");
  assert.match(error.title, /undefined variable `cuont`/);
  assert.match(error.hint, /did you mean `count`/);
});

test("rejects assignment to constants", () => {
  const error = failure("const x = 1\nx = 2");
  assert.match(error.title, /cannot assign to the constant `x`/);
  assert.match(error.hint, /`let`/);
});

test("reports division and modulo by zero", () => {
  assert.match(failure("1 / 0").title, /division by zero/);
  assert.match(failure("1 % 0").title, /modulo by zero/);
});

test("reports type errors with types", () => {
  assert.match(failure('"x" + 1').title, /cannot add string and number/);
  assert.match(failure("1 < \"a\"").title, /cannot compare number with string/);
  assert.match(failure("1()").title, /cannot call a number/);
});

test("reports wrong arity", () => {
  assert.match(failure("fn f(a) { a }\nf(1, 2)").title, /expects 1 argument, got 2/);
  assert.match(failure("fn f(a) { a }\nf()").title, /expects 1 argument, got 0/);
});

test("reports out of range indexes", () => {
  const error = failure("[1, 2][5]");
  assert.match(error.title, /out of range/);
  assert.match(error.hint, /0\.\.1/);
});

test("reports missing map keys", () => {
  assert.match(failure('{ a: 1 }["b"]').title, /no key "b"/);
  assert.match(failure("{ a: 1 }.b").hint, /did you mean `\.a`/);
});

test("stops runaway programs", () => {
  const error = failure("let i = 0\nwhile true { i += 1 }", { maxSteps: 100 });
  assert.match(error.title, /infinite loop/);
  assert.match(error.hint, /eventually stops/);
});

test("stops runaway recursion", () => {
  const error = failure("fn f(n) { f(n + 1) }\nf(0)", { maxDepth: 25 });
  assert.match(error.title, /maximum call depth/);
});

test("reports runtime errors with a stack of frames", () => {
  const error = failure("fn inner() { nope }\nfn outer() { inner() }\nouter()");
  assert.deepEqual(
    error.frames.map((frame) => frame.name),
    ["inner", "outer"],
  );
});

test("records trace events when asked", () => {
  const events = [];
  evaluate("let x = 1\nx + 1", { onStep: (event) => events.push(event) });
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "stmt");
  assert.equal(events[0].line, 1);
  assert.equal(events[0].label, "let x");
  assert.ok(events[0].variables.some((variable) => variable.name === "x" && variable.value === "1"));
  assert.equal(events[1].label, "+ expression");
});

test("print output is collected in order", () => {
  assert.deepEqual(printed('print("a")\nprint(1, true, [2])'), ["a", "1 true [2]"]);
});
