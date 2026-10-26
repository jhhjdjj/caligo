/**
 * The tree-walking interpreter.
 *
 * Evaluation is deliberately direct: `evaluate(node, env)` with a small switch.
 * Two details carry most of the "real language" feel:
 *
 * 1. Blocks are expressions, so `if`, loops-as-expressions and function bodies
 *    all produce values naturally.
 * 2. Errors are `CaligoError`s with spans; each function call pushes a frame so a
 *    runtime failure can show a stack trace, not just a caret.
 */

import { positionAt, runtimeError, CaligoError, suggestName } from "./errors.js";
import { builtinNames, getBuiltin } from "./builtins.js";
import {
  NativeFunction,
  CaligoFunction,
  createMap,
  display,
  equals,
  isMap,
  preview,
  quote,
  truthy,
  typeName,
} from "./values.js";

/* ------------------------------------------------------------------ */
/* Control-flow signals                                                */
/* ------------------------------------------------------------------ */

class ReturnSignal {
  constructor(value, span) {
    this.value = value;
    this.span = span;
  }
}

class BreakSignal {
  constructor(span) {
    this.span = span;
  }
}

class ContinueSignal {
  constructor(span) {
    this.span = span;
  }
}

/* ------------------------------------------------------------------ */
/* Environments                                                        */
/* ------------------------------------------------------------------ */

export class Env {
  constructor(parent = null) {
    /** @type {Env | null} */
    this.parent = parent;
    /** @type {Map<string, { value: unknown, constant: boolean }>} */
    this.bindings = new Map();
    this.isBuiltins = false;
  }

  define(name, value, { constant = false, span = null } = {}) {
    const existing = this.bindings.get(name);
    if (existing?.constant) {
      throw runtimeError(`cannot redefine the constant \`${name}\``, span, "pick another name");
    }
    this.bindings.set(name, { value, constant });
    return value;
  }

  lookup(name) {
    let environment = this;
    while (environment) {
      const binding = environment.bindings.get(name);
      if (binding) return { environment, binding };
      environment = environment.parent;
    }
    return null;
  }

  has(name) {
    return this.lookup(name) !== null;
  }

  get(name) {
    return this.lookup(name)?.binding.value;
  }

  assign(name, value, span) {
    const found = this.lookup(name);
    if (!found) {
      throw runtimeError(`cannot assign to \`${name}\` because it is not defined`, span, `create it first with \`let ${name} = ...\``);
    }
    if (found.binding.constant) {
      throw runtimeError(`cannot assign to the constant \`${name}\``, span, `declare it with \`let\` instead of \`const\``);
    }
    found.binding.value = value;
    return value;
  }

  names() {
    const names = [];
    let environment = this;
    while (environment) {
      for (const name of environment.bindings.keys()) names.push(name);
      environment = environment.parent;
    }
    return names;
  }
}

/* ------------------------------------------------------------------ */
/* Interpreter                                                         */
/* ------------------------------------------------------------------ */

const BUILTIN_NAMES = builtinNames();

export class Interpreter {
  /**
   * @param {{
   *   output?: (line: string) => void,
   *   onStep?: ((event: object) => void) | null,
   *   args?: string[],
   *   source?: string,
   *   maxSteps?: number,
   *   maxDepth?: number,
   *   maxEvents?: number,
   * }} [options]
   */
  constructor({
    output = () => {},
    onStep = null,
    args = [],
    source = "",
    maxSteps = 200_000,
    maxDepth = 1_000,
    maxEvents = 400,
    global: sharedGlobal = null,
  } = {}) {
    this.output = output;
    this.onStep = onStep;
    this.source = source;
    this.maxSteps = maxSteps;
    this.maxDepth = maxDepth;
    this.maxEvents = maxEvents;

    this.steps = 0;
    this.depth = 0;
    this.frames = [];
    this.eventCount = 0;
    this.eventsTruncated = false;

    /** Builtins live in their own constant scope so user code cannot clobber them. */
    const builtins = new Env(null);
    builtins.isBuiltins = true;
    for (const name of BUILTIN_NAMES) builtins.define(name, getBuiltin(name), { constant: true });
    this.builtins = builtins;

    /** Top-level user bindings. Kept across `run()` calls so a REPL works. */
    this.global = sharedGlobal ?? new Env(builtins);
    if (!this.global.has("args")) this.global.define("args", args, { constant: true });

    this.lineStarts = null;
    if (source) {
      const starts = [0];
      for (let i = 0; i < source.length; i += 1) if (source.charCodeAt(i) === 10) starts.push(i + 1);
      this.lineStarts = starts;
    }
  }

