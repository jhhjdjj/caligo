/**
 * Generate docs/builtins.md from the builtin metadata in src/builtins.js.
 *
 * `npm run docs:builtins` — CI verifies the committed file is up to date.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinDocs } from "../src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const escapeCell = (text) => text.replace(/\|/gu, "\\|");

const rows = builtinDocs()
  .map((entry) => `| \`${escapeCell(entry.signature)}\` | ${escapeCell(entry.doc)} |`)
  .join("\n");

const content = `# Builtins

Caligo ships with a small standard library. Every function is a plain value, so you
can pass it around like any other function:

\`\`\`caligo
let shout = upper
print(map(["hi", "there"], shout))
\`\`\`

This page is generated from the source with \`npm run docs:builtins\`.

| Signature | Description |
| --- | --- |
${rows}
`;

writeFileSync(path.join(root, "docs", "builtins.md"), content, "utf8");
console.log(`wrote docs/builtins.md (${builtinDocs().length} builtins)`);
