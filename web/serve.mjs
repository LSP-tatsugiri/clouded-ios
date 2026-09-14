// Static server for web/. Node 20+, no dependencies.
//
//   node web/serve.mjs          # http://localhost:5173
//   node web/serve.mjs 8080
//
// A server is needed because ES modules do not load over file://. This one is
// for local development only: it binds to 127.0.0.1 and serves this one
// directory, and there is no reason to put it on a network.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.argv[2]) || 5173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
  // normalize() resolves ".." first, so anything still climbing out is an
  // attempt at traversal rather than a stray path segment
  if (rel.split(sep).includes("..")) { res.writeHead(403).end("forbidden"); return; }
  const path = join(ROOT, rel === "" ? "index.html" : rel);

  try {
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      "cache-control": "no-store"
    }).end(body);
  } catch (err) {
    const missing = err.code === "ENOENT" || err.code === "EISDIR";
    res.writeHead(missing ? 404 : 500).end(missing ? "not found" : "error");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`clouded → http://localhost:${PORT}`);
  console.log("ctrl-c to stop");
});
