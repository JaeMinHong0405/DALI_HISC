/**
 * DALI — 국가법령정보 Open API 중계 (Cloudflare Workers 무료 플랜용)
 *
 * GitHub Pages만 쓰는 경우, 브라우저가 law.go.kr을 직접 부르면 CORS 때문에 막힐 수 있습니다.
 * 이 파일을 Cloudflare Worker로 배포하고, DALI 문서 관리 → '국가법령정보 API' → 연결 설정의
 * '중계 주소'에 Worker 주소(https://<이름>.<계정>.workers.dev)를 넣으면 됩니다.
 *
 * 배포: dash.cloudflare.com → Workers & Pages → Create → Worker → 이 코드를 붙여넣고 Deploy
 * 요청 형식은 Vercel 함수(api/law.js)와 같습니다:  ?op=search|service&target=law&query=…
 */
const OC = "LAW0223";                         // 국가법령정보 공동활용 API 인증키(OC)
const BASE = "https://www.law.go.kr/DRF";
const OPS = { search: "lawSearch.do", service: "lawService.do" };
const TARGETS = new Set(["law", "eflaw", "admrul", "prec", "expc", "detc", "ordin", "trty", "lsHistory"]);
const PARAMS = new Set(["target", "query", "display", "page", "sort", "search", "ID", "MST", "LID", "JO", "efYd", "nw", "knd", "org"]);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const u = new URL(request.url);
    const op = u.searchParams.get("op") || "";
    const out = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
    if (op === "ping") return out(200, { app: "dali-law", ok: true });
    if (!OPS[op]) return out(400, { code: "bad_request", message: "op must be search or service" });
    const q = new URLSearchParams();
    for (const [k, v] of u.searchParams) if (PARAMS.has(k) && v.length <= 200) q.set(k, v);
    if (!TARGETS.has(q.get("target") || "")) return out(400, { code: "bad_request", message: "unsupported target" });
    q.set("OC", (env && env.LAW_OC) || OC);
    q.set("type", "JSON");
    try {
      const r = await fetch(`${BASE}/${OPS[op]}?${q}`, { headers: { "User-Agent": "DALI/1.0", Accept: "application/json, text/plain, */*" }, cf: { cacheTtl: 3600 } });
      const text = await r.text();
      return new Response(text, { status: r.ok ? 200 : 502, headers: { ...CORS, "Content-Type": /^\s*[{[]/.test(text) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    } catch (e) {
      return out(502, { code: "law_unreachable", message: String(e && e.message || e) });
    }
  },
};
