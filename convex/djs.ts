import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
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

/** The only colour format accepted anywhere, so none of it can reach CSS raw. */
const HEX = /^#[0-9a-f]{6}$/i;

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

    // Tracks store the kerb; the display name lives on the DJ's profile and is
    // resolved here, so renaming yourself renames your whole back catalogue.
    // Profiles are keyed by kerb and survive the account being removed, so a
    // graduate's tracks keep their name and colour.
    const profiles = await ctx.db.query("djProfiles").collect();
    const names = new Map<string, string>();
    const colors = new Map<string, string>();
    const customTags = new Map<string, { bg: string; fg: string; glow: boolean }>();
    for (const p of profiles) {
      if (p.djName?.trim()) names.set(p.kerb, p.djName.trim());
      if (p.djColor) colors.set(p.kerb, p.djColor);
      // Both halves or neither: a bubble colour with no letter colour set
      // can end up unreadable.
      if (p.tagBg && p.tagFg)
        customTags.set(p.kerb, { bg: p.tagBg, fg: p.tagFg, glow: !!p.tagGlow });
    }

    // The profile name, then the name captured at upload (for anyone who
    // uploaded before profiles existed), then the bare kerb.
    return await Promise.all(
      tracks.map(async (t) => ({
        ...t,
        djDisplay: names.get(t.dj) ?? t.djNameSnapshot ?? t.dj,
        djColor: colors.get(t.dj) ?? null,
        djTag: customTags.get(t.dj) ?? null,
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
/** A kerb's profile row, or null if they've never set anything. */
const profileFor = async (ctx: QueryCtx, kerb: string) =>
  await ctx.db
    .query("djProfiles")
    .withIndex("by_kerb", (q) => q.eq("kerb", kerb))
    .unique();

export const myDjSettings = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requirePutz(ctx);
    const kerb = kerbOf(user.email);
    const profile = await profileFor(ctx, kerb);
    return {
      kerb,
      djName: profile?.djName ?? "",
      djColor: profile?.djColor ?? "",
      djBio: profile?.djBio ?? "",
      tagBg: profile?.tagBg ?? "",
      tagFg: profile?.tagFg ?? "",
      tagGlow: !!profile?.tagGlow,
      avatarUrl: profile?.avatarId ? await ctx.storage.getUrl(profile.avatarId) : null,
    };
  },
});

/** The bio length a tag's profile card can show without becoming an essay. */
const MAX_BIO = 280;

/**
 * Every DJ profile, keyed by kerb. Separate from listTracks so a few hundred
 * track rows don't each carry a copy of someone's bio, and read from
 * djProfiles rather than users so people who have graduated still have one.
 */
export const listDjProfiles = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);
    const profiles = await ctx.db.query("djProfiles").collect();
    return await Promise.all(
      profiles.map(async (p) => ({
        kerb: p.kerb,
        djName: p.djName?.trim() || null,
        djColor: p.djColor ?? null,
        djTag:
          p.tagBg && p.tagFg ? { bg: p.tagBg, fg: p.tagFg, glow: !!p.tagGlow } : null,
        djBio: p.djBio?.trim() || null,
        avatarUrl: p.avatarId ? await ctx.storage.getUrl(p.avatarId) : null,
      })),
    );
  },
});

/**
 * Set your own display name and tag colour. A blank name falls back to your
 * kerb; a blank colour falls back to the site accent.
 */
