import { mutation, query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireAdmin, requirePutz } from "./utils/auth";
import { disambiguateNames } from "./locations";

const getKillOf = (ctx: QueryCtx, victimId: Id<"users">) =>
  ctx.db
    .query("assassinsKills")
    .withIndex("by_victimId", (q) => q.eq("victimId", victimId))
    .unique();

// Every PUTZ person is playing: the living (by name) and the dead (most recent first), with kill
// counts. Targets are secret, so nothing here says who is hunting whom.
export const getPlayers = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);

    const [users, kills] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("assassinsKills").collect(),
    ]);
    // Non-MIT accounts are shared ones (the hall TV, computzing), not players.
    const players = users.filter((u) => u.affiliation === "PUTZ" && u.email.endsWith("@mit.edu"));

    // First names, with a last initial if two players share one.
    const nameOf = disambiguateNames(
      players.map((p) => {
        const [name, ...rest] = p.name.split(" ");
        return { providerId: p._id, name, lastName: rest.join(" ") || undefined };
      })
    );

    const deathOf = new Map(kills.map((k) => [k.victimId, k]));
    const killCount = new Map<Id<"users">, number>();
    for (const { killerId } of kills)
      if (killerId) killCount.set(killerId, (killCount.get(killerId) ?? 0) + 1);

    const toPlayer = (p: (typeof players)[number]) => ({
      _id: p._id,
      name: nameOf.get(p._id)!,
      kills: killCount.get(p._id) ?? 0,
    });

    return {
      alive: players
        .filter((p) => !deathOf.has(p._id))
        .map(toPlayer)
        .sort((a, b) => a.name.localeCompare(b.name)),
      dead: players
        .filter((p) => deathOf.has(p._id))
        .map((p) => {
          const { killerId, timestamp } = deathOf.get(p._id)!;
          const killer = killerId ? (nameOf.get(killerId) ?? null) : null; // null = disqualified.
          return { ...toPlayer(p), killer, timestamp };
        })
        .sort((a, b) => b.timestamp - a.timestamp),
    };
  },
});

export const recordKill = mutation({
  args: {
    victimId: v.id("users"),
    killerId: v.union(v.id("users"), v.null()), // null = disqualified by the game master.
  },
  handler: async (ctx, { victimId, killerId }) => {
    await requireAdmin(ctx);

    if (victimId === killerId) throw new Error("CANNOT_KILL_SELF");
    if (await getKillOf(ctx, victimId)) throw new Error("VICTIM_ALREADY_DEAD");
    if (killerId && (await getKillOf(ctx, killerId))) throw new Error("KILLER_ALREADY_DEAD");

    await ctx.db.insert("assassinsKills", { victimId, killerId, timestamp: Date.now() });
  },
});

export const undoKill = mutation({
  args: { victimId: v.id("users") },
  handler: async (ctx, { victimId }) => {
    await requireAdmin(ctx);

    const kill = await getKillOf(ctx, victimId);
    if (!kill) throw new Error("PLAYER_NOT_DEAD");

    await ctx.db.delete(kill._id);
  },
});
