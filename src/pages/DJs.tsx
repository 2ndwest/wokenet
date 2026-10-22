import {
  AlertDialog,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Select,
  Separator,
  Slider,
  Text,
  TextField,
} from "@radix-ui/themes";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { Quality } from "../../convex/schema";
import { DJ_COLORS } from "../../convex/djs";
import {
  BPM_BUCKETS,
  QUALITY_LABEL,
  QUALITY_ORDER,
  bucketForBpm,
  detectBpm,
  extOf,
  formatDuration,
  formatSize,
  inferQuality,
  readDuration,
  rejectReason,
} from "../utils/audio";
import { buildRekordboxXml, matchKey, parseRekordboxXml } from "../utils/rekordbox";
import { formatTimestamp, getRelativeTime } from "../utils/time";
import { buildZip, saveBlob, type ZipEntry } from "../utils/zip";
import { useAuthStatus } from "../utils/useAuthStatus";

/** listTracks resolves the DJ display name and cover URL on the way out. */
type Track = Doc<"djTracks"> & {
  djDisplay: string;
  djColor: string | null;
  coverUrl: string | null;
};

/** A DJ colour from the server, narrowed to what Radix will accept. */
type BadgeColor = React.ComponentProps<typeof Badge>["color"];
const asBadgeColor = (c: string | null | undefined): BadgeColor =>
  (c || undefined) as BadgeColor;

/** Square cover art, or a prompt to add one. */
const Cover = memo(
  ({ url, size, onClick }: { url: string | null; size: number; onClick?: () => void }) => {
    const common = {
      width: size,
      height: size,
      borderRadius: "var(--radius-2)",
      flex: `0 0 ${size}px`,
      cursor: onClick ? "pointer" : undefined,
    } as const;

    if (url) {
      return (
        <img
          src={url}
          alt=""
          onClick={onClick}
          style={{ ...common, objectFit: "cover", border: "1px solid var(--gray-4)" }}
        />
      );
    }

    // The full prompt only fits at dialog size; a row thumbnail gets a mark.
    const roomy = size >= 72;

    return (
      <Flex
        align="center"
        justify="center"
        onClick={onClick}
        style={{
          ...common,
          border: "1px dashed var(--gray-6)",
          backgroundColor: "var(--gray-2)",
          padding: roomy ? 6 : 2,
          overflow: "hidden",
        }}
      >
        <Text
          align="center"
          color="gray"
          style={{
            fontSize: roomy ? 10 : 15,
            lineHeight: roomy ? 1.3 : 1,
            opacity: 0.6,
          }}
        >
          {roomy ? (
            <>
              no cover
              <br />
              image.
              <br />
              add one?
            </>
          ) : (
            "+"
          )}
        </Text>
      </Flex>
    );
  },
);

const PlayIcon = ({ playing }: { playing: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    {playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path d="M4 2.5v11l9-5.5z" />}
  </svg>
);

/**
 * Track badges. Slightly smaller than a default Badge so a row of genres plus
 * quality, bpm and key stays readable without wrapping. A trailing "?" marks a
 * detected (rather than tagged) value.
 */
const Tag = memo(
  ({
    color,
    variant,
    children,
  }: {
    /** Omit to follow the theme accent rather than pinning a colour. */
    color?: React.ComponentProps<typeof Badge>["color"];
    variant: React.ComponentProps<typeof Badge>["variant"];
    children: React.ReactNode;
  }) => (
    <Badge color={color} variant={variant} style={{ fontSize: "12px", padding: "3px 9px" }}>
      {children}
    </Badge>
  ),
);

const SkipIcon = ({ direction }: { direction: "back" | "forward" }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="currentColor"
    style={direction === "back" ? { transform: "scaleX(-1)" } : undefined}
  >
    <path d="M3 3l7 5-7 5V3zM11 3h2v10h-2z" />
  </svg>
);

const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M11.5 1.5l3 3-8 8H3.5v-3l8-8zM2 14h12v1.5H2V14z" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M7 1h2v7l3-3 1.4 1.4L8 12 2.6 6.4 4 5l3 3z" />
    <path d="M2 13h12v2H2z" />
  </svg>
);

/** Clickable pill used for every filter facet, so they all read the same. */
const FilterChip = memo(
  ({
    active,
    onClick,
    color,
    count,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    /** Overrides the default tint, so a DJ's chip matches their tag. */
    color?: BadgeColor;
    /** Rendered lighter after the label, so the name reads first. */
    count?: number;
    children: React.ReactNode;
  }) => (
    <Button
      size="1"
      radius="full"
      variant={active ? "solid" : "surface"}
      // Unset follows the theme accent; a DJ colour wins when there is one.
      color={color ?? (active ? undefined : "gray")}
      onClick={onClick}
      style={{ height: "24px" }}
    >
      <Text weight="bold">{children}</Text>
      {count !== undefined && (
        <Text weight="regular" style={{ opacity: 0.7 }}>
          ({count})
        </Text>
      )}
    </Button>
  ),
);

/** Drag payload: the track ids being dropped onto a playlist. */
const DRAG_TRACKS = "application/x-wokenet-tracks";

/** How many genre chips fit on one line before we collapse the rest. */
const COLLAPSED_GENRE_COUNT = 8;

type SortMode = "alphabetical" | "added" | "bpm" | "key" | "dj" | "genre";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortMode, string> = {
  alphabetical: "Alphabetical",
  added: "Date added",
  bpm: "BPM",
  key: "Key",
  dj: "DJ",
  genre: "Genre",
};

/** What each direction means per mode, so the label isn't just asc/desc. */
const DIRECTION_LABELS: Record<SortMode, { asc: string; desc: string }> = {
  alphabetical: { asc: "A–Z", desc: "Z–A" },
  added: { asc: "Oldest", desc: "Newest" },
  bpm: { asc: "Slowest", desc: "Fastest" },
  key: { asc: "1A–12B", desc: "12B–1A" },
  dj: { asc: "A–Z", desc: "Z–A" },
  genre: { asc: "A–Z", desc: "Z–A" },
};

/** Newest-first is the useful default for dates; everything else reads up. */
const DEFAULT_DIRECTION: Record<SortMode, SortDir> = {
  alphabetical: "asc",
  added: "desc",
  bpm: "asc",
  key: "asc",
  dj: "asc",
  genre: "asc",
};

/**
 * Sort key for a title: ignore anything before the first letter, so "&NUFF"
 * files under N and "365 PARTYDOG" under P rather than clustering all the
 * punctuation and numbers at the top. Accents fold, so "Azótame" sits with the
 * As. Titles with no letters at all sort after Z.
 */
export function alphaKey(title: string): string {
  const folded = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const first = folded.search(/[a-z]/);
  // ￿ sorts above any letter, parking letterless titles at the end.
  return first === -1 ? `￿${folded}` : folded.slice(first);
}

/**
 * Order a Camelot key around the wheel: 1A, 1B, 2A, 2B … so harmonically
 * neighbouring keys end up next to each other, which is the point of sorting
 * by key at all. Anything unparsed sorts last.
 */
export function camelotOrder(key: string | undefined): number {
  const m = /^(\d{1,2})([ab])$/i.exec((key ?? "").trim());
  if (!m) return Infinity;
  return Number(m[1]) * 2 + (m[2].toLowerCase() === "b" ? 1 : 0);
}

/**
 * Order the visible tracks. Every mode falls back to title, so the list is
 * stable rather than shuffling around within equal values, and anything
 * missing the sort field sinks to the bottom instead of leading the list.
 */
function sortTracks(tracks: Track[], mode: SortMode, dir: SortDir): Track[] {
  const byTitle = (a: Track, b: Track) => alphaKey(a.title).localeCompare(alphaKey(b.title));

  /** True when a track has nothing to sort on in this mode. */
  const missing = (t: Track): boolean => {
    if (mode === "bpm") return t.bpm === undefined;
    if (mode === "key") return camelotOrder(t.musicalKey) === Infinity;
    if (mode === "genre") return t.genres.length === 0;
    return false; // every track has a title, a DJ and an upload time
  };

  /** Ascending comparator for tracks that do have a value. */
  const compare = (a: Track, b: Track): number => {
    switch (mode) {
      case "added":
        return a.uploadedAt - b.uploadedAt || byTitle(a, b);
      case "bpm":
        return (a.bpm ?? 0) - (b.bpm ?? 0) || byTitle(a, b);
      case "key":
        return camelotOrder(a.musicalKey) - camelotOrder(b.musicalKey) || byTitle(a, b);
      case "dj":
        return a.djDisplay.localeCompare(b.djDisplay) || byTitle(a, b);
      case "genre":
        return a.genres[0].localeCompare(b.genres[0]) || byTitle(a, b);
      default:
        return byTitle(a, b);
    }
  };

  // Tracks with nothing to sort on stay at the bottom in both directions --
  // reversing the whole list would otherwise lead with the untagged ones.
  const present = tracks.filter((t) => !missing(t)).sort(compare);
  if (dir === "desc") present.reverse();
  const absent = tracks.filter(missing).sort(byTitle);

  return [...present, ...absent];
}

const toggleIn = <T,>(set: Set<T>, value: T): Set<T> => {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
};

const removeFrom = <T,>(set: Set<T>, value: T): Set<T> => {
  const next = new Set(set);
  next.delete(value);
  return next;
};

