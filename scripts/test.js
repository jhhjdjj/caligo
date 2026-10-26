/**
 * Test entry point.
 *
 * `node --test` spawns one child process per test file, which is the canonical
 * way to run a Node test suite. This runner imports every `*.test.js` file into
 * a single process instead: same tests, same `node:test` assertions, but no
 * child processes. That keeps `npm test` working in restricted environments
 * (sandboxes that deny process spawning) and makes the suite start instantly.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const testDirectory = path.join(here, "..", "test");

const files = readdirSync(testDirectory)
  .filter((file) => file.endsWith(".test.js"))
  .sort();

if (files.length === 0) {
  console.error("no test files found");
  process.exitCode = 1;
} else {
  for (const file of files) {
    await import(pathToFileURL(path.join(testDirectory, file)).href);
  }
}
