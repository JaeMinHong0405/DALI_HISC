// Shared helpers for the serverless functions (files starting with "_" are not exposed as endpoints on Vercel).
"use strict";
const crypto = require("crypto");

function cfg() {
  return {
    apiKey: (process.env.ANTHROPIC_API_KEY || "").trim(),
    accessCode: (process.env.DALI_ACCESS_CODE || "").trim(),
    baseUrl: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, ""),
    modelDefault: process.env.DALI_MODEL_DEFAULT || "claude-sonnet-5-5",
    modelQuick: process.env.DALI_MODEL_QUICK || "claude-haiku-5-5",
    maxTokens: Number(process.env.DALI_MAX_TOKENS) || 8192,
  };
}
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
function sameSecret(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 2 * 1024 * 1024) throw Object.assign(new Error("too large"), { status: 413 }); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function mapUpstreamError(status, body) {
  const msg = body?.error?.message || "";
  if (status === 401 || status === 403) return ["auth_error", "API 키가 올바르지 않거나 권한이 없습니다."];
  if (status === 429) return ["rate_limited", msg];
  if (status === 413 || /prompt is too long|too many tokens/i.test(msg)) return ["prompt_too_large", msg];
  if (status === 404 && /model/i.test(msg)) return ["model_not_found", msg];
  if (status === 400) return ["bad_request", msg];
  return ["upstream_error", msg || `HTTP ${status}`];
}
module.exports = { cfg, json, sameSecret, readJson, mapUpstreamError };