/** An active filter, shown next to the search box with an × to drop it. */
const ActiveFilterBubble = memo(
  ({ label, onRemove }: { label: string; onRemove: () => void }) => (
    <Badge variant="solid" radius="full" style={{ paddingRight: 2 }}>
      <Flex align="center" gap="1">
        {label}
        <IconButton
          size="1"
          radius="full"
          variant="ghost"
          aria-label={`Remove filter ${label}`}
          onClick={onRemove}
          style={{ width: 14, height: 14, margin: 0, cursor: "pointer" }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M1 1l6 6M7 1L1 7" />
          </svg>
        </IconButton>
      </Flex>
    </Badge>
  ),
);

export const DJs = memo(() => {
  const convex = useConvex();
  const { user } = useAuthStatus();

  const tracks = useQuery(api.djs.listTracks);
  const ripRequests = useQuery(api.djs.listRipRequests);
  const playlists = useQuery(api.djs.listPlaylists);

  /** null = the whole library; otherwise the playlist being viewed. */
  const [activePlaylistId, setActivePlaylistId] = useState<Id<"djPlaylists"> | null>(null);
  const playlistTrackIds = useQuery(
    api.djs.listPlaylistTrackIds,
    activePlaylistId ? { playlistId: activePlaylistId } : "skip",
  );

  const createPlaylist = useMutation(api.djs.createPlaylist);
  const addTracksToPlaylist = useMutation(api.djs.addTracksToPlaylist);
  const removeTracksFromPlaylist = useMutation(api.djs.removeTracksFromPlaylist);
  const deletePlaylist = useMutation(api.djs.deletePlaylist);
  const updatePlaylist = useMutation(api.djs.updatePlaylist);

  const activePlaylist = (playlists ?? []).find((p) => p._id === activePlaylistId) ?? null;

  const generateUploadUrl = useMutation(api.djs.generateUploadUrl);
  const addTrack = useMutation(api.djs.addTrack);
  const setGenres = useMutation(api.djs.setGenres);
  const updateTrack = useMutation(api.djs.updateTrack);
  const deleteTrack = useMutation(api.djs.deleteTrack);
  const requestRip = useMutation(api.djs.requestRip);
  const attachCues = useMutation(api.djs.attachCues);
  const setCover = useMutation(api.djs.setCover);
  const setAnalysis = useMutation(api.djs.setAnalysis);

  // ---- filters (within a facet: OR; across facets: AND) ----
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState<Set<string>>(new Set());
  const [matchAllGenres, setMatchAllGenres] = useState(false);
  const [onlyUntagged, setOnlyUntagged] = useState(false);
  // The genre list runs to ~40 chips, which swamps the filter card. Collapse
  // it to one line until asked for more.
  const [showAllGenres, setShowAllGenres] = useState(false);
  const [djFilter, setDjFilter] = useState<Set<string>>(new Set());
  const [qualityFilter, setQualityFilter] = useState<Set<Quality>>(new Set());
  const [bpmFilter, setBpmFilter] = useState<Set<string>>(new Set());
  const [needHotCues, setNeedHotCues] = useState(false);
  const [needMemoryCues, setNeedMemoryCues] = useState(false);

  // ---- playback ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [sortBy, setSortBy] = useState<SortMode>("alphabetical");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Mirrored from the <audio> element so the seek slider can drive it.
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  // Multi-select: the row's download and delete controls become a checkbox,
  // while the pencil and everything else keep working.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<Id<"djTracks">>>(new Set());

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ripUrl, setRipUrl] = useState("");

  /** The tracks in scope: the whole library, or just the open playlist. */
  const scoped = useMemo(() => {
    const all = tracks ?? [];
    if (!activePlaylistId) return all;
    if (!playlistTrackIds) return [];
    const order = new Map(playlistTrackIds.map((id, i) => [id, i]));
    return all.filter((t) => order.has(t._id)).sort((a, b) => order.get(a._id)! - order.get(b._id)!);
  }, [tracks, activePlaylistId, playlistTrackIds]);

  const allGenres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of scoped) {
      for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    // Alphabetical, so a given genre is always in the same place. localeCompare
    // keeps accented names (Guarachatón) next to their unaccented neighbours.
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [scoped]);

  /**
   * Genres shown while collapsed: the first row's worth, plus any that are
   * currently filtering, so an active chip is never hidden behind "see more".
   */
  const visibleGenres = useMemo(() => {
    if (showAllGenres || allGenres.length <= COLLAPSED_GENRE_COUNT) return allGenres;
    const head = allGenres.slice(0, COLLAPSED_GENRE_COUNT);
    const activeTail = allGenres
      .slice(COLLAPSED_GENRE_COUNT)
      .filter(([genre]) => genreFilter.has(genre));
    return [...head, ...activeTail];
  }, [allGenres, genreFilter, showAllGenres]);

  const hiddenGenreCount = allGenres.length - visibleGenres.length;

  // Keyed by kerb (stable identity), labelled with the DJ's chosen name.
  const allDjs = useMemo(() => {
    const byKerb = new Map<string, { label: string; count: number; color: string | null }>();
    for (const t of scoped) {
      const entry = byKerb.get(t.dj);
      if (entry) entry.count += 1;
      else byKerb.set(t.dj, { label: t.djDisplay, count: 1, color: t.djColor });
    }
    return [...byKerb.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  }, [scoped]);

  const djLabel = useCallback(
    (kerb: string) => allDjs.find(([k]) => k === kerb)?.[1].label ?? kerb,
    [allDjs],
  );

  const availableQualities = useMemo(() => {
    const counts = new Map<Quality, number>();
    for (const t of scoped) counts.set(t.quality, (counts.get(t.quality) ?? 0) + 1);
    return QUALITY_ORDER.filter((q) => counts.has(q)).map(
      (q) => [q, counts.get(q)!] as const,
    );
  }, [scoped]);

  const cueCounts = useMemo(
    () => ({
      hot: scoped.filter((t) => (t.hotCues?.length ?? 0) > 0).length,
      memory: scoped.filter((t) => (t.memoryCues?.length ?? 0) > 0).length,
    }),
    [scoped],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((t) => {
      if (q) {
        // Search both the kerb and the DJ's chosen name.
        const haystack =
          `${t.title} ${t.artist ?? ""} ${t.dj} ${t.djDisplay} ${t.genres.join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (onlyUntagged && t.genres.length > 0) return false;
      if (genreFilter.size > 0) {
        const hits = [...genreFilter].filter((g) => t.genres.includes(g));
        if (matchAllGenres ? hits.length !== genreFilter.size : hits.length === 0) return false;
      }
      if (djFilter.size > 0 && !djFilter.has(t.dj)) return false;
      if (qualityFilter.size > 0 && !qualityFilter.has(t.quality)) return false;
      if (bpmFilter.size > 0) {
        const bucket = bucketForBpm(t.bpm);
        if (!bucket || !bpmFilter.has(bucket)) return false;
      }
      if (needHotCues && !(t.hotCues && t.hotCues.length > 0)) return false;
      if (needMemoryCues && !(t.memoryCues && t.memoryCues.length > 0)) return false;
      return true;
    });
  }, [
    scoped,
    search,
    genreFilter,
    matchAllGenres,
    onlyUntagged,
    djFilter,
    qualityFilter,
    bpmFilter,
    needHotCues,
    needMemoryCues,
  ]);

  /** Filtering decides what's shown; this decides the order it's shown in. */
  const ordered = useMemo(
    () => sortTracks(filtered, sortBy, sortDir),
    [filtered, sortBy, sortDir],
  );

  /** Only show BPM buckets that something actually falls into. */
  const availableBpmBuckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of scoped) {
      const b = bucketForBpm(t.bpm);
      if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return BPM_BUCKETS.filter((b) => counts.has(b.label)).map(
      (b) => [b.label, counts.get(b.label)!] as const,
    );
  }, [scoped]);

  const untaggedCount = useMemo(
    () => scoped.filter((t) => t.genres.length === 0).length,
    [scoped],
  );

  const anyFilter =
    search.trim().length > 0 ||
    genreFilter.size > 0 ||
    onlyUntagged ||
    djFilter.size > 0 ||
    qualityFilter.size > 0 ||
    bpmFilter.size > 0 ||
    needHotCues ||
    needMemoryCues;

  const clearFilters = useCallback(() => {
    setSearch("");
    setGenreFilter(new Set());
    setOnlyUntagged(false);
    setDjFilter(new Set());
    setQualityFilter(new Set());
    setBpmFilter(new Set());
    setNeedHotCues(false);
    setNeedMemoryCues(false);
    setMatchAllGenres(false);
  }, []);

  // ---- actions ----

  /** Load a track into the player and start it. */
  const playTrack = useCallback(
    async (track: Track) => {
      const url = await convex.query(api.djs.getTrackUrl, { trackId: track._id });
      if (!url) return;
      setNowPlaying(track);
      // Let the <audio> element pick up the new src before playing.
      requestAnimationFrame(() => {
        if (!audioRef.current) return;
        audioRef.current.src = url;
        void audioRef.current.play();
      });
    },
    [convex],
  );

  /** Row play button: toggles if it's already the current track. */
  const play = useCallback(
    async (track: Track) => {
      if (nowPlaying?._id === track._id && audioRef.current) {
        if (isPlaying) audioRef.current.pause();
        else void audioRef.current.play();
        return;
      }
      await playTrack(track);
    },
    [isPlaying, nowPlaying, playTrack],
  );

  /** Step through whatever is on screen; shuffle picks at random instead. */
  const step = useCallback(
    (direction: 1 | -1) => {
      if (!nowPlaying) return;

      let next: Track | undefined;
      if (shuffle) {
        const pool = ordered.filter((t) => t._id !== nowPlaying._id);
        next = pool[Math.floor(Math.random() * pool.length)];
      } else {
        const i = ordered.findIndex((t) => t._id === nowPlaying._id);
        next = i >= 0 ? ordered[i + direction] : undefined;
      }

      if (!next) return;
      void playTrack(next);
    },
    [ordered, nowPlaying, playTrack, shuffle],
  );

  /**
   * Roll on to the next track when one finishes, so the library plays through
   * like a playlist instead of stopping after every song. Follows whatever is
   * on screen, so filters and playlist order decide what comes next.
   */
  /**
   * Roll on when a track finishes, so the library plays through rather than
   * stopping after every song. Reaching the end just stops.
   */
  const playNext = useCallback(() => {
    const atEnd =
      !shuffle &&
      nowPlaying !== null &&
      ordered.findIndex((t) => t._id === nowPlaying._id) === ordered.length - 1;
    if (atEnd) {
      setIsPlaying(false);
      return;
    }
    step(1);
  }, [ordered, nowPlaying, shuffle, step]);

  /** Kick off playback from a random track in whatever is on screen. */
  const shufflePlay = useCallback(async () => {
    if (ordered.length === 0) return;
    setShuffle(true);
    await playTrack(ordered[Math.floor(Math.random() * ordered.length)]);
  }, [ordered, playTrack]);

  const download = useCallback(
    async (track: Track) => {
      const url = await convex.query(api.djs.getTrackUrl, { trackId: track._id });
      if (!url) return;

      // A plain <a download> doesn't work here: the browser ignores the
      // download attribute on a cross-origin URL, so the file lands named
      // after its storage id with an extension guessed from the content type
      // (.mp4 for an .m4a). Fetching the bytes and handing over a same-origin
      // blob keeps the real filename and extension.
      setBusy(`downloading ${track.title}`);
      setNotice(null);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`download failed (${res.status})`);
        const objectUrl = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = track.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Couldn't download that track.");
      } finally {
        setBusy(null);
      }
    },
    [convex],
  );

  /**
   * Import a whole rekordbox collection from the browser.
   *
   * The XML is only a catalogue, so the DJ also picks the folder their music
   * lives in; entries are matched to real files by name. Everything rekordbox
   * analysed -- tempo, key, cue points -- rides along, so imported tracks are
   * accurate rather than estimated.
   */
  const importLibrary = useCallback(
    async (xmlFile: File, audioFiles: File[]) => {
      setNotice(null);
      setBusy("reading rekordbox.xml");
      try {
        const parsed = parseRekordboxXml(await xmlFile.text());

        const byName = new Map<string, File>();
        for (const f of audioFiles) byName.set(matchKey(f.name), f);

        const library = tracks ?? [];
        const byLibName = new Map(library.map((t) => [matchKey(t.filename), t]));
        const byLibTitle = new Map(library.map((t) => [matchKey(t.title), t]));

        // Split into tracks we need to upload and tracks we already hold,
        // which only need rekordbox's analysis attaching.
        const queue: { entry: (typeof parsed)[number]; file: File }[] = [];
        const attach: {
          trackId: Id<"djTracks">;
          hotCues: typeof parsed[number]["hotCues"];
          memoryCues: typeof parsed[number]["memoryCues"];
          bpm?: number;
          musicalKey?: string;
        }[] = [];

        for (const entry of parsed) {
          const key = matchKey(entry.filename);
          const existing = byLibName.get(key) ?? byLibTitle.get(matchKey(entry.title));
          if (existing) {
            const useful =
              entry.hotCues.length > 0 ||
              entry.memoryCues.length > 0 ||
              entry.bpm !== undefined ||
              entry.musicalKey !== undefined;
            if (useful) {
              attach.push({
                trackId: existing._id,
                hotCues: entry.hotCues,
                memoryCues: entry.memoryCues,
                bpm: entry.bpm,
                musicalKey: entry.musicalKey,
              });
            }
            continue;
          }
          const file = byName.get(key);
          if (file && rejectReason(file) === null) queue.push({ entry, file });
        }

        if (attach.length > 0) {
          setBusy(`updating ${attach.length} tracks you already have`);
          await attachCues({ cues: attach, source: "rekordbox-xml" });
        }

        if (queue.length === 0) {
          setNotice(
            attach.length > 0
              ? `Updated ${attach.length} existing tracks with rekordbox analysis. Nothing new to upload.`
              : `Matched nothing — ${parsed.length} tracks in that export, ` +
                `${audioFiles.length} files in that folder.`,
          );
          return;
        }

        let done = 0;
        let failed = 0;
        for (const { entry, file } of queue) {
          done += 1;
          setBusy(`importing ${done}/${queue.length}: ${file.name.slice(0, 40)}`);
          try {
            const durationSec = await readDuration(file);
            const { quality, bitrateKbps } = inferQuality(file.name, file.size, durationSec);

            const uploadUrl = await generateUploadUrl();
            const res = await fetch(uploadUrl, {
              method: "POST",
              headers: { "Content-Type": file.type || "application/octet-stream" },
              body: file,
            });
            if (!res.ok) throw new Error(`upload failed (${res.status})`);
            const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };

            const hasCues = entry.hotCues.length > 0 || entry.memoryCues.length > 0;
            await addTrack({
              storageId,
              title: entry.title || file.name.replace(/\.[^.]+$/, ""),
              artist: entry.artist || undefined,
              filename: file.name,
              ext: extOf(file.name),
              mimeType: file.type || "application/octet-stream",
              sizeBytes: file.size,
              durationSec,
              quality,
              bitrateKbps,
              bpm: entry.bpm,
              musicalKey: entry.musicalKey,
              hotCues: hasCues ? entry.hotCues : undefined,
              memoryCues: hasCues ? entry.memoryCues : undefined,
              cueSource: "rekordbox-xml",
            });
          } catch {
            failed += 1;
          }
        }

        const summary = [`Imported ${done - failed} of ${queue.length} new tracks`];
        if (attach.length > 0) summary.push(`updated ${attach.length} you already had`);
        if (failed > 0) summary.push(`${failed} failed`);
        setNotice(summary.join(", ") + ".");
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Couldn't read that export.");
      } finally {
        setBusy(null);
      }
    },
    [addTrack, generateUploadUrl, tracks],
  );

  /** Zip up the selected tracks and hand them over as one download. */
  const downloadSelected = useCallback(async () => {
    const chosen = (tracks ?? []).filter((t) => selected.has(t._id));
    if (chosen.length === 0) return;

    setNotice(null);
    const entries: ZipEntry[] = [];
    try {
      for (let i = 0; i < chosen.length; i += 1) {
        const t = chosen[i];
        setBusy(`fetching ${i + 1}/${chosen.length}: ${t.title.slice(0, 36)}`);
        const url = await convex.query(api.djs.getTrackUrl, { trackId: t._id });
        if (!url) continue;
        const res = await fetch(url);
        if (!res.ok) continue;
        entries.push({ name: t.filename, data: await res.blob() });
      }

      // Ship a rekordbox collection alongside the audio, so cue points and
      // analysis travel with the download rather than being left behind.
      const xml = buildRekordboxXml(
        chosen.map((t) => ({
          title: t.title,
          artist: t.artist,
          filename: t.filename,
          durationSec: t.durationSec,
          bpm: t.bpm,
          musicalKey: t.musicalKey,
          hotCues: t.hotCues,
          memoryCues: t.memoryCues,
        })),
      );
      entries.push({
        name: "wokenet-rekordbox.xml",
        data: new Blob([xml], { type: "application/xml" }),
      });

      setBusy(`building zip (${entries.length - 1} tracks)`);
      saveBlob(await buildZip(entries), `wokenet-${entries.length - 1}-tracks.zip`);
      setNotice(`Downloaded ${entries.length} track${entries.length === 1 ? "" : "s"}.`);
      setSelectMode(false);
      setSelected(new Set());
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't build that download.");
    } finally {
      setBusy(null);
    }
  }, [convex, selected, tracks]);

  /**
   * Quietly fill in missing BPMs in the background.
   *
   * Tracks that came from rekordbox already have real analysis; this is for
   * everything else. It works one track at a time with a gap between them, so
   * it never competes with what the person is actually doing, and only while
   * the tab is visible. Failures are remembered for the session so an
   * undetectable track isn't retried forever.
   */
  const attemptedBpm = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!tracks) return;

    let cancelled = false;

    const run = async () => {
      while (!cancelled) {
        if (document.hidden) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        const next = (tracks ?? []).find(
          (t) => t.bpm === undefined && !attemptedBpm.current.has(t._id),
        );
        if (!next) return;

        attemptedBpm.current.add(next._id);
        try {
          const url = await convex.query(api.djs.getTrackUrl, { trackId: next._id });
          if (url) {
            const res = await fetch(url);
            if (res.ok) {
              const bpm = await detectBpm(await res.arrayBuffer());
              if (bpm && !cancelled) {
                await setAnalysis({ trackId: next._id, bpm, source: "detected" });
              }
            }
          }
        } catch {
          // Leave it marked attempted and move on.
        }

        // Breathe between tracks so this stays genuinely background work.
        await new Promise((r) => setTimeout(r, 4000));
      }
    };

    const timer = setTimeout(() => void run(), 8000); // let the page settle first
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tracks, convex, setAnalysis]);

  /** Analyse a track already in the library, without re-uploading it. */
  const detectBpmFor = useCallback(
    async (track: Track): Promise<number | undefined> => {
      const url = await convex.query(api.djs.getTrackUrl, { trackId: track._id });
      if (!url) return undefined;
      try {
        const res = await fetch(url);
        if (!res.ok) return undefined;
        return await detectBpm(await res.arrayBuffer());
      } catch {
        return undefined;
      }
    },
    [convex],
  );

  /** Replace one track's cover art with an image from disk. */
  const uploadCover = useCallback(
    async (track: Track, file: File) => {
      setBusy(`uploading cover for ${track.title}`);
      setNotice(null);
      try {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "image/jpeg" },
          body: file,
        });
        if (!res.ok) throw new Error(`cover upload failed (${res.status})`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await setCover({ trackId: track._id, storageId });
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Couldn't set that cover.");
      } finally {
        setBusy(null);
      }
    },
    [generateUploadUrl, setCover],
  );

  const upload = useCallback(
    async (files: File[], playlist: { name: string; description: string } | null) => {
      setNotice(null);
      let done = 0;
      const rejected: string[] = [];
      const uploadedIds: Id<"djTracks">[] = [];

      for (const file of files) {
        // Refuse junk before spending time uploading it; the server checks too.
        const reason = rejectReason(file);
        if (reason) {
          rejected.push(reason);
          continue;
        }
        setBusy(`uploading ${file.name}`);
        try {
          const durationSec = await readDuration(file);
          const { quality, bitrateKbps } = inferQuality(file.name, file.size, durationSec);

          // One global tempo estimate, at upload time, in the browser -- so it
          // works for any upload rather than only for rips.
          setBusy(`analysing ${file.name}`);
          const bpm = await detectBpm(file).catch(() => undefined);
          setBusy(`uploading ${file.name}`);

          const uploadUrl = await generateUploadUrl();
          const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!res.ok) throw new Error(`upload failed (${res.status})`);
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };

          const trackId = await addTrack({
            storageId,
            title: file.name.replace(/\.[^.]+$/, ""),
            filename: file.name,
            ext: extOf(file.name),
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            durationSec,
            quality,
            bitrateKbps,
            bpm,
          });
          uploadedIds.push(trackId);
          done += 1;
        } catch (err) {
          setNotice(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
        }
      }
      const parts: string[] = [];
      if (done > 0) parts.push(`Uploaded ${done} file${done === 1 ? "" : "s"}.`);
      if (rejected.length > 0) parts.push(`Skipped ${rejected.length}: ${rejected[0]}`);

      // Only worth making the playlist if something actually landed.
      if (playlist && uploadedIds.length > 0) {
        setBusy(`creating playlist "${playlist.name}"`);
        try {
          const playlistId = await createPlaylist({
            name: playlist.name,
            description: playlist.description || undefined,
          });
          await addTracksToPlaylist({ playlistId, trackIds: uploadedIds });
          setActivePlaylistId(playlistId);
          parts.push(`Added to "${playlist.name}".`);
        } catch {
          parts.push("Couldn't create the playlist.");
        }
      }

      setBusy(null);
      if (parts.length > 0) setNotice(parts.join(" "));
    },
    [addTrack, addTracksToPlaylist, createPlaylist, generateUploadUrl],
  );

  /** Queue a SoundCloud URL for a DJ's ripper to pick up. */
  const submitRip = useCallback(async () => {
    const url = ripUrl.trim();
    if (!url) return;
    setBusy("queueing rip");
    setNotice(null);
    try {
      await requestRip({ url });
      setRipUrl("");
      setNotice("Queued. It'll appear once a DJ's ripper picks it up.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message.replace(/^.*Error: /, "") : "Couldn't queue.");
    } finally {
      setBusy(null);
    }
  }, [requestRip, ripUrl]);

  const pendingRips = (ripRequests ?? []).filter(
    (r) => r.status === "pending" || r.status === "claimed",
  );

  return (
    <Flex width="100%" height="100%" style={{ minHeight: 0 }}>
      <PlaylistSidebar
        playlists={playlists}
        activeId={activePlaylistId}
        libraryCount={tracks?.length ?? 0}
        onSelect={(id) => {
          setActivePlaylistId(id);
          // Filters belong to the view you set them in: a genre that makes
          // sense in the library may match nothing in a playlist, which just
          // looks like an empty playlist. Start each one clean.
          clearFilters();
          setShowAllGenres(false);
          setSelected(new Set());
          setSelectMode(false);
        }}
        onCreate={(name, description) =>
          void createPlaylist({ name, description: description || undefined }).then(
            setActivePlaylistId,
          )
        }
        onDropTracks={(playlistId, trackIds) => {
          void addTracksToPlaylist({ playlistId, trackIds });
          setSelected(new Set());
        }}
      />

      {/* Left-aligned against the sidebar rather than centred, so the page
          doesn't leave a dead gutter on wide screens. */}
      <Flex
        direction="column"
        p="5"
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          overflowY: "auto",
          // Keep the list clear of the now-playing card in the corner.
          paddingRight: nowPlaying ? 272 : undefined,
        }}
      >
        <Flex direction="column" width="100%" style={{ maxWidth: 1600 }} gap="4" pb="9">
        <Flex justify="between" align="center" wrap="wrap" gap="3">
          <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
            <Flex align="baseline" gap="3" wrap="wrap">
              <Heading size="8" truncate>
                {activePlaylist ? activePlaylist.name : "Library"}
              </Heading>
              {activePlaylist?.description && (
                <Text size="2" color="gray" style={{ opacity: 0.8 }}>
                  {activePlaylist.description}
                </Text>
              )}
            </Flex>
            {activePlaylist && (
              <Text size="1" color="gray" style={{ opacity: 0.7 }}>
                playlist by{" "}
                <Text size="1" color={asBadgeColor(activePlaylist.createdByColor) ?? "gray"}>
                  {activePlaylist.createdByName}
                </Text>
                {activePlaylist.contributors.length > 0 && (
                  <>
                    {" · colonized by "}
                    {activePlaylist.contributors.map((c, i) => (
                      <Text key={c.kerb} size="1" color={asBadgeColor(c.color) ?? "gray"}>
                        {i > 0 ? ", " : ""}
                        {c.name}
                      </Text>
                    ))}
                  </>
                )}
              </Text>
            )}
          </Flex>

          <Flex gap="2" align="center" wrap="wrap">
            <RipDialog
              value={ripUrl}
              onChange={setRipUrl}
              onSubmit={submitRip}
              pending={pendingRips}
              busy={busy !== null}
            />
            <UploadDialog onRun={(f, p) => void upload(f, p)} busy={busy !== null} />
            <LibraryImportDialog onRun={importLibrary} busy={busy !== null} />
            {user?.isAdmin && <DuplicatesDialog />}
            {activePlaylist && (
              <PlaylistSettingsDialog
                playlist={activePlaylist}
                onSave={(name, description) =>
                  void updatePlaylist({ playlistId: activePlaylist._id, name, description })
                }
                onDelete={() =>
                  void deletePlaylist({ playlistId: activePlaylist._id }).then(() =>
                    setActivePlaylistId(null),
                  )
                }
              />
            )}
          </Flex>
        </Flex>

        {(busy || notice) && (
          <Text size="2" color={busy ? "orange" : "gray"}>
            {busy ? `${busy}…` : notice}
          </Text>
        )}

        {/* ---- filters ---- */}
        <Card style={{ border: "1px solid var(--accent-7)" }}>
          <Flex direction="column" gap="3">
            <Flex gap="2" align="center" wrap="wrap">
              <TextField.Root
                placeholder="Search title, artist, dj, genre…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: "1 1 240px" }}
              />
              {anyFilter && (
                <Button size="1" variant="soft" color="gray" onClick={clearFilters}>
                  Clear
                </Button>
              )}
            </Flex>

            {/* Everything currently filtering, each droppable on its own. */}
            {anyFilter && (
              <Flex gap="1" wrap="wrap">
                {search.trim() && (
                  <ActiveFilterBubble
                    label={`"${search.trim()}"`}
                    onRemove={() => setSearch("")}
                  />
                )}
                {onlyUntagged && (
                  <ActiveFilterBubble label="untagged" onRemove={() => setOnlyUntagged(false)} />
                )}
                {[...genreFilter].map((g) => (
                  <ActiveFilterBubble
                    key={`g-${g}`}
                    label={g}
                    onRemove={() => setGenreFilter((s) => removeFrom(s, g))}
                  />
                ))}
                {[...djFilter].map((d) => (
                  <ActiveFilterBubble
                    key={`d-${d}`}
                    label={djLabel(d)}
                    onRemove={() => setDjFilter((s) => removeFrom(s, d))}
                  />
                ))}
                {[...qualityFilter].map((q) => (
                  <ActiveFilterBubble
                    key={`q-${q}`}
                    label={QUALITY_LABEL[q]}
                    onRemove={() => setQualityFilter((s) => removeFrom(s, q))}
                  />
                ))}
                {[...bpmFilter].map((b) => (
                  <ActiveFilterBubble
                    key={`b-${b}`}
                    label={`${b} bpm`}
                    onRemove={() => setBpmFilter((s) => removeFrom(s, b))}
                  />
                ))}
                {needHotCues && (
                  <ActiveFilterBubble
                    label="has hot cues"
                    onRemove={() => setNeedHotCues(false)}
                  />
                )}
                {needMemoryCues && (
                  <ActiveFilterBubble
                    label="has memory cues"
                    onRemove={() => setNeedMemoryCues(false)}
                  />
                )}
              </Flex>
            )}

            <FacetRow label="Genre" empty={allGenres.length === 0 && untaggedCount === 0}>
              {untaggedCount > 0 && (
                <FilterChip
                  active={onlyUntagged}
                  count={untaggedCount}
                  onClick={() => setOnlyUntagged((v) => !v)}
                >
                  untagged
                </FilterChip>
              )}
              {visibleGenres.map(([genre, count]) => (
                <FilterChip
                  key={genre}
                  active={genreFilter.has(genre)}
                  count={count}
                  onClick={() => setGenreFilter((s) => toggleIn(s, genre))}
                >
                  {genre}
                </FilterChip>
              ))}
              {hiddenGenreCount > 0 && (
                <Button
                  size="1"
                  radius="full"
                  variant="ghost"
                  color="gray"
                  onClick={() => setShowAllGenres(true)}
                  style={{ height: "22px" }}
                >
                  show {hiddenGenreCount} more
                </Button>
              )}
              {showAllGenres && allGenres.length > COLLAPSED_GENRE_COUNT && (
                <Button
                  size="1"
                  radius="full"
                  variant="ghost"
                  color="gray"
                  onClick={() => setShowAllGenres(false)}
                  style={{ height: "22px" }}
                >
                  show less
                </Button>
              )}
              {genreFilter.size > 1 && (
                <FilterChip active={matchAllGenres} onClick={() => setMatchAllGenres((v) => !v)}>
                  {matchAllGenres ? "match all" : "match any"}
                </FilterChip>
              )}
            </FacetRow>

            <FacetRow label="DJ" empty={allDjs.length === 0}>
              {allDjs.map(([kerb, { label, count, color }]) => (
                <FilterChip
                  key={kerb}
                  active={djFilter.has(kerb)}
                  color={asBadgeColor(color)}
                  count={count}
                  onClick={() => setDjFilter((s) => toggleIn(s, kerb))}
                >
                  {label}
                </FilterChip>
              ))}
            </FacetRow>

            <FacetRow label="Quality" empty={availableQualities.length === 0}>
              {availableQualities.map(([q, count]) => (
                <FilterChip
                  key={q}
                  active={qualityFilter.has(q)}
                  count={count}
                  onClick={() => setQualityFilter((s) => toggleIn(s, q))}
                >
                  {QUALITY_LABEL[q]}
                </FilterChip>
              ))}
            </FacetRow>

            <FacetRow label="BPM" empty={availableBpmBuckets.length === 0}>
              {availableBpmBuckets.map(([label, count]) => (
                <FilterChip
                  key={label}
                  active={bpmFilter.has(label)}
                  count={count}
                  onClick={() => setBpmFilter((s) => toggleIn(s, label))}
                >
                  {label}
                </FilterChip>
              ))}
            </FacetRow>

            <FacetRow label="Cues">
              <FilterChip
                active={needHotCues}
                count={cueCounts.hot}
                onClick={() => setNeedHotCues((v) => !v)}
              >
                hot cues
              </FilterChip>
              <FilterChip
                active={needMemoryCues}
                count={cueCounts.memory}
                onClick={() => setNeedMemoryCues((v) => !v)}
              >
                memory cues
              </FilterChip>
            </FacetRow>
          </Flex>
        </Card>

        <Flex justify="between" align="center" gap="3" wrap="wrap">
          <Text size="2" color="gray">
            {tracks === undefined
              ? "Loading…"
              : `${ordered.length} of ${scoped.length} track${scoped.length === 1 ? "" : "s"}`}
          </Text>

          {/* Selection controls sit on the count line, next to what they act on. */}
          <Flex gap="2" align="center" wrap="wrap">
            {selectMode ? (
              <>
                <Button
                  size="1"
                  radius="full"
                  variant="soft"
                  color="gray"
                  onClick={() => {
                    setSelectMode(false);
                    setSelected(new Set());
                  }}
                >
                  Cancel
                </Button>
                {activePlaylist ? (
                  <Button
                    size="1"
                    radius="full"
                    variant="soft"
                    color="red"
                    disabled={selected.size === 0}
                    onClick={() => {
                      void removeTracksFromPlaylist({
                        playlistId: activePlaylist._id,
                        trackIds: [...selected],
                      });
                      setSelected(new Set());
                    }}
                  >
                    Remove {selected.size} from playlist
                  </Button>
                ) : null}
                <AddToPlaylistButton
                  playlists={playlists ?? []}
                  count={selected.size}
                  onAdd={(playlistId) => {
                    void addTracksToPlaylist({ playlistId, trackIds: [...selected] });
                    setSelected(new Set());
                    setSelectMode(false);
                  }}
                />
                <Button
                  size="1"
                  radius="full"
                  disabled={selected.size === 0 || busy !== null}
                  onClick={() => void downloadSelected()}
                >
                  Download {selected.size} track{selected.size === 1 ? "" : "s"}
                </Button>
                <Button
                  size="1"
                  radius="full"
                  variant="surface"
                  onClick={() =>
                    // "Select all" acts on what's filtered, and toggles back off.
                    setSelected((prev) =>
                      prev.size === ordered.length
                        ? new Set()
                        : new Set(ordered.map((t) => t._id)),
                    )
                  }
                >
                  {selected.size === ordered.length && ordered.length > 0
                    ? "Select none"
                    : "Select all"}
                </Button>
              </>
            ) : (
              <>
                <Flex gap="1" align="center">
                  <Text size="1" color="gray">
                    Sort by
                  </Text>
                  <Select.Root
                    value={sortBy}
                    onValueChange={(v) => {
                      const mode = v as SortMode;
                      setSortBy(mode);
                      // Dates read newest-first; everything else reads up.
                      setSortDir(DEFAULT_DIRECTION[mode]);
                    }}
                  >
                    <Select.Trigger variant="surface" radius="full" />
                    <Select.Content>
                      {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
                        <Select.Item key={m} value={m}>
                          {SORT_LABELS[m]}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  <Button
                    size="1"
                    radius="full"
                    variant="surface"
                    onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                    title="Reverse the order"
                  >
                    {sortDir === "asc" ? "↑" : "↓"} {DIRECTION_LABELS[sortBy][sortDir]}
                  </Button>
                </Flex>
                <Button
                  size="1"
                  radius="full"
                  variant={shuffle ? "solid" : "surface"}
                  disabled={ordered.length === 0}
                  onClick={() => void shufflePlay()}
                >
                  Shuffle
                </Button>
                <Button
                  size="1"
                  radius="full"
                  variant="surface"
                  onClick={() => setSelectMode(true)}
                >
                  Select tracks
                </Button>
              </>
            )}
          </Flex>
        </Flex>

        {/* ---- track list ---- */}
        {tracks !== undefined && ordered.length === 0 ? (
          <Flex direction="column" align="center" gap="2" py="8">
            <Text size="8" color="gray" style={{ opacity: 0.5 }}>
              {scoped.length === 0 ? ":(" : ":/"}
            </Text>
            <Text size="2" color="gray">
              {scoped.length > 0
                ? "Nothing matches those filters."
                : activePlaylist
                  ? "This playlist is empty. Drag tracks in from the library."
                  : "Nothing in the library yet."}
            </Text>
          </Flex>
        ) : (
          <Flex direction="column" gap="2">
            {ordered.map((track) => (
              <TrackRow
                key={track._id}
                track={track}
                isCurrent={nowPlaying?._id === track._id}
                isPlaying={isPlaying && nowPlaying?._id === track._id}
                canDelete
                onPlay={() => void play(track)}
                onDownload={() => void download(track)}
                onDelete={() => void deleteTrack({ trackId: track._id })}
                onSetCover={(file) => void uploadCover(track, file)}
                onDetectBpm={() => detectBpmFor(track)}
                selectMode={selectMode}
                isSelected={selected.has(track._id)}
                onToggleSelected={() => setSelected((s) => toggleIn(s, track._id))}
                onDragStart={(e) => {
                  // Dragging a selected row carries the whole selection.
                  const ids =
                    selected.size > 0 && selected.has(track._id) ? [...selected] : [track._id];
                  e.dataTransfer.setData(DRAG_TRACKS, JSON.stringify(ids));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onSave={(edits) => {
                  // Two mutations: one for the track fields, one for tags.
                  // Both write to Convex, so every connected client updates.
                  void updateTrack({
                    trackId: track._id,
                    title: edits.title,
                    artist: edits.artist,
                    bpm: edits.bpm,
                    musicalKey: edits.musicalKey,
                  });
                  void setGenres({ trackId: track._id, genres: edits.genres });
                }}
              />
            ))}
          </Flex>
        )}
        </Flex>
      </Flex>

      {/* ---- now playing card ----
           A corner card rather than a full-width bar, so it doesn't sit on
           top of the sidebar and hide the DJ settings button. */}
      {nowPlaying && (
        <Flex
          direction="column"
          gap="2"
          p="2"
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            width: 224,
            zIndex: 50,
            backgroundColor: "var(--gray-2)",
            border: "1px solid var(--accent-7)",
            borderRadius: "var(--radius-3)",
          }}
        >
          <Cover url={nowPlaying.coverUrl} size={208} />

          <Flex direction="column" style={{ minWidth: 0 }}>
            <Text size="2" weight="bold" truncate>
              {nowPlaying.title}
            </Text>
            <Text size="1" color="gray" truncate>
              {nowPlaying.artist ? `${nowPlaying.artist} · ` : ""}
              <Text size="1" color={asBadgeColor(nowPlaying.djColor) ?? "gray"}>
                {nowPlaying.djDisplay}
              </Text>
            </Text>
          </Flex>

          {/* The element itself is hidden; the controls below drive it. */}
          <audio
            ref={audioRef}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={playNext}
            onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0);
              setElapsed(0);
            }}
            style={{ display: "none" }}
          />

          <Flex align="center" gap="2">
            <IconButton
              size="2"
              radius="full"
              onClick={() => {
                if (!audioRef.current) return;
                if (isPlaying) audioRef.current.pause();
                else void audioRef.current.play();
              }}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              <PlayIcon playing={isPlaying} />
            </IconButton>
            <Text size="1" color="gray" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatDuration(elapsed)} / {formatDuration(duration || nowPlaying.durationSec)}
            </Text>
          </Flex>

          <Slider
            size="1"
            value={[Math.min(elapsed, duration || 0)]}
            max={Math.max(duration || nowPlaying.durationSec || 1, 1)}
            step={1}
            onValueChange={([v]) => {
              // Move the handle immediately; timeupdate would lag the drag.
              setElapsed(v);
              if (audioRef.current) audioRef.current.currentTime = v;
            }}
            aria-label="Seek"
          />

          <Flex justify="between" align="center" gap="1">
            <Flex gap="1" align="center">
              <IconButton
                size="1"
                variant="soft"
                color="gray"
                onClick={() => step(-1)}
                title="Previous track"
                aria-label="Previous track"
              >
                <SkipIcon direction="back" />
              </IconButton>
              <IconButton
                size="1"
                variant="soft"
                color="gray"
                onClick={() => step(1)}
                title="Next track"
                aria-label="Next track"
              >
                <SkipIcon direction="forward" />
              </IconButton>
              {/* Shuffle stays reachable while something is playing. */}
              <IconButton
                size="1"
                radius="full"
                variant={shuffle ? "solid" : "soft"}
                color={shuffle ? undefined : "gray"}
                onClick={() => setShuffle((v) => !v)}
                title={shuffle ? "Shuffle on" : "Shuffle off"}
                aria-label="Toggle shuffle"
              >
                ⤮
              </IconButton>
              <IconButton
                size="1"
                variant="soft"
                color="gray"
                onClick={() => void download(nowPlaying)}
                title="Download this track"
                aria-label="Download this track"
              >
                <DownloadIcon />
              </IconButton>
            </Flex>
            <IconButton size="1" variant="ghost" color="gray" onClick={() => setNowPlaying(null)}>
              ✕
            </IconButton>
          </Flex>
        </Flex>
      )}
    </Flex>
  );
});

const FacetRow = memo(
  ({ label, empty, children }: { label: string; empty?: boolean; children: React.ReactNode }) => (
    <Flex gap="2" align="start">
      <Text size="2" color="gray" style={{ minWidth: 68, paddingTop: 2 }}>
        {label}
      </Text>
      <Flex gap="1" wrap="wrap">
        {/* Without this an empty facet reads as a broken, unclickable label. */}
        {empty ? (
          <Text size="1" color="gray" style={{ opacity: 0.5, paddingTop: 3 }}>
            nothing tagged yet
          </Text>
        ) : (
          children
        )}
      </Flex>
    </Flex>
  ),
);

const TrackRow = memo(
  ({
    track,
    isCurrent,
    isPlaying,
    canDelete,
    onPlay,
    onDownload,
    onDelete,
    onSave,
    onSetCover,
    onDetectBpm,
    selectMode,
    isSelected,
    onToggleSelected,
    onDragStart,
  }: {
    track: Track;
    isCurrent: boolean;
    isPlaying: boolean;
    canDelete: boolean;
    onPlay: () => void;
    onDownload: () => void;
    onDelete: () => void;
    onSave: (edits: TrackEdits) => void;
    onSetCover: (file: File) => void;
    onDetectBpm: () => Promise<number | undefined>;
    selectMode: boolean;
    isSelected: boolean;
    onToggleSelected: () => void;
    onDragStart: (e: React.DragEvent) => void;
  }) => {
    // Lets you set cover art straight from the row, without opening the editor.
    const rowCoverInput = useRef<HTMLInputElement | null>(null);

    const hot = track.hotCues?.length ?? 0;
    const mem = track.memoryCues?.length ?? 0;

    return (
      <Card
        style={{
          border: `1px solid ${isCurrent ? "var(--accent-9)" : "var(--accent-7)"}`,
          background: isCurrent ? "var(--accent-2)" : undefined,
        }}
      >
        {/* nowrap so the action icons never drop to their own line: the
            title, badges and artwork give up space first. */}
        {/* Clicking anywhere that isn't a control plays the track (or toggles
            selection while selecting). The controls stop propagation. */}
        <Flex
          align="center"
          gap="3"
          wrap="nowrap"
          draggable
          onDragStart={onDragStart}
          onClick={() => (selectMode ? onToggleSelected() : onPlay())}
          style={{ cursor: selectMode ? "pointer" : "grab", minWidth: 0 }}
        >
          <IconButton
            size="1"
            radius="full"
            variant={isPlaying ? "solid" : "soft"}
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
          >
            <PlayIcon playing={isPlaying} />
          </IconButton>

          {/* Artwork is the first thing to go when the row runs out of room.
              Its own click sets cover art, so it mustn't also start playback. */}
          <Box
            display={{ initial: "none", xs: "block" }}
            style={{ flex: "0 0 auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <Cover url={track.coverUrl} size={46} onClick={() => rowCoverInput.current?.click()} />
          </Box>
          <input
            ref={rowCoverInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSetCover(f);
              e.target.value = "";
            }}
          />

          <Flex direction="column" style={{ minWidth: 0, flex: "1 1 220px" }}>
            <Text size="3" weight="bold" truncate>
              {track.title}
            </Text>
            <Text size="2" color="gray" truncate>
              {track.artist ? `${track.artist} · ` : ""}
              {formatDuration(track.durationSec)} · {formatSize(track.sizeBytes)}
            </Text>
          </Flex>

          <Flex
            gap="1"
            align="center"
            wrap="wrap"
            justify="end"
            style={{ flex: "1 1 auto", minWidth: 0 }}
          >
            <Tag color={asBadgeColor(track.djColor)} variant="soft">
              {track.djDisplay}
            </Tag>
            <Tag color={track.quality === "lossless" ? "green" : "gray"} variant="soft">
              {QUALITY_LABEL[track.quality]}
            </Tag>
            {track.bpm ? (
              <Tag color="gray" variant="outline">
                {Math.round(track.bpm)} bpm
                {track.analysisSource === "detected" ? "?" : ""}
              </Tag>
            ) : null}
            {track.musicalKey ? (
              <Tag color="gray" variant="outline">
                {track.musicalKey}
                {track.analysisSource === "detected" ? "?" : ""}
              </Tag>
            ) : null}
            {track.genres.map((g) => (
              <Tag key={g} color="gray" variant="outline">
                {g}
              </Tag>
            ))}
            {hot > 0 && (
              <Tag color="purple" variant="soft">
                {hot} hot
              </Tag>
            )}
            {mem > 0 && (
              <Tag color="blue" variant="soft">
                {mem} mem
              </Tag>
            )}
          </Flex>

          <Flex
            gap="1"
            align="center"
            style={{ flex: "0 0 auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* The pencil stays available in select mode; download and delete
                give way to the checkbox so the row doesn't grow. */}
            <TrackEditDialog
              track={track}
              onSave={onSave}
              onSetCover={onSetCover}
              onDetectBpm={onDetectBpm}
            />
            {selectMode ? (
              <Checkbox
                size="2"
                checked={isSelected}
                onCheckedChange={onToggleSelected}
                aria-label={`Select ${track.title}`}
                style={{ margin: "0 4px", cursor: "pointer" }}
              />
            ) : (
              <>
                <IconButton size="1" variant="soft" color="gray" onClick={onDownload}>
                  <DownloadIcon />
                </IconButton>
                {canDelete && (
                  <AlertDialog.Root>
                    <AlertDialog.Trigger>
                      <IconButton size="1" variant="soft" color="red" aria-label="Delete track">
                        ✕
                      </IconButton>
                    </AlertDialog.Trigger>
                    <AlertDialog.Content maxWidth="420px">
                      <AlertDialog.Title>Delete this track?</AlertDialog.Title>
                      <AlertDialog.Description size="2">
                        <Text weight="bold">{track.title}</Text> will be removed from the library
                        for everyone, along with its audio file and any playlists it's in. This
                        can't be undone.
                      </AlertDialog.Description>
                      {/* Delete is pushed to the far left and Cancel sits
                          where a confirm button normally would, so destroying
                          something takes a deliberate move rather than a
                          reflex click. */}
                      <Flex gap="2" justify="between" mt="4">
                        <AlertDialog.Action>
                          <Button size="1" color="red" onClick={onDelete}>
                            Delete
                          </Button>
                        </AlertDialog.Action>
                        <AlertDialog.Cancel>
                          <Button size="1" variant="soft" color="gray">
                            Cancel
                          </Button>
                        </AlertDialog.Cancel>
                      </Flex>
                    </AlertDialog.Content>
                  </AlertDialog.Root>
                )}
              </>
            )}
          </Flex>
        </Flex>
      </Card>
    );
  },
);

/**
 * Lets a DJ set the name shown on their tracks. Tracks are keyed by kerb, so
 * changing this renames their whole back catalogue, not just future uploads.
 */
const DjSettingsDialog = memo(() => {
  const me = useQuery(api.djs.myDjSettings);
  const save = useMutation(api.djs.setMyDjSettings);

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const name = nameDraft ?? me?.djName ?? "";
  const color = colorDraft ?? me?.djColor ?? "";
  const preview = name.trim() || me?.kerb || "you";

  const commit = async () => {
    setSaving(true);
    try {
      await save({ djName: name, djColor: color });
      setNameDraft(null);
      setColorDraft(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) {
          setNameDraft(null);
          setColorDraft(null);
        }
      }}
    >
      <Dialog.Trigger>
        <Button size="1" radius="full" variant="surface" color={asBadgeColor(me?.djColor)}>
          {me?.djName || me?.kerb || "DJ settings"}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>DJ settings</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          How you're credited on every track you add, and the colour your tag gets.
        </Dialog.Description>

        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            <Text size="2" weight="bold">
              Name
            </Text>
            <TextField.Root
              placeholder={me?.kerb ?? "kerb"}
              value={name}
              maxLength={40}
              onChange={(e) => setNameDraft(e.target.value)}
            />
            <Text size="1" color="gray">
              Blank uses your kerb{me?.kerb ? ` (${me.kerb})` : ""}. Renaming updates your existing
              tracks too — they're stored against your kerb, not the name.
            </Text>
          </Flex>

          <Flex direction="column" gap="2">
            <Text size="2" weight="bold">
              Tag colour
            </Text>
            <Flex gap="2" wrap="wrap">
              {/* Each swatch shows the actual tag, so you pick what you'll see. */}
              <Badge
                variant="soft"
                onClick={() => setColorDraft("")}
                style={{
                  cursor: "pointer",
                  outline: color === "" ? "2px solid var(--gray-12)" : undefined,
                }}
              >
                {preview}
              </Badge>
              {DJ_COLORS.map((c) => (
                <Badge
                  key={c}
                  color={c}
                  variant="soft"
                  onClick={() => setColorDraft(c)}
                  style={{
                    cursor: "pointer",
                    outline: color === c ? "2px solid var(--gray-12)" : undefined,
                  }}
                >
                  {preview}
                </Badge>
              ))}
            </Flex>
            <Text size="1" color="gray">
              Used for your tag on every track and for your chip in the DJ filter.
            </Text>
          </Flex>
        </Flex>

        <Flex justify="end" gap="2" mt="4">
          <Dialog.Close>
            <Button size="1" variant="soft" color="gray">
              Cancel
            </Button>
          </Dialog.Close>
          <Dialog.Close>
            <Button size="1" disabled={saving} onClick={() => void commit()}>
              Save
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
});

export type TrackEdits = {
  title: string;
  artist: string;
  bpm?: number;
  musicalKey: string;
  genres: string[];
};

/** Everything editable about one track, plus the facts you can't change. */
const TrackEditDialog = memo(
  ({
    track,
    onSave,
    onSetCover,
    onDetectBpm,
  }: {
    track: Track;
    onSave: (edits: TrackEdits) => void;
    onSetCover: (file: File) => void;
    onDetectBpm: () => Promise<number | undefined>;
  }) => {
    const coverInput = useRef<HTMLInputElement | null>(null);
    const [detecting, setDetecting] = useState(false);
    const [title, setTitle] = useState(track.title);
    const [artist, setArtist] = useState(track.artist ?? "");
    const [bpm, setBpm] = useState(track.bpm ? String(track.bpm) : "");
    const [musicalKey, setMusicalKey] = useState(track.musicalKey ?? "");
    const [genres, setGenres] = useState(track.genres.join(", "));

    // Re-seed the form whenever the dialog is reopened on fresh data.
    const reset = () => {
      setTitle(track.title);
      setArtist(track.artist ?? "");
      setBpm(track.bpm ? String(track.bpm) : "");
      setMusicalKey(track.musicalKey ?? "");
      setGenres(track.genres.join(", "));
    };

    const save = () => {
      const parsedBpm = Number.parseFloat(bpm);
      onSave({
        title: title.trim() || track.title,
        artist: artist.trim(),
        bpm: Number.isFinite(parsedBpm) && parsedBpm > 0 ? parsedBpm : undefined,
        musicalKey: musicalKey.trim(),
        genres: genres
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
    };

    return (
      <Dialog.Root onOpenChange={(open) => open && reset()}>
        <Dialog.Trigger>
          <IconButton size="1" variant="soft" color="gray" aria-label="Edit track">
            <PencilIcon />
          </IconButton>
        </Dialog.Trigger>
        <Dialog.Content maxWidth="680px">
          <Dialog.Title>Edit track</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="4">
            Anyone can edit these. Only admins can delete a track.
          </Dialog.Description>

          <Flex gap="3" mb="3" align="start">
            <Flex direction="column" gap="1" align="center">
              <Cover
                url={track.coverUrl}
                size={96}
                onClick={() => coverInput.current?.click()}
              />
              <input
                ref={coverInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onSetCover(f);
                  e.target.value = "";
                }}
              />
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => coverInput.current?.click()}
              >
                {track.coverUrl ? "change" : "add cover"}
              </Button>
            </Flex>

            <Flex direction="column" gap="3" style={{ flex: "1 1 auto" }}>
              <Field label="Title">
                <TextField.Root value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Artist">
                <TextField.Root
                  value={artist}
                  placeholder="unknown"
                  onChange={(e) => setArtist(e.target.value)}
                />
              </Field>
            </Flex>
          </Flex>

          <Flex direction="column" gap="3">
            <Field label="Artist">
              <TextField.Root
                value={artist}
                placeholder="unknown"
                onChange={(e) => setArtist(e.target.value)}
              />
            </Field>
            <Flex gap="3">
              <Field label="BPM">
                <Flex gap="1" align="center">
                  <TextField.Root
                    value={bpm}
                    placeholder="—"
                    inputMode="decimal"
                    onChange={(e) => setBpm(e.target.value)}
                    style={{ flex: "1 1 auto" }}
                  />
                  <Button
                    size="1"
                    variant="surface"
                    disabled={detecting}
                    onClick={() => {
                      setDetecting(true);
                      void onDetectBpm()
                        .then((v) => v && setBpm(String(v)))
                        .finally(() => setDetecting(false));
                    }}
                  >
                    {detecting ? "…" : "detect"}
                  </Button>
                </Flex>
              </Field>
              <Field label="Key">
                <TextField.Root
                  value={musicalKey}
                  placeholder="e.g. Am"
                  onChange={(e) => setMusicalKey(e.target.value)}
                />
              </Field>
            </Flex>
            <Field label="Genres">
              <TextField.Root
                value={genres}
                placeholder="comma separated, e.g. Baile Funk, Jersey Club"
                onChange={(e) => setGenres(e.target.value)}
              />
            </Field>
            <Text size="1" color="gray">
              Separate genres with commas. Tags get normalized, so "ukgarage" and "UK Garage" end up
              the same one — but anything you type by hand is kept as-is.
            </Text>
          </Flex>

          <Separator size="4" my="4" />

          {/* Facts about the file itself, which editing can't change. */}
          <Flex direction="column" gap="1">
            <Flex gap="2" align="start">
              <Text size="1" color="gray" style={{ minWidth: 70 }}>
                DJ
              </Text>
              <Flex direction="column">
                <Text size="1">{track.djDisplay}</Text>
                {/* The kerb is the stable identity behind the display name. */}
                {track.djDisplay !== track.dj && (
                  <Text size="1" color="gray" style={{ opacity: 0.7 }}>
                    {track.dj}
                  </Text>
                )}
              </Flex>
            </Flex>
            <ReadOnly label="Uploaded" value={`${formatTimestamp(track.uploadedAt)} (${getRelativeTime(track.uploadedAt)})`} />
            <ReadOnly label="Quality" value={QUALITY_LABEL[track.quality] + (track.bitrateKbps ? ` · ${track.bitrateKbps} kbps` : "")} />
            <ReadOnly label="Format" value={`${track.ext.toUpperCase()} · ${formatDuration(track.durationSec)} · ${formatSize(track.sizeBytes)}`} />
            <ReadOnly label="File" value={track.filename} />
            {track.cueSource && (
              <ReadOnly
                label="Cues"
                value={`${track.hotCues?.length ?? 0} hot, ${track.memoryCues?.length ?? 0} memory (${track.cueSource})`}
              />
            )}
            {track.sourceUrl && <ReadOnly label="Source" value={track.sourceUrl} />}
          </Flex>

          <Flex justify="end" gap="2" mt="4">
            <Dialog.Close>
              <Button size="1" variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Dialog.Close>
              <Button size="1" onClick={save}>
                Save
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    );
  },
);

const Field = memo(({ label, children }: { label: string; children: React.ReactNode }) => (
  <Flex direction="column" gap="1" style={{ flex: "1 1 auto" }}>
    <Text size="1" color="gray">
      {label}
    </Text>
    {children}
  </Flex>
));

const ReadOnly = memo(({ label, value }: { label: string; value: string }) => (
  <Flex gap="2" align="start">
    <Text size="1" color="gray" style={{ minWidth: 70 }}>
      {label}
    </Text>
    <Text size="1" style={{ wordBreak: "break-all" }}>
      {value}
    </Text>
  </Flex>
));

type PlaylistRow = Doc<"djPlaylists"> & {
  trackCount: number;
  createdByName: string;
  createdByColor: string | null;
  contributors: { kerb: string; name: string; color: string | null }[];
};

/** Drop the current selection into an existing playlist. */
const AddToPlaylistButton = memo(
  ({
    playlists,
    count,
    onAdd,
  }: {
    playlists: PlaylistRow[];
    count: number;
    onAdd: (playlistId: Id<"djPlaylists">) => void;
  }) => (
    <Dialog.Root>
      <Dialog.Trigger>
        <Button size="1" radius="full" variant="surface" disabled={count === 0}>
          Add to playlist
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="380px">
        <Dialog.Title>Add {count} track{count === 1 ? "" : "s"}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Tracks already in the playlist are skipped.
        </Dialog.Description>

        {playlists.length === 0 ? (
          <Text size="2" color="gray">
            No playlists yet — make one in the sidebar first.
          </Text>
        ) : (
          <Flex direction="column" gap="1">
            {playlists.map((p) => (
              <Dialog.Close key={p._id}>
                <Button
                  size="1"
                  variant="surface"
                  onClick={() => onAdd(p._id)}
                  style={{ justifyContent: "space-between" }}
                >
                  {p.name}
                  <Text size="1" color="gray">
                    {p.trackCount}
                  </Text>
                </Button>
              </Dialog.Close>
            ))}
          </Flex>
        )}

        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button size="1" variant="soft" color="gray">
              Cancel
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  ),
);

/**
 * Shows what a duplicate merge would do, then runs it. Admin-only, since
 * merging deletes the losing copies and their audio.
 */
const DuplicatesDialog = memo(() => {
  const groups = useQuery(api.djs.findDuplicates);
  const merge = useMutation(api.djs.mergeDuplicates);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toRemove = (groups ?? []).reduce((n, g) => n + g.drop.length, 0);

  return (
    <Dialog.Root onOpenChange={(open) => open && setResult(null)}>
      <Dialog.Trigger>
        <Button size="1" radius="full" variant="surface">
          Duplicates{toRemove > 0 ? ` (${toRemove})` : ""}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="620px">
        <Dialog.Title>Duplicate tracks</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          The same recording ingested more than once — matched on identical length and title, so
          edits and remixes stay separate.
        </Dialog.Description>

        {groups === undefined ? (
          <Text size="2" color="gray">
            Checking…
          </Text>
        ) : groups.length === 0 ? (
          <Text size="2" color="gray">
            No duplicates found.
          </Text>
        ) : (
          <>
            <Text size="2" mb="2" as="p">
              <Text weight="bold">{groups.length}</Text> groups, removing{" "}
              <Text weight="bold">{toRemove}</Text> copies. The best quality copy of each is kept.
            </Text>

            <Flex
              direction="column"
              gap="2"
              style={{ maxHeight: 280, overflowY: "auto" }}
              pr="2"
            >
              {groups.slice(0, 40).map((g, i) => (
                <Flex key={i} direction="column" style={{ borderBottom: "1px solid var(--gray-4)" }} pb="1">
                  <Text size="1" truncate>
                    <Text weight="bold">keep</Text> {g.keep.title} —{" "}
                    <Text color="green">{QUALITY_LABEL[g.keep.quality as Quality]}</Text>
                  </Text>
                  {g.drop.map((d, j) => (
                    <Text key={j} size="1" color="gray" truncate style={{ opacity: 0.75 }}>
                      drop {d.title} — {QUALITY_LABEL[d.quality as Quality]}
                    </Text>
                  ))}
                </Flex>
              ))}
              {groups.length > 40 && (
                <Text size="1" color="gray">
                  …and {groups.length - 40} more
                </Text>
              )}
            </Flex>

            <Text size="1" color="gray" mt="3" as="p">
              Genres from every copy are merged onto the one kept, and cues, BPM, key and cover art
              are inherited where it's missing them. Playlist entries are re-pointed, so nothing
              drops out of a playlist.
            </Text>
          </>
        )}

        {result && (
          <Text size="2" mt="3" as="p">
            {result}
          </Text>
        )}

        <Flex justify="end" gap="2" mt="4">
          <Dialog.Close>
            <Button size="1" variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
          {(groups?.length ?? 0) > 0 && (
            <Button
              size="1"
              color="red"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void merge({})
                  .then((r) => setResult(`Merged ${r.merged} groups, removed ${r.removed} copies.`))
                  .catch(() => setResult("Couldn't merge — admin only."))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "merging…" : `Merge ${toRemove}`}
            </Button>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
});

/** Rename a playlist, change its blurb, or remove it. */
const PlaylistSettingsDialog = memo(
  ({
    playlist,
    onSave,
    onDelete,
  }: {
    playlist: PlaylistRow;
    onSave: (name: string, description: string) => void;
    onDelete: () => void;
  }) => {
    const [name, setName] = useState(playlist.name);
    const [description, setDescription] = useState(playlist.description ?? "");

    return (
      <Dialog.Root
        onOpenChange={(open) => {
          if (open) {
            setName(playlist.name);
            setDescription(playlist.description ?? "");
          }
        }}
      >
        <Dialog.Trigger>
          <Button size="1" radius="full" variant="surface">
            Playlist
          </Button>
        </Dialog.Trigger>
        <Dialog.Content maxWidth="440px">
          <Dialog.Title>Playlist settings</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="4">
            Deleting a playlist only removes the grouping — the tracks stay in the library.
          </Dialog.Description>

          <Flex direction="column" gap="2">
            <TextField.Root
              placeholder="name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField.Root
              placeholder="short description"
              value={description}
              maxLength={140}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Flex>

          <Flex justify="between" mt="4" gap="2">
            <Dialog.Close>
              <Button size="1" variant="soft" color="red" onClick={onDelete}>
                Delete playlist
              </Button>
            </Dialog.Close>
            <Flex gap="2">
              <Dialog.Close>
                <Button size="1" variant="soft" color="gray">
                  Cancel
                </Button>
              </Dialog.Close>
              <Dialog.Close>
                <Button size="1" disabled={!name.trim()} onClick={() => onSave(name.trim(), description.trim())}>
                  Save
                </Button>
              </Dialog.Close>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    );
  },
);

/**
 * Left-hand nav: the whole library, then every shared playlist, then who you
 * are. Mirrors how a DJ app lays out a collection.
 */
const PlaylistSidebar = memo(
  ({
    playlists,
    activeId,
    libraryCount,
    onSelect,
    onCreate,
    onDropTracks,
  }: {
    playlists: PlaylistRow[] | undefined;
    activeId: Id<"djPlaylists"> | null;
    libraryCount: number;
    onSelect: (id: Id<"djPlaylists"> | null) => void;
    onCreate: (name: string, description: string) => void;
    onDropTracks: (playlistId: Id<"djPlaylists">, trackIds: Id<"djTracks">[]) => void;
  }) => {
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [dropTarget, setDropTarget] = useState<Id<"djPlaylists"> | null>(null);

    const Row = ({
      label,
      byline,
      bylineColor,
      count,
      active,
      onClick,
      dropId,
    }: {
      label: string;
      /** Creator credit, tinted with their DJ colour. */
      byline?: string;
      bylineColor?: BadgeColor;
      count: number;
      active: boolean;
      onClick: () => void;
      /** Set to make this row accept tracks dragged from the list. */
      dropId?: Id<"djPlaylists">;
    }) => (
      <Flex
        justify="between"
        align="center"
        gap="2"
        px="2"
        py="1"
        onClick={onClick}
        onDragOver={
          dropId
            ? (e) => {
                if (!e.dataTransfer.types.includes(DRAG_TRACKS)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setDropTarget(dropId);
              }
            : undefined
        }
        onDragLeave={dropId ? () => setDropTarget(null) : undefined}
        onDrop={
          dropId
            ? (e) => {
                e.preventDefault();
                setDropTarget(null);
                const raw = e.dataTransfer.getData(DRAG_TRACKS);
                if (!raw) return;
                try {
                  const ids = JSON.parse(raw) as Id<"djTracks">[];
                  if (Array.isArray(ids) && ids.length > 0) onDropTracks(dropId, ids);
                } catch {
                  // A drag from somewhere else; nothing to do.
                }
              }
            : undefined
        }
        style={{
          cursor: "pointer",
          borderRadius: "var(--radius-2)",
          backgroundColor:
            dropId && dropTarget === dropId
              ? "var(--accent-6)"
              : active
                ? "var(--accent-4)"
                : undefined,
          outline: dropId && dropTarget === dropId ? "1px dashed var(--accent-9)" : undefined,
        }}
      >
        <Text size="2" truncate color={active ? undefined : "gray"} weight={active ? "bold" : "regular"}>
          {label}
          {byline && (
            <Text size="1" color={bylineColor ?? "gray"} style={{ opacity: 0.9 }}>
              {" — "}
              {byline}
            </Text>
          )}
        </Text>
        <Text size="1" color="gray" style={{ opacity: 0.7 }}>
          {count}
        </Text>
      </Flex>
    );

    return (
      <Flex
        direction="column"
        gap="1"
        p="3"
        style={{
          width: 240,
          flex: "0 0 240px",
          borderRight: "1px solid var(--gray-3)",
          overflowY: "auto",
        }}
      >
        <Row
          label="Library"
          count={libraryCount}
          active={activeId === null}
          onClick={() => onSelect(null)}
        />

        <Text size="1" color="gray" mt="3" mb="1" style={{ opacity: 0.6 }}>
          PLAYLISTS
        </Text>

        {playlists === undefined ? (
          <Text size="1" color="gray">
            Loading…
          </Text>
        ) : playlists.length === 0 ? (
          <Text size="1" color="gray" style={{ opacity: 0.6 }}>
            none yet
          </Text>
        ) : (
          playlists.map((p) => (
            <Row
              key={p._id}
              label={p.name}
              byline={p.createdByName}
              bylineColor={asBadgeColor(p.createdByColor)}
              count={p.trackCount}
              active={activeId === p._id}
              onClick={() => onSelect(p._id)}
              dropId={p._id}
            />
          ))
        )}

        {creating ? (
          <Flex direction="column" gap="1" mt="2">
            <TextField.Root
              size="1"
              autoFocus
              placeholder="name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField.Root
              size="1"
              placeholder="description"
              value={description}
              maxLength={140}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Flex gap="1">
              <Button
                size="1"
                disabled={!name.trim()}
                onClick={() => {
                  onCreate(name.trim(), description.trim());
                  setName("");
                  setDescription("");
                  setCreating(false);
                }}
              >
                Create
              </Button>
              <Button size="1" variant="soft" color="gray" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </Flex>
          </Flex>
        ) : (
          <Button
            size="1"
            variant="ghost"
            color="gray"
            mt="2"
            onClick={() => setCreating(true)}
            style={{ justifyContent: "flex-start" }}
          >
            + new playlist
          </Button>
        )}

        <Flex direction="column" gap="1" mt="auto" pt="3">
          <Separator size="4" />
          <Text size="1" color="gray" style={{ opacity: 0.6 }}>
            DJ SETTINGS
          </Text>
          <DjSettingsDialog />
        </Flex>
      </Flex>
    );
  },
);

/**
 * Upload dialog. Picking files is a step rather than the whole interaction,
 * so there's somewhere to say "and put these in a new playlist" before
 * anything is sent.
 */
const UploadDialog = memo(
  ({
    onRun,
    busy,
  }: {
    onRun: (files: File[], playlist: { name: string; description: string } | null) => void;
    busy: boolean;
  }) => {
    const input = useRef<HTMLInputElement | null>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [asPlaylist, setAsPlaylist] = useState(false);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");

    const ready = files.length > 0 && (!asPlaylist || name.trim().length > 0);

    return (
      <Dialog.Root
        onOpenChange={(open) => {
          if (!open) {
            setFiles([]);
            setAsPlaylist(false);
            setName("");
            setDescription("");
          }
        }}
      >
        <Dialog.Trigger>
          <Button size="1" radius="full" variant="surface">
            Upload
          </Button>
        </Dialog.Trigger>
        <Dialog.Content maxWidth="520px">
          <Dialog.Title>Upload tracks</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="4">
            Audio files from your machine. BPM is estimated on upload; genres and key you can fill
            in afterwards, or import from rekordbox to get them exactly.
          </Dialog.Description>

          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Text size="2" weight="bold">
                1. Choose files
              </Text>
              <input
                ref={input}
                type="file"
                accept="audio/*,.m4a,.mp3,.wav,.flac,.aiff,.aif"
                multiple
                hidden
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              <Button size="1" variant="surface" onClick={() => input.current?.click()}>
                {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "Choose audio files"}
              </Button>
            </Flex>

            <Flex direction="column" gap="2">
              <Text as="label" size="2">
                <Flex gap="2" align="center">
                  <Checkbox
                    checked={asPlaylist}
                    onCheckedChange={(v) => setAsPlaylist(v === true)}
                  />
                  Put these in a new playlist
                </Flex>
              </Text>

              {asPlaylist && (
                <Flex direction="column" gap="2" pl="5">
                  <TextField.Root
                    placeholder="playlist name"
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <TextField.Root
                    placeholder="short description (optional)"
                    value={description}
                    maxLength={140}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Flex>
              )}
            </Flex>

            <Dialog.Close>
              <Button
                size="1"
                disabled={!ready || busy}
                onClick={() =>
                  onRun(files, asPlaylist ? { name: name.trim(), description: description.trim() } : null)
                }
              >
                {busy ? "uploading…" : `Upload ${files.length || ""}`.trim()}
              </Button>
            </Dialog.Close>
          </Flex>

          <Flex justify="end" mt="4">
            <Dialog.Close>
              <Button size="1" variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    );
  },
);

/**
 * Import a whole rekordbox collection: the XML plus the folder the music
 * actually lives in. Anyone signed in can run this on their own library.
 */
const LibraryImportDialog = memo(
  ({ onRun, busy }: { onRun: (xml: File, audio: File[]) => void; busy: boolean }) => {
    const xmlInput = useRef<HTMLInputElement | null>(null);
    const folderInput = useRef<HTMLInputElement | null>(null);
    const [xml, setXml] = useState<File | null>(null);
    const [audio, setAudio] = useState<File[]>([]);

    const audioCount = audio.length;

    return (
      <Dialog.Root>
        <Dialog.Trigger>
          <Button size="1" radius="full" variant="surface">
            Import
          </Button>
        </Dialog.Trigger>
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>Import a rekordbox library</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="4">
            Brings in your tracks along with rekordbox's own BPM, key and cue points. A
            rekordbox.xml holds no audio, only a list of files — so pick the folder your music is
            in as well.
          </Dialog.Description>

          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Text size="2" weight="bold">
                1. Collection export
              </Text>
              <Text size="1" color="gray">
                In rekordbox: File → Export Collection in xml format.
              </Text>
              <input
                ref={xmlInput}
                type="file"
                accept=".xml,application/xml,text/xml"
                hidden
                onChange={(e) => setXml(e.target.files?.[0] ?? null)}
              />
              <Button size="1" variant="surface" onClick={() => xmlInput.current?.click()}>
                {xml ? xml.name.slice(0, 40) : "Choose rekordbox.xml"}
              </Button>
            </Flex>

            <Flex direction="column" gap="1">
              <Text size="2" weight="bold">
                2. Music folder
              </Text>
              <Text size="1" color="gray">
                The folder holding those tracks. Nothing is read until you start the import.
              </Text>
              <input
                ref={folderInput}
                type="file"
                hidden
                multiple
                // Non-standard, but supported in Chrome, Edge and Safari.
                {...{ webkitdirectory: "", directory: "" }}
                onChange={(e) => setAudio(Array.from(e.target.files ?? []))}
              />
              <Button size="1" variant="surface" onClick={() => folderInput.current?.click()}>
                {audioCount > 0 ? `${audioCount} files selected` : "Choose music folder"}
              </Button>
            </Flex>

            <Separator size="4" />

            <Button
              size="1"
              disabled={!xml || audioCount === 0 || busy}
              onClick={() => xml && onRun(xml, audio)}
            >
              {busy ? "importing…" : "Start import"}
            </Button>
            <Text size="1" color="gray">
              Tracks already in the library are skipped, so running it again only adds what's new.
              Large or unsupported files are skipped too.
            </Text>
          </Flex>

          <Flex justify="end" mt="4">
            <Dialog.Close>
              <Button size="1" variant="soft" color="gray">
                Close
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    );
  },
);

const RipDialog = memo(
  ({
    value,
    onChange,
    onSubmit,
    pending,
    busy,
  }: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    pending: Doc<"djRipRequests">[];
    busy: boolean;
  }) => (
    <Dialog.Root>
      <Dialog.Trigger>
        <Button size="1" radius="full" variant="surface">
          Rip{pending.length > 0 ? ` (${pending.length})` : ""}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Rip from SoundCloud</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Queues a playlist or track. A DJ's machine does the actual ripping and uploads the result,
          so it lands once their ripper is running.
        </Dialog.Description>

        <Text size="1" color="gray" mb="4" as="p" style={{ opacity: 0.8 }}>
          You'll get an email confirming the request was submitted, and another once the tracks are
          in the library.
        </Text>

        <Flex gap="2" align="center">
          <TextField.Root
            placeholder="https://soundcloud.com/…"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: "1 1 auto" }}
          />
          <Button size="1" onClick={onSubmit} disabled={busy || value.trim().length === 0}>
            Queue
          </Button>
        </Flex>

        {pending.length > 0 && (
          <>
            <Separator size="4" my="4" />
            <Text size="2" weight="bold">
              In the queue
            </Text>
            <Flex direction="column" gap="1" mt="2">
              {pending.map((r) => (
                <Flex key={r._id} justify="between" gap="2">
                  <Text size="1" color="gray" truncate style={{ flex: "1 1 auto" }}>
                    {r.url}
                  </Text>
                  <Badge size="1" color={r.status === "claimed" ? "orange" : "gray"} variant="soft">
                    {r.status === "claimed" ? "ripping" : "pending"}
                  </Badge>
                </Flex>
              ))}
            </Flex>
          </>
        )}

        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button size="1" variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  ),
);
