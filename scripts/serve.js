/**
 * A tiny static file server for local development.
 *
 *   node scripts/serve.js          → http://localhost:4173/
 *   PORT=8080 node scripts/serve.js
 *
 * No dependencies, no watching: reload the browser after an edit.
 */

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".caligo": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end("bad request");
    return;
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = path.resolve(root, `.${pathname}`);

  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    response.writeHead(403).end("forbidden");
    return;
  }

  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 — not found");
    return;
  }

  if (stats.isDirectory()) {
    response.writeHead(302, { location: `${pathname}/` }).end();
    return;
  }

  const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  response.writeHead(200, {
    "content-type": type,
    "content-length": stats.size,
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Caligo playground → http://${host}:${port}/`);
  console.log("Press Ctrl+C to stop.");
});
