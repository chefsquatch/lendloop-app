import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./lib/auth";
import { isIsoDate, overlaps, todayIso } from "./lib/dates";

const MAX_LOAN_DAYS = 30;

/**
 * Queue a signed notification to n8n for this loan's current status. The automationEvents
 * row is keyed by loan+status, so the same transition can never queue two notifications.
 */
export async function queueLoanNotification(ctx: MutationCtx, loan: Doc<"loans">) {
  const idempotencyKey = `loan:${loan._id}:${loan.status}`;
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (existing) return;
  await ctx.db.insert("automationEvents", {
    loanId: loan._id,
    kind: "loan_notification",
    idempotencyKey,
    status: "pending",
    attempts: 0,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.notify.deliverLoanEvent, { idempotencyKey });
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new ConvexError("Tool not found.");
    if (tool.ownerId === viewer._id) throw new ConvexError("You can't borrow your own tool.");
    if (!isIsoDate(args.startDate) || !isIsoDate(args.endDate)) throw new ConvexError("Pick valid dates.");
    if (args.startDate < todayIso()) throw new ConvexError("Start date can't be in the past.");
    if (args.endDate < args.startDate) throw new ConvexError("End date must be on or after start date.");
    const days = (Date.parse(args.endDate) - Date.parse(args.startDate)) / 86_400_000 + 1;
    if (days > MAX_LOAN_DAYS) throw new ConvexError(`Loans are limited to ${MAX_LOAN_DAYS} days.`);

    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", tool._id))
      .collect();
    if (loans.some((l) => l.status === "approved" && overlaps(l.startDate, l.endDate, args.startDate, args.endDate))) {
      throw new ConvexError("That tool is already lent out for some of those dates.");
    }
    if (loans.some((l) => l.status === "requested" && l.borrowerId === viewer._id)) {
      throw new ConvexError("You already have a pending request for this tool.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: viewer._id,
      startDate: args.startDate,
      endDate: args.endDate,
      status: "requested",
    });
    await queueLoanNotification(ctx, (await ctx.db.get(loanId))!);
    return loanId;
  },
});

/** Only the tool's owner can approve or decline. */
export const decide = mutation({
  args: { loanId: v.id("loans"), approve: v.boolean() },
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) throw new ConvexError("Request not found.");
    if (loan.ownerId !== viewer._id) throw new ConvexError("Only the tool's owner can decide this request.");
    if (loan.status !== "requested") throw new ConvexError("This request was already decided.");
    if (args.approve) {
      const others = await ctx.db
        .query("loans")
        .withIndex("by_tool", (q) => q.eq("toolId", loan.toolId))
        .collect();
      if (others.some((l) => l.status === "approved" && overlaps(l.startDate, l.endDate, loan.startDate, loan.endDate))) {
        throw new ConvexError("Those dates overlap a loan you already approved.");
      }
    }
    await ctx.db.patch(loan._id, { status: args.approve ? "approved" : "declined" });
    await queueLoanNotification(ctx, (await ctx.db.get(loan._id))!);
  },
});

/** The owner marks the tool returned (they are the one who has it back in hand). */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) throw new ConvexError("Loan not found.");
    if (loan.ownerId !== viewer._id) throw new ConvexError("Only the tool's owner can mark it returned.");
    if (loan.status !== "approved") throw new ConvexError("Only an active loan can be marked returned.");
    await ctx.db.patch(loan._id, { status: "returned", returnedAt: Date.now() });
    await queueLoanNotification(ctx, (await ctx.db.get(loan._id))!);
  },
});

async function present(ctx: QueryCtx, loan: Doc<"loans">) {
  const [tool, owner, borrower, events] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.ownerId),
    ctx.db.get(loan.borrowerId),
    ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .collect(),
  ]);
  const today = todayIso();
  return {
    _id: loan._id,
    toolName: tool?.name ?? "(removed tool)",
    ownerName: owner?.name.split(" ")[0] ?? "Neighbor",
    borrowerName: borrower?.name.split(" ")[0] ?? "Neighbor",
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < today,
    automation: events
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((e) => ({ kind: e.kind, status: e.status, attempts: e.attempts, at: e.updatedAt })),
  };
}

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((l) => present(ctx, l)));
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((l) => present(ctx, l)));
  },
});

export const adminAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(500);
    return await Promise.all(loans.map((l) => present(ctx, l)));
  },
});
