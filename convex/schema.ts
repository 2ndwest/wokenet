import { defineSchema, defineTable } from "convex/server";
import { v, Infer } from "convex/values";

export const AFFILIATION_VALIDATOR = v.union(v.literal("PUTZ"), v.literal("NONE"));
export type Affiliation = Infer<typeof AFFILIATION_VALIDATOR>;

export default defineSchema({
  locations: defineTable({
    name: v.string(),
    location: v.optional(
      v.union(v.literal("ON CAMPUS"), v.literal("OFF CAMPUS"), v.literal("IN HOUSING"))
    ),
  }),
  users: defineTable({
    name: v.string(),
    email: v.string(),
    affiliation: AFFILIATION_VALIDATOR,
    isAdmin: v.boolean(),
  }).index("by_email", ["email"]),
});
