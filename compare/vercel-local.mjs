// Serves the Vercel Build Output (.vercel/output) locally, so the production
// Astro build can be compared with `next start` without deploying.
// Implements the subset of the Build Output API v3 routing this app uses:
// regex routes with headers/status, "continue", the "filesystem" handle,
// and functions (`dest` pointing at a .func folder).
// Usage: node compare/vercel-local.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.vercel/output");
const port = Number(process.argv[2] ?? 4321);
const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".png": "image/png",
};

const functions = new Map();
async function loadFunction(name) {
  if (!functions.has(name)) {
    const dir = path.join(root, "functions", `${name}.func`);
    const vc = JSON.parse(await readFile(path.join(dir, ".vc-config.json"), "utf8"));
    const mod = await import(pathToFileURL(path.join(dir, vc.handler)).href);
    functions.set(name, mod.default);
  }
  return functions.get(name);
}

async function findStatic(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  for (const candidate of [rel, path.posix.join(rel, "index.html")]) {
    const file = path.join(root, "static", candidate);
    if (!file.startsWith(path.join(root, "static"))) return null;
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return file;
  }
  return null;
}

async function sendFile(res, file, status, headers) {
  const body = await readFile(file);
  res.writeHead(status, {
    "content-type": types[path.extname(file)] ?? "application/octet-stream",
    ...headers,
  });
  res.end(body);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    const headers = {};
    let afterFilesystem = false;

    for (const route of config.routes) {
      if (route.handle === "filesystem") {
        const file = await findStatic(url.pathname);
        if (file) return await sendFile(res, file, 200, headers);
        afterFilesystem = true;
        continue;
      }
      if (route.handle) continue;
      const match = new RegExp(route.src).exec(url.pathname);
      if (!match) continue;

      for (const [k, v] of Object.entries(route.headers ?? {})) {
        headers[k.toLowerCase()] = v.replace(/\$(\d+)/g, (_, i) => match[Number(i)] ?? "");
      }
      if (route.continue) continue;

      if (route.status && !route.dest) {
        res.writeHead(route.status, headers);
        return res.end();
      }
      if (route.dest) {
        if (afterFilesystem && route.dest.startsWith("/")) {
          const file = await findStatic(route.dest);
          if (file) return await sendFile(res, file, route.status ?? 200, headers);
        }
        const handler = await loadFunction(route.dest.replace(/^\//, ""));
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
        });
        const response = await handler.fetch(request);
        res.writeHead(response.status, { ...headers, ...Object.fromEntries(response.headers) });
        if (response.body) Readable.fromWeb(response.body).pipe(res);
        else res.end();
        return;
      }
    }
    res.writeHead(404);
    res.end("Not Found");
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end("Local server error");
  }
}).listen(port, () => console.log(`Vercel output served at http://localhost:${port}`));
