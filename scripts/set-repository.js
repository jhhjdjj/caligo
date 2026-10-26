/**
 * Point the project at your repository in one command.
 *
 *   node scripts/set-repository.js <github-owner> [repo-name]
 *
 * The published files use `__OWNER__` as a placeholder so nothing ships with a
 * broken link by accident. This script replaces it in the package manifest and
 * both READMEs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const owner = process.argv[2];
const name = process.argv[3] ?? "caligo";

if (!owner) {
  console.error("usage: node scripts/set-repository.js <github-owner> [repo-name]");
  process.exitCode = 2;
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = ["package.json", "README.md", "README.zh-CN.md"];
  let changed = 0;

  for (const file of files) {
    const target = path.join(root, file);
    let text;
    try {
      text = readFileSync(target, "utf8");
    } catch {
      continue;
    }
    const updated = text
      .replaceAll("__OWNER__/caligo", `${owner}/${name}`)
      .replaceAll("__OWNER__.github.io/caligo", `${owner}.github.io/${name}`)
      .replaceAll("__OWNER__", owner);
    if (updated !== text) {
      writeFileSync(target, updated, "utf8");
      console.log(`updated ${file}`);
      changed += 1;
    }
  }

  console.log(
    changed ? `done — repository set to ${owner}/${name}` : "nothing to do (no __OWNER__ placeholders left)",
  );
}