export const setMyDjSettings = mutation({
  args: {
    djName: v.string(),
    djColor: v.string(),
    djBio: v.optional(v.string()),
    /** Hex pair for a hand-picked tag. Empty strings go back to the accent. */
    tagBg: v.optional(v.string()),
    tagFg: v.optional(v.string()),
    tagGlow: v.optional(v.boolean()),
  },
  handler: async (ctx, { djName, djColor, djBio, tagBg, tagFg, tagGlow }) => {
    const { user } = await requirePutz(ctx);
    const kerb = kerbOf(user.email);
    const existing = await profileFor(ctx, kerb);

    const trimmedName = djName.trim().slice(0, 40);
    // Left out means "leave it alone", so saving the name doesn't wipe a bio.
    const trimmedBio = (djBio ?? existing?.djBio ?? "").trim().slice(0, MAX_BIO);
    // Only accept colours we actually offer, so nothing can inject a value
    // that Radix won't render.
    const color = (DJ_COLORS as readonly string[]).includes(djColor) ? djColor : undefined;

    // Left out keeps what's stored; an empty string clears it. Only real hex
    // is accepted, so nothing can inject a value into a style attribute.
    const hexOr = (next: string | undefined, current: string | undefined) => {
      if (next === undefined) return current;
      if (next === "") return undefined;
      return HEX.test(next) ? next : current;
    };
    const bg = hexOr(tagBg, existing?.tagBg);
    const fg = hexOr(tagFg, existing?.tagFg);

    const fields = {
      djName: trimmedName.length > 0 ? trimmedName : undefined,
      djColor: color,
      djBio: trimmedBio.length > 0 ? trimmedBio : undefined,
      // Only a complete pair is stored, so a tag is never half-styled.
      tagBg: bg && fg ? bg : undefined,
      tagFg: bg && fg ? fg : undefined,
      tagGlow: bg && fg && (tagGlow ?? existing?.tagGlow) ? true : undefined,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("djProfiles", { kerb, ...fields });

    return { djName: trimmedName, djColor: color ?? "", djBio: trimmedBio };
  },
});

/** Set your own profile picture. Same checks as a track's cover art. */
export const setMyDjAvatar = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const { user } = await requirePutz(ctx);
    const kerb = kerbOf(user.email);
    const existing = await profileFor(ctx, kerb);

    // Check what landed in storage, not what the client said it was sending.
    const meta = await ctx.db.system.get(storageId);
    if (!meta) throw new Error("IMAGE_NOT_FOUND");
    if (meta.size > MAX_COVER_BYTES) {
      await ctx.storage.delete(storageId).catch(() => {});
      throw new Error("IMAGE_TOO_LARGE");
    }
    if (meta.contentType && !meta.contentType.startsWith("image/")) {
      await ctx.storage.delete(storageId).catch(() => {});
      throw new Error("NOT_AN_IMAGE");
    }

    if (existing?.avatarId) await ctx.storage.delete(existing.avatarId).catch(() => {});
    if (existing) await ctx.db.patch(existing._id, { avatarId: storageId, updatedAt: Date.now() });
    else await ctx.db.insert("djProfiles", { kerb, avatarId: storageId, updatedAt: Date.now() });
  },
});

/** Drop your profile picture, going back to the initial. */
export const clearMyDjAvatar = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requirePutz(ctx);
    const existing = await profileFor(ctx, kerbOf(user.email));
    if (!existing) return;
    if (existing.avatarId) await ctx.storage.delete(existing.avatarId).catch(() => {});
    await ctx.db.patch(existing._id, { avatarId: undefined, updatedAt: Date.now() });
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
    const { user } = await requirePutz(ctx);
    const kerb = kerbOf(user.email);
    const recent = await ctx.db
      .query("djRipRequests")
      .withIndex("by_createdAt")
      .order("desc")
      .take(50);

    // Number the ones still waiting, oldest first: that's the order the
    // ripper will take them in, so it's the order people should see.
    const queue = recent
      .filter((r) => r.status === "pending" || r.status === "claimed")
      .sort((a, b) => a.createdAt - b.createdAt);
    const place = new Map(queue.map((r, i) => [r._id, i + 1]));

    // Where each one's tracks are going, so the queue can say.
    const playlistNames = new Map<string, string>();
    for (const r of recent) {
      if (r.playlistId && !playlistNames.has(r.playlistId)) {
        const p = await ctx.db.get(r.playlistId);
        if (p) playlistNames.set(r.playlistId, p.name);
      }
    }

    return recent.map((r) => ({
      ...r,
      playlistName: (r.playlistId && playlistNames.get(r.playlistId)) || r.newPlaylistName || null,
      place: place.get(r._id) ?? null,
      // Whoever queued it can stop it; admins can stop anything stuck.
      canCancel: r.requestedBy === kerb || !!user.isAdmin,
    }));
  },
});

