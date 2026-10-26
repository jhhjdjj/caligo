import test from "node:test";
import assert from "node:assert/strict";
import { failure, printed, value } from "./helpers.js";

test("print joins its arguments with spaces", () => {
  assert.deepEqual(printed('print("a", 1, true, nil, [2], { k: 3 })'), ['a 1 true nil [2] { k: 3 }']);
  assert.deepEqual(printed("print()"), [""]);
});

test("str, num, bool and type convert values", () => {
  assert.equal(value("str(1.5)"), "1.5");
  assert.equal(value('str("x")'), "x");
  assert.equal(value('num(" 42 ")'), 42);
  assert.equal(value("num(7)"), 7);
  assert.equal(value("bool(0)"), true);
  assert.equal(value("bool(nil)"), false);
  assert.equal(value("type(print)"), "function");
  assert.equal(value("type(nil)"), "nil");
  assert.match(failure('num("abc")').title, /cannot convert/);
});

test("len counts characters, items and keys", () => {
  assert.equal(value('len("a😀b")'), 3);
  assert.equal(value("len([1, 2])"), 2);
  assert.equal(value("len({ a: 1, b: 2 })"), 2);
  assert.match(failure("len(1)").title, /len expects/);
});

test("range builds integer lists", () => {
  assert.deepEqual(value("range(4)"), [0, 1, 2, 3]);
  assert.deepEqual(value("range(2, 5)"), [2, 3, 4]);
  assert.deepEqual(value("range(2, 2)"), []);
  assert.match(failure("range(3, 1)").title, /counts backwards/);
});

test("map, filter and reduce transform lists", () => {
  assert.deepEqual(value("map([1, 2, 3], fn(x) { x * 2 })"), [2, 4, 6]);
  assert.deepEqual(value("filter([1, 2, 3, 4], fn(x) { x % 2 == 0 })"), [2, 4]);
  assert.equal(value("reduce([1, 2, 3, 4], 0, fn(acc, x) { acc + x })"), 10);
  assert.equal(value("reduce([], 10, fn(acc, x) { acc + x })"), 10);
  assert.match(failure('map([1], "nope")').title, /must be a function/);
});

test("find, any, all and each inspect every item", () => {
  assert.equal(value("find([1, 2, 3], fn(x) { x > 1 })"), 2);
  assert.equal(value("find([1], fn(x) { x > 5 })"), null);
  assert.equal(value("any([1, 2], fn(x) { x > 1 })"), true);
  assert.equal(value("all([1, 2], fn(x) { x > 1 })"), false);
  assert.deepEqual(printed("each([1, 2], fn(x) { print(x) })"), ["1", "2"]);
});

test("append, concat, slice, setAt, reverse and sort return new lists", () => {
  assert.deepEqual(value("append([1], 2, 3)"), [1, 2, 3]);
  assert.deepEqual(value('concat([1], [2])'), [1, 2]);
  assert.equal(value('concat("a", "b")'), "ab");
  assert.deepEqual(value("slice([1, 2, 3, 4], 1, 3)"), [2, 3]);
  assert.equal(value('slice("hello", 1)'), "ello");
  assert.deepEqual(value("setAt([1, 2], 0, 9)"), [9, 2]);
  assert.deepEqual(value("reverse([1, 2, 3])"), [3, 2, 1]);
  assert.equal(value('reverse("abc")'), "cba");
  assert.deepEqual(value("sort([3, 1, 2])"), [1, 2, 3]);
  assert.deepEqual(value("sort([3, 1, 2], fn(a, b) { b - a })"), [3, 2, 1]);
  assert.match(failure('sort([1, "a"])').title, /cannot compare/);
});

test("sum and the numeric helpers do maths", () => {
  assert.equal(value("sum([1, 2, 3])"), 6);
  assert.equal(value("min([3, 1, 2])"), 1);
  assert.equal(value("max(3, 7, 2)"), 7);
  assert.equal(value("abs(-4)"), 4);
  assert.equal(value("floor(3.7)"), 3);
  assert.equal(value("ceil(3.2)"), 4);
  assert.equal(value("round(2.5)"), 3);
  assert.equal(value("sqrt(16)"), 4);
  assert.equal(value("pow(2, 8)"), 256);
  assert.match(failure("sqrt(-1)").title, /only defined/);
  assert.match(failure('sum(["a"])').title, /must be a number/);
});

test("maps are read and copied, never mutated", () => {
  assert.deepEqual(value('keys({ b: 1, a: 2 })'), ["b", "a"]);
  assert.deepEqual(value("values({ a: 1 })"), [1]);
  assert.equal(value('has({ a: 1 }, "a")'), true);
  assert.equal(value('get({ a: 1 }, "b", 7)'), 7);
  assert.equal(value('get({ a: 1 }, "b")'), null);
  assert.equal(value('put({ a: 1 }, "b", 2).b'), 2);
  assert.equal(value('put({ a: 1 }, "b", 2).a'), 1);
  assert.deepEqual(value("keys(merge({ a: 1 }, { b: 2 }))"), ["a", "b"]);
  assert.equal(value("merge({ a: 1 }, { a: 2 }).a"), 2);
  assert.equal(value("toJson(put({ a: 1 }, \"b\", 2))"), '{"a":1,"b":2}');
});

test("string helpers split, join, trim and search", () => {
  assert.deepEqual(value('split("a,b", ",")'), ["a", "b"]);
  assert.deepEqual(value('split("ab", "")'), ["a", "b"]);
  assert.equal(value('join(["a", "b"], "-")'), "a-b");
  assert.equal(value('upper("abc")'), "ABC");
  assert.equal(value('lower("ABC")'), "abc");
  assert.equal(value('trim("  x  ")'), "x");
  assert.equal(value('replace("a-b-a", "a", "z")'), "z-b-z");
  assert.equal(value('repeat("ab", 3)'), "ababab");
  assert.equal(value('startsWith("caligo", "ca")'), true);
  assert.equal(value('endsWith("caligo", "go")'), true);
  assert.equal(value('contains("caligo", "li")'), true);
  assert.equal(value("contains([1, 2], 2)"), true);
  assert.match(failure('join([1], ",")').title, /list of strings/);
});

test("json round trips through toJson and fromJson", () => {
  assert.equal(value('toJson([1, "two", nil, true])'), '[1,"two",null,true]');
  assert.deepEqual(value('fromJson("[1, 2]")'), [1, 2]);
  assert.equal(value('fromJson("{\\"a\\": {\\"b\\": 2}}").a.b'), 2);
  assert.match(failure('fromJson("{")').title, /invalid JSON/);
  assert.match(failure("toJson(print)").title, /function/);
});

test("assert fails with the supplied message", () => {
  assert.equal(value("assert(1 == 1)"), null);
  const error = failure('assert(false, "boom")');
  assert.equal(error.title, "boom");
});
