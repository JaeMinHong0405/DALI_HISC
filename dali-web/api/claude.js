// POST /api/claude — calls the Anthropic API with the key kept in the deployment's environment variables.
// Body: { input: string, json?: boolean, tier?: "default" | "quick" }   Header: x-dali-code: <access code>
// Streams text back as simple server-sent events: {"t": "..."} … {"done": true, "stop": "...", "model": "..."}
"use strict";
const { cfg, json, sameSecret, readJson, mapUpstreamError } = require("./_shared");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { code: "method_not_allowed" });
  const c = cfg();
  if (!c.apiKey || !c.accessCode) return json(res, 400, { code: "no_api_key", message: "ANTHROPIC_API_KEY와 DALI_ACCESS_CODE를 모두 설정해야 합니다." });
  if (!sameSecret(req.headers["x-dali-code"] || "", c.accessCode)) return json(res, 401, { code: "bad_access_code", message: "접속 코드가 맞지 않습니다." });

  let b;
  try { b = await readJson(req); } catch (e) { return json(res, e.status || 400, { code: "bad_request", message: "invalid body" }); }
  const input = b.input, wantJson = !!b.json, tier = b.tier === "quick" ? "quick" : "default";
  if (typeof input !== "string" || !input.trim() || input.length > 400000) return json(res, 400, { code: "bad_request", message: "input is required" });

  const model = tier === "quick" ? c.modelQuick : c.modelDefault;
  const ctl = new AbortController();
  req.on("close", () => { if (!res.writableEnded) ctl.abort(); });
  const body = { model, max_tokens: wantJson ? 2048 : c.maxTokens, messages: [{ role: "user", content: input }], stream: !wantJson };
  if (wantJson) body.system = "Respond with a single valid JSON value only. No prose, no code fences.";

  let up;
  try {
    up = await fetch(c.baseUrl + "/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body), signal: ctl.signal,
    });
  } catch (e) {
    if (ctl.signal.aborted) return;
    return json(res, 502, { code: "upstream_error", message: "Anthropic API에 연결하지 못했습니다." });
  }
  if (!up.ok) {
    const eb = await up.json().catch(() => ({}));
    const [code, message] = mapUpstreamError(up.status, eb);
    return json(res, up.status === 429 ? 429 : 502, { code, message });
  }
  if (wantJson) {
    const r = await up.json();
    return json(res, 200, { text: (r.content || []).filter(x => x.type === "text").map(x => x.text).join(""), model: r.model, stop: r.stop_reason });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  const out = o => res.write("data: " + JSON.stringify(o) + "\n\n");
  let stop = null, used = model, buf = "";
  const dec = new TextDecoder();
  try {
    for await (const chunk of up.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
        if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        if (ev.type === "message_start") used = ev.message?.model || used;
        else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") out({ t: ev.delta.text });
        else if (ev.type === "message_delta") stop = ev.delta?.stop_reason || stop;
        else if (ev.type === "error") out({ error: { code: "upstream_error", message: ev.error?.message || "stream error" } });
      }
    }
    out({ done: true, stop, model: used });
  } catch (e) {
    if (!ctl.signal.aborted) out({ error: { code: "upstream_error", message: "스트림이 끊겼습니다." } });
  }
  res.end();
};