/** How long a finished rip stays on its requester's downloads list. */
const RIP_DOWNLOAD_DAYS = 7;

/**
 * The viewer's own finished rips from the last week, newest first, for the
 * download list. Separate from listRipRequests so a busy week of other
 * people's rips can't push yours out of view.
 */
export const myRecentRips = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requirePutz(ctx);
    const kerb = kerbOf(user.email);
    const since = Date.now() - RIP_DOWNLOAD_DAYS * 24 * 3600 * 1000;

    // A rip finishes after it's created, so anything finished this week was
    // created at most a day or so before the window opened.
    const recent = await ctx.db
      .query("djRipRequests")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", since - 24 * 3600 * 1000))
      .order("desc")
      .collect();

    const mine = recent.filter(
      (r) =>
        r.requestedBy === kerb &&
        !r.dismissedAt &&
        (r.finishedAt ?? 0) >= since &&
        (r.trackIds?.length ?? 0) > 0,
    );
    return await Promise.all(
      mine.map(async (r) => ({
        ...r,
        playlistName: (r.playlistId && (await ctx.db.get(r.playlistId))?.name) || r.newPlaylistName || null,
      })),
    );
  },
});

/** Clear a finished rip from your downloads list. The tracks stay in the library. */
export const dismissRip = mutation({
  args: { requestId: v.id("djRipRequests") },
  handler: async (ctx, { requestId }) => {
    const { user } = await requirePutz(ctx);
    const request = await ctx.db.get(requestId);
    if (!request || request.requestedBy !== kerbOf(user.email)) throw new Error("NOT_YOUR_RIP");
    await ctx.db.patch(requestId, { dismissedAt: Date.now() });
  },
});

// ---------------------------------------------------------------- playlists

/** Playlists with their track counts, oldest first. */
export const listPlaylists = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);
    const playlists = await ctx.db.query("djPlaylists").withIndex("by_createdAt").collect();
    playlists.sort((a, b) => playlistOrder(a) - playlistOrder(b));
    const members = await ctx.db.query("djPlaylistTracks").collect();

    // Names and colours come from DJ profiles, same as track credits, so a
    // rename or recolour follows everywhere.
    const profiles = await ctx.db.query("djProfiles").collect();
    const names = new Map<string, string>();
    const colors = new Map<string, string>();
    const customTags = new Map<string, { bg: string; fg: string; glow: boolean }>();
    for (const p of profiles) {
      if (p.djName?.trim()) names.set(p.kerb, p.djName.trim());
      if (p.djColor) colors.set(p.kerb, p.djColor);
      if (p.tagBg && p.tagFg)
        customTags.set(p.kerb, { bg: p.tagBg, fg: p.tagFg, glow: !!p.tagGlow });
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
      createdByTag: customTags.get(p.createdBy) ?? null,
      /** Everyone who has added to it, minus its creator, with their styling. */
      contributors: [...(contributors.get(p._id) ?? [])]
        .filter((kerb) => kerb !== p.createdBy)
        .sort()
        .map((kerb) => ({
          kerb,
          name: names.get(kerb) ?? kerb,
          color: colors.get(kerb) ?? null,
          tag: customTags.get(kerb) ?? null,
        })),
    }));
  },
});

/**
 * Where a playlist sits in the sidebar. A reorder numbers every playlist from
 * 0, so anything moved sorts ahead of creation timestamps -- which leaves a
 * playlist made after the last reorder at the bottom, where you'd expect it.
 */
const playlistOrder = (p: Doc<"djPlaylists">): number => p.position ?? p.createdAt;

/**
 * Save a new sidebar order. The client sends every playlist it can see, in
 * order; any it didn't know about (made by someone else mid-drag) keep their
 * place after them.
 */
