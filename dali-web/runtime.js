/**
 * DALI web runtime — lets the DALI page run without a server.
 *
 *  - Documents: built-in dataset (data/dali-data.js) + documents you add, kept in this browser (localStorage)
 *  - Claude:    demo mode (mock-claude.js) by default.
 *               If the site is deployed with the serverless function (api/claude.js) and
 *               ANTHROPIC_API_KEY + DALI_ACCESS_CODE are set, real Claude answers are used.
 *  - Paths are relative, so it works on GitHub Pages (/repo/), Vercel (/) and from a local file.
 */
(function () {
  "use strict";
  const err = (code, message, text) => { const e = new Error(message || code); e.code = code; if (text) e.text = text; return e; };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return e; } },
  };
  const CODE_KEY = "dali.web.accessCode";
  let codeRejected = false;

  /* ---------- mode: real Claude (serverless) or demo ---------- */
  const mode = { real: false, needCode: false, models: {}, reason: "" };
  const modeReady = (async () => {
    if (location.protocol === "file:") { mode.reason = "로컬 파일로 열림"; return mode; }
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch("api/health", { signal: ctl.signal, cache: "no-store" }); clearTimeout(t);
      const j = r.ok ? await r.json() : null;
      if (j && j.app === "dali" && j.hasKey) { mode.real = true; mode.needCode = !!j.needCode; mode.models = j.models || {}; }
      else mode.reason = j && j.app === "dali" ? (j.keyWithoutCode ? "DALI_ACCESS_CODE 미설정" : "API 키 미설정") : "서버리스 함수 없음";
    } catch { mode.reason = "서버리스 함수 없음"; }
    return mode;
  })();

  /* ---------- sample: real (serverless) ---------- */
  function linkSignal(outer) {
    const ctl = new AbortController();
    if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener("abort", () => ctl.abort(), { once: true }); }
    return ctl;
  }
  async function postClaude(body, signal) {
    let code = LS.get(CODE_KEY, "");
    if (mode.needCode && !code) { code = await askCode(codeRejected); codeRejected = false; }
    let res;
    try {
      res = await fetch("api/claude", { method: "POST", headers: { "content-type": "application/json", "x-dali-code": code || "" }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal && signal.aborted) throw err("cancelled");
      throw err("upstream_error", "서버리스 함수에 연결하지 못했습니다.");
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.code === "bad_access_code") { LS.set(CODE_KEY, ""); codeRejected = true; }
      throw err(j.code || "upstream_error", j.message);
    }
    return res;
  }
  async function realSample(input, opts = {}) {
    const ctl = linkSignal(opts.signal);
    const res = await postClaude({ input, tier: opts.modelTier === "quick" ? "quick" : "default" }, ctl.signal);
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", text = "", meta = {};
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).replace(/^data: ?/, ""); buf = buf.slice(i + 2);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.t) { text += ev.t; opts.onText && opts.onText({ text }); }
          else if (ev.error) throw err(ev.error.code, ev.error.message, text);
          else if (ev.done) meta = ev;
        }
      }
    } catch (e) {
      if (ctl.signal.aborted) throw err("cancelled", "", text);
      throw e.code ? e : err("upstream_error", String(e), text);
    }
    return { text, truncated: meta.stop === "max_tokens", modelTierApplied: meta.model || opts.modelTier };
  }
  realSample.json = async function (input, opts = {}) {
    const res = await postClaude({ input, json: true, tier: opts.modelTier === "default" ? "default" : "quick" }, linkSignal(opts.signal).signal);
    const j = await res.json();
    opts.onText && opts.onText({ text: j.text });
    return parseJson(j.text);
  };
  function parseJson(t) {
    const raw = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { return JSON.parse(raw); } catch {}
    const m = raw.match(/[\[{][\s\S]*[\]}]/); if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw err("invalid_json", "응답이 JSON 형식이 아닙니다", t);
  }

  /* ---------- sample: demo (mock) ---------- */
  const wait = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); signal && signal.addEventListener("abort", () => { clearTimeout(t); rej(err("cancelled")); }, { once: true }); });
  async function demoSample(input, opts = {}) {
    const ctl = linkSignal(opts.signal);
    await wait(250, ctl.signal);
    const full = window.DALI_MOCK.respond(input, false);
    let text = "";
    for (const part of full.match(/[\s\S]{1,28}/g) || []) {
      if (ctl.signal.aborted) throw err("cancelled", "", text);
      text += part; opts.onText && opts.onText({ text });
      await wait(14, ctl.signal).catch(e => { throw err("cancelled", "", text); });
    }
    return { text, truncated: false, modelTierApplied: "demo (모의 응답)" };
  }
  demoSample.json = async function (input, opts = {}) {
    await wait(120, opts.signal);
    const obj = window.DALI_MOCK.respond(input, true);
    opts.onText && opts.onText({ text: JSON.stringify(obj, null, 2) });
    return obj;
  };

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
      if (name === "sample") { await modeReady; const s = mode.real ? realSample : demoSample; s.ready = true; s.demo = !mode.real; return s; }
      if (name === "db") return db;
      if (name === "user") return { id: "web", can: async () => true };
      return null;
    },
  };
  window.daliResetLocalData = () => { overlay = { docs: {}, arts: {} }; LS.set(OVERLAY_KEY, overlay); location.reload(); };

  /* ---------- small UI: mode badge + banner + access code ---------- */
  function paintMode() {
    const pill = document.getElementById("pillApi");
    if (pill) { pill.className = "pill " + (mode.real ? "on" : "wait"); pill.lastElementChild.textContent = mode.real ? "Claude API 연결" : "데모 모드"; pill.title = mode.real ? (mode.models.default || "") : "Claude API 없이 원문 발췌로 응답 (" + mode.reason + ")"; }
    const db = document.getElementById("pillDb");
    if (db) { db.lastElementChild.textContent = "내장 데이터"; }
    if (!mode.real && !document.getElementById("dali-demo-banner") && !LS.get("dali.web.bannerClosed", false)) {
      const b = document.createElement("div");
      b.id = "dali-demo-banner";
      b.style.cssText = "background:var(--hl);color:var(--ink);border-bottom:1px solid var(--line);font-size:13px;padding:8px 16px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap";
      b.innerHTML = `<span><b>데모 모드</b> · Claude API 없이 동작합니다. 검색·원문·문서 관리는 실제 데이터이고, 답변·챗봇·초안은 <b>근거 조문 문장을 발췌한 모의 응답</b>입니다.</span><button type="button" class="btn small">닫기</button>`;
      b.querySelector("button").onclick = () => { b.remove(); LS.set("dali.web.bannerClosed", true); };
      const header = document.querySelector("header.top");
      header && header.parentNode.insertBefore(b, header.nextSibling);
    }
  }
  function askCode(retry) {
    return new Promise(resolve => {
      const old = document.getElementById("dali-code"); if (old) old.remove();
      const w = document.createElement("div"); w.id = "dali-code";
      w.innerHTML = `<div style="position:fixed;inset:0;background:rgba(10,14,20,.45);z-index:100;display:grid;place-items:center;padding:16px"><form style="background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;width:min(420px,100%);padding:20px;display:flex;flex-direction:column;gap:12px"><b>접속 코드</b><div style="font-size:13px;color:var(--muted)">${retry ? "접속 코드가 맞지 않습니다. 다시 입력하세요." : "이 사이트의 Claude 기능을 쓰려면 관리자가 알려 준 접속 코드를 입력하세요."}</div><input type="password" name="c" autocomplete="off"><div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn primary">확인</button></div></form></div>`;
      document.body.appendChild(w);
      const f = w.querySelector("form"); setTimeout(() => f.c.focus(), 30);
      f.onsubmit = e => { e.preventDefault(); const c = f.c.value.trim(); if (!c) return; LS.set(CODE_KEY, c); w.remove(); resolve(c); };
    });
  }
  document.addEventListener("DOMContentLoaded", () => modeReady.then(() => setTimeout(paintMode, 0)));
})();
