import { defineSchema, defineTable } from "convex/server";
import { v, Infer } from "convex/values";

export const AFFILIATION_VALIDATOR = v.union(v.literal("PUTZ"), v.literal("NONE"));
export type Affiliation = Infer<typeof AFFILIATION_VALIDATOR>;

export default defineSchema({
  locations: defineTable({
    name: v.string(),
    lastName: v.optional(v.string()), // Used to disambiguate people who share a first name.
    providerId: v.string(),
    latitude: v.number(),
    longitude: v.number(),
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
    voteCount: v.optional(v.number()), // Track total votes for sorting
    hidden: v.optional(v.boolean()), // Hidden quotes are excluded from getSayings
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_voteCount", ["voteCount"]),

  // Assassins: who killed whom. Every PUTZ user is playing.
  assassinsKills: defineTable({
    victimId: v.id("users"),
    killerId: v.union(v.id("users"), v.null()), // null = disqualified by the game master.
    timestamp: v.number(),
  }).index("by_victimId", ["victimId"]),

  // Pushed by nickbot as it refreshes each room's MIT room bookings (plus Hydrant's class schedule), every ~6 hours.
  classroomAvailability: defineTable({
    room: v.string(), // e.g. "W41-1119"
    building: v.string(), // e.g. "W41" (wings like "14N" are folded into "14")
    capacity: v.optional(v.number()), // Seats: registrar count, or estimated from floor area; >= 60 ≈ lecture hall
    open: v.array(v.object({ start: v.number(), end: v.number() })), // ms timestamps, today and tomorrow
    updatedAt: v.number(), // When nickbot fetched this room's bookings (ms)
  }).index("by_room", ["room"]),

  // Classrooms people couldn't use, for admins to review and drop from nickbot's list. One per person per room.
  classroomReports: defineTable({
    room: v.string(),
    userId: v.id("users"),
    note: v.string(), // What's wrong with it, in the reporter's words.
    timestamp: v.number(),
  })
    .index("by_room", ["room"])
    .index("by_user_room", ["userId", "room"]),

  // Track individual user votes on SMDS quotes
  smdsVotes: defineTable({
    sayingId: v.id("shitMyDadSays"),
    userId: v.id("users"),
  })
    .index("by_saying", ["sayingId"])
    .index("by_user_saying", ["userId", "sayingId"]),
});
