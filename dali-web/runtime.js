/**
 * DALI web runtime — lets the DALI page run without a server.
 *
 * AI provider (chosen in the 'AI 설정' dialog, top right):
 *  - 데모 모드 (default): mock-claude.js quotes the retrieved articles — no API, no key.
 *  - Gemini (내 API 키): each user enters their own Google Gemini API key. The key is kept in this
 *    browser only (localStorage) and sent directly to Google — never to the repository or any server of ours.
 *  - Claude (서버): only when deployed with the serverless function (api/claude.js) and
 *    ANTHROPIC_API_KEY + DALI_ACCESS_CODE are set.
 * Documents: built-in dataset (data/dali-data.js) + documents you add, kept in this browser.
 * Paths are relative, so it works on GitHub Pages (/repo/…), Vercel (/) and from a local file.
 */
(function () {
  "use strict";
  const err = (code, message, text) => { const e = new Error(message || code); e.code = code; if (text) e.text = text; return e; };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return e; } },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const K = { provider: "dali.web.provider", gemini: "dali.web.gemini", code: "dali.web.accessCode", banner: "dali.web.bannerClosed", geminiBase: "dali.web.geminiBase" };
  const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
  const geminiBase = () => LS.get(K.geminiBase, "https://generativelanguage.googleapis.com");
  const gcfg = () => LS.get(K.gemini, { key: "", model: GEMINI_DEFAULT_MODEL });

  /* ---------- is the Claude serverless function available? ---------- */
  const server = { claude: false, needCode: true, models: {}, reason: "" };
  const serverReady = (async () => {
    if (location.protocol === "file:") { server.reason = "로컬 파일"; return; }
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch("api/health", { signal: ctl.signal, cache: "no-store" }); clearTimeout(t);
      const j = r.ok ? await r.json() : null;
      if (j && j.app === "dali" && j.hasKey) { server.claude = true; server.needCode = !!j.needCode; server.models = j.models || {}; }
      else server.reason = j && j.app === "dali" ? (j.keyWithoutCode ? "DALI_ACCESS_CODE 미설정" : "API 키 미설정") : "서버리스 함수 없음";
    } catch { server.reason = "서버리스 함수 없음"; }
  })();

  /* ---------- which provider is active ---------- */
  function active() {
    const want = LS.get(K.provider, "auto"), g = gcfg();
    if (want === "demo") return "demo";
    if (want === "gemini") return g.key ? "gemini" : "demo";
    if (want === "claude") return server.claude ? "claude" : "demo";
    return server.claude ? "claude" : g.key ? "gemini" : "demo";   // auto
  }

  /* ---------- helpers ---------- */
  function linkSignal(outer) {
    const ctl = new AbortController();
    if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener("abort", () => ctl.abort(), { once: true }); }
    return ctl;
  }
  function parseJson(t) {
    const raw = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { return JSON.parse(raw); } catch {}
    const m = raw.match(/[\[{][\s\S]*[\]}]/); if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw err("invalid_json", "응답이 JSON 형식이 아닙니다", t);
  }
  async function readSSE(res, onEvent, ctl) {
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
        if (data) onEvent(JSON.parse(data));
      }
      if (ctl.signal.aborted) break;
    }
  }

  /* ---------- Claude via the serverless function ---------- */
  let codeRejected = false;
  async function postClaude(body, signal) {
    let code = LS.get(K.code, "");
    if (server.needCode && !code) { code = await askCode(codeRejected); codeRejected = false; }
    let res;
    try {
      res = await fetch("api/claude", { method: "POST", headers: { "content-type": "application/json", "x-dali-code": code || "" }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal && signal.aborted) throw err("cancelled");
      throw err("upstream_error", "서버리스 함수에 연결하지 못했습니다.");
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.code === "bad_access_code") { LS.set(K.code, ""); codeRejected = true; }
      throw err(j.code || "upstream_error", j.message);
    }
    return res;
  }
  async function claudeSample(input, opts) {
    const ctl = linkSignal(opts.signal);
    const res = await postClaude({ input, tier: opts.modelTier === "quick" ? "quick" : "default" }, ctl.signal);
    let text = "", meta = {};
    try {
      await readSSE(res, ev => {
        if (ev.t) { text += ev.t; opts.onText && opts.onText({ text }); }
        else if (ev.error) throw err(ev.error.code, ev.error.message, text);
        else if (ev.done) meta = ev;
      }, ctl);
    } catch (e) { if (ctl.signal.aborted) throw err("cancelled", "", text); throw e.code ? e : err("upstream_error", String(e), text); }
    if (ctl.signal.aborted) throw err("cancelled", "", text);
    return { text, truncated: meta.stop === "max_tokens", modelTierApplied: meta.model || opts.modelTier };
  }
  async function claudeJson(input, opts) {
    const res = await postClaude({ input, json: true, tier: opts.modelTier === "default" ? "default" : "quick" }, linkSignal(opts.signal).signal);
    const j = await res.json();
    opts.onText && opts.onText({ text: j.text });
    return parseJson(j.text);
  }

  /* ---------- Gemini, called directly from the browser with the user's own key ---------- */
  function geminiError(status, j) {
    const msg = (j && j.error && j.error.message) || "";
    if (status === 400 && /api key|api_key/i.test(msg)) return err("auth_error", "Gemini API 키가 올바르지 않습니다.");
    if (status === 401 || status === 403) return err("auth_error", msg);
    if (status === 429) return err("rate_limited", "Gemini 무료 사용량 한도에 도달했습니다. 잠시 후 다시 시도하세요.");
    if (status === 404) return err("model_not_found", msg);
    if (status === 400) return err("bad_request", msg);
    return err("upstream_error", msg || "HTTP " + status);
  }
  async function geminiFetch(path, body, signal, key) {
    const k = key || gcfg().key;
    let res;
    try {
      res = await fetch(`${geminiBase()}/v1beta/${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-goog-api-key": k }, body: body ? JSON.stringify(body) : undefined, signal });
    } catch (e) {
      if (signal && signal.aborted) throw err("cancelled");
      throw err("upstream_error", "Gemini API에 연결하지 못했습니다. 인터넷 연결을 확인하세요.");
    }
    if (!res.ok) throw geminiError(res.status, await res.json().catch(() => ({})));
    return res;
  }
  /* 속도: Gemini 3.x Flash는 기본으로 '생각(thinking)'을 중간 수준까지 한 뒤 답을 쓰기 때문에 첫 글자까지 수십 초가 걸린다.
     근거 조문을 주고 정리만 시키는 작업이므로 생각 수준을 낮춘다. 모델이 이 설정을 받지 않으면 한 번만 빼고 다시 보낸다. */
  const noThink = new Set();
  function thinking(model) {
    if (noThink.has(model)) return null;
    if (/gemini-2\.5-pro/.test(model)) return { thinkingBudget: 128 };
    if (/gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
    if (/gemini-(3|4)/.test(model)) return { thinkingLevel: "low" };
    return null;
  }
  async function geminiCall(model, method, body, signal) {
    const tc = thinking(model);
    const withTc = tc ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: tc } } : body;
    try { return await geminiFetch(`models/${encodeURIComponent(model)}:${method}`, withTc, signal); }
    catch (e) {
      if (tc && e.code === "bad_request" && /think/i.test(e.message || "")) { noThink.add(model); return geminiFetch(`models/${encodeURIComponent(model)}:${method}`, body, signal); }
      throw e;
    }
  }
  // 검색어 확장·질문 재작성(quick)은 더 가벼운 Flash-Lite 모델이 있으면 그쪽으로 보낸다.
  let quickModel = null;
  async function geminiQuickModel() {
    const g = gcfg();
    if (quickModel && quickModel.base === g.model) return quickModel.id;
    let id = g.model;
    try {
      const cached = JSON.parse(sessionStorage.getItem("dali.web.geminiModels") || "null");
      const models = cached || await geminiModels(g.key);
      if (!cached) try { sessionStorage.setItem("dali.web.geminiModels", JSON.stringify(models)); } catch {}
      const fam = (g.model.match(/gemini-[\d.]+/) || [""])[0];
      const lite = models.filter(m => /flash-lite/.test(m.id) && !/preview|exp|image/.test(m.id));
      id = (lite.find(m => fam && m.id.startsWith(fam)) || lite.sort((a, b) => b.id.localeCompare(a.id))[0] || { id: g.model }).id;
    } catch {}
    quickModel = { base: g.model, id };
    return id;
  }
  const partsText = c => ((c && c.content && c.content.parts) || []).map(p => p.text || "").join("");
  async function geminiSample(input, opts) {
    const ctl = linkSignal(opts.signal), g = gcfg();
    const res = await geminiCall(g.model, "streamGenerateContent?alt=sse",
      { contents: [{ role: "user", parts: [{ text: input }] }], generationConfig: { maxOutputTokens: 8192, temperature: 0.2 } }, ctl.signal);
    let text = "", finish = "";
    try {
      await readSSE(res, ev => {
        if (ev.promptFeedback && ev.promptFeedback.blockReason) throw err("refused", "Gemini가 이 요청을 처리하지 않았습니다 (" + ev.promptFeedback.blockReason + ")", text);
        const c = (ev.candidates || [])[0];
        const t = partsText(c); if (t) { text += t; opts.onText && opts.onText({ text }); }
        if (c && c.finishReason) finish = c.finishReason;
      }, ctl);
    } catch (e) { if (ctl.signal.aborted) throw err("cancelled", "", text); throw e.code ? e : err("upstream_error", String(e), text); }
    if (ctl.signal.aborted) throw err("cancelled", "", text);
    if (!text && finish && finish !== "STOP") throw err("refused", "Gemini가 응답을 생성하지 않았습니다 (" + finish + ")");
    return { text, truncated: finish === "MAX_TOKENS", modelTierApplied: g.model };
  }
  async function geminiJson(input, opts) {
    const g = gcfg(), quick = opts.modelTier !== "default";
    const ctl = linkSignal(opts.signal);
    const run = async () => {
      const model = quick ? await geminiQuickModel() : g.model;
      const res = await geminiCall(model, "generateContent",
        { contents: [{ role: "user", parts: [{ text: input }] }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: quick ? 1024 : 4096, temperature: 0 } }, ctl.signal);
      const j = await res.json();
      const text = partsText((j.candidates || [])[0]);
      opts.onText && opts.onText({ text });
      return parseJson(text);
    };
    if (!quick) return run();
    // 검색어 확장이 6초 안에 안 오면 기다리지 않고 내장 용어집으로 확장한다 (답변은 그대로 Gemini가 작성).
    let timer;
    const fallback = new Promise(res => { timer = setTimeout(() => { ctl.abort(); res("timeout"); }, 6000); });
    try {
      const r = await Promise.race([run(), fallback]);
      if (r !== "timeout") return r;
    } catch (e) { if (opts.signal && opts.signal.aborted) throw err("cancelled"); if (e.code === "auth_error" || e.code === "rate_limited") throw e; }
    finally { clearTimeout(timer); }
    if (opts.signal && opts.signal.aborted) throw err("cancelled");
    const local = window.DALI_MOCK.respond(input, true);
    opts.onText && opts.onText({ text: "(Gemini 응답 지연 → 내장 용어집으로 검색어 확장)\n" + JSON.stringify(local, null, 2) });
    return local;
  }
  async function geminiModels(key) {
    const res = await geminiFetch("models?pageSize=200", null, null, key);
    const j = await res.json();
    return (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/i.test(m.name) && !/embedding|image|tts|audio|live|vision|robotics|computer/i.test(m.name))
      .map(m => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name }))
      .sort((a, b) => (/flash/.test(b.id) - /flash/.test(a.id)) || a.id.localeCompare(b.id));
  }

  /* ---------- demo mode ---------- */
  const wait = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); signal && signal.addEventListener("abort", () => { clearTimeout(t); rej(err("cancelled")); }, { once: true }); });
  async function demoSample(input, opts) {
    const ctl = linkSignal(opts.signal);
    await wait(250, ctl.signal);
    const full = window.DALI_MOCK.respond(input, false);
    let text = "";
    for (const part of full.match(/[\s\S]{1,28}/g) || []) {
      text += part; opts.onText && opts.onText({ text });
      await wait(14, ctl.signal).catch(() => { throw err("cancelled", "", text); });
    }
    return { text, truncated: false, modelTierApplied: "demo (모의 응답)" };
  }
  async function demoJson(input, opts) {
    await wait(120, opts.signal);
    const obj = window.DALI_MOCK.respond(input, true);
    opts.onText && opts.onText({ text: JSON.stringify(obj, null, 2) });
    return obj;
  }

  /* ---------- the sample() the page calls — routes to the active provider at call time ---------- */
  function onFail(e) { if (e && (e.code === "auth_error" || e.code === "model_not_found") && active() === "gemini") setTimeout(openSettings, 50); throw e; }
  async function sample(input, opts = {}) {
    const p = active();
    return (p === "claude" ? claudeSample : p === "gemini" ? geminiSample : demoSample)(input, opts).catch(onFail);
  }
  sample.json = async function (input, opts = {}) {
    const p = active();
    return (p === "claude" ? claudeJson : p === "gemini" ? geminiJson : demoJson)(input, opts).catch(onFail);
  };
  sample.ready = true;
  Object.defineProperty(sample, "demo", { get: () => active() === "demo" });

  /* ---------- db: built-in data + this browser's changes ---------- */
  const OVERLAY_KEY = "dali.web.overlay.v1";
  const seed = window.DALI_SEED || { docs: [], arts: [] };
  let overlay = LS.get(OVERLAY_KEY, { docs: {}, arts: {} });
  const cache = {}, listeners = {}, timers = {};
  function rebuild(col) {
    const m = new Map((seed[col] || []).map(r => [r.id, r]));
    for (const [id, v] of Object.entries(overlay[col] || {})) { if (v === null) m.delete(id); else m.set(id, { ...v, id }); }
    cache[col] = m;
  }
  function emit(col) {
    clearTimeout(timers[col]);
    timers[col] = setTimeout(() => {
      if (!cache[col]) rebuild(col);
      const snap = { docs: [...cache[col].values()].map(r => ({ id: r.id, data: () => { const { id, ...d } = r; return d; } })) };
      (listeners[col] || new Set()).forEach(([cb]) => { try { cb(snap); } catch (e) { console.error(e); } });
    }, 60);
  }
  function save(col, id, value) {
    (overlay[col] || (overlay[col] = {}))[id] = value;
    const ok = LS.set(OVERLAY_KEY, overlay);
    if (ok !== true) { delete overlay[col][id]; throw err("quota_exceeded", "브라우저 저장 공간이 가득 찼습니다"); }
    if (!cache[col]) rebuild(col);
    if (value === null) cache[col].delete(id); else cache[col].set(id, { ...value, id });
    emit(col);
  }
  const db = {
    collection(col) {
      return {
        onSnapshot(cb, onErr) {
          const l = [cb, onErr]; (listeners[col] || (listeners[col] = new Set())).add(l);
          if (!cache[col]) rebuild(col); emit(col);
          return () => listeners[col].delete(l);
        },
      };
    },
    doc(p) {
      const [col, id] = p.split("/");
      return {
        async get() { if (!cache[col]) rebuild(col); return cache[col].get(id) || null; },
        async set(data) { save(col, id, { ...data }); },
        async update(data) { if (!cache[col]) rebuild(col); const cur = cache[col].get(id); if (!cur) throw err("not_found"); const { id: _, ...rest } = cur; save(col, id, { ...rest, ...data }); },
        async delete() { save(col, id, null); },
      };
    },
  };

  /* ---------- runtime entry ---------- */
  window.claude = {
    web: true,
    async use(name) {
      if (name === "sample") { await serverReady; return sample; }
      if (name === "db") return db;
      if (name === "user") return { id: "web", can: async () => true };
      return null;
    },
  };
  window.daliResetLocalData = () => { overlay = { docs: {}, arts: {} }; LS.set(OVERLAY_KEY, overlay); location.reload(); };

  /* ---------- UI: status, banner, AI settings, access code ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function paintMode() {
    const p = active(), pill = document.getElementById("pillApi");
    if (pill) {
      pill.className = "pill " + (p === "demo" ? "wait" : "on");
      pill.lastElementChild.textContent = p === "claude" ? "Claude API 연결" : p === "gemini" ? "Gemini 연결" : "데모 모드";
      pill.title = p === "claude" ? (server.models.default || "") : p === "gemini" ? gcfg().model : "API 없이 원문 발췌로 응답";
    }
    const dbp = document.getElementById("pillDb"); if (dbp) dbp.lastElementChild.textContent = "내장 데이터";
    const old = document.getElementById("dali-demo-banner");
    if (p !== "demo") { old && old.remove(); return; }
    if (old || LS.get(K.banner, false)) return;
    const b = document.createElement("div");
    b.id = "dali-demo-banner";
    b.style.cssText = "background:var(--hl);color:var(--ink);border-bottom:1px solid var(--line);font-size:13px;padding:8px 16px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap";
    b.innerHTML = `<span><b>데모 모드</b> · 검색·원문·문서 관리는 실제 데이터이고, 답변·챗봇·초안은 <b>근거 조문 문장을 발췌한 모의 응답</b>입니다. 실제 AI 응답을 보려면 Gemini 무료 API 키를 넣으세요.</span><button type="button" class="btn small primary" data-s>AI 설정</button><button type="button" class="btn small" data-x>닫기</button>`;
    b.querySelector("[data-s]").onclick = openSettings;
    b.querySelector("[data-x]").onclick = () => { b.remove(); LS.set(K.banner, true); };
    const header = document.querySelector("header.top");
    header && header.parentNode.insertBefore(b, header.nextSibling);
  }
  function addSettingsButton() {
    const status = document.querySelector("header .status");
    if (!status || document.getElementById("dali-ai-btn")) return;
    const b = document.createElement("button");
    b.id = "dali-ai-btn"; b.type = "button"; b.className = "btn-con"; b.textContent = "AI 설정";
    b.onclick = openSettings;
    status.insertBefore(b, status.lastElementChild);
  }
  function openSettings() {
    if (document.getElementById("dali-ai")) return;
    const g = gcfg(), want = LS.get(K.provider, "auto"), cur = active();
    const pick = want === "auto" ? cur : want;
    const w = document.createElement("div"); w.id = "dali-ai";
    w.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(10,14,20,.45);z-index:100;display:grid;place-items:center;padding:16px">
      <form style="background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;width:min(540px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <b style="font-size:16px">AI 설정</b>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label class="chk" style="color:var(--ink)"><input type="radio" name="p" value="demo" ${pick === "demo" ? "checked" : ""}> 데모 모드 — API 없이 근거 조문 발췌로 응답</label>
          <label class="chk" style="color:var(--ink)"><input type="radio" name="p" value="gemini" ${pick === "gemini" ? "checked" : ""}> Gemini — 내 Google Gemini API 키 사용 (무료 등급 가능)</label>
          <label class="chk" style="color:${server.claude ? "var(--ink)" : "var(--muted)"}"><input type="radio" name="p" value="claude" ${pick === "claude" ? "checked" : ""} ${server.claude ? "" : "disabled"}> Claude — 서버리스 함수 ${server.claude ? "(사용 가능)" : "(이 사이트에는 설정되지 않음)"}</label>
        </div>
        <fieldset data-g style="border:1px solid var(--line);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px;margin:0">
          <legend style="font-size:13px;padding:0 4px">Gemini</legend>
          <label class="f">API 키 <span style="font-weight:400">(<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>에서 무료 발급)</span>
            <input type="password" name="key" autocomplete="off" placeholder="${g.key ? "저장됨 — 바꿀 때만 입력" : "AIza..."}"></label>
          <div style="display:flex;gap:8px;align-items:flex-end">
            <label class="f" style="flex:1">모델<select name="model"><option value="${esc(g.model)}">${esc(g.model)}</option></select></label>
            <button type="button" class="btn" data-test>연결 테스트</button>
          </div>
          <div data-msg style="font-size:13px;min-height:1.2em"></div>
          <div style="font-size:12px;color:var(--muted);line-height:1.6">· 키는 <b>이 브라우저에만</b> 저장되고 Google로만 전송됩니다. 저장소나 다른 사용자에게는 전달되지 않습니다.<br>· 무료 등급은 입력 내용이 Google 제품 개선에 쓰일 수 있습니다. <b>사내 기밀·거래 정보는 입력하지 마세요.</b><br>· 공용 PC에서는 사용 후 '키 삭제'를 누르세요.</div>
        </fieldset>
        <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap">
          <button type="button" class="btn danger" data-del ${g.key ? "" : "hidden"}>키 삭제</button>
          <span style="flex:1"></span>
          <button type="button" class="btn" data-x>닫기</button><button class="btn primary">저장</button>
        </div>
      </form>
    </div>`;
    document.body.appendChild(w);
    const f = w.querySelector("form"), msg = w.querySelector("[data-msg]"), fs = w.querySelector("[data-g]");
    const sync = () => { fs.style.opacity = f.p.value === "gemini" ? "1" : ".55"; };
    f.querySelectorAll("input[name=p]").forEach(r => r.onchange = sync); sync();
    const close = () => w.remove();
    w.querySelector("[data-x]").onclick = close;
    w.firstElementChild.addEventListener("click", e => { if (e.target === w.firstElementChild) close(); });
    w.querySelector("[data-del]").onclick = () => { LS.del(K.gemini); if (LS.get(K.provider, "auto") === "gemini") LS.set(K.provider, "auto"); paintMode(); close(); };
    async function test() {
      const key = f.key.value.trim() || g.key;
      if (!key) { msg.innerHTML = '<span class="bad">API 키를 입력하세요.</span>'; return false; }
      msg.innerHTML = '<span class="spin"></span> 연결 확인 중…';
      try {
        const models = await geminiModels(key);
        if (!models.length) throw err("model_not_found", "사용 가능한 Gemini 모델이 없습니다");
        const keep = f.model.value;
        const chosen = models.some(m => m.id === keep) ? keep : (models.find(m => m.id === GEMINI_DEFAULT_MODEL) || models.find(m => /flash/.test(m.id) && !/lite|preview/.test(m.id)) || models[0]).id;
        f.model.innerHTML = models.map(m => `<option value="${esc(m.id)}"${m.id === chosen ? " selected" : ""}>${esc(m.id)}</option>`).join("");
        const r = await geminiFetch(`models/${encodeURIComponent(chosen)}:generateContent`, { contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }], generationConfig: { maxOutputTokens: 256, temperature: 0, ...(thinking(chosen) ? { thinkingConfig: thinking(chosen) } : {}) } }, null, key).catch(e => e.code === "bad_request" ? geminiFetch(`models/${encodeURIComponent(chosen)}:generateContent`, { contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }], generationConfig: { maxOutputTokens: 256, temperature: 0 } }, null, key) : Promise.reject(e));
        const j = await r.json();
        msg.innerHTML = `<span class="ok">✓ 연결됨 · 모델 ${models.length}개 확인 · 테스트 응답 "${esc(partsText((j.candidates || [])[0]).trim().slice(0, 20))}"</span>`;
        return true;
      } catch (e) {
        msg.innerHTML = `<span class="bad">✕ ${esc(e.code === "auth_error" ? "API 키가 올바르지 않습니다." : e.code === "rate_limited" ? "사용량 한도에 도달했습니다. 잠시 후 다시 시도하세요." : (e.message || e.code))}</span>`;
        return false;
      }
    }
    w.querySelector("[data-test]").onclick = test;
    f.onsubmit = async e => {
      e.preventDefault();
      const p = f.p.value;
      if (p === "gemini") {
        const key = f.key.value.trim() || g.key;
        if (!key) { msg.innerHTML = '<span class="bad">Gemini를 쓰려면 API 키를 입력하세요.</span>'; return; }
        if (f.key.value.trim() && !(await test())) return;
        LS.set(K.gemini, { key, model: f.model.value || GEMINI_DEFAULT_MODEL }); quickModel = null; try { sessionStorage.removeItem("dali.web.geminiModels"); } catch {}
      }
      LS.set(K.provider, p);
      paintMode(); close();
    };
    setTimeout(() => (pick === "gemini" ? f.key : f.querySelector("button.primary")).focus(), 30);
  }
  function askCode(retry) {
    return new Promise(resolve => {
      const old = document.getElementById("dali-code"); if (old) old.remove();
      const w = document.createElement("div"); w.id = "dali-code";
      w.innerHTML = `<div style="position:fixed;inset:0;background:rgba(10,14,20,.45);z-index:100;display:grid;place-items:center;padding:16px"><form style="background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;width:min(420px,100%);padding:20px;display:flex;flex-direction:column;gap:12px"><b>접속 코드</b><div style="font-size:13px;color:var(--muted)">${retry ? "접속 코드가 맞지 않습니다. 다시 입력하세요." : "이 사이트의 Claude 기능을 쓰려면 관리자가 알려 준 접속 코드를 입력하세요."}</div><input type="password" name="c" autocomplete="off"><div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn primary">확인</button></div></form></div>`;
      document.body.appendChild(w);
      const f = w.querySelector("form"); setTimeout(() => f.c.focus(), 30);
      f.onsubmit = e => { e.preventDefault(); const c = f.c.value.trim(); if (!c) return; LS.set(K.code, c); w.remove(); resolve(c); };
    });
  }
  document.addEventListener("DOMContentLoaded", () => { addSettingsButton(); serverReady.then(() => setTimeout(paintMode, 0)); });
  window.daliOpenSettings = openSettings;
})();
