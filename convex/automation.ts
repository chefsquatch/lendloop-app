import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { todayIso } from "./lib/dates";

/** Approved loans whose end date has passed. Minimal fields: what n8n needs to send one reminder. */
export const overdueLoans = internalQuery({
  args: { today: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const today = args.today ?? todayIso();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today))
      .collect();
    const out = [];
    for (const loan of loans) {
      const [tool, borrower] = await Promise.all([ctx.db.get(loan.toolId), ctx.db.get(loan.borrowerId)]);
      if (!borrower?.email) continue;
      out.push({
        loanId: loan._id,
        toolName: tool?.name ?? "a tool",
        endDate: loan.endDate,
        borrower: { firstName: borrower.name.split(" ")[0], email: borrower.email },
        // One reminder per loan per day: n8n echoes this back on write-back.
        reminderKey: `reminder:${loan._id}:${today}`,
      });
    }
    return { today, loans: out };
  },
});

/**
 * n8n write-back after sending (or failing to send) a reminder. Idempotent on reminderKey:
 * a retried write-back updates the same row, never adds a second one.
 */
export const recordReminder = internalMutation({
  args: {
    loanId: v.id("loans"),
    reminderKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.reminderKey.startsWith(`reminder:${args.loanId}:`)) {
      return { ok: false as const, error: "reminderKey does not match loanId" };
    }
    const loan = await ctx.db.get(args.loanId);
    if (!loan) return { ok: false as const, error: "loan not found" };
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.reminderKey))
      .unique();
    const now = Date.now();
    if (existing) {
      // A late "failed" retry never overwrites a recorded success.
      if (existing.status !== "sent") {
        await ctx.db.patch(existing._id, {
          status: args.status,
          attempts: existing.attempts + 1,
          detail: args.detail?.slice(0, 300),
          updatedAt: now,
        });
      }
      return { ok: true as const, duplicate: true };
    }
    await ctx.db.insert("automationEvents", {
      loanId: args.loanId,
      kind: "overdue_reminder",
      idempotencyKey: args.reminderKey,
      status: args.status,
      attempts: 1,
      detail: args.detail?.slice(0, 300),
      updatedAt: now,
    });
    return { ok: true as const, duplicate: false };
  },
});
