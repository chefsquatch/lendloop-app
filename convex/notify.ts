import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign } from "./lib/hmac";

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [0, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];

/**
 * Builds the minimal payload for one loan notification: who to notify and what about.
 * The recipient is the one person who needs to act or know (owner on a new request,
 * borrower on a decision or return). No other user's email ever leaves Convex.
 */
export const loanEventPayload = internalQuery({
  args: { idempotencyKey: v.string() },
  handler: async (ctx, { idempotencyKey }) => {
    const event = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (!event || event.status === "sent") return null;
    const loan = await ctx.db.get(event.loanId);
    if (!loan) return null;
    const tool = await ctx.db.get(loan.toolId);
    const recipientId = loan.status === "requested" ? loan.ownerId : loan.borrowerId;
    const recipient = await ctx.db.get(recipientId);
    if (!recipient?.email) return null;
    return {
      eventId: idempotencyKey,
      attempts: event.attempts,
      payload: {
        eventId: idempotencyKey,
        type: `loan.${loan.status}`,
        loanId: loan._id,
        toolName: tool?.name ?? "a tool",
        startDate: loan.startDate,
        endDate: loan.endDate,
        recipient: { firstName: recipient.name.split(" ")[0], email: recipient.email },
      },
    };
  },
});

export const recordDelivery = internalMutation({
  args: { idempotencyKey: v.string(), ok: v.boolean(), detail: v.optional(v.string()) },
  handler: async (ctx, { idempotencyKey, ok, detail }) => {
    const event = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (!event || event.status === "sent") return { retry: false };
    const attempts = event.attempts + 1;
    if (ok) {
      await ctx.db.patch(event._id, { status: "sent", attempts, detail: undefined, updatedAt: Date.now() });
      return { retry: false };
    }
    const giveUp = attempts >= MAX_ATTEMPTS;
    await ctx.db.patch(event._id, {
      status: giveUp ? "failed" : "pending",
      attempts,
      detail: detail?.slice(0, 300),
      updatedAt: Date.now(),
    });
    return { retry: !giveUp, delayMs: BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)] };
  },
});

/** POSTs one signed loan event to the n8n webhook, retrying with backoff on failure. */
export const deliverLoanEvent = internalAction({
  args: { idempotencyKey: v.string() },
  handler: async (ctx, { idempotencyKey }) => {
    const data = await ctx.runQuery(internal.notify.loanEventPayload, { idempotencyKey });
    if (!data) return;
    const url = process.env.N8N_LOAN_EVENT_WEBHOOK_URL;
    const secret = process.env.N8N_SIGNING_SECRET;
    let ok = false;
    let detail: string | undefined;
    if (!url || !secret) {
      detail = "N8N_LOAN_EVENT_WEBHOOK_URL or N8N_SIGNING_SECRET not set";
    } else {
      const body = JSON.stringify(data.payload);
      const ts = Math.floor(Date.now() / 1000);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [TIMESTAMP_HEADER]: String(ts),
            [SIGNATURE_HEADER]: await sign(secret, ts, body),
            // n8n can dedupe on this if a retry lands after a slow success.
            "x-lendloop-event-id": data.eventId,
          },
          body,
        });
        ok = res.ok;
        if (!ok) detail = `n8n responded ${res.status}`;
      } catch (e) {
        detail = `network error: ${(e as Error).message}`;
      }
    }
    const result = await ctx.runMutation(internal.notify.recordDelivery, { idempotencyKey, ok, detail });
    if (result.retry) {
      await ctx.scheduler.runAfter(result.delayMs ?? 60_000, internal.notify.deliverLoanEvent, { idempotencyKey });
    }
  },
});
