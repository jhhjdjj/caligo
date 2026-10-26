/**
 * The Caligo standard library.
 *
 * Every builtin is a `NativeFunction` with metadata (params, doc, return type)
 * so the CLI, the docs and the playground reference panel are all generated
 * from the same source of truth.
 *
 * Builtins never mutate their arguments: list/map helpers return fresh values.
 */

import {
  NativeFunction,
  createMap,
  display,
  equals,
  isCallable,
  isMap,
  mapEntries,
  typeName,
  truthy,
} from "./values.js";

/** @type {Map<string, NativeFunction>} */
const registry = new Map();

function define({ name, params, doc, returns = "nil", min = params.length, max = params.length, call }) {
  if (registry.has(name)) throw new Error(`duplicate builtin: ${name}`);
  const fn = new NativeFunction({ name, params, min, max, doc, returns, call });
  registry.set(name, fn);
  return fn;
}

export function getBuiltin(name) {
  return registry.get(name) ?? null;
}

export function builtinNames() {
  return [...registry.keys()].sort();
}

export function builtinDocs() {
  return [...registry.values()]
    .map((fn) => ({
      name: fn.name,
      signature: fn.signature,
      doc: fn.doc,
      returns: fn.returns,
      params: fn.params,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Argument helpers                                                    */
/* ------------------------------------------------------------------ */

function expectList(value, ctx, position) {
  if (!Array.isArray(value)) ctx.fail(`${position} must be a list, got ${typeName(value)}`);
  return value;
}

function expectMap(value, ctx, position) {
  if (!isMap(value)) ctx.fail(`${position} must be a map, got ${typeName(value)}`);
  return value;
}

function expectString(value, ctx, position) {
  if (typeof value !== "string") ctx.fail(`${position} must be a string, got ${typeName(value)}`);
  return value;
}

function expectNumber(value, ctx, position) {
  if (typeof value !== "number") ctx.fail(`${position} must be a number, got ${typeName(value)}`);
  return value;
}

function expectInteger(value, ctx, position) {
  expectNumber(value, ctx, position);
  if (!Number.isInteger(value)) ctx.fail(`${position} must be an integer, got ${value}`);
  return value;
}

function expectFunction(value, ctx, position) {
  if (!isCallable(value)) ctx.fail(`${position} must be a function, got ${typeName(value)}`);
  return value;
}

function clampIndex(index, length, ctx, what) {
  expectInteger(index, ctx, what);
  const normalized = index < 0 ? length + index : index;
  return Math.max(0, Math.min(length, normalized));
}

function compareValues(left, right, ctx) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") return left < right ? -1 : left > right ? 1 : 0;
  ctx.fail(`cannot compare ${typeName(left)} with ${typeName(right)}`, "sort needs values of the same type");
}

/* ------------------------------------------------------------------ */
/* Core                                                                */
/* ------------------------------------------------------------------ */

define({
  name: "print",
  params: ["...values"],
  min: 0,
  max: Infinity,
  doc: "Print the values on one line, separated by spaces.",
  call(args, ctx) {
    ctx.write(args.map((value) => display(value)).join(" "));
    return null;
  },
});

define({
  name: "str",
  params: ["value"],
  returns: "string",
  doc: "Convert any value to its display string.",
  call(args) {
    return display(args[0]);
  },
});

define({
  name: "num",
  params: ["value"],
  returns: "number",
  doc: 'Convert a string or number to a number. `num("2.5")` is `2.5`.',
  call(args, ctx) {
    const value = args[0];
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) ctx.fail("cannot convert an empty string to a number");
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) ctx.fail(`cannot convert ${JSON.stringify(value)} to a number`);
      return parsed;
    }
    ctx.fail(`num expects a string or a number, got ${typeName(value)}`);
  },
});

define({
  name: "bool",
  params: ["value"],
  returns: "bool",
  doc: "Return the truthiness of a value. Only `nil` and `false` are falsy.",
  call(args) {
    return truthy(args[0]);
  },
});

define({
  name: "type",
  params: ["value"],
  returns: "string",
  doc: 'Return the type name: "nil", "bool", "number", "string", "list", "map" or "function".',
  call(args) {
    return typeName(args[0]);
  },
});

