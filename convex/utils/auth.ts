import { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

export const getIdentity = async (ctx: QueryCtx | ActionCtx | MutationCtx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !identity.email) throw new Error("UNAUTHENTICATED");
  return identity;
};

export const getUser = async <T extends boolean = false>(
  ctx: QueryCtx,
  // We do this nasty generics stuff to ensure the user return type
  // is only nullable if allowFresh=true, and non-nullable otherwise.
  { allowFresh = false as T }: { allowFresh?: T } = {} as { allowFresh?: T }
) => {
  const identity = await getIdentity(ctx);

  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", identity.email!))
    .unique();

  if (!allowFresh && !user) throw new Error("USER_NOT_FOUND");

  return {
    user: user as T extends true ? typeof user : NonNullable<typeof user>,
    identity,
  };
};

export const requirePutz = async (ctx: QueryCtx | MutationCtx) => {
  const userData = await getUser(ctx);
  if (userData.user.affiliation !== "PUTZ") throw new Error("NOT_PUTZ");
  return userData;
};

export const requireAdmin = async (ctx: QueryCtx | MutationCtx) => {
  const userData = await requirePutz(ctx);
  if (!userData.user.isAdmin) throw new Error("NOT_ADMIN");
  return userData;
};
