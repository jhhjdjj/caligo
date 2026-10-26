import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";

const examplesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples");
const files = readdirSync(examplesDirectory)
  .filter((file) => file.endsWith(".caligo"))
  .sort();

test("there are example programs to test", () => {
  assert.ok(files.length >= 5, `expected at least 5 examples, found ${files.length}`);
});

for (const file of files) {
  test(`example ${file} runs`, () => {
    const source = readFileSync(path.join(examplesDirectory, file), "utf8");
    const result = run(source);
    if (!result.ok) {
      assert.fail(`${file} failed: ${result.error.kind} error — ${result.error.title}\n${result.error.snippet}`);
    }
    assert.ok(result.output.length > 0, `${file} should print something`);
  });

  test(`example ${file} documents itself with a title comment`, () => {
    const source = readFileSync(path.join(examplesDirectory, file), "utf8");
    assert.match(source, /^\/\/ title: .+/mu);
    assert.match(source, /^\/\/ description: .+/mu);
  });
}

test("the playground copy of the examples is up to date", () => {
  const generated = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "examples.js"),
    "utf8",
  );
  for (const file of files) {
    const id = file.replace(/\.caligo$/u, "");
    assert.ok(generated.includes(`"id": "${id}"`), `web/examples.js is missing ${id} — run npm run build:examples`);
  }
});
