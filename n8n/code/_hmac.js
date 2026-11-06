// ---- shared HMAC helpers (prepended to every Code node by n8n/build-workflows.mjs) ----
// Same scheme as convex/lib/hmac.ts: hex HMAC-SHA256 over `${unixSeconds}.${rawBody}`,
// 300 s replay window, constant-time compare. The secret comes from the container env
// (n8n/.env), never from this file or the exported workflow JSON.
const crypto = require("crypto");
const LENDLOOP_MAX_SKEW_SECONDS = 300;

function lendloopSecret() {
  const s = $env.N8N_SIGNING_SECRET;
  if (!s) throw new Error("N8N_SIGNING_SECRET is not set in the n8n container env");
  return s;
}

function lendloopSign(ts, rawBody) {
  return crypto.createHmac("sha256", lendloopSecret()).update(`${ts}.${rawBody}`).digest("hex");
}

function lendloopVerify(rawBody, tsHeader, sigHeader, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!tsHeader || !sigHeader) return { ok: false, reason: "missing headers" };
  const ts = Number(tsHeader);
  if (!Number.isInteger(ts)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSeconds - ts) > LENDLOOP_MAX_SKEW_SECONDS) return { ok: false, reason: "stale timestamp" };
  const expected = Buffer.from(lendloopSign(ts, rawBody), "utf8");
  const given = Buffer.from(String(sigHeader).trim().toLowerCase(), "utf8");
  if (expected.length !== given.length) return { ok: false, reason: "bad signature" };
  return crypto.timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: "bad signature" };
}

/** Headers + exact body for a signed POST to Convex; the HTTP Request node sends `body` raw. */
function lendloopSignedRequest(path, payload) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const base = ($env.LENDLOOP_CONVEX_SITE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("LENDLOOP_CONVEX_SITE_URL is not set in the n8n container env");
  return { url: `${base}${path}`, body, timestamp: String(ts), signature: lendloopSign(ts, body) };
}
// ---- end shared helpers ----