  /**
   * Evaluate a parsed program in the persistent global scope.
   * @param {object} program
   */
  run(program) {
    this.steps = 0;
    this.depth = 0;
    this.frames = [];
    this.eventCount = 0;
    this.eventsTruncated = false;
    try {
      return this.executeBlock(program, this.global, false);
    } catch (error) {
      if (error instanceof ReturnSignal) {
        throw runtimeError("`return` can only be used inside a function", error.span);
      }
      if (error instanceof BreakSignal) {
        throw runtimeError("`break` can only be used inside a loop", error.span);
      }
      if (error instanceof ContinueSignal) {
        throw runtimeError("`continue` can only be used inside a loop", error.span);
      }
      if (error instanceof RangeError && /call stack/iu.test(error.message)) {
        throw runtimeError("stack overflow — the recursion went too deep", null, "add a base case to stop the recursion");
      }
      throw error;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Statements & blocks                                               */
  /* ---------------------------------------------------------------- */

  executeBlock(block, env, createScope = true) {
    const scope = createScope ? new Env(env) : env;
    let value = null;
    for (const statement of block.body) value = this.executeStatement(statement, scope);
    return value;
  }

  /** Count one unit of work and stop runaway programs (the playground's seatbelt). */
  tick(span = null) {
    this.steps += 1;
    if (this.steps > this.maxSteps) {
      throw runtimeError(
        `evaluation stopped after ${this.maxSteps.toLocaleString("en-US")} steps — this looks like an infinite loop`,
        span,
        "check that the loop or recursion eventually stops",
      );
    }
  }

  executeStatement(node, env) {
    this.tick(node.span);

    let value = null;

    switch (node.type) {
      case "Let": {
        value = this.evaluate(node.value, env);
        env.define(node.name, value, { constant: node.isConst, span: node.span });
        value = null;
        break;
      }
      case "FnDecl": {
        const fn = new CaligoFunction({ name: node.name, params: node.params, body: node.body, closure: env });
        env.define(node.name, fn, { span: node.span });
        value = null;
        break;
      }
      case "Break":
        throw new BreakSignal(node.span);
      case "Continue":
        throw new ContinueSignal(node.span);
      case "Return": {
        const returned = node.value ? this.evaluate(node.value, env) : null;
        throw new ReturnSignal(returned, node.span);
      }
      case "While":
        value = this.evaluateWhile(node, env);
        break;
      case "For":
        value = this.evaluateFor(node, env);
        break;
      default:
        value = this.evaluate(node, env);
        break;
    }

    this.emit("stmt", node, env);
    return value;
  }

  /* ---------------------------------------------------------------- */
  /* Expressions                                                       */
  /* ---------------------------------------------------------------- */

  evaluate(node, env) {
    switch (node.type) {
      case "Literal":
        return node.value;

      case "Ident":
        return this.readVariable(node.name, env, node.span);

      case "Str":
        return node.parts
          .map((part) => (part.type === "text" ? part.value : display(this.evaluate(part.expression, env))))
          .join("");

      case "ListExpr":
        return node.items.map((item) => this.evaluate(item, env));

      case "MapExpr":
        return createMap(node.entries.map((entry) => [entry.key, this.evaluate(entry.value, env)]));

      case "Unary": {
        const operand = this.evaluate(node.operand, env);
        if (node.operator === "!") return !truthy(operand);
        if (typeof operand !== "number") {
          throw runtimeError(`unary \`-\` expects a number, got ${typeName(operand)}`, node.span);
        }
        return -operand;
      }

      case "Binary":
        return this.evaluateBinary(node, env);

      case "If": {
        const condition = this.evaluate(node.condition, env);
        if (truthy(condition)) return this.executeBlock(node.consequent, env);
        if (!node.alternate) return null;
        if (node.alternate.type === "If") return this.evaluate(node.alternate, env);
        return this.executeBlock(node.alternate, env);
      }

      case "Call": {
        const callee = this.evaluate(node.callee, env);
        const args = node.args.map((argument) => this.evaluate(argument, env));
        return this.callValue(callee, args, node.span);
      }

      case "Index":
        return this.evaluateIndex(node, env);

      case "Member":
        return this.evaluateMember(node, env);

      case "Match":
        return this.evaluateMatch(node, env);

      case "Fn":
        return new CaligoFunction({ name: node.name, params: node.params, body: node.body, closure: env });

      case "Block":
        return this.executeBlock(node, env);

      case "Assign": {
        const value = this.evaluateAssignValue(node, env);
        return env.assign(node.name, value, node.span);
      }

      case "While":
      case "For":
      case "FnDecl":
      case "Let":
      case "Break":
      case "Continue":
      case "Return":
        throw runtimeError(`${node.type} is a statement and cannot be used as a value`, node.span);

      default:
        throw runtimeError(`cannot evaluate a ${node.type} node`, node.span);
    }
  }

  readVariable(name, env, span) {
    const found = env.lookup(name);
    if (found) return found.binding.value;
    const suggestion = suggestName(name, env.names());
    throw runtimeError(
      `undefined variable \`${name}\``,
      span,
      suggestion ? `did you mean \`${suggestion}\`?` : `declare it first, for example \`let ${name} = ...\``,
    );
  }

  evaluateAssignValue(node, env) {
    const value = this.evaluate(node.value, env);
    if (node.operator === "=") return value;
    const current = this.readVariable(node.name, env, node.span);
    return this.binaryOperation(node.operator[0], current, value, node.span);
  }

  evaluateIndex(node, env) {
    const object = this.evaluate(node.object, env);
    const index = this.evaluate(node.index, env);

    if (Array.isArray(object)) {
      if (typeof index !== "number" || !Number.isInteger(index)) {
        throw runtimeError(`list indexes must be integers, got ${typeName(index)}`, node.index.span);
      }
      const normalized = index < 0 ? object.length + index : index;
      if (normalized < 0 || normalized >= object.length) {
        throw runtimeError(
          `index ${index} is out of range for a list of length ${object.length}`,
          node.span,
          object.length ? `valid indexes are 0..${object.length - 1} or -${object.length}..-1` : "the list is empty",
        );
      }
      return object[normalized];
    }

    if (typeof object === "string") {
      const characters = [...object];
      if (typeof index !== "number" || !Number.isInteger(index)) {
        throw runtimeError(`string indexes must be integers, got ${typeName(index)}`, node.index.span);
      }
      const normalized = index < 0 ? characters.length + index : index;
      if (normalized < 0 || normalized >= characters.length) {
        throw runtimeError(
          `index ${index} is out of range for a string of length ${characters.length}`,
          node.span,
        );
      }
      return characters[normalized];
    }

    if (isMap(object)) {
      if (typeof index !== "string") {
        throw runtimeError(
          `map keys are strings, got ${typeName(index)}`,
          node.index.span,
          index === null ? null : `wrap the key in quotes: map["${display(index)}"]`,
        );
      }
      if (!Object.hasOwn(object, index)) {
        throw runtimeError(
          `the map has no key ${quote(index)}`,
          node.span,
          `use get(map, ${quote(index)}, default) for an optional lookup`,
        );
      }
      return object[index];
    }

    throw runtimeError(
      `cannot index a ${typeName(object)}`,
      node.span,
      "only lists, strings and maps support `[ ]`",
    );
  }

  evaluateMember(node, env) {
    const object = this.evaluate(node.object, env);

    if (isMap(object)) {
      if (Object.hasOwn(object, node.property)) return object[node.property];
      const suggestion = suggestName(node.property, Object.keys(object));
      throw runtimeError(
        `the map has no key ${quote(node.property)}`,
        node.span,
        suggestion ? `did you mean \`.${suggestion}\`?` : "use get(map, key, default) for an optional lookup",
      );
    }

    if (Array.isArray(object)) {
      throw runtimeError(
        `a list has no property \`${node.property}\``,
        node.span,
        "use len(list) for the length, or index it like list[0]",
      );
    }

    if (typeof object === "string") {
      throw runtimeError(
        `a string has no property \`${node.property}\``,
        node.span,
        "use len(text) for the length, or index it like text[0]",
      );
    }

    throw runtimeError(`cannot read the property \`${node.property}\` of a ${typeName(object)}`, node.span);
  }

  evaluateBinary(node, env) {
    const operator = node.operator;

    if (operator === "|>") {
      const value = this.evaluate(node.left, env);
      if (node.right.type === "Call") {
        const callee = this.evaluate(node.right.callee, env);
        const args = node.right.args.map((argument) => this.evaluate(argument, env));
        return this.callValue(callee, [value, ...args], node.span);
      }
      const callee = this.evaluate(node.right, env);
      return this.callValue(callee, [value], node.span);
    }

    if (operator === "&&" || operator === "||") {
      const left = this.evaluate(node.left, env);
      const shortCircuit = operator === "&&" ? !truthy(left) : truthy(left);
      if (shortCircuit) return left;
      return this.evaluate(node.right, env);
    }

    const left = this.evaluate(node.left, env);
    const right = this.evaluate(node.right, env);
    return this.binaryOperation(operator, left, right, node.span);
  }

  binaryOperation(operator, left, right, span) {
    switch (operator) {
      case "+": {
        if (typeof left === "number" && typeof right === "number") return left + right;
        if (typeof left === "string" && typeof right === "string") return left + right;
        if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
        throw runtimeError(
          `cannot add ${typeName(left)} and ${typeName(right)}`,
          span,
          typeof left === "string" || typeof right === "string" ? "use str(...) to turn the other value into text first" : null,
        );
      }
      case "-":
      case "*":
      case "/":
      case "%": {
        if (typeof left !== "number" || typeof right !== "number") {
          throw runtimeError(`\`${operator}\` expects numbers, got ${typeName(left)} and ${typeName(right)}`, span);
        }
        if ((operator === "/" || operator === "%") && right === 0) {
          throw runtimeError(operator === "/" ? "division by zero" : "modulo by zero", span);
        }
        if (operator === "-") return left - right;
        if (operator === "*") return left * right;
        if (operator === "/") return left / right;
        return left % right;
      }
      case "==":
        return equals(left, right);
      case "!=":
        return !equals(left, right);
      case "<":
      case "<=":
      case ">":
      case ">=": {
        const comparable =
          (typeof left === "number" && typeof right === "number") ||
          (typeof left === "string" && typeof right === "string");
        if (!comparable) {
          throw runtimeError(`cannot compare ${typeName(left)} with ${typeName(right)} using \`${operator}\``, span, "only numbers and strings can be ordered");
        }
        if (operator === "<") return left < right;
        if (operator === "<=") return left <= right;
        if (operator === ">") return left > right;
        return left >= right;
      }
      default:
        throw runtimeError(`unknown operator \`${operator}\``, span);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Functions                                                         */
  /* ---------------------------------------------------------------- */

  callValue(value, args, span) {
    if (value instanceof CaligoFunction) return this.callCaligoFunction(value, args, span);
    if (value instanceof NativeFunction) return this.callNativeFunction(value, args, span);
    const hint =
      isMap(value) && Object.hasOwn(value, "name")
        ? "did you mean to call one of the map's functions?"
        : "only functions can be called, e.g. `fn(x) { x * 2 }`";
    throw runtimeError(`cannot call a ${typeName(value)} — it is not a function`, span, hint);
  }

  callNativeFunction(fn, args, span) {
    if (args.length < fn.min || args.length > fn.max) {
      const expected =
        fn.min === fn.max
          ? `${fn.min}`
          : fn.max === Infinity
            ? `at least ${fn.min}`
            : `${fn.min} to ${fn.max}`;
      const plural = fn.min === 1 && fn.max === 1 ? "argument" : "arguments";
      throw runtimeError(`\`${fn.name}\` expects ${expected} ${plural}, got ${args.length}`, span, `signature: ${fn.signature}`);
    }

    const context = {
      call: (callee, callArgs) => this.callValue(callee, callArgs, span),
      fail: (message, hint = null) => {
        throw runtimeError(message, span, hint);
      },
      write: (text) => this.output(text),
    };

    return fn.call(args, context);
  }

  callCaligoFunction(fn, args, span) {
    const label = fn.name ? `\`${fn.name}\`` : "this function";
    if (args.length !== fn.params.length) {
      const plural = fn.params.length === 1 ? "argument" : "arguments";
      throw runtimeError(
        `${label} expects ${fn.params.length} ${plural}, got ${args.length}`,
        span,
        `signature: fn ${fn.name ?? "anonymous"}(${fn.params.join(", ")})`,
      );
    }

    this.depth += 1;
    if (this.depth > this.maxDepth) {
      this.depth -= 1;
      throw runtimeError(
        `maximum call depth of ${this.maxDepth} exceeded`,
        span,
        "a recursive function is probably missing its base case",
      );
    }

    const scope = new Env(fn.closure);
    if (fn.name && !fn.params.includes(fn.name)) scope.define(fn.name, fn, { constant: true });
    fn.params.forEach((param, index) => scope.define(param, args[index], { constant: false }));

    this.frames.push({ name: fn.name ?? "anonymous", span });
    try {
      return this.executeBlock(fn.body, scope, false);
    } catch (error) {
      if (error instanceof ReturnSignal) return error.value;
      if (error instanceof BreakSignal) {
        throw runtimeError("`break` can only be used inside a loop", error.span);
      }
      if (error instanceof ContinueSignal) {
        throw runtimeError("`continue` can only be used inside a loop", error.span);
      }
      if (error instanceof CaligoError && error.frames.length === 0) {
        error.frames = this.frames
          .slice()
          .reverse()
          .map((frame) => ({ name: frame.name, span: frame.span }));
      }
      throw error;
    } finally {
      this.frames.pop();
      this.depth -= 1;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Loops & pattern matching                                          */
  /* ---------------------------------------------------------------- */

  evaluateFor(node, env) {
    const iterable = this.evaluate(node.iterable, env);
    /** @type {Array<unknown[]>} */
    let entries;

    if (Array.isArray(iterable)) {
      entries = iterable.map((value, index) => (node.names.length === 2 ? [index, value] : [value]));
    } else if (typeof iterable === "string") {
      entries = [...iterable].map((character, index) => (node.names.length === 2 ? [index, character] : [character]));
    } else if (isMap(iterable)) {
      entries = Object.entries(iterable).map(([key, value]) => (node.names.length === 2 ? [key, value] : [key]));
    } else {
      throw runtimeError(
        `cannot loop over a ${typeName(iterable)}`,
        node.iterable.span,
        "for loops work with lists, strings and maps",
      );
    }

    for (const entry of entries) {
      this.tick(node.span);
      const loopEnv = new Env(env);
      node.names.forEach((name, index) => loopEnv.define(name, entry[index], { constant: true }));
      try {
        this.executeBlock(node.body, loopEnv, false);
      } catch (error) {
        if (error instanceof BreakSignal) break;
        if (error instanceof ContinueSignal) continue;
        throw error;
      }
    }

    return null;
  }

  evaluateWhile(node, env) {
    while (truthy(this.evaluate(node.condition, env))) {
      this.tick(node.span);
      try {
        this.executeBlock(node.body, env, true);
      } catch (error) {
        if (error instanceof BreakSignal) break;
        if (error instanceof ContinueSignal) continue;
        throw error;
      }
    }
    return null;
  }

  evaluateMatch(node, env) {
    const subject = this.evaluate(node.subject, env);
    for (const arm of node.arms) {
      const bindings = new Map();
      if (this.matchPattern(arm.pattern, subject, bindings)) {
        const scope = new Env(env);
        for (const [name, value] of bindings) scope.define(name, value, { constant: true });
        if (arm.body.type === "Block") return this.executeBlock(arm.body, scope, false);
        return this.evaluate(arm.body, scope);
      }
    }
    throw runtimeError(
      `no match arm matched ${preview(subject, 60)}`,
      node.span,
      "add a wildcard arm: `_ => ...`",
    );
  }

  matchPattern(pattern, value, bindings) {
    switch (pattern.type) {
      case "PatternWildcard":
        return true;
      case "PatternBind":
        bindings.set(pattern.name, value);
        return true;
      case "PatternLiteral":
        return equals(pattern.value, value);
      case "PatternList": {
        if (!Array.isArray(value)) return false;
        if (pattern.rest === null && value.length !== pattern.items.length) return false;
        if (value.length < pattern.items.length) return false;
        for (let index = 0; index < pattern.items.length; index += 1) {
          if (!this.matchPattern(pattern.items[index], value[index], bindings)) return false;
        }
        if (pattern.rest !== null) bindings.set(pattern.rest, value.slice(pattern.items.length));
        return true;
      }
      case "PatternMap": {
        if (!isMap(value)) return false;
        for (const entry of pattern.entries) {
          if (!Object.hasOwn(value, entry.key)) return false;
          if (!this.matchPattern(entry.pattern, value[entry.key], bindings)) return false;
        }
        return true;
      }
      default:
        throw runtimeError(`unknown pattern ${pattern.type}`, pattern.span);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Tracing                                                           */
  /* ---------------------------------------------------------------- */

  positionOf(span) {
    if (!span || !this.lineStarts) return { line: null, column: null };
    const position = positionAt(this.source, span.start, this.lineStarts);
    return { line: position.line, column: position.column };
  }

  snapshot(env) {
    const seen = new Set();
    const variables = [];
    let environment = env;
    let depth = 0;
    while (environment && depth < 8) {
      if (environment.isBuiltins) break;
      for (const [name, binding] of environment.bindings) {
        if (seen.has(name)) continue;
        seen.add(name);
        variables.push({ name, value: preview(binding.value) });
      }
      environment = environment.parent;
      depth += 1;
    }
    return variables.slice(0, 24);
  }

  emit(kind, node, env, label = null) {
    if (!this.onStep) return;
    if (this.eventCount >= this.maxEvents) {
      this.eventsTruncated = true;
      return;
    }
    this.eventCount += 1;
    const { line, column } = this.positionOf(node.span);
    this.onStep({
      index: this.eventCount,
      kind,
      line,
      column,
      label: label ?? describeNode(node),
      variables: this.snapshot(env),
    });
  }
}

/** Short human-readable label for a statement, used by the tracer. */
export function describeNode(node) {
  switch (node.type) {
    case "Let":
      return `${node.isConst ? "const" : "let"} ${node.name}`;
    case "FnDecl":
      return `fn ${node.name}(${node.params.join(", ")})`;
    case "Assign":
      return `${node.name} ${node.operator} …`;
    case "Call":
      return `${calleeLabel(node.callee)}(…)`;
    case "If":
      return "if";
    case "While":
      return "while";
    case "For":
      return `for ${node.names.join(", ")} in …`;
    case "Match":
      return "match";
    case "Return":
      return "return";
    case "Break":
      return "break";
    case "Continue":
      return "continue";
    case "Str":
      return "string";
    case "Ident":
      return node.name;
    case "Member":
      return `.${node.property}`;
    case "Index":
      return "index";
    case "Literal":
      return `literal ${node.raw ?? ""}`.trim();
    case "Binary":
      return `${node.operator} expression`;
    default:
      return node.type;
  }
}

function calleeLabel(callee) {
  if (callee.type === "Ident") return callee.name;
  if (callee.type === "Member") return `${calleeLabel(callee.object)}.${callee.property}`;
  if (callee.type === "Fn") return "fn";
  if (callee.type === "Call") return `${calleeLabel(callee.callee)}()`;
  return "expression";
}
