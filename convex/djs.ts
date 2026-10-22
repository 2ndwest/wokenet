import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { CUE_SOURCE_VALIDATOR, QUALITY_VALIDATOR } from "./schema";
import { requireAdmin, requirePutz } from "./utils/auth";
import { normalizeGenres, normalizeUserGenres } from "./utils/genres";
import { normalizeKey } from "./utils/keys";
import { groupDuplicates } from "./utils/duplicates";

/**
 * Upload limits. Enforced here rather than only in the UI, because the
 * mutation is callable directly by anyone signed in.
 */
const MAX_AUDIO_BYTES = 300 * 1024 * 1024; // 300 MB — a long lossless set
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTS = ["m4a", "mp3", "wav", "flac", "aiff", "aif", "opus", "ogg"];

/** Plausible tempo range; anything outside is a detection or typing error. */
const MIN_BPM = 40;
const MAX_BPM = 200;

const cleanBpm = (bpm: number | undefined): number | undefined => {
  if (typeof bpm !== "number" || !Number.isFinite(bpm)) return undefined;
  if (bpm < MIN_BPM || bpm > MAX_BPM) return undefined;
  return Math.round(bpm * 100) / 100;
};

/**
 * Everyone's DJ name is their kerb: the local part of their MIT email, minus
 * any "+tag" subaddress, so nicorios+whatever@mit.edu is still just nicorios.
 */
const kerbOf = (email: string) => email.split("@")[0].split("+")[0].toLowerCase();

const CUE_VALIDATOR = v.object({
  name: v.string(),
  timeMs: v.number(),
  slot: v.optional(v.number()),
  colorHex: v.optional(v.string()),
});

// ---------------------------------------------------------------- reading

/**
 * The whole library. Filtering (genre / dj / quality / cues) happens on the
 * client: the collection is a few hundred rows, and filtering there lets us
 * combine any number of filters without an index per combination.
 */
export const listTracks = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);
    const tracks = await ctx.db.query("djTracks").withIndex("by_uploadedAt").order("desc").collect();

    // Tracks store the kerb; the display name lives on the user and is
    // resolved here, so renaming yourself renames your whole back catalogue.
    const users = await ctx.db.query("users").collect();
    const names = new Map<string, string>();
    const colors = new Map<string, string>();
    for (const u of users) {
      const kerb = kerbOf(u.email);
      if (u.djName?.trim()) names.set(kerb, u.djName.trim());
      if (u.djColor) colors.set(kerb, u.djColor);
    }

    // Live name, then the name captured at upload (for DJs who have since
    // left and had their account removed), then the bare kerb.
    return await Promise.all(
      tracks.map(async (t) => ({
        ...t,
        djDisplay: names.get(t.dj) ?? t.djNameSnapshot ?? t.dj,
        djColor: colors.get(t.dj) ?? null,
        coverUrl: t.coverId ? await ctx.storage.getUrl(t.coverId) : null,
      })),
    );
  },
});

/** Colours a DJ can tag themselves with. Radix accents that read on both themes. */
export const DJ_COLORS = [
  "orange", "amber", "tomato", "red", "crimson", "pink", "plum", "purple",
  "violet", "indigo", "blue", "cyan", "teal", "jade", "green", "grass", "bronze",
] as const;

/** The caller's own DJ settings, so the UI can show what's currently set. */
export const myDjSettings = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requirePutz(ctx);
    return {
      kerb: kerbOf(user.email),
      djName: user.djName ?? "",
      djColor: user.djColor ?? "",
    };
  },
});

/**
 * Set your own display name and tag colour. A blank name falls back to your
 * kerb; a blank colour falls back to the site accent.
 */
export const setMyDjSettings = mutation({
  args: { djName: v.string(), djColor: v.string() },
  handler: async (ctx, { djName, djColor }) => {
    const { user } = await requirePutz(ctx);

    const trimmedName = djName.trim().slice(0, 40);
    // Only accept colours we actually offer, so nothing can inject a value
    // that Radix won't render.
    const color = (DJ_COLORS as readonly string[]).includes(djColor) ? djColor : undefined;

    await ctx.db.patch(user._id, {
      djName: trimmedName.length > 0 ? trimmedName : undefined,
      djColor: color,
    });
    return { djName: trimmedName, djColor: color ?? "" };
  },
});

