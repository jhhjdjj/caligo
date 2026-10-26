/**
 * Caligo's public API.
 *
 * The CLI, the playground and the test suite all go through `run()`, which
 * never throws: it returns either a value or a structured diagnostic. That
 * makes it safe to call from an event handler in the browser.
 */

import { formatAst } from "./ast.js";
import { builtinDocs } from "./builtins.js";
import { formatDiagnostic, toDiagnostic } from "./errors.js";
import { Interpreter } from "./interpreter.js";
import { Lexer, tokenize } from "./lexer.js";
import { parse, stripBom } from "./parser.js";
import { VERSION } from "./version.js";
import { display, inspect, typeName } from "./values.js";

/**
 * Parse and evaluate a Caligo program.
 *
 * @param {string} source
 * @param {{
 *   onOutput?: (line: string) => void,
 *   onStep?: ((event: object) => void) | null,
 *   args?: string[],
 *   filename?: string | null,
 *   maxSteps?: number,
 *   maxDepth?: number,
 *   maxEvents?: number,
 *   global?: object | null,
 * }} [options]
 */
export function run(source, options = {}) {
  const text = stripBom(source);
  const output = [];
  const write = options.onOutput ?? ((line) => output.push(line));
  let ast = null;
  let interpreter = null;

  try {
    ast = parse(text);
    interpreter = new Interpreter({
      output: write,
      onStep: options.onStep ?? null,
      args: options.args ?? [],
      source: text,
      maxSteps: options.maxSteps,
      maxDepth: options.maxDepth,
      maxEvents: options.maxEvents,
      global: options.global ?? null,
    });
    const value = interpreter.run(ast);
    return {
      ok: true,
      value,
      output,
      ast,
      error: null,
      steps: interpreter.steps,
      events: interpreter.eventCount,
      eventsTruncated: interpreter.eventsTruncated,
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      output,
      ast,
      error: toDiagnostic(error, text, { filename: options.filename ?? null }),
      steps: interpreter?.steps ?? 0,
      events: interpreter?.eventCount ?? 0,
      eventsTruncated: interpreter?.eventsTruncated ?? false,
    };
  }
}

export {
  VERSION,
  parse,
  Interpreter,
  Lexer,
  tokenize,
  formatAst,
  builtinDocs,
  formatDiagnostic,
  toDiagnostic,
  inspect,
  display,
  typeName,
};
