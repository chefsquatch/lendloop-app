import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { category, condition } from "./schema";
import { requireUser } from "./lib/auth";
import { todayIso } from "./lib/dates";

const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

function cleanText(s: string, max: number, field: string): string {
  const t = s.trim();
  if (!t) throw new ConvexError(`${field} is required.`);
  if (t.length > max) throw new ConvexError(`${field} must be ${max} characters or less.`);
  return t;
}

/** A tool is out if an approved loan covers today. */
async function isOnLoanToday(ctx: QueryCtx, toolId: Id<"tools">): Promise<boolean> {
  const today = todayIso();
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .collect();
  return loans.some((l) => l.status === "approved" && l.startDate <= today && today <= l.endDate);
}

/**
 * Public, signed-out list. Data minimization: name and category only, no owner, no
 * description, no ids of people.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(200);
    const out = [];
    for (const t of tools) {
      if (!(await isOnLoanToday(ctx, t._id))) out.push({ name: t.name, category: t.category });
    }
    return out;
  },
});

/** Signed-in browse: every tool with availability, optional category filter. */
export const listAll = query({
  args: { category: v.optional(category) },
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .order("desc")
          .collect()
      : await ctx.db.query("tools").order("desc").collect();
    return await Promise.all(tools.map((t) => present(ctx, t, viewer)));
  },
});

export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .collect();
    return await Promise.all(tools.map((t) => present(ctx, t, viewer)));
  },
});

async function present(ctx: QueryCtx, t: Doc<"tools">, viewer: Doc<"users">) {
  const owner = await ctx.db.get(t.ownerId);
  return {
    _id: t._id,
    name: t.name,
    category: t.category,
    condition: t.condition,
    description: t.description,
    // Signed-in neighbors see the lender's first name and trust badge, never email.
    ownerName: owner?.name.split(" ")[0] ?? "Neighbor",
    ownerTrusted: owner?.trustedLender ?? false,
    isMine: t.ownerId === viewer._id,
    available: !(await isOnLoanToday(ctx, t._id)),
  };
}

export const create = mutation({
  args: { name: v.string(), category, condition, description: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    return await ctx.db.insert("tools", {
      ownerId: viewer._id,
      name: cleanText(args.name, MAX_NAME, "Name"),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, MAX_DESCRIPTION, "Description"),
    });
  },
});

/** Owners edit their own listings. Admins can remove but not edit other people's listings. */
export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new ConvexError("Tool not found.");
    if (tool.ownerId !== viewer._id) throw new ConvexError("You can only edit your own listings.");
    await ctx.db.patch(tool._id, {
      name: cleanText(args.name, MAX_NAME, "Name"),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, MAX_DESCRIPTION, "Description"),
    });
  },
});

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new ConvexError("Tool not found.");
    if (tool.ownerId !== viewer._id && viewer.role !== "admin") {
      throw new ConvexError("You can only remove your own listings.");
    }
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", tool._id))
      .collect();
    if (loans.some((l) => l.status === "approved")) {
      throw new ConvexError("This tool is lent out. Mark the loan returned first.");
    }
    // Open requests on a removed tool are declined so borrowers are not left waiting.
    for (const l of loans) if (l.status === "requested") await ctx.db.patch(l._id, { status: "declined" });
    await ctx.db.delete(tool._id);
  },
});