/**
 * A short-lived URL for streaming or downloading one track. Kept separate from
 * listTracks so we don't mint a few hundred URLs on every reactive re-run.
 */
export const getTrackUrl = query({
  args: { trackId: v.id("djTracks") },
  handler: async (ctx, { trackId }) => {
    await requirePutz(ctx);
    const track = await ctx.db.get(trackId);
    if (!track) throw new Error("TRACK_NOT_FOUND");
    return await ctx.storage.getUrl(track.storageId);
  },
});

export const listRipRequests = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);
    return await ctx.db.query("djRipRequests").withIndex("by_createdAt").order("desc").take(50);
  },
});

// ---------------------------------------------------------------- playlists

/** Playlists with their track counts, oldest first. */
export const listPlaylists = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);
    const playlists = await ctx.db.query("djPlaylists").withIndex("by_createdAt").collect();
    const members = await ctx.db.query("djPlaylistTracks").collect();

    // Display names come from the user record, same as track credits, so a
    // rename follows everywhere.
    const users = await ctx.db.query("users").collect();
    const names = new Map<string, string>();
    const colors = new Map<string, string>();
    for (const u of users) {
      const kerb = kerbOf(u.email);
      if (u.djName?.trim()) names.set(kerb, u.djName.trim());
      if (u.djColor) colors.set(kerb, u.djColor);
    }

    const counts = new Map<string, number>();
    const contributors = new Map<string, Set<string>>();
    for (const m of members) {
      counts.set(m.playlistId, (counts.get(m.playlistId) ?? 0) + 1);
      if (m.addedBy) {
        const set = contributors.get(m.playlistId) ?? new Set<string>();
        set.add(m.addedBy);
        contributors.set(m.playlistId, set);
      }
    }

    return playlists.map((p) => ({
      ...p,
      trackCount: counts.get(p._id) ?? 0,
      createdByName: names.get(p.createdBy) ?? p.createdBy,
      createdByColor: colors.get(p.createdBy) ?? null,
      /** Everyone who has added to it, minus its creator, with their styling. */
      contributors: [...(contributors.get(p._id) ?? [])]
        .filter((kerb) => kerb !== p.createdBy)
        .sort()
        .map((kerb) => ({
          kerb,
          name: names.get(kerb) ?? kerb,
          color: colors.get(kerb) ?? null,
        })),
    }));
  },
});

/** Which tracks are in a playlist, in order. */
export const listPlaylistTrackIds = query({
  args: { playlistId: v.id("djPlaylists") },
  handler: async (ctx, { playlistId }) => {
    await requirePutz(ctx);
    const rows = await ctx.db
      .query("djPlaylistTracks")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlistId))
      .collect();
    rows.sort((a, b) => a.position - b.position);
    return rows.map((r) => r.trackId);
  },
});

export const createPlaylist = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, { name, description }) => {
    const { user } = await requirePutz(ctx);
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) throw new Error("PLAYLIST_NAME_REQUIRED");

    return await ctx.db.insert("djPlaylists", {
      name: trimmed,
      description: description?.trim().slice(0, 140) || undefined,
      createdBy: kerbOf(user.email),
      createdAt: Date.now(),
    });
  },
});

export const updatePlaylist = mutation({
  args: {
    playlistId: v.id("djPlaylists"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { playlistId, name, description }) => {
    await requirePutz(ctx);
    const patch: Record<string, unknown> = {};
    if (typeof name === "string" && name.trim()) patch.name = name.trim().slice(0, 60);
    if (typeof description === "string") {
      patch.description = description.trim().slice(0, 140) || undefined;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(playlistId, patch);
  },
});

/**
 * Removing a playlist only removes the grouping -- the tracks and their audio
 * stay in the library. Restricted to its creator or an admin all the same.
 */
export const deletePlaylist = mutation({
  args: { playlistId: v.id("djPlaylists") },
  handler: async (ctx, { playlistId }) => {
    const { user } = await requirePutz(ctx);
    const playlist = await ctx.db.get(playlistId);
    if (!playlist) return;
    if (playlist.createdBy !== kerbOf(user.email) && !user.isAdmin) {
      throw new Error("NOT_PLAYLIST_OWNER");
    }

    const rows = await ctx.db
      .query("djPlaylistTracks")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlistId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    await ctx.db.delete(playlistId);
  },
});

export const addTracksToPlaylist = mutation({
  args: { playlistId: v.id("djPlaylists"), trackIds: v.array(v.id("djTracks")) },
  handler: async (ctx, { playlistId, trackIds }) => {
    const { user } = await requirePutz(ctx);
    const kerb = kerbOf(user.email);

    const existing = await ctx.db
      .query("djPlaylistTracks")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlistId))
      .collect();
    const already = new Set(existing.map((r) => r.trackId));
    let position = existing.reduce((max, r) => Math.max(max, r.position), -1) + 1;

    let added = 0;
    for (const trackId of trackIds) {
      if (already.has(trackId)) continue; // adding twice is a no-op, not an error
      await ctx.db.insert("djPlaylistTracks", {
        playlistId,
        trackId,
        position,
        addedAt: Date.now(),
        addedBy: kerb,
      });
      position += 1;
      added += 1;
    }
    return { added, skipped: trackIds.length - added };
  },
});

