import { readFile } from "node:fs/promises";
/**
 * Local preview of the Netlify deployment: serves apps/web/dist and routes /api/* to the real function handler.
 * Usage: GYM_DB_URL=postgres://... pnpm exec tsx scripts/preview-server.mts  (port 8888)
 */
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import handler from "../netlify/functions/api.mts";

const PORT = Number(process.env.PORT ?? 8888);
const DIST = join(import.meta.dirname, "..", "apps", "web", "dist");
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/api/")) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await handler(
      new Request(url, {
        method: req.method,
        headers: req.headers as HeadersInit,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      }),
    );
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const safe = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, safe);
  let body = await readFile(file).catch(() => null);
  if (!body) {
    file = join(DIST, "index.html");
    body = await readFile(file);
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(body);
}).listen(PORT, () => console.log(`preview on http://localhost:${PORT}`));
