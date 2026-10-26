/**
 * Assemble the static site that GitHub Pages serves.
 *
 * The repository layout is already a website (root `index.html` plus `web/`,
 * `src/`, `docs/`), so this script only copies the files that are safe to
 * publish into `_site/` and drops a `.nojekyll` marker.
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "_site");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const files = ["index.html", "README.md", "README.zh-CN.md", "CHANGELOG.md", "LICENSE"];
const directories = ["web", "src", "docs", "examples"];

for (const file of files) {
  if (existsSync(path.join(root, file))) cpSync(path.join(root, file), path.join(output, file));
}

for (const directory of directories) {
  cpSync(path.join(root, directory), path.join(output, directory), { recursive: true });
}

writeFileSync(path.join(output, ".nojekyll"), "");

console.log(`built static site → ${path.relative(root, output)}/`);