define({
  name: "len",
  params: ["value"],
  returns: "number",
  doc: "Length of a string (in characters), list, or map.",
  call(args, ctx) {
    const value = args[0];
    if (typeof value === "string") return [...value].length;
    if (Array.isArray(value)) return value.length;
    if (isMap(value)) return Object.keys(value).length;
    ctx.fail(`len expects a string, list or map, got ${typeName(value)}`);
  },
});

define({
  name: "range",
  params: ["start", "end?"],
  returns: "list",
  min: 1,
  max: 2,
  doc: "Build a list of integers: `range(4)` is `[0, 1, 2, 3]`, `range(2, 5)` is `[2, 3, 4]`.",
  call(args, ctx) {
    let start = 0;
    let end;
    if (args.length === 1) {
      end = expectInteger(args[0], ctx, "the argument of `range`");
    } else {
      start = expectInteger(args[0], ctx, "the start of `range`");
      end = expectInteger(args[1], ctx, "the end of `range`");
    }
    const count = end - start;
    if (count < 0) ctx.fail(`range(${start}, ${end}) counts backwards — the start must not exceed the end`);
    if (count > 1_000_000) ctx.fail("range is limited to 1,000,000 items");
    return Array.from({ length: count }, (_, index) => start + index);
  },
});

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

define({
  name: "map",
  params: ["list", "fn"],
  returns: "list",
  doc: "Return a new list containing `fn(item)` for every item.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the first argument of `map`");
    const fn = expectFunction(args[1], ctx, "the second argument of `map`");
    return list.map((item) => ctx.call(fn, [item]));
  },
});

define({
  name: "filter",
  params: ["list", "fn"],
  returns: "list",
  doc: "Keep the items for which `fn(item)` is truthy.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the first argument of `filter`");
    const fn = expectFunction(args[1], ctx, "the second argument of `filter`");
    return list.filter((item) => truthy(ctx.call(fn, [item])));
  },
});

define({
  name: "reduce",
  params: ["list", "initial", "fn"],
  doc: "Fold a list into one value: `reduce(list, 0, fn(acc, item) { acc + item })`.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the first argument of `reduce`");
    const fn = expectFunction(args[2], ctx, "the third argument of `reduce`");
    let accumulator = args[1];
    for (const item of list) accumulator = ctx.call(fn, [accumulator, item]);
    return accumulator;
  },
});

define({
  name: "find",
  params: ["list", "fn"],
  doc: "Return the first item for which `fn(item)` is truthy, or `nil`.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the first argument of `find`");
    const fn = expectFunction(args[1], ctx, "the second argument of `find`");
    for (const item of list) {
      if (truthy(ctx.call(fn, [item]))) return item;
    }
    return null;
  },
});

define({
  name: "any",
  params: ["list", "fn"],
  returns: "bool",
  doc: "True when `fn(item)` is truthy for at least one item.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the first argument of `any`");
    const fn = expectFunction(args[1], ctx, "the second argument of `any`");
    return list.some((item) => truthy(ctx.call(fn, [item])));
  },
});

define({
  name: "all",
  params: ["list", "fn"],
  returns: "bool",
  doc: "True when `fn(item)` is truthy for every item.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the first argument of `all`");
    const fn = expectFunction(args[1], ctx, "the second argument of `all`");
    return list.every((item) => truthy(ctx.call(fn, [item])));
  },
});

define({
  name: "each",
  params: ["list", "fn"],
  doc: "Call `fn(item)` for its side effects and return `nil`.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the first argument of `each`");
    const fn = expectFunction(args[1], ctx, "the second argument of `each`");
    for (const item of list) ctx.call(fn, [item]);
    return null;
  },
});

define({
  name: "append",
  params: ["list", "...values"],
  returns: "list",
  min: 2,
  max: Infinity,
  doc: "Return a new list with the values appended.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the first argument of `append`");
    return [...list, ...args.slice(1)];
  },
});

define({
  name: "concat",
  params: ["first", "second"],
  doc: "Join two lists or two strings.",
  call(args, ctx) {
    const [first, second] = args;
    if (Array.isArray(first) && Array.isArray(second)) return [...first, ...second];
    if (typeof first === "string" && typeof second === "string") return first + second;
    ctx.fail(`concat expects two lists or two strings, got ${typeName(first)} and ${typeName(second)}`);
  },
});

