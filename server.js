import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public/", import.meta.url));
const port = Number(process.env.PORT || 4173);
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
  await serveStatic(res, url.pathname);
});

server.listen(port, () => {
  console.log(`Denver Crash Explorer running at http://localhost:${port}`);
});