export const reorderPlaylists = mutation({
  args: { playlistIds: v.array(v.id("djPlaylists")) },
  handler: async (ctx, { playlistIds }) => {
    await requirePutz(ctx);
    const all = await ctx.db.query("djPlaylists").withIndex("by_createdAt").collect();
    all.sort((a, b) => playlistOrder(a) - playlistOrder(b));

    const known = new Set(all.map((p) => p._id));
    const ordered = [...new Set(playlistIds)].filter((id) => known.has(id));
    const placed = new Set(ordered);
    for (const p of all) if (!placed.has(p._id)) ordered.push(p._id);

    for (const [i, id] of ordered.entries()) {
      const p = all.find((x) => x._id === id);
      if (p && p.position !== i) await ctx.db.patch(id, { position: i });
    }
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

/** Append tracks to the end of a playlist, skipping any already on it. */
const appendToPlaylist = async (
  ctx: MutationCtx,
  playlistId: Id<"djPlaylists">,
  trackIds: Id<"djTracks">[],
  kerb: string,
) => {
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
};

export const addTracksToPlaylist = mutation({
  args: { playlistId: v.id("djPlaylists"), trackIds: v.array(v.id("djTracks")) },
  handler: async (ctx, { playlistId, trackIds }) => {
    const { user } = await requirePutz(ctx);
    return await appendToPlaylist(ctx, playlistId, trackIds, kerbOf(user.email));
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

// ---------------------------------------------------------------- tag styling

export const listTagStyles = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);
    return await ctx.db.query("djTagStyles").collect();
  },
});

/** Give a tag its own colours, or clear them by passing nothing. */
export const setTagStyle = mutation({
  args: {
    tag: v.string(),
    bg: v.optional(v.string()),
    fg: v.optional(v.string()),
    glow: v.optional(v.boolean()),
  },
  handler: async (ctx, { tag, bg, fg, glow }) => {
    await requirePutz(ctx);

    // Only accept real hex, so nothing can inject a value into a style attr.
    const cleanBg = bg && HEX.test(bg) ? bg : undefined;
    const cleanFg = fg && HEX.test(fg) ? fg : undefined;

    const existing = await ctx.db
      .query("djTagStyles")
      .withIndex("by_tag", (q) => q.eq("tag", tag))
      .unique();

    // Nothing set means nothing to store: drop the row rather than keep a
    // blank one around.
    if (!cleanBg && !cleanFg && !glow) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }

    const doc = { tag, bg: cleanBg, fg: cleanFg, glow: glow || undefined };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("djTagStyles", doc);
  },
});

/**
 * Rename a tag everywhere it appears.
 *
 * This rewrites the genre on each track rather than keeping an alias, so the
 * library has one name for one thing. Renaming onto an existing tag merges
 * the two.
 */
export const renameTag = mutation({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    await requirePutz(ctx);

    const [renamed] = normalizeUserGenres([to]);
    if (!renamed || renamed === from) return { changed: 0 };

    const tracks = await ctx.db.query("djTracks").collect();
    let changed = 0;

    for (const t of tracks) {
      if (!t.genres.includes(from)) continue;
      // Set keeps the merge case clean when the target already exists.
      const next = [...new Set(t.genres.map((g) => (g === from ? renamed : g)))];
      await ctx.db.patch(t._id, { genres: next });
      changed += 1;
    }

    // Carry any styling across to the new name.
    const style = await ctx.db
      .query("djTagStyles")
      .withIndex("by_tag", (q) => q.eq("tag", from))
      .unique();
    if (style) {
      const target = await ctx.db
        .query("djTagStyles")
        .withIndex("by_tag", (q) => q.eq("tag", renamed))
        .unique();
      if (target) await ctx.db.delete(style._id);
      else await ctx.db.patch(style._id, { tag: renamed });
    }

    return { changed, renamed };
  },
});

