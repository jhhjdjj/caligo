/**
 * Runtime value helpers: functions, type names, equality and printing.
 *
 * Caligo values are plain JavaScript values:
 *   nil -> null, bool -> boolean, number -> number, string -> string,
 *   list -> Array, map -> null-prototype object, function -> CaligoFunction | NativeFunction.
 *
 * Lists and maps are immutable by convention: the language has no assignment
 * through an index, and every builtin that "changes" a collection returns a new
 * one. That removes a whole class of aliasing bugs and keeps equality simple.
 */

export class CaligoFunction {
  /**
   * @param {{ name?: string | null, params: string[], body: object, closure: object }} options
   */
  constructor({ name = null, params, body, closure }) {
    this.name = name ?? null;
    this.params = params;
    this.body = body;
    this.closure = closure;
  }
}

export class NativeFunction {
  /**
   * @param {{ name: string, params: string[], min: number, max: number, doc: string, returns?: string, call: Function }} options
   */
  constructor({ name, params, min, max, doc, returns = "any", call }) {
    this.name = name;
    this.params = params;
    this.min = min;
    this.max = max;
    this.doc = doc;
    this.returns = returns;
    this.call = call;
  }

  get signature() {
    return `${this.name}(${this.params.join(", ")})${this.returns && this.returns !== "nil" ? ` -> ${this.returns}` : ""}`;
  }
}

export function isCallable(value) {
  return value instanceof CaligoFunction || value instanceof NativeFunction;
}

export function isMap(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isCallable(value);
}

export function typeName(value) {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return "list";
  if (isCallable(value)) return "function";
  return "map";
}

/** Format a number the way Caligo prints it (15 significant digits, no trailing `.0`). */
export function formatNumber(value) {
  if (Number.isNaN(value)) return "nan";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  if (Object.is(value, -0) || value === 0) return "0";
  if (Number.isInteger(value)) return String(value);
  const rounded = Number(value.toPrecision(15));
  return String(rounded);
}

export function quote(value) {
  const escaped = value
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, "\\n")
    .replace(/\t/gu, "\\t")
    .replace(/\r/gu, "\\r");
  return `"${escaped}"`;
}

export function functionLabel(value) {
  return `<fn ${value.name ?? "anonymous"}>`;
}

const IDENTIFIER_KEY = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function mapKeyLabel(key) {
  return IDENTIFIER_KEY.test(key) ? key : quote(key);
}

export function createMap(entries = []) {
  const map = Object.create(null);
  for (const [key, value] of entries) map[key] = value;
  return map;
}

export function mapEntries(value) {
  return Object.entries(value);
}

/** Human readable form used by `print` and string interpolation. */
export function display(value) {
  if (typeof value === "string") return value;
  return inspect(value);
}

/** Exact form used inside collections, the REPL and error messages. */
export function inspect(value) {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return quote(value);
  if (Array.isArray(value)) return `[${value.map(inspect).join(", ")}]`;
  if (isCallable(value)) return functionLabel(value);
  const entries = mapEntries(value);
  if (!entries.length) return "{}";
  return `{ ${entries.map(([key, item]) => `${mapKeyLabel(key)}: ${inspect(item)}`).join(", ")} }`;
}

export function truthy(value) {
  return value !== null && value !== false;
}

/** Structural equality for every Caligo value. */
export function equals(left, right) {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (!equals(left[i], right[i])) return false;
    }
    return true;
  }
  if (isMap(left) && isMap(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!Object.hasOwn(right, key)) return false;
      if (!equals(left[key], right[key])) return false;
    }
    return true;
  }
  return false;
}

/** A short, single-line rendering used by the playground's variable tracer. */
export function preview(value, maxLength = 48) {
  const text = inspect(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
