/**
 * HMAC-SHA256 signing shared by both directions (Convex -> n8n and n8n -> Convex).
 *
 * The usual webhook-signature pattern (as in Square / Stripe verification): sign the exact raw
 * body, compare in constant time. Convex's default runtime has Web Crypto, not node:crypto,
 * so createHmac/timingSafeEqual become crypto.subtle + a constant-time loop.
 *
 * Signed string = `${timestamp}.${rawBody}` (timestamp = unix seconds) so a captured request
 * cannot be replayed later (the same scheme as n8n template 14486 / Stripe / Slack).
 */
export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const MAX_SKEW_SECONDS = 300;

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sign(secret: string, timestamp: number, rawBody: string): Promise<string> {
  return hmacHex(secret, `${timestamp}.${rawBody}`);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verify(
  secret: string | undefined,
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!secret) return { ok: false, reason: "secret not configured" };
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: "missing headers" };
  const ts = Number(timestampHeader);
  if (!Number.isInteger(ts)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale timestamp" };
  const expected = await sign(secret, ts, rawBody);
  return constantTimeEqual(expected, signatureHeader.trim().toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "bad signature" };
}