define({
  name: "slice",
  params: ["value", "start", "end?"],
  min: 2,
  max: 3,
  doc: "Take a section of a list or string. Negative indexes count from the end.",
  call(args, ctx) {
    const value = args[0];
    const isText = typeof value === "string";
    if (!isText && !Array.isArray(value)) ctx.fail(`slice expects a list or a string, got ${typeName(value)}`);
    const items = isText ? [...value] : value;
    const start = clampIndex(args[1], items.length, ctx, "the start of `slice`");
    const end = args.length > 2 ? clampIndex(args[2], items.length, ctx, "the end of `slice`") : items.length;
    const result = start >= end ? [] : items.slice(start, end);
    return isText ? result.join("") : result;
  },
});

define({
  name: "setAt",
  params: ["list", "index", "value"],
  returns: "list",
  doc: "Return a copy of the list with one item replaced.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the first argument of `setAt`");
    const index = expectInteger(args[1], ctx, "the index of `setAt`");
    const normalized = index < 0 ? list.length + index : index;
    if (normalized < 0 || normalized >= list.length) {
      ctx.fail(`index ${index} is out of range for a list of length ${list.length}`);
    }
    const copy = [...list];
    copy[normalized] = args[2];
    return copy;
  },
});

define({
  name: "reverse",
  params: ["value"],
  doc: "Reverse a list or a string.",
  call(args, ctx) {
    const value = args[0];
    if (Array.isArray(value)) return [...value].reverse();
    if (typeof value === "string") return [...value].reverse().join("");
    ctx.fail(`reverse expects a list or a string, got ${typeName(value)}`);
  },
});

define({
  name: "sort",
  params: ["list", "fn?"],
  returns: "list",
  min: 1,
  max: 2,
  doc: "Return a sorted copy. Pass a comparator `fn(a, b)` returning a number for custom ordering.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the first argument of `sort`");
    const comparator = args.length > 1 ? expectFunction(args[1], ctx, "the comparator of `sort`") : null;
    const decorated = list.map((value, index) => ({ value, index }));
    decorated.sort((left, right) => {
      let result;
      if (comparator) {
        const raw = ctx.call(comparator, [left.value, right.value]);
        if (typeof raw !== "number") {
          ctx.fail(`the comparator of \`sort\` must return a number, got ${typeName(raw)}`, "return a negative, zero or positive number");
        }
        result = raw;
      } else {
        result = compareValues(left.value, right.value, ctx);
      }
      return result === 0 ? left.index - right.index : result;
    });
    return decorated.map((entry) => entry.value);
  },
});

define({
  name: "sum",
  params: ["list"],
  returns: "number",
  doc: "Add up a list of numbers.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the argument of `sum`");
    let total = 0;
    list.forEach((item, index) => {
      expectNumber(item, ctx, `item ${index} of the list passed to \`sum\``);
      total += item;
    });
    return total;
  },
});

/* ------------------------------------------------------------------ */
/* Maps                                                                */
/* ------------------------------------------------------------------ */

define({
  name: "keys",
  params: ["map"],
  returns: "list",
  doc: "Return the keys of a map as a list.",
  call(args, ctx) {
    const map = expectMap(args[0], ctx, "the argument of `keys`");
    return Object.keys(map);
  },
});

define({
  name: "values",
  params: ["map"],
  returns: "list",
  doc: "Return the values of a map as a list.",
  call(args, ctx) {
    const map = expectMap(args[0], ctx, "the argument of `values`");
    return Object.values(map);
  },
});

define({
  name: "has",
  params: ["map", "key"],
  returns: "bool",
  doc: "Check whether a map contains a key.",
  call(args, ctx) {
    const map = expectMap(args[0], ctx, "the first argument of `has`");
    const key = expectString(args[1], ctx, "the key passed to `has`");
    return Object.hasOwn(map, key);
  },
});

define({
  name: "get",
  params: ["map", "key", "default?"],
  min: 2,
  max: 3,
  doc: "Read a key from a map, returning `default` (or `nil`) when it is missing.",
  call(args, ctx) {
    const map = expectMap(args[0], ctx, "the first argument of `get`");
    const key = expectString(args[1], ctx, "the key passed to `get`");
    if (Object.hasOwn(map, key)) return map[key];
    return args.length > 2 ? args[2] : null;
  },
});

define({
  name: "put",
  params: ["map", "key", "value"],
  returns: "map",
  doc: "Return a copy of the map with one key set.",
  call(args, ctx) {
    const map = expectMap(args[0], ctx, "the first argument of `put`");
    const key = expectString(args[1], ctx, "the key passed to `put`");
    return createMap([...mapEntries(map), [key, args[2]]]);
  },
});

