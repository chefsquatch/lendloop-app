import { mutation, query } from "./_generated/server";
import { getViewer, isBootstrapAdmin } from "./lib/auth";
import { ConvexError } from "convex/values";

/** Called by the client after Clerk sign-in. Creates or refreshes the viewer's row. */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in required.");
    const name = identity.name ?? identity.nickname ?? "Neighbor";
    const email = identity.email;
    const existing = await getViewer(ctx);
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (existing.name !== name) patch.name = name;
      if (existing.email !== email) patch.email = email;
      if (existing.role !== "admin" && isBootstrapAdmin(email)) patch.role = "admin";
      if (Object.keys(patch).length) await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: isBootstrapAdmin(email) ? "admin" : "user",
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getViewer(ctx);
    if (!user) return null;
    return { _id: user._id, name: user.name, role: user.role, trustedLender: user.trustedLender };
  },
});
