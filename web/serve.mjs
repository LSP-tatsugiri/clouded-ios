// Static server for web/. Node 20+, no dependencies.
//
//   node web/serve.mjs          # http://localhost:5173
//   node web/serve.mjs 8080
//
// A server is needed because ES modules do not load over file://. This one is
// for local development only and serves two directories to this one machine.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.argv[2]) || 5173;

// The browser can only fetch inside the served root, so the shared pure
// modules are mounted rather than copied (docs/refactor-extraction-core.md).
// Narrow on purpose: extraction/.env holds the Anthropic key and sits one
// level above extraction/src/, so it is not reachable through this mount.
// Step 7 hosting has to reproduce this mapping, or serve the file from a path
// the page can reach.
const MOUNTS = [
  ["/extraction/src/", fileURLToPath(new URL("../extraction/src/", import.meta.url))]
];

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

// normalize() resolves ".." first, so anything still climbing out is an
// attempt at traversal rather than a stray path segment.
function safeRel(p) {
  const rel = normalize(p).replace(/^[/\\]+/, "");
  return rel.split(sep).includes("..") ? null : rel;
}

// Prefixes are matched before normalize(), because normalize() rewrites "/"
// to "\" on Windows and the mount keys are URL paths.
function resolvePath(decoded) {
  for (const [prefix, base] of MOUNTS) {
    if (decoded.startsWith(prefix)) {
      const rel = safeRel(decoded.slice(prefix.length));
      return rel ? join(base, rel) : null;
    }
  }
  const rel = safeRel(decoded);
  if (rel === null) return null;
  return join(ROOT, rel === "" ? "index.html" : rel);
}

// Everything is inside the try: a throw out here takes the whole server down,
// and one malformed request should not end the session.
const server = createServer(async (req, res) => {
  try {
    // Collapse leading slashes first. "//" parses as a protocol-relative URL
    // with an empty host, which throws, and any page can request it.
    const target = (req.url || "/").replace(/^\/+/, "/");
    const decoded = decodeURIComponent(new URL(target, "http://localhost").pathname);
    const path = resolvePath(decoded);
    if (path === null) { res.writeHead(403).end("forbidden"); return; }

    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      "cache-control": "no-store"
    }).end(body);
  } catch (err) {
    // TypeError: unparseable URL. URIError: bad percent-encoding.
    const bad = err instanceof TypeError || err instanceof URIError;
    const missing = err.code === "ENOENT" || err.code === "EISDIR";
    const code = bad ? 400 : missing ? 404 : 500;
    res.writeHead(code).end(bad ? "bad request" : missing ? "not found" : "error");
  }
});

// Listening without a host binds dual-stack, so both ::1 and 127.0.0.1 answer.
// On Windows `localhost` resolves to ::1 first, and binding 127.0.0.1 alone
// made the browser fail to connect. HOST=127.0.0.1 narrows it back if wanted.
const HOST = process.env.HOST;
server.listen(PORT, HOST, () => {
  console.log(`clouded → http://localhost:${PORT}`);
  console.log("ctrl-c to stop");
});