export const removeTracksFromPlaylist = mutation({
  args: { playlistId: v.id("djPlaylists"), trackIds: v.array(v.id("djTracks")) },
  handler: async (ctx, { playlistId, trackIds }) => {
    await requirePutz(ctx);
    const wanted = new Set(trackIds);
    const rows = await ctx.db
      .query("djPlaylistTracks")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlistId))
      .collect();
    for (const r of rows) if (wanted.has(r.trackId)) await ctx.db.delete(r._id);
  },
});

// ---------------------------------------------------------------- uploading

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const addTrack = mutation({
  args: {
    storageId: v.id("_storage"),
    title: v.string(),
    artist: v.optional(v.string()),
    filename: v.string(),
    ext: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    durationSec: v.optional(v.number()),
    quality: QUALITY_VALIDATOR,
    bitrateKbps: v.optional(v.number()),
    /** Raw genre strings, straight off the file -- normalized here. */
    rawGenres: v.optional(v.array(v.string())),
    bpm: v.optional(v.number()),
    musicalKey: v.optional(v.string()),
    coverId: v.optional(v.id("_storage")),
    /** Cue points, when importing from a rekordbox export in the browser. */
    hotCues: v.optional(v.array(CUE_VALIDATOR)),
    memoryCues: v.optional(v.array(CUE_VALIDATOR)),
    cueSource: v.optional(CUE_SOURCE_VALIDATOR),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requirePutz(ctx);

    const ext = args.ext.toLowerCase().replace(/^\./, "");
    if (!ALLOWED_EXTS.includes(ext)) throw new Error("UNSUPPORTED_FORMAT");
    if (args.sizeBytes > MAX_AUDIO_BYTES) throw new Error("FILE_TOO_LARGE");
    if (args.sizeBytes <= 0) throw new Error("EMPTY_FILE");

    // A bpm arriving with a new upload came from browser detection, so mark
    // it as an estimate rather than something the file told us.
    const bpm = cleanBpm(args.bpm);
    // A rekordbox import carries real analysis; a plain upload's bpm came from
    // browser detection and should be shown as an estimate.
    const fromRekordbox = args.cueSource === "rekordbox-xml";
    const analysisSource =
      bpm !== undefined || args.musicalKey
        ? fromRekordbox
          ? ("tag" as const)
          : ("detected" as const)
        : undefined;
    const { rawGenres, ...rest } = args;

    return await ctx.db.insert("djTracks", {
      ...rest,
      title: args.title.trim() || args.filename,
      ext,
      bpm,
      musicalKey: normalizeKey(args.musicalKey),
      dj: kerbOf(user.email),
      djNameSnapshot: user.djName?.trim() || undefined,
      genres: normalizeGenres(rawGenres ?? []),
      analysisSource,
      uploadedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------- editing

/**
 * Anyone in PUTZ can retag. It's a small trusted group and the whole point is
 * that the library gets curated collectively.
 */
export const setGenres = mutation({
  args: {
    trackId: v.id("djTracks"),
    genres: v.array(v.string()),
  },
  handler: async (ctx, { trackId, genres }) => {
    await requirePutz(ctx);
    // Hand-typed tags get the gentle normalizer: aliases still fold together,
    // but nothing a person deliberately typed gets thrown away as junk.
    await ctx.db.patch(trackId, { genres: normalizeUserGenres(genres) });
  },
});

export const updateTrack = mutation({
  args: {
    trackId: v.id("djTracks"),
    title: v.optional(v.string()),
    artist: v.optional(v.string()),
    bpm: v.optional(v.number()),
    musicalKey: v.optional(v.string()),
  },
  handler: async (ctx, { trackId, ...fields }) => {
    await requirePutz(ctx);

    const patch: Record<string, unknown> = {};
    if (typeof fields.title === "string" && fields.title.trim()) patch.title = fields.title.trim();
    if (typeof fields.artist === "string") patch.artist = fields.artist.trim() || undefined;
    if (typeof fields.bpm === "number") {
      const bpm = cleanBpm(fields.bpm);
      if (bpm === undefined) throw new Error("BPM_OUT_OF_RANGE");
      patch.bpm = bpm;
      patch.analysisSource = "manual";
    }
    if (typeof fields.musicalKey === "string") {
      // Hand-entered keys get normalized the same way imported ones do, so
      // "Am" and "8A" don't end up as two different values.
      patch.musicalKey = fields.musicalKey.trim() ? normalizeKey(fields.musicalKey) : undefined;
      patch.analysisSource = "manual";
    }

    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(trackId, patch);
  },
});

/**
 * Attach cue points parsed from a rekordbox.xml export. Rekordbox keeps cues in
 * its own database rather than in the audio file, so an export is the only way
 * to get them. Parsing happens on the client (Convex has no DOMParser).
 */
export const attachCues = mutation({
  args: {
    cues: v.array(
      v.object({
        trackId: v.id("djTracks"),
        hotCues: v.array(CUE_VALIDATOR),
        memoryCues: v.array(CUE_VALIDATOR),
        bpm: v.optional(v.number()),
        musicalKey: v.optional(v.string()),
      }),
    ),
    source: CUE_SOURCE_VALIDATOR,
  },
  handler: async (ctx, { cues, source }) => {
    await requirePutz(ctx);

    let applied = 0;
    let keptExisting = 0;

    for (const entry of cues) {
      const track = await ctx.db.get(entry.trackId);
      if (!track) continue; // deleted between parsing and saving

      const patch: Record<string, unknown> = {};

      // If this track already has cues, leave them alone. Two DJs importing
      // overlapping libraries shouldn't clobber each other's cue points, and
      // silently keeping the first set is less surprising than overwriting.
      const hasCues = (track.hotCues?.length ?? 0) > 0 || (track.memoryCues?.length ?? 0) > 0;
      const bringsCues = entry.hotCues.length > 0 || entry.memoryCues.length > 0;

      if (bringsCues && hasCues) {
        keptExisting += 1;
      } else if (bringsCues) {
        patch.hotCues = entry.hotCues;
        patch.memoryCues = entry.memoryCues;
        patch.cueSource = source;
        applied += 1;
      }
      // The XML carries analysis data too; don't clobber existing values with
      // nothing if this export happens to lack them. Rekordbox's own analysis
      // is authoritative, so clear any "detected" marker on these values.
      const bpm = cleanBpm(entry.bpm);
      if (bpm !== undefined) {
        patch.bpm = bpm;
        patch.analysisSource = "tag";
      }
      const key = normalizeKey(entry.musicalKey);
      if (key) {
        patch.musicalKey = key;
        patch.analysisSource = "tag";
      }

      if (Object.keys(patch).length > 0) await ctx.db.patch(entry.trackId, patch);
    }

    return { applied, keptExisting, total: cues.length };
  },
});

/** Replace a track's cover art. The old image is deleted from storage. */
export const setCover = mutation({
  args: { trackId: v.id("djTracks"), storageId: v.id("_storage") },
  handler: async (ctx, { trackId, storageId }) => {
    await requirePutz(ctx);
    const track = await ctx.db.get(trackId);
    if (!track) throw new Error("TRACK_NOT_FOUND");

    // Check what was actually uploaded, not what the client claims.
    const meta = await ctx.db.system.get(storageId);
    if (!meta) throw new Error("COVER_NOT_FOUND");
    if (meta.size > MAX_COVER_BYTES) {
      await ctx.storage.delete(storageId).catch(() => {});
      throw new Error("COVER_TOO_LARGE");
    }
    if (meta.contentType && !meta.contentType.startsWith("image/")) {
      await ctx.storage.delete(storageId).catch(() => {});
      throw new Error("COVER_NOT_AN_IMAGE");
    }

    if (track.coverId) await ctx.storage.delete(track.coverId).catch(() => {});
    await ctx.db.patch(trackId, { coverId: storageId });
  },
});

/**
 * Record a detected or hand-entered BPM / key.
 *
 * Detection runs in the browser so it works for uploads as well as rips, and
 * the source is recorded so the UI can mark estimates as such.
 */
export const setAnalysis = mutation({
  args: {
    trackId: v.id("djTracks"),
    bpm: v.optional(v.number()),
    musicalKey: v.optional(v.string()),
    source: v.union(v.literal("tag"), v.literal("detected"), v.literal("manual")),
  },
  handler: async (ctx, { trackId, bpm, musicalKey, source }) => {
    await requirePutz(ctx);
    const patch: Record<string, unknown> = { analysisSource: source };
    const clean = cleanBpm(bpm);
    if (clean !== undefined) patch.bpm = clean;
    if (musicalKey?.trim()) patch.musicalKey = normalizeKey(musicalKey);
    await ctx.db.patch(trackId, patch);
  },
});

// ---------------------------------------------------------------- duplicates

/**
 * Tracks that look like the same recording arriving more than once.
 * Read-only: shows what a merge would do without doing it.
 */
export const findDuplicates = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);
    const tracks = await ctx.db.query("djTracks").collect();

    return groupDuplicates(
      tracks.map((t) => ({
        _id: t._id,
        title: t.title,
        durationSec: t.durationSec,
        quality: t.quality,
        uploadedAt: t.uploadedAt,
        dj: t.dj,
      })),
    ).map((g) => ({
      keep: { title: g.keep.title, quality: g.keep.quality, dj: g.keep.dj },
      drop: g.drop.map((d) => ({ title: d.title, quality: d.quality, dj: d.dj })),
    }));
  },
});

/**
 * Merge duplicate groups: keep the best copy, fold everything useful into it,
 * and delete the rest.
 *
 * Nothing is lost -- genres are unioned, and cues, analysis and cover art are
 * inherited where the winner lacks them. Duplicates are matched on identical
 * length, so cue positions remain valid across copies.
 *
 * Admin-only: it deletes tracks and their stored audio.
 */
export const mergeDuplicates = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const tracks = await ctx.db.query("djTracks").collect();
    const byId = new Map(tracks.map((t) => [t._id as string, t]));
    const groups = groupDuplicates(
      tracks.map((t) => ({
        _id: t._id,
        title: t.title,
        durationSec: t.durationSec,
        quality: t.quality,
        uploadedAt: t.uploadedAt,
      })),
    );

    let merged = 0;
    let removed = 0;

    for (const group of groups) {
      const keep = byId.get(group.keep._id);
      const losers = group.drop.map((d) => byId.get(d._id)).filter((t) => !!t);
      if (!keep || losers.length === 0) continue;

      const patch: Record<string, unknown> = {};
      const claimedCovers = new Set<string>();

      // Tags are additive: every copy's genres survive on the winner.
      const genres = new Set(keep.genres);
      for (const l of losers) for (const g of l.genres) genres.add(g);
      if (genres.size !== keep.genres.length) patch.genres = [...genres];

      // Cues transfer only when the winner has none. Identical length means
      // the positions still line up; prefer whichever copy has the most.
      if ((keep.hotCues?.length ?? 0) === 0 && (keep.memoryCues?.length ?? 0) === 0) {
        const best = losers
          .filter((l) => (l.hotCues?.length ?? 0) + (l.memoryCues?.length ?? 0) > 0)
          .sort(
            (a, b) =>
              (b.hotCues?.length ?? 0) +
              (b.memoryCues?.length ?? 0) -
              ((a.hotCues?.length ?? 0) + (a.memoryCues?.length ?? 0)),
          )[0];
        if (best) {
          patch.hotCues = best.hotCues;
          patch.memoryCues = best.memoryCues;
          patch.cueSource = best.cueSource;
        }
      }

      // Analysis and artwork fill gaps only; real analysis beats an estimate.
      if (keep.bpm === undefined) {
        const src =
          losers.find((l) => l.bpm !== undefined && l.analysisSource === "tag") ??
          losers.find((l) => l.bpm !== undefined);
        if (src) {
          patch.bpm = src.bpm;
          patch.analysisSource = src.analysisSource;
        }
      }
      if (!keep.musicalKey) {
        const src = losers.find((l) => l.musicalKey);
        if (src) patch.musicalKey = src.musicalKey;
      }
      if (!keep.coverId) {
        const src = losers.find((l) => l.coverId);
        if (src?.coverId) {
          patch.coverId = src.coverId;
          claimedCovers.add(src.coverId); // inherited, so don't delete it below
        }
      }

      if (Object.keys(patch).length > 0) await ctx.db.patch(keep._id, patch);

      for (const loser of losers) {
        // Re-point playlist membership at the winner, without duplicating it.
        const rows = await ctx.db
          .query("djPlaylistTracks")
          .withIndex("by_track", (q) => q.eq("trackId", loser._id))
          .collect();

        for (const row of rows) {
          const existing = await ctx.db
            .query("djPlaylistTracks")
            .withIndex("by_playlist_track", (q) =>
              q.eq("playlistId", row.playlistId).eq("trackId", keep._id),
            )
            .unique();
          if (existing) await ctx.db.delete(row._id);
          else await ctx.db.patch(row._id, { trackId: keep._id });
        }

        await ctx.storage.delete(loser.storageId).catch(() => {});
        if (loser.coverId && !claimedCovers.has(loser.coverId)) {
          await ctx.storage.delete(loser.coverId).catch(() => {});
        }
        await ctx.db.delete(loser._id);
        removed += 1;
      }
      merged += 1;
    }

    return { merged, removed };
  },
});

