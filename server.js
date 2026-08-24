import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public/", import.meta.url));
const port = Number(process.env.PORT || 4173);
const upstream = (process.env.CRASH_API_URL || "https://denver.zerovision.dev/map/api").replace(/\/$/, "");

const allowedApiPaths = new Set([
  "/streets",
  "/street-centerlines",
  "/buffered-street-centerlines",
  "/incidents",
  "/incidents/buffered-street",
  "/incidents/buffered-street/history",
]);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function send(res, status, body, type = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, { "content-type": type, ...headers });
  res.end(body);
}

async function proxyApi(req, res, url) {
  const apiPath = url.pathname.slice(4);
  if (!allowedApiPaths.has(apiPath)) {
    send(res, 404, JSON.stringify({ error: "Unknown API route" }), "application/json; charset=utf-8");
    return;
  }

  try {
    const target = `${upstream}${apiPath}${url.search}`;
    const response = await fetch(target, {
      headers: { accept: "application/json", "user-agent": "DenverCrashExplorer/0.1" },
      signal: AbortSignal.timeout(45_000),
    });
    const body = Buffer.from(await response.arrayBuffer());
    send(
      res,
      response.status,
      body,
      response.headers.get("content-type") || "application/json; charset=utf-8",
      { "cache-control": apiPath === "/streets" ? "public, max-age=86400" : "public, max-age=300" },
    );
  } catch (error) {
    console.error("Proxy error:", error.message);
    send(
      res,
      502,
      JSON.stringify({ error: "The crash-data service is unavailable. Try again shortly." }),
      "application/json; charset=utf-8",
    );
  }
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(root, safePath);

  try {
    const details = await stat(filePath);
    if (details.isDirectory()) filePath = join(filePath, "index.html");
    const body = await readFile(filePath);
    send(res, 200, body, contentTypes[extname(filePath)] || "application/octet-stream", {
      "cache-control": "no-cache",
    });
  } catch {
    send(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method !== "GET") {
    send(res, 405, "Method not allowed", undefined, { allow: "GET" });
    return;
  }
  if (url.pathname.startsWith("/api/")) await proxyApi(req, res, url);
  else await serveStatic(res, url.pathname);
});

server.listen(port, () => {
  console.log(`Denver Crash Explorer running at http://localhost:${port}`);
  console.log(`Crash data: ${upstream}`);
});