define({
  name: "merge",
  params: ["map", "other"],
  returns: "map",
  doc: "Return a shallow merge of two maps; keys in `other` win.",
  call(args, ctx) {
    const left = expectMap(args[0], ctx, "the first argument of `merge`");
    const right = expectMap(args[1], ctx, "the second argument of `merge`");
    return createMap([...mapEntries(left), ...mapEntries(right)]);
  },
});

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

define({
  name: "min",
  params: ["...values"],
  returns: "number",
  min: 1,
  max: Infinity,
  doc: "Smallest of the arguments. `min(list)` also works with a single list.",
  call(args, ctx) {
    const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (!values.length) ctx.fail("min needs at least one number");
    return values.reduce((best, value, index) => {
      expectNumber(value, ctx, `argument ${index + 1} of \`min\``);
      return value < best ? value : best;
    }, Infinity);
  },
});

define({
  name: "max",
  params: ["...values"],
  returns: "number",
  min: 1,
  max: Infinity,
  doc: "Largest of the arguments. `max(list)` also works with a single list.",
  call(args, ctx) {
    const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (!values.length) ctx.fail("max needs at least one number");
    return values.reduce((best, value, index) => {
      expectNumber(value, ctx, `argument ${index + 1} of \`max\``);
      return value > best ? value : best;
    }, -Infinity);
  },
});

define({
  name: "abs",
  params: ["number"],
  returns: "number",
  doc: "Absolute value.",
  call(args, ctx) {
    return Math.abs(expectNumber(args[0], ctx, "the argument of `abs`"));
  },
});

define({
  name: "floor",
  params: ["number"],
  returns: "number",
  doc: "Round down.",
  call(args, ctx) {
    return Math.floor(expectNumber(args[0], ctx, "the argument of `floor`"));
  },
});

define({
  name: "ceil",
  params: ["number"],
  returns: "number",
  doc: "Round up.",
  call(args, ctx) {
    return Math.ceil(expectNumber(args[0], ctx, "the argument of `ceil`"));
  },
});

define({
  name: "round",
  params: ["number"],
  returns: "number",
  doc: "Round to the nearest integer.",
  call(args, ctx) {
    return Math.round(expectNumber(args[0], ctx, "the argument of `round`"));
  },
});

define({
  name: "sqrt",
  params: ["number"],
  returns: "number",
  doc: "Square root.",
  call(args, ctx) {
    const value = expectNumber(args[0], ctx, "the argument of `sqrt`");
    if (value < 0) ctx.fail("sqrt is only defined for numbers >= 0");
    return Math.sqrt(value);
  },
});

define({
  name: "pow",
  params: ["base", "exponent"],
  returns: "number",
  doc: "Raise `base` to the power of `exponent`.",
  call(args, ctx) {
    const base = expectNumber(args[0], ctx, "the base of `pow`");
    const exponent = expectNumber(args[1], ctx, "the exponent of `pow`");
    const result = base ** exponent;
    if (Number.isNaN(result)) ctx.fail(`pow(${base}, ${exponent}) is not a number`);
    return result;
  },
});

/* ------------------------------------------------------------------ */
/* Strings                                                             */
/* ------------------------------------------------------------------ */

define({
  name: "split",
  params: ["text", "separator"],
  returns: "list",
  doc: 'Split a string on a separator. An empty separator splits into characters: `split("abc", "")`.',
  call(args, ctx) {
    const text = expectString(args[0], ctx, "the first argument of `split`");
    const separator = expectString(args[1], ctx, "the separator passed to `split`");
    if (separator === "") return [...text];
    return text.split(separator);
  },
});

define({
  name: "join",
  params: ["list", "separator"],
  returns: "string",
  doc: "Join a list of strings with a separator.",
  call(args, ctx) {
    const list = expectList(args[0], ctx, "the first argument of `join`");
    const separator = expectString(args[1], ctx, "the separator passed to `join`");
    list.forEach((item, index) => {
      if (typeof item !== "string") {
        ctx.fail(
          `join expects a list of strings, but item ${index} is a ${typeName(item)}`,
          "convert the items first, for example: map(items, str) |> join(\", \")",
        );
      }
    });
    return list.join(separator);
  },
});

