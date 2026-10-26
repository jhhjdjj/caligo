import assert from "node:assert/strict";
import { run } from "../src/index.js";

/** Run a program and assert that it succeeds. */
export function evaluate(source, options = {}) {
  const result = run(source, options);
  if (!result.ok) {
    const where = result.error.filename ? `${result.error.filename}:` : "";
    assert.fail(
      `expected the program to succeed, but it failed with ${result.error.kind} error ` +
        `"${result.error.title}" at ${where}${result.error.line}:${result.error.column}\n${result.error.snippet}`,
    );
  }
  return result;
}

/** The value of the last expression in a program. */
export function value(source, options = {}) {
  return evaluate(source, options).value;
}

/** Everything the program printed. */
export function printed(source, options = {}) {
  return evaluate(source, options).output;
}

/** Assert the program fails; returns the structured diagnostic. */
export function failure(source, options = {}) {
  const result = run(source, options);
  assert.equal(result.ok, false, `expected the program to fail, but it returned ${JSON.stringify(result.value)}`);
  return result.error;
}

export { assert };
