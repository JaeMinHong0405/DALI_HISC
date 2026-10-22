// GET /api/law?op=search|service&target=law&query=… — relay to the 국가법령정보 공동활용 Open API (law.go.kr DRF).
// The browser usually cannot call law.go.kr directly (no CORS headers), so this function forwards the request
// with the OC value and returns the JSON as-is. CORS is open on purpose: the repository is public and
// any DALI page (GitHub Pages included) may use this endpoint as its relay.
"use strict";
const { json } = require("./_shared");

const BASE = (process.env.LAW_API_BASE || "https://www.law.go.kr/DRF").replace(/\/+$/, "");
const OC = () => (process.env.LAW_OC || "LAW0223").trim();
const OPS = { search: "lawSearch.do", service: "lawService.do" };
const TARGETS = new Set(["law", "eflaw", "admrul", "prec", "expc", "detc", "ordin", "trty", "lsHistory"]);
const PARAMS = new Set(["target", "query", "display", "page", "sort", "search", "ID", "MST", "LID", "JO", "efYd", "nw", "knd", "org"]);

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "GET") return json(res, 405, { code: "method_not_allowed" });

  const u = new URL(req.url, "http://localhost");
  const op = u.searchParams.get("op") || "";
  if (op === "ping") return json(res, 200, { app: "dali-law", ok: true });
  if (!OPS[op]) return json(res, 400, { code: "bad_request", message: "op must be search or service" });

  const q = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (PARAMS.has(k) && v.length <= 200) q.set(k, v);
  if (!TARGETS.has(q.get("target") || "")) return json(res, 400, { code: "bad_request", message: "unsupported target" });
  q.set("OC", OC());
  q.set("type", "JSON");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(`${BASE}/${OPS[op]}?${q}`, { signal: ctl.signal, headers: { "User-Agent": "DALI/1.0 (+https://github.com/JaeMinHong0405/DALI_HISC)", Accept: "application/json, text/plain, */*" } });
    const text = await r.text();
    res.statusCode = r.ok ? 200 : 502;
    res.setHeader("Content-Type", /^\s*[{[]/.test(text) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", r.ok ? "public, s-maxage=3600, max-age=300" : "no-store");
    res.end(text);
  } catch (e) {
    json(res, 502, { code: e.name === "AbortError" ? "law_timeout" : "law_unreachable", message: String(e.message || e) });
  } finally { clearTimeout(timer); }
};