/**
 * Re-run the tag normalizer over the whole library, so tags stored before an
 * alias was added fold onto it ("Hip-hop & Rap" onto "Hip Hop"). Uses the
 * gentle normalizer: tags someone typed by hand are left as they are.
 *
 *   npx convex run djs:renormalizeGenres
 */
export const renormalizeGenres = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tracks = await ctx.db.query("djTracks").collect();
    let changed = 0;
    for (const t of tracks) {
      const next = normalizeUserGenres(t.genres);
      if (next.join("\u0000") === t.genres.join("\u0000")) continue;
      await ctx.db.patch(t._id, { genres: next });
      changed += 1;
    }
    return { changed };
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

      // Credit goes to whoever brought the track to the library first, even
      // when a better-sounding copy arrives later and wins the merge. The
      // higher-quality file survives; the earliest uploader keeps the credit.
      const first = [keep, ...losers].reduce((a, b) => (b.uploadedAt < a.uploadedAt ? b : a));
      if (first.dj !== keep.dj) {
        patch.dj = first.dj;
        patch.djNameSnapshot = first.djNameSnapshot;
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
  args: {
    url: v.string(),
    /** File the tracks into this playlist as they land... */
    playlistId: v.optional(v.id("djPlaylists")),
    /** ...or into a new one by this name, made when the first track lands. */
    newPlaylistName: v.optional(v.string()),
    newPlaylistDescription: v.optional(v.string()),
  },
  handler: async (ctx, { url, playlistId, newPlaylistName, newPlaylistDescription }) => {
    const { user } = await requirePutz(ctx);

    const trimmed = url.trim();
    if (!trimmed.includes("soundcloud.com")) throw new Error("NOT_A_SOUNDCLOUD_URL");
    if (playlistId && !(await ctx.db.get(playlistId))) throw new Error("PLAYLIST_NOT_FOUND");
    const newName = newPlaylistName?.trim().slice(0, 60) || undefined;

    // Don't queue the same thing twice while it's still outstanding.
    const outstanding = await ctx.db
      .query("djRipRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const dupe = outstanding.find((r) => r.url === trimmed);
    if (dupe) return dupe._id;

    const requestId = await ctx.db.insert("djRipRequests", {
      url: trimmed,
      requestedBy: kerbOf(user.email),
      status: "pending",
      createdAt: Date.now(),
      playlistId,
      newPlaylistName: playlistId ? undefined : newName,
      newPlaylistDescription:
        playlistId || !newName ? undefined : newPlaylistDescription?.trim().slice(0, 140) || undefined,
    });

    // Scheduled rather than awaited: a mail outage must not fail the request.
    await ctx.scheduler.runAfter(0, internal.email.sendRipQueued, {
      to: user.email,
      url: trimmed,
      // Everything already waiting, which is what it has to get through
      // before this one starts.
      ahead: outstanding.length,
    });

    return requestId;
  },
});

/**
 * Stop a rip. A pending one is simply never claimed; a running one is stopped
 * by the ripper between tracks, the next time it checks in. Tracks it already
 * uploaded stay in the library.
 */
