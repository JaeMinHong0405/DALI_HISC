/**
 * DALI — 국가법령정보 공동활용 Open API 연동 (법제처 law.go.kr DRF)
 *
 * 문서 관리 화면에 '국가법령정보 API에서 가져오기' 패널을 붙입니다.
 * 현행 법령·행정규칙을 검색하고, 고른 문서의 전체 조문을 받아 조(條) 단위로 등록합니다.
 * 등록된 조문은 바로 질문·답변 / 챗봇 / 규정 비교 / 문서 작업의 검색 범위에 들어갑니다.
 *
 * 호출 경로 (위에서부터 시도, 성공한 경로를 기억):
 *   1) 같은 사이트의 api/law  — Vercel 배포 또는 scripts/dev-server.js 실행 시
 *   2) 중계 주소              — 연결 설정에 넣은 주소 (Cloudflare Worker, 다른 DALI Vercel 주소의 /api/law 등)
 *   3) law.go.kr 직접 호출     — 브라우저에서 CORS가 허용될 때만 동작
 * OC(인증키)는 공개 저장소 공용 값으로 쓰도록 기본값을 넣어 두었고, 연결 설정에서 바꿀 수 있습니다.
 */
(function () {
  "use strict";
  const DEFAULT_OC = "LAW0223";
  const K = { cfg: "dali.web.law", base: "dali.web.lawBase" };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };
  const cfg = () => ({ oc: DEFAULT_OC, relay: "", ...LS.get(K.cfg, {}) });
  const directBase = () => LS.get(K.base, "https://www.law.go.kr/DRF");
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const live = { docs: [], arts: [], ready: null };                    // DALI 문서 저장소의 현재 상태 (구독)
  const appState = () => live;
  function watch() {
    if (live.ready) return live.ready;
    return (live.ready = (async () => {
      const db = await window.claude.use("db");
      await new Promise(res => {
        let n = 0; const done = () => { if (++n === 2) res(); };
        db.collection("docs").onSnapshot(s => { live.docs = s.docs.map(d => ({ id: d.id, ...d.data() })); done(); });
        db.collection("arts").onSnapshot(s => { live.arts = s.docs.map(d => ({ id: d.id, docId: d.data().docId })); done(); });
      });
    })());
  }
  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------- transport ---------- */
  let serverLaw = null, lastRoute = null;
  async function hasServer() {
    if (serverLaw !== null) return serverLaw;
    if (location.protocol === "file:") return (serverLaw = false);
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch("api/law?op=ping", { signal: ctl.signal, cache: "no-store" }); clearTimeout(t);
      const j = r.ok ? await r.json().catch(() => null) : null;
      serverLaw = !!(j && j.app === "dali-law");
    } catch { serverLaw = false; }
    return serverLaw;
  }
  async function routes() {
    const c = cfg(), list = [];
    if (await hasServer()) list.push({ kind: "server", label: "이 사이트의 중계 함수(api/law)", url: "api/law" });
    if (c.relay) list.push({ kind: "relay", label: "중계 주소", url: c.relay.replace(/\/+$/, "") });
    list.push({ kind: "direct", label: "law.go.kr 직접 호출", url: directBase() });
    if (lastRoute) list.sort((a, b) => (b.kind === lastRoute) - (a.kind === lastRoute));
    return list;
  }
  function buildUrl(route, op, params) {
    const q = new URLSearchParams(params);
    if (route.kind === "direct") { q.set("OC", cfg().oc || DEFAULT_OC); q.set("type", "JSON"); return `${route.url}/${op === "search" ? "lawSearch.do" : "lawService.do"}?${q}`; }
    q.set("op", op); return `${route.url}${route.url.includes("?") ? "&" : "?"}${q}`;
  }
  function parseBody(text) {
    const t = String(text || "").trim();
    if (/검증에\s*실패|미신청|인증키|OC\s*값|승인/.test(t) && !/^\s*[{[]/.test(t)) throw err("law_auth", t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200));
    let j; try { j = JSON.parse(t); } catch { throw err("law_bad_response", t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160) || "빈 응답"); }
    const msg = j && (j.result || j.msg || j.message);
    if (typeof msg === "string" && /검증에\s*실패|미신청|인증|권한/.test(msg)) throw err("law_auth", msg);
    if (j && j.code && /^law_|bad_request/.test(j.code)) throw err(j.code, j.message || j.code);
    return j;
  }
  async function call(op, params) {
    let lastErr = null, blocked = false;
    for (const route of await routes()) {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
      try {
        const r = await fetch(buildUrl(route, op, params), { signal: ctl.signal, cache: "no-store" });
        const text = await r.text();
        if (!r.ok && !/^\s*[{[]/.test(text)) throw err(route.kind === "direct" ? "law_bad_response" : "law_unreachable", `HTTP ${r.status}`);
        const j = parseBody(text);
        lastRoute = route.kind;
        return { data: j, route };
      } catch (e) {
        if (e.code === "law_auth") throw e;                       // OC 문제는 다른 경로로 가도 같음
        if (route.kind === "direct" && (e instanceof TypeError || e.name === "TypeError")) blocked = true;
        lastErr = e.name === "AbortError" ? err("law_timeout", "응답 시간이 초과되었습니다") : e;
      } finally { clearTimeout(t); }
    }
    if (blocked && !lastErr?.code?.startsWith?.("law_auth")) throw err("law_cors", "브라우저에서 law.go.kr 직접 호출이 차단되었습니다");
    throw lastErr || err("law_unreachable");
  }
  function errText(e) {
    switch (e && e.code) {
      case "law_cors": return "브라우저에서 law.go.kr을 직접 부를 수 없습니다(CORS). '연결 설정'에 중계 주소를 넣거나 Vercel로 배포하세요. 저장소의 relay/law-relay-worker.js 참고.";
      case "law_auth": return "인증키(OC) 확인 실패: " + (e.message || "") + " — open.law.go.kr 마이페이지에서 OC 승인 상태와 등록한 도메인·IP를 확인하세요.";
      case "law_timeout": return "국가법령정보센터 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.";
      case "law_bad_response": return "예상하지 못한 응답입니다: " + (e.message || "");
      default: return "국가법령정보 API에 연결하지 못했습니다 (" + (e?.message || e?.code || "error") + ").";
    }
  }

  /* ---------- response helpers (the API returns objects for single items, arrays for many) ---------- */
  const arr = x => x == null ? [] : Array.isArray(x) ? x : [x];
  const val = x => x == null ? "" : typeof x === "object" ? (Array.isArray(x) ? x.map(val).join("\n") : (x.content ?? x["#text"] ?? x._text ?? Object.values(x).filter(v => typeof v === "string").pop() ?? "")) : String(x);
  const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null && val(o[k]) !== "") return val(o[k]).trim(); return ""; };
  const ymd = s => { const d = String(s || "").replace(/\D/g, ""); return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : String(s || ""); };
  const lines = x => arr(x).flatMap(v => typeof v === "object" && !Array.isArray(v) ? [val(v)] : Array.isArray(v) ? v.map(val) : [String(v)]).map(s => s.replace(/[ \t]+\n/g, "\n").trim()).filter(Boolean);
  const TYPEMAP = { "대통령령": "시행령", "총리령": "시행규칙", "부령": "시행규칙" };

  /* ---------- search ---------- */
  async function search(query, target = "law", page = 1) {
    const { data, route } = await call("search", { target, query, display: "20", page: String(page) });
    const root = target === "admrul" ? (data.AdmRulSearch || data.admRulSearch || data) : (data.LawSearch || data.lawSearch || data);
    const items = arr(target === "admrul" ? (root.admrul || root.AdmRul) : (root.law || root.Law));
    const total = Number(pick(root, ["totalCnt", "totalcnt"])) || items.length;
    return {
      route, total,
      items: items.map(o => target === "admrul" ? {
        target, key: pick(o, ["행정규칙일련번호", "일련번호", "ID"]), lawId: pick(o, ["행정규칙ID"]),
        title: pick(o, ["행정규칙명", "행정규칙명한글"]), kind: pick(o, ["행정규칙종류", "행정규칙종류명"]) || "행정규칙",
        agency: pick(o, ["소관부처명", "소관부처"]), effective: ymd(pick(o, ["시행일자"])), promulgated: ymd(pick(o, ["발령일자"])),
      } : {
        target, key: pick(o, ["법령일련번호", "MST", "일련번호"]), lawId: pick(o, ["법령ID", "ID"]),
        title: pick(o, ["법령명한글", "법령명", "법령명_한글"]), kind: pick(o, ["법령구분명", "법령구분"]) || "법령",
        agency: pick(o, ["소관부처명", "소관부처"]), effective: ymd(pick(o, ["시행일자"])), promulgated: ymd(pick(o, ["공포일자"])),
      }).filter(x => x.key && x.title),
    };
  }

  /* ---------- full text → DALI articles ---------- */
  const lawUrl = (title, kind) => `https://www.law.go.kr/${kind === "admrul" ? "행정규칙" : "법령"}/${encodeURIComponent(title.replace(/\s+/g, ""))}`;
  function lawArticles(root, base) {
    const units = arr(root?.조문?.조문단위 ?? root?.조문 ?? root?.조문단위);
    const out = [];
    for (const u of units) {
      if (!u || typeof u !== "object") continue;
      if ((val(u.조문여부) || "조문") !== "조문") continue;                         // 편·장·절 제목(전문) 제외
      const no = pick(u, ["조문번호"]), br = pick(u, ["조문가지번호"]);
      if (!no) continue;
      const num = `제${no}조${br && br !== "0" ? "의" + br : ""}`;
      const title = pick(u, ["조문제목"]);
      const body = [...lines(u.조문내용)];
      const addHo = (hos, pad) => arr(hos).forEach(h => { body.push(...lines(h.호내용).map(s => pad + s)); arr(h.목).forEach(m => body.push(...lines(m.목내용).map(s => pad + "  " + s))); });
      arr(u.항).forEach(h => { body.push(...lines(h.항내용)); addHo(h.호, "  "); });
      addHo(u.호, "  ");
      const text = body.join("\n").trim();
      if (!text) continue;
      out.push({ num, label: title ? `${num}(${title})` : num, text, sourceUrl: `${base}/${encodeURIComponent(num)}` });
    }
    return out;
  }
  function textArticles(text, base) {
    const chunks = String(text || "").split(/\n(?=\s*제\d+조(?:의\d+)?\s*(?:\(|\s))/).map(s => s.trim()).filter(Boolean);
    const parts = chunks.map((c, i) => { const m = c.match(/^제(\d+)조(?:의(\d+))?\s*(?:\(([^)]{1,60})\))?/); const num = m ? `제${m[1]}조${m[2] ? "의" + m[2] : ""}` : (chunks.length > 1 ? `단락 ${i + 1}` : "본문"); return { num, label: m && m[3] ? `${num}(${m[3]})` : num, text: c }; });
    return parts.map(a => ({ num: a.num, label: a.label, text: a.text, sourceUrl: /^제\d/.test(a.num) ? `${base}/${encodeURIComponent(a.num)}` : base }));
  }
  function strings(x, out = []) {
    if (x == null) return out;
    if (typeof x === "string") { if (x.trim()) out.push(x.trim()); }
    else if (Array.isArray(x)) x.forEach(v => strings(v, out));
    else if (typeof x === "object") Object.entries(x).forEach(([k, v]) => { if (!/기본정보|부칙|개정문|제개정이유|별표|링크|코드$/.test(k)) strings(v, out); });
    return out;
  }
  async function fetchDoc(item) {
    const params = item.target === "admrul" ? { target: "admrul", ID: item.key } : { target: "law", MST: item.key };
    const { data } = await call("service", params);
    const base = lawUrl(item.title, item.target);
    let root, info, arts;
    if (item.target === "admrul") {
      root = data.AdmRulService || data.admRulService || data;
      info = root.행정규칙기본정보 || root.기본정보 || {};
      arts = textArticles(lines(root.조문내용).join("\n"), base);
    } else {
      root = data.법령 || data.Law || data;
      info = root.기본정보 || {};
      arts = lawArticles(root, base);
    }
    if (!arts.length) arts = textArticles(strings(root).join("\n"), base);   // 구조가 다를 때의 안전장치
    if (!arts.length) throw err("law_empty", "조문을 찾지 못했습니다");
    const title = pick(info, ["법령명_한글", "법령명한글", "행정규칙명"]) || item.title;
    const kindRaw = pick(info, ["법종구분", "법령구분명", "행정규칙종류"]) || item.kind;
    const eff = ymd(pick(info, ["시행일자"])) || item.effective, pro = ymd(pick(info, ["공포일자", "발령일자"])) || item.promulgated;
    return {
      title, arts,
      meta: {
        title, country: "한국", agency: pick(info, ["소관부처", "소관부처명"]) || item.agency,
        type: item.target === "admrul" ? (/고시|규정/.test(title + kindRaw) ? "감독규정" : "세칙") : (TYPEMAP[kindRaw] || kindRaw || "법률"),
        effective: [eff && `시행 ${eff}`, pro && `(${item.target === "admrul" ? "발령" : "공포"} ${pro})`].filter(Boolean).join(" "),
        sourceUrl: base, origin: "law.go.kr API",
        license: `국가법령정보 공동활용 Open API(법제처) · ${today()} 실시간 조회 · 현행본`,
        note: `국가법령정보센터 Open API로 ${today()}에 받아 온 현행본입니다. 조문 단위로 나눠 저장했으며, 별표·서식·부칙은 포함하지 않습니다.`,
        lawApi: { target: item.target, key: item.key, lawId: item.lawId, fetchedAt: Date.now() },
      },
    };
  }

  /* ---------- save into DALI's document store ---------- */
  async function store(doc, opts = {}) {
    const db = await window.claude.use("db"); await watch();
    const id = "lawapi_" + (doc.meta.lawApi.target === "admrul" ? "a" : "l") + (doc.meta.lawApi.lawId || doc.meta.lawApi.key);
    const S = appState();
    const oldArts = (S.arts || []).filter(a => a.docId === id).map(a => a.id);
    await db.doc("docs/" + id).set({ ...doc.meta, status: "processing", articleCount: doc.arts.length, chars: doc.arts.reduce((n, a) => n + a.text.length, 0), createdAt: Date.now() });
    const keep = new Set();
    for (let i = 0; i < doc.arts.length; i++) {
      const a = doc.arts[i], aid = id + "_" + String(i).padStart(4, "0"); keep.add(aid);
      await db.doc("arts/" + aid).set({ docId: id, ord: i, num: a.num, label: a.label, text: a.text.slice(0, 60000), sourceUrl: a.sourceUrl });
      opts.onProgress && opts.onProgress(i + 1, doc.arts.length);
    }
    for (const aid of oldArts) if (!keep.has(aid)) await db.doc("arts/" + aid).delete();
    await db.doc("docs/" + id).update({ status: "ready" });
    let hidden = 0;
    if (opts.hideOlder) {                                             // 같은 이름의 예전 수집본은 검색에서 제외
      const norm = s => String(s || "").replace(/\s+/g, "");
      for (const d of (S.docs || [])) {
        if (d.id === id || norm(d.title) !== norm(doc.title) || d.origin === "law.go.kr API") continue;
        const ids = (S.arts || []).filter(a => a.docId === d.id).map(a => a.id);
        await db.doc("docs/" + d.id).delete();
        for (const aid of ids) await db.doc("arts/" + aid).delete();
        hidden++;
      }
    }
    return { id, hidden };
  }

  /* ---------- UI (문서 관리 화면) ---------- */
  function mount() {
    const page = document.querySelector('[data-page="docs"]'), reg = document.getElementById("regPanel");
    if (!page || !reg || document.getElementById("lawPanel")) return;
    const p = document.createElement("div");
    p.className = "panel"; p.id = "lawPanel";
    p.style.cssText = "display:flex;flex-direction:column;gap:12px";
    p.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
        <div><h2 style="font-size:16px">국가법령정보 API에서 가져오기</h2>
        <p class="muted" style="font-size:13px;margin:4px 0 0">법제처 국가법령정보센터 Open API로 <b>현행</b> 법령·행정규칙을 검색해 조문 단위로 바로 등록합니다.</p></div>
        <button type="button" class="btn small" data-cfg>연결 설정</button>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <select data-target style="width:auto"><option value="law">법령 (법률·시행령·시행규칙)</option><option value="admrul">행정규칙 (고시·훈령·예규)</option></select>
        <input type="text" data-q placeholder="예: 가상자산, 자본시장과 금융투자업, 전자증권" style="flex:1;min-width:200px">
        <button type="button" class="btn primary" data-go>검색</button>
      </div>
      <div class="chips" data-ex></div>
      <label class="chk" style="font-size:13px"><input type="checkbox" data-hide checked> 가져올 때 같은 이름의 내장 수집본(2025년 8월)은 검색 범위에서 빼기</label>
      <div data-st class="muted" style="font-size:13px;min-height:1.2em"></div>
      <div data-list style="display:flex;flex-direction:column;gap:8px"></div>`;
    reg.parentNode.insertBefore(p, reg);
    watch();
    const $ = s => p.querySelector(s), st = $("[data-st]"), list = $("[data-list]");
    const examples = [["law", "가상자산 이용자 보호"], ["law", "자본시장과 금융투자업"], ["law", "전자증권"], ["law", "특정 금융거래정보"], ["admrul", "가상자산"], ["admrul", "금융투자업규정"]];
    $("[data-ex]").innerHTML = examples.map(([t, q]) => `<button type="button" class="tag" data-t="${t}" data-v="${esc(q)}" style="cursor:pointer;border:1px solid var(--line)">${t === "admrul" ? "행정규칙 · " : ""}${esc(q)}</button>`).join("");
    $("[data-ex]").querySelectorAll("button").forEach(b => b.onclick = () => { $("[data-target]").value = b.dataset.t; $("[data-q]").value = b.dataset.v; run(); });
    $("[data-cfg]").onclick = openCfg;
    $("[data-q]").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); run(); } });
    $("[data-go]").onclick = () => run();
    let current = [];
    async function run(page = 1) {
      const q = $("[data-q]").value.trim(), target = $("[data-target]").value;
      if (!q) { st.textContent = "검색어를 입력하세요."; return; }
      $("[data-go]").disabled = true; st.innerHTML = '<span class="spin"></span> 국가법령정보센터 검색 중…'; list.innerHTML = "";
      try {
        const r = await search(q, target, page); current = r.items;
        st.textContent = r.items.length ? `${r.total.toLocaleString()}건 중 ${r.items.length}건 · ${r.route.label}` : `"${q}" 검색 결과가 없습니다. 법령명 일부로 다시 검색해 보세요.`;
        const have = new Set((appState().docs || []).filter(d => d.origin === "law.go.kr API").map(d => d.lawApi?.key));
        list.innerHTML = r.items.map((it, i) => `
          <div class="card" style="display:flex;flex-direction:row;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;text-align:left">
            <div style="min-width:0;flex:1"><b>${esc(it.title)}</b>
              <div class="muted" style="font-size:12px;margin-top:2px">${esc([it.kind, it.agency, it.effective && "시행 " + it.effective].filter(Boolean).join(" · "))}</div></div>
            <div class="row" style="gap:6px"><a class="btn small" style="text-decoration:none" href="${esc(lawUrl(it.title, it.target))}" target="_blank" rel="noopener">원문 사이트</a>
              <button type="button" class="btn small ${have.has(it.key) ? "" : "primary"}" data-i="${i}">${have.has(it.key) ? "다시 받기" : "가져오기"}</button></div>
          </div>`).join("");
        list.querySelectorAll("[data-i]").forEach(b => b.onclick = () => importOne(current[+b.dataset.i], b));
      } catch (e) { st.textContent = errText(e); if (e.code === "law_cors") { st.insertAdjacentHTML("beforeend", ' <button type="button" class="btn small" data-c2>연결 설정</button>'); st.querySelector("[data-c2]").onclick = openCfg; } }
      finally { $("[data-go]").disabled = false; }
    }
    async function importOne(it, btn) {
      btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spin"></span>';
      try {
        st.innerHTML = `<span class="spin"></span> ${esc(it.title)} 전문 받는 중…`;
        const doc = await fetchDoc(it);
        const r = await store(doc, { hideOlder: $("[data-hide]").checked, onProgress: (n, t) => { st.textContent = `${doc.title} · 저장 중 ${n}/${t}`; } });
        st.textContent = `등록 완료 · ${doc.title} 조문 ${doc.arts.length}개가 검색 범위에 들어갔습니다.${r.hidden ? ` (내장 수집본 ${r.hidden}건은 검색에서 제외)` : ""}`;
        btn.textContent = "다시 받기"; btn.classList.remove("primary");
      } catch (e) {
        st.textContent = e.code === "quota_exceeded" ? "브라우저 저장 공간이 가득 찼습니다. 쓰지 않는 문서를 삭제하세요." : e.code === "law_empty" ? "이 문서는 API에서 조문 본문을 제공하지 않습니다. 원문 사이트에서 복사해 아래 '문서 등록'에 붙여넣으세요." : errText(e);
        btn.textContent = old;
      } finally { btn.disabled = false; }
    }
  }
  function openCfg() {
    if (document.getElementById("dali-law-cfg")) return;
    const c = cfg();
    const w = document.createElement("div"); w.id = "dali-law-cfg";
    w.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(10,14,20,.45);z-index:100;display:grid;place-items:center;padding:16px">
      <form style="background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;width:min(540px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <b style="font-size:16px">국가법령정보 API 연결 설정</b>
        <label class="f">인증키 (OC)<input type="text" name="oc" value="${esc(c.oc)}" autocomplete="off" spellcheck="false"></label>
        <label class="f">중계 주소 <span style="font-weight:400">(선택 · 브라우저 직접 호출이 막힐 때)</span><input type="url" name="relay" value="${esc(c.relay)}" placeholder="https://dali-law.<계정>.workers.dev  또는  https://<vercel 주소>/api/law"></label>
        <div data-msg style="font-size:13px;min-height:1.2em"></div>
        <div style="font-size:12px;color:var(--muted);line-height:1.6">· 호출 순서: 이 사이트의 api/law(Vercel) → 중계 주소 → law.go.kr 직접 호출<br>· OC는 open.law.go.kr에서 발급한 값입니다. 공개 저장소 공용 키이므로 누구나 이 화면에서 호출할 수 있습니다.<br>· 중계 주소는 저장소의 <b>relay/law-relay-worker.js</b>를 Cloudflare Worker로 배포해 만들 수 있습니다.</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button type="button" class="btn" data-test>연결 테스트</button><span style="flex:1"></span><button type="button" class="btn" data-x>닫기</button><button class="btn primary">저장</button></div>
      </form>
    </div>`;
    document.body.appendChild(w);
    const f = w.querySelector("form"), msg = w.querySelector("[data-msg]"), close = () => w.remove();
    const apply = () => LS.set(K.cfg, { oc: f.oc.value.trim().replace(/[^A-Za-z0-9_.-]/g, "") || DEFAULT_OC, relay: f.relay.value.trim() });
    w.querySelector("[data-x]").onclick = close;
    w.firstElementChild.addEventListener("click", e => { if (e.target === w.firstElementChild) close(); });
    w.querySelector("[data-test]").onclick = async () => {
      const prev = LS.get(K.cfg, null); apply(); lastRoute = null;
      msg.innerHTML = '<span class="spin"></span> 연결 확인 중…';
      try { const r = await search("가상자산", "law"); msg.innerHTML = `<span class="ok">✓ 연결됨 · ${esc(r.route.label)} · "가상자산" 법령 ${r.total}건</span>`; }
      catch (e) { msg.innerHTML = `<span class="bad">✕ ${esc(errText(e))}</span>`; }
      finally { if (prev) LS.set(K.cfg, prev); else localStorage.removeItem(K.cfg); }
    };
    f.onsubmit = e => { e.preventDefault(); apply(); lastRoute = null; close(); };
  }

  window.DaliLaw = { search, fetchDoc, store, config: cfg, openSettings: openCfg, state: live };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
