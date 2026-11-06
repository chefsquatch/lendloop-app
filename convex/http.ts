import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./lib/hmac";

/**
 * Endpoints n8n calls. Every request must carry a fresh HMAC signature over
 * `${timestamp}.${rawBody}` made with N8N_SIGNING_SECRET; anything else gets 401 and
 * touches nothing. Errors never echo the secret or the expected signature.
 */
const http = httpRouter();

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function verified(req: Request): Promise<{ ok: true; raw: string } | { ok: false; res: Response }> {
  const raw = await req.text();
  const check = await verify(
    process.env.N8N_SIGNING_SECRET,
    raw,
    req.headers.get(TIMESTAMP_HEADER),
    req.headers.get(SIGNATURE_HEADER),
  );
  if (!check.ok) return { ok: false, res: json(401, { error: "unauthorized", reason: check.reason }) };
  return { ok: true, raw };
}

// POST (not GET) so the request has a body to sign; body is `{}` or `{"today":"YYYY-MM-DD"}`.
http.route({
  path: "/n8n/overdue-loans",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const v = await verified(req);
    if (!v.ok) return v.res;
    let today: string | undefined;
    try {
      const body = v.raw ? JSON.parse(v.raw) : {};
      if (typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)) today = body.today;
    } catch {
      return json(400, { error: "invalid JSON" });
    }
    return json(200, await ctx.runQuery(internal.automation.overdueLoans, { today }));
  }),
});

http.route({
  path: "/n8n/reminder-status",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const v = await verified(req);
    if (!v.ok) return v.res;
    let body: { loanId?: unknown; reminderKey?: unknown; status?: unknown; detail?: unknown };
    try {
      body = JSON.parse(v.raw);
    } catch {
      return json(400, { error: "invalid JSON" });
    }
    if (
      typeof body.loanId !== "string" ||
      typeof body.reminderKey !== "string" ||
      (body.status !== "sent" && body.status !== "failed")
    ) {
      return json(400, { error: "loanId, reminderKey and status (sent|failed) are required" });
    }
    try {
      const result = await ctx.runMutation(internal.automation.recordReminder, {
        loanId: body.loanId as Id<"loans">,
        reminderKey: body.reminderKey,
        status: body.status,
        detail: typeof body.detail === "string" ? body.detail : undefined,
      });
      return json(result.ok ? 200 : 404, result);
    } catch {
      // Malformed id (fails Convex's v.id validation).
      return json(400, { error: "invalid loanId" });
    }
  }),
});

export default http;