export const cancelRipRequest = mutation({
  args: { requestId: v.id("djRipRequests") },
  handler: async (ctx, { requestId }) => {
    const { user } = await requirePutz(ctx);
    const request = await ctx.db.get(requestId);
    if (!request) throw new Error("RIP_NOT_FOUND");
    if (request.requestedBy !== kerbOf(user.email) && !user.isAdmin) {
      throw new Error("NOT_YOUR_RIP");
    }
    if (request.status !== "pending" && request.status !== "claimed") return;

    await ctx.db.patch(requestId, {
      status: "cancelled",
      message: `cancelled by ${kerbOf(user.email)}`,
      finishedAt: Date.now(),
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

/**
 * A progress note on a request that's still running, so a long rip isn't a
 * silent "claimed" for half an hour. Only touches the message: the status and
 * the finish time belong to finishRipRequest.
 */
export const noteRipProgress = internalMutation({
  args: {
    requestId: v.id("djRipRequests"),
    message: v.string(),
    done: v.optional(v.number()),
    tried: v.optional(v.number()),
    total: v.optional(v.number()),
  },
  handler: async (ctx, { requestId, message, done, tried, total }) => {
    const request = await ctx.db.get(requestId);
    // The answer doubles as the ripper's cue to stop.
    if (request?.status === "cancelled") return { cancelled: true };
    // Ignore a note that arrives after the request was finished.
    if (!request || request.status !== "claimed") return { cancelled: false };
    await ctx.db.patch(requestId, {
      message: message.slice(0, 200),
      tracksDone: done,
      tracksTried: tried,
      tracksTotal: total,
    });
    return { cancelled: false };
  },
});

export const finishRipRequest = internalMutation({
  args: {
    requestId: v.id("djRipRequests"),
    status: v.union(v.literal("done"), v.literal("failed")),
    message: v.optional(v.string()),
    trackCount: v.optional(v.number()),
    rateLimited: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { requestId, status, message, trackCount, rateLimited }) => {
    // Cancelled mid-rip: keep it cancelled, record what got done before the
    // ripper stopped, and don't email -- they know, they cancelled it.
    const current = await ctx.db.get(requestId);
    if (current?.status === "cancelled") {
      await ctx.db.patch(requestId, { message, trackCount });
      return;
    }

    await ctx.db.patch(requestId, {
      status,
      message,
      trackCount,
      rateLimited: rateLimited?.length ? rateLimited : undefined,
      finishedAt: Date.now(),
    });

    // Tell whoever asked for it. The kerb is the local part of their address.
    const request = await ctx.db.get(requestId);
    if (!request) return;

    // Match on the kerb rather than rebuilding an @mit.edu address: people
    // sign in with whatever Clerk has for them, and anyone on another domain
    // would silently never get this one.
    const users = await ctx.db.query("users").collect();
    const owner = users.find((u) => kerbOf(u.email) === request.requestedBy);
    if (!owner) return;

    await ctx.scheduler.runAfter(0, internal.email.sendRipReady, {
      to: owner.email,
      url: request.url,
      trackCount,
      message,
      rateLimited,
    });
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

/**
 * Record a track the ripper just registered against its request, and file it
 * into the playlist the request asked for, if any. Called for tracks that were
 * already in the library too, so re-ripping a set still fills the playlist and
 * still downloads as a whole.
 *
 * The ripper doesn't say which request a track belongs to, but it works one
 * request at a time and credits each track to whoever asked, so the request is
 * the one currently being ripped for that person. Keeping the matching here
 * means the ripper machine never needs updating for this.
 */
export const fileRippedTrack = internalMutation({
  args: { dj: v.string(), trackId: v.id("djTracks") },
  handler: async (ctx, { dj, trackId }) => {
    const kerb = dj.toLowerCase();
    const claimed = await ctx.db
      .query("djRipRequests")
      .withIndex("by_status", (q) => q.eq("status", "claimed"))
      .collect();
    const request = claimed
      .filter((r) => r.requestedBy === kerb)
      .sort((a, b) => (b.claimedAt ?? 0) - (a.claimedAt ?? 0))[0];
    if (!request) return;

    const trackIds = request.trackIds ?? [];
    if (!trackIds.includes(trackId)) {
      await ctx.db.patch(request._id, { trackIds: [...trackIds, trackId] });
    }
    if (!request.playlistId && !request.newPlaylistName) return;

    let playlistId = request.playlistId;
    if (!playlistId || !(await ctx.db.get(playlistId))) {
      // Asked for a new one, or the chosen one was deleted mid-rip.
      if (!request.newPlaylistName) return;
      playlistId = await ctx.db.insert("djPlaylists", {
        name: request.newPlaylistName,
        description: request.newPlaylistDescription,
        createdBy: kerb,
        createdAt: Date.now(),
      });
      await ctx.db.patch(request._id, { playlistId });
    }
    await appendToPlaylist(ctx, playlistId, [trackId], kerb);
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
