import { defineSchema, defineTable } from "convex/server";
import { v, Infer } from "convex/values";

export const AFFILIATION_VALIDATOR = v.union(v.literal("PUTZ"), v.literal("NONE"));
export type Affiliation = Infer<typeof AFFILIATION_VALIDATOR>;

/** Audio quality tiers for the DJs library, best first. */
export const QUALITY_VALIDATOR = v.union(
  v.literal("lossless"), // WAV / FLAC / AIFF -- the uploader's original
  v.literal("mp3-320"),
  v.literal("aac-256"), // SoundCloud Go+ stream
  v.literal("aac-160"), // SoundCloud free-tier stream
  v.literal("aac-96"),
  v.literal("other"),
);
export type Quality = Infer<typeof QUALITY_VALIDATOR>;

/**
 * Where a track's cue points came from. Rekordbox keeps cues in its own
 * database rather than in the audio file, so they only arrive via an XML
 * export. Serato writes them into the file, so those can be read on upload.
 */
export const CUE_SOURCE_VALIDATOR = v.union(
  v.literal("rekordbox-xml"),
  v.literal("serato-embedded"),
  v.literal("manual"),
);
export type CueSource = Infer<typeof CUE_SOURCE_VALIDATOR>;

const CUE_VALIDATOR = v.object({
  name: v.string(),
  timeMs: v.number(),
  /** Hot cue slot (0 = A, 1 = B, ...). Absent for memory cues. */
  slot: v.optional(v.number()),
  colorHex: v.optional(v.string()),
});

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
    /**
     * Legacy home of the DJ display name and colour, before profiles moved to
     * djProfiles so they could outlive the account. Nothing reads these; they
     * stay in the schema only so existing rows still validate.
     */
    djName: v.optional(v.string()),
    djColor: v.optional(v.string()),
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

  // Pushed by the availability scraper as it refreshes each room's MIT room bookings (plus Hydrant's
  // class schedule), every ~6 hours.
  classroomAvailability: defineTable({
    room: v.string(), // e.g. "W41-1119"
    building: v.string(), // e.g. "W41" (wings like "14N" are folded into "14")
    capacity: v.optional(v.number()), // Seats: registrar count, or estimated from floor area; >= 60 ≈ lecture hall
    open: v.array(v.object({ start: v.number(), end: v.number() })), // ms timestamps, today and tomorrow
    updatedAt: v.number(), // When the availability scraper fetched this room's bookings (ms)
  }).index("by_room", ["room"]),

  // Classrooms people couldn't use, for admins to review and drop from the availability scraper's list.
  // One per person per room.
  classroomReports: defineTable({
    room: v.string(),
    userId: v.id("users"),
    note: v.string(), // What's wrong with it, in the reporter's words.
    timestamp: v.number(),
  })
    .index("by_room", ["room"])
    .index("by_user_room", ["userId", "room"]),

  // The DJs library: tracks PUTZ members upload or rip, for everyone to
  // preview and download. Audio itself lives in Convex file storage.
  djTracks: defineTable({
    title: v.string(),
    artist: v.optional(v.string()),
    /**
     * Kerberos of whoever added it, e.g. "nicorios". Deliberately a plain
     * string rather than an Id<"users">: tracks outlive accounts, so removing
     * someone who has graduated must never take their uploads with them.
     */
    dj: v.string(),
    /**
     * Their DJ name as it was at upload time. Only used as a fallback once the
     * user record is gone -- while they still have an account the live name
     * wins, so renaming still updates their whole back catalogue.
     */
    djNameSnapshot: v.optional(v.string()),

    storageId: v.id("_storage"),
    filename: v.string(),
    ext: v.string(), // "m4a", "wav", ...
    mimeType: v.string(),
    sizeBytes: v.number(),
    durationSec: v.optional(v.number()),

    quality: QUALITY_VALIDATOR,
    bitrateKbps: v.optional(v.number()),

    /** Normalized genre tags (see convex/utils/genres.ts). Editable by anyone. */
    genres: v.array(v.string()),

    bpm: v.optional(v.number()),
    musicalKey: v.optional(v.string()),
    /** How bpm/musicalKey were obtained, so estimates can be labelled. */
    analysisSource: v.optional(v.union(v.literal("tag"), v.literal("detected"), v.literal("manual"))),

    /** Cover art, extracted from the file on ingest or uploaded by hand. */
    coverId: v.optional(v.id("_storage")),

    /** Rekordbox/Serato cue points, when we have them. */
    hotCues: v.optional(v.array(CUE_VALIDATOR)),
    memoryCues: v.optional(v.array(CUE_VALIDATOR)),
    cueSource: v.optional(CUE_SOURCE_VALIDATOR),

    sourceUrl: v.optional(v.string()), // SoundCloud permalink, if ripped
    uploadedAt: v.number(),
  })
    .index("by_dj", ["dj"])
    .index("by_uploadedAt", ["uploadedAt"]),

  // A DJ's identity on the library: name, tag colour, bio, picture.
  //
  // Keyed by kerb and deliberately kept off the user record, for the same
  // reason tracks are: someone who graduates loses their account, and their
  // back catalogue should still carry their name, colour and face rather than
  // falling back to a bare kerb.
  djProfiles: defineTable({
    kerb: v.string(),
    djName: v.optional(v.string()),
    /** Radix accent name used for this DJ's tag, e.g. "cyan". */
    djColor: v.optional(v.string()),
    djBio: v.optional(v.string()),
    avatarId: v.optional(v.id("_storage")),
    /** Hand-picked tag colours, which win over djColor when set. */
    tagBg: v.optional(v.string()),
    tagFg: v.optional(v.string()),
    /** Whether the tag glows, the same option genre tags get. */
    tagGlow: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_kerb", ["kerb"]),

  // Shared playlists over the DJ library. Anyone in PUTZ can make one, and
  // membership is a join table so a track can sit in several playlists and
  // deleting a playlist never touches the audio.
  djPlaylists: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    createdBy: v.string(), // kerb
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  djPlaylistTracks: defineTable({
    playlistId: v.id("djPlaylists"),
    trackId: v.id("djTracks"),
    position: v.number(),
    addedAt: v.number(),
    /** Kerb of whoever put this track in, for crediting contributors. */
    addedBy: v.optional(v.string()),
  })
    .index("by_playlist", ["playlistId"])
    .index("by_playlist_track", ["playlistId", "trackId"])
    .index("by_track", ["trackId"]),

  // Per-tag styling, so a genre can be given house colours. Only tags that
  // have been customised get a row; everything else falls back to the built-in
  // rules and then to the plain outline.
  djTagStyles: defineTable({
    tag: v.string(),
    bg: v.optional(v.string()), // hex, e.g. "#FF6A00"
    fg: v.optional(v.string()),
    glow: v.optional(v.boolean()),
  }).index("by_tag", ["tag"]),

  // Rip requests. Serverless can't run yt-dlp/ffmpeg, so a helper on a DJ's
  // own machine polls for pending rows, rips, uploads, and marks them done.
  djRipRequests: defineTable({
    url: v.string(),
    requestedBy: v.string(), // kerb
    status: v.union(
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("done"),
      v.literal("failed"),
    ),
    /** Progress / error detail for whoever is watching the queue. */
    message: v.optional(v.string()),
    trackCount: v.optional(v.number()),
    /**
     * Titles still rate-limited when the ripper gave up on them. Kept so the
     * email and the queue can name them, rather than just counting them.
     */
    rateLimited: v.optional(v.array(v.string())),
    claimedBy: v.optional(v.string()), // kerb of the machine's owner
    claimedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"]),

  // Track individual user votes on SMDS quotes
  smdsVotes: defineTable({
    sayingId: v.id("shitMyDadSays"),
    userId: v.id("users"),
  })
    .index("by_saying", ["sayingId"])
    .index("by_user_saying", ["userId", "sayingId"]),
});
