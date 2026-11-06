// Workflow 1, step 1: verify the Convex signature over the RAW request body, refuse
// replays, and drop duplicate deliveries (Convex retries with the same event id).
const item = $input.first();
const headers = item.json.headers || {};

// The Webhook node keeps the raw body as binary "data" (option Raw Body). Re-serialising
// the parsed JSON could change bytes and break the signature, so no raw body = reject.
let raw = null;
if (item.binary && item.binary.data) {
  raw = (await this.helpers.getBinaryDataBuffer(0, "data")).toString("utf8");
}
if (raw === null) return [{ json: { valid: false, reason: "raw body unavailable" } }];

const check = lendloopVerify(raw, headers["x-lendloop-timestamp"], headers["x-lendloop-signature"]);
if (!check.ok) return [{ json: { valid: false, reason: check.reason } }];

let event;
try {
  event = JSON.parse(raw);
} catch (e) {
  return [{ json: { valid: false, reason: "invalid JSON" } }];
}
if (!event || typeof event.eventId !== "string" || !event.recipient || !event.recipient.email) {
  return [{ json: { valid: false, reason: "missing fields" } }];
}

// Idempotency: remember event ids for 7 days (workflow static data persists across
// production executions). A retry that lands after a slow success is acknowledged, not re-sent.
const store = $getWorkflowStaticData("global");
store.seenEventIds = store.seenEventIds || {};
const now = Date.now();
for (const [id, at] of Object.entries(store.seenEventIds)) {
  if (now - at > 7 * 24 * 3600 * 1000) delete store.seenEventIds[id];
}
const duplicate = Boolean(store.seenEventIds[event.eventId]);
if (!duplicate) store.seenEventIds[event.eventId] = now;

return [{ json: { valid: true, duplicate, event } }];
