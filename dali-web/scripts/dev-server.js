/**
 * Local preview that behaves like the deployed site: static files + the /api functions.
 *   node scripts/dev-server.js            → http://localhost:3000
 * Environment variables (optional): ANTHROPIC_API_KEY, DALI_ACCESS_CODE, DALI_MODEL_DEFAULT, DALI_MODEL_QUICK, PORT
 * Without ANTHROPIC_API_KEY + DALI_ACCESS_CODE the page runs in demo mode.
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const fns = { "/api/health": require("../api/health"), "/api/claude": require("../api/claude") };

http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (fns[p]) { try { await fns[p](req, res); } catch (e) { if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ code: "server_error", message: e.message })); } } return; }
  if (p.startsWith("/api/")) { res.statusCode = 404; return res.end("{}"); }
  const file = path.normalize(path.join(ROOT, p === "/" ? "index.html" : p));
  if (!file.startsWith(ROOT + path.sep) || /[\\/](api|scripts|node_modules|\.git)[\\/]/.test(file.slice(ROOT.length))) { res.statusCode = 404; return res.end("Not found"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end("Not found"); }
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    res.end(buf);
  });
}).listen(PORT, "127.0.0.1", () => {
  const live = process.env.ANTHROPIC_API_KEY && process.env.DALI_ACCESS_CODE;
  console.log(`\n  DALI → http://localhost:${PORT}   (${live ? "Claude API 연결" : "데모 모드"})\n`);
});