/**
 * Any member can delete. It destroys the stored file as well as the row, so
 * the UI confirms first -- the library is small and trusted enough that
 * curation is worth more than gatekeeping.
 */
export const deleteTrack = mutation({
  args: { trackId: v.id("djTracks") },
  handler: async (ctx, { trackId }) => {
    await requirePutz(ctx);
    const track = await ctx.db.get(trackId);
    if (!track) return;

    // Drop it from any playlists first, so none are left pointing at nothing.
    const memberships = await ctx.db
      .query("djPlaylistTracks")
      .withIndex("by_track", (q) => q.eq("trackId", trackId))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);

    await ctx.storage.delete(track.storageId);
    if (track.coverId) await ctx.storage.delete(track.coverId).catch(() => {});
    await ctx.db.delete(trackId);
  },
});

// ---------------------------------------------------------------- rip requests

export const requestRip = mutation({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const { user } = await requirePutz(ctx);

    const trimmed = url.trim();
    if (!trimmed.includes("soundcloud.com")) throw new Error("NOT_A_SOUNDCLOUD_URL");

    // Don't queue the same thing twice while it's still outstanding.
    const outstanding = await ctx.db
      .query("djRipRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const dupe = outstanding.find((r) => r.url === trimmed);
    if (dupe) return dupe._id;

    return await ctx.db.insert("djRipRequests", {
      url: trimmed,
      requestedBy: kerbOf(user.email),
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------- ripper helper
//
// Serverless can't run yt-dlp or ffmpeg, so a helper script on a DJ's own
// machine does the ripping. It talks to the HTTP routes in convex/http.ts,
// authenticated with DJ_RIPPER_SECRET, and drives these internal functions.

export const claimNextRipRequest = internalMutation({
  args: { claimedBy: v.string() },
  handler: async (ctx, { claimedBy }) => {
    const pending = await ctx.db
      .query("djRipRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .first();
    if (!pending) return null;

    await ctx.db.patch(pending._id, {
      status: "claimed",
      claimedBy,
      claimedAt: Date.now(),
      message: "ripping",
    });

    return { requestId: pending._id, url: pending.url, requestedBy: pending.requestedBy };
  },
});

export const finishRipRequest = internalMutation({
  args: {
    requestId: v.id("djRipRequests"),
    status: v.union(v.literal("done"), v.literal("failed")),
    message: v.optional(v.string()),
    trackCount: v.optional(v.number()),
  },
  handler: async (ctx, { requestId, status, message, trackCount }) => {
    await ctx.db.patch(requestId, { status, message, trackCount, finishedAt: Date.now() });
  },
});

/** Same as addTrack, but attributed to the requester rather than the ripper. */
export const insertRippedTrack = internalMutation({
  args: {
    dj: v.string(),
    storageId: v.id("_storage"),
    title: v.string(),
    artist: v.optional(v.string()),
    filename: v.string(),
    ext: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    durationSec: v.optional(v.number()),
    quality: QUALITY_VALIDATOR,
    bitrateKbps: v.optional(v.number()),
    rawGenres: v.optional(v.array(v.string())),
    coverId: v.optional(v.id("_storage")),
    bpm: v.optional(v.number()),
    musicalKey: v.optional(v.string()),
    /** Cue points, when ingesting from a rekordbox collection export. */
    hotCues: v.optional(v.array(CUE_VALIDATOR)),
    memoryCues: v.optional(v.array(CUE_VALIDATOR)),
    cueSource: v.optional(CUE_SOURCE_VALIDATOR),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { rawGenres, dj, ...rest } = args;
    const kerb = dj.toLowerCase();

    // Capture the requester's DJ name so the credit survives them leaving.
    const owner = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", `${kerb}@mit.edu`))
      .unique();

    return await ctx.db.insert("djTracks", {
      ...rest,
      bpm: cleanBpm(args.bpm),
      musicalKey: normalizeKey(args.musicalKey),
      dj: kerb,
      djNameSnapshot: owner?.djName?.trim() || undefined,
      genres: normalizeGenres(rawGenres ?? []),
      // bpm/key from a rekordbox export are real analysis, not an estimate.
      analysisSource: args.bpm !== undefined || args.musicalKey ? ("tag" as const) : undefined,
      uploadedAt: Date.now(),
    });
  },
});

/** Lets the ripper skip URLs already in the library. */
export const findTrackBySourceUrl = internalQuery({
  args: { sourceUrl: v.string() },
  handler: async (ctx, { sourceUrl }) => {
    const all = await ctx.db.query("djTracks").collect();
    return all.find((t) => t.sourceUrl === sourceUrl) ?? null;
  },
});

/**
 * Attach cover art to an existing track, matched by filename.
 *
 * Lets the seeder backfill artwork for tracks that were ingested before cover
 * extraction existed, without re-uploading the audio.
 */
export const setCoverByFilename = internalMutation({
  args: { filename: v.string(), coverId: v.id("_storage") },
  handler: async (ctx, { filename, coverId }) => {
    const all = await ctx.db.query("djTracks").collect();
    const track = all.find((t) => t.filename === filename);
    if (!track) return { matched: false };

    if (track.coverId) await ctx.storage.delete(track.coverId).catch(() => {});
    await ctx.db.patch(track._id, { coverId });
    return { matched: true };
  },
});

/** Filenames already in the library, so an import can skip them. */
export const listFilenames = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("djTracks").collect()).map((t) => t.filename),
});

/**
 * Build a playlist from the CLI, selecting tracks by genre and/or filename.
 *
 * This is what a rekordbox PLAYLISTS import hangs off: the importer knows
 * which files belong together, and needs to create the grouping server-side
 * because it has no Clerk session.
 */
export const createPlaylistFrom = internalMutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    createdBy: v.string(),
    genres: v.optional(v.array(v.string())),
    filenames: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { name, description, createdBy, genres, filenames }) => {
    const wantGenres = new Set((genres ?? []).map((g) => g.toLowerCase()));
    const wantFiles = new Set(filenames ?? []);

    const all = await ctx.db.query("djTracks").collect();
    const matched = all.filter(
      (t) =>
        wantFiles.has(t.filename) ||
        t.genres.some((g) => wantGenres.has(g.toLowerCase())),
    );

    const playlistId = await ctx.db.insert("djPlaylists", {
      name: name.trim().slice(0, 60),
      description: description?.trim().slice(0, 140) || undefined,
      createdBy: createdBy.toLowerCase(),
      createdAt: Date.now(),
    });

    let position = 0;
    for (const t of matched) {
      await ctx.db.insert("djPlaylistTracks", {
        playlistId,
        trackId: t._id,
        position,
        addedAt: Date.now(),
        addedBy: createdBy.toLowerCase(),
      });
      position += 1;
    }

    return { playlistId, added: matched.length };
  },
});

export const generateRipperUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});
