import { defineSchema, defineTable } from "convex/server";
import { v, Infer } from "convex/values";

export const AFFILIATION_VALIDATOR = v.union(v.literal("PUTZ"), v.literal("NONE"));
export type Affiliation = Infer<typeof AFFILIATION_VALIDATOR>;

export default defineSchema({
  googleAuthCookies: defineTable({
    name: v.string(),
    value: v.string(),
  }).index("by_name", ["name"]),

  locations: defineTable({
    name: v.string(),
    providerId: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    timestamp: v.number(),
    accuracy: v.number(),
  }).index("by_providerId", ["providerId"]),

  users: defineTable({
    name: v.string(),
    email: v.string(),
    affiliation: AFFILIATION_VALIDATOR,
    isAdmin: v.boolean(),
  }).index("by_email", ["email"]),

  shitMyDadSays: defineTable({
    timestamp: v.number(),
    sender: v.string(),
    quoted: v.string(),
    quote: v.string(),
  }).index("by_timestamp", ["timestamp"]),
});