define({
  name: "upper",
  params: ["text"],
  returns: "string",
  doc: "Convert a string to upper case.",
  call(args, ctx) {
    return expectString(args[0], ctx, "the argument of `upper`").toUpperCase();
  },
});

define({
  name: "lower",
  params: ["text"],
  returns: "string",
  doc: "Convert a string to lower case.",
  call(args, ctx) {
    return expectString(args[0], ctx, "the argument of `lower`").toLowerCase();
  },
});

define({
  name: "trim",
  params: ["text"],
  returns: "string",
  doc: "Remove whitespace from both ends of a string.",
  call(args, ctx) {
    return expectString(args[0], ctx, "the argument of `trim`").trim();
  },
});

define({
  name: "replace",
  params: ["text", "search", "replacement"],
  returns: "string",
  doc: "Replace every occurrence of `search` with `replacement`.",
  call(args, ctx) {
    const text = expectString(args[0], ctx, "the first argument of `replace`");
    const search = expectString(args[1], ctx, "the search text of `replace`");
    const replacement = expectString(args[2], ctx, "the replacement of `replace`");
    if (search === "") ctx.fail("replace cannot search for an empty string");
    return text.split(search).join(replacement);
  },
});

define({
  name: "repeat",
  params: ["text", "times"],
  returns: "string",
  doc: "Repeat a string `times` times.",
  call(args, ctx) {
    const text = expectString(args[0], ctx, "the first argument of `repeat`");
    const times = expectInteger(args[1], ctx, "the second argument of `repeat`");
    if (times < 0) ctx.fail("repeat needs a count >= 0");
    if (text.length * times > 1_000_000) ctx.fail("repeat produced more than 1,000,000 characters");
    return text.repeat(times);
  },
});

define({
  name: "startsWith",
  params: ["text", "prefix"],
  returns: "bool",
  doc: "Check whether a string starts with a prefix.",
  call(args, ctx) {
    const text = expectString(args[0], ctx, "the first argument of `startsWith`");
    const prefix = expectString(args[1], ctx, "the prefix passed to `startsWith`");
    return text.startsWith(prefix);
  },
});

define({
  name: "endsWith",
  params: ["text", "suffix"],
  returns: "bool",
  doc: "Check whether a string ends with a suffix.",
  call(args, ctx) {
    const text = expectString(args[0], ctx, "the first argument of `endsWith`");
    const suffix = expectString(args[1], ctx, "the suffix passed to `endsWith`");
    return text.endsWith(suffix);
  },
});

define({
  name: "contains",
  params: ["collection", "needle"],
  returns: "bool",
  doc: "Check whether a string contains a substring, or a list contains a value.",
  call(args, ctx) {
    const collection = args[0];
    if (typeof collection === "string") {
      return collection.includes(expectString(args[1], ctx, "the needle passed to `contains`"));
    }
    if (Array.isArray(collection)) return collection.some((item) => equals(item, args[1]));
    ctx.fail(`contains expects a string or a list, got ${typeName(collection)}`);
  },
});

/* ------------------------------------------------------------------ */
/* JSON & assertions                                                   */
/* ------------------------------------------------------------------ */

define({
  name: "toJson",
  params: ["value"],
  returns: "string",
  doc: "Serialize a value to a compact JSON string.",
  call(args, ctx) {
    const convert = (value) => {
      if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
        return value;
      }
      if (Array.isArray(value)) return value.map(convert);
      if (isCallable(value)) ctx.fail("cannot convert a function to JSON");
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convert(item)]));
    };
    return JSON.stringify(convert(args[0]));
  },
});

define({
  name: "fromJson",
  params: ["text"],
  doc: "Parse a JSON string into lists, maps and scalar values.",
  call(args, ctx) {
    const text = expectString(args[0], ctx, "the argument of `fromJson`");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      ctx.fail(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const convert = (value) => {
      if (Array.isArray(value)) return value.map(convert);
      if (value && typeof value === "object") return createMap(Object.entries(value).map(([key, item]) => [key, convert(item)]));
      return value;
    };
    return convert(parsed);
  },
});

define({
  name: "assert",
  params: ["condition", "message?"],
  min: 1,
  max: 2,
  doc: "Fail with `message` when `condition` is falsy.",
  call(args, ctx) {
    if (!truthy(args[0])) ctx.fail(args.length > 1 ? display(args[1]) : "assertion failed");
    return null;
  },
});
