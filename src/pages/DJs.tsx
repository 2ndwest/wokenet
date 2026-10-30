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
  Progress,
  SegmentedControl,
  Select,
  Separator,
  Slider,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
  readTags,
  rejectReason,
} from "../utils/audio";
import { shrinkImage } from "../utils/image";
import {
  buildRekordboxXml,
  matchKey,
  parseRekordboxXml,
  type ParsedXml,
  type ParsedXmlPlaylist,
  type ParsedXmlTrack,
} from "../utils/rekordbox";
import { formatTimestamp, getRelativeTime } from "../utils/time";
import { buildZip, saveBlob, type ZipEntry } from "../utils/zip";
import { useAuthStatus } from "../utils/useAuthStatus";

/**
 * Upload cover art pulled out of an audio file. Returns undefined rather than
 * throwing: a track without its artwork is better than no track at all.
 */
async function uploadEmbeddedCover(
  cover: Blob | undefined,
  generateUploadUrl: () => Promise<string>,
): Promise<Id<"_storage"> | undefined> {
  if (!cover) return undefined;
  try {
    const uploadUrl = await generateUploadUrl();
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": cover.type || "image/jpeg" },
      body: cover,
    });
    if (!res.ok) return undefined;
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    return storageId;
  } catch {
    return undefined;
  }
}

/** listRipRequests numbers everything still waiting, oldest first. */
/** One of your finished rips, with its tracks narrowed to the ones still in the library. */
type FinishedRip = Doc<"djRipRequests"> & {
  trackIds: Id<"djTracks">[];
  playlistName: string | null;
};

type RipRequest = Doc<"djRipRequests"> & {
  place: number | null;
  canCancel: boolean;
  playlistName: string | null;
};

/** listTracks resolves the DJ display name and cover URL on the way out. */
type Track = Doc<"djTracks"> & {
  djDisplay: string;
  djColor: string | null;
  /** Hand-picked bubble/letter colours, which win over djColor. */
  djTag: TagStyle | null;
  coverUrl: string | null;
};

/** A DJ colour from the server, narrowed to what Radix will accept. */
type BadgeColor = React.ComponentProps<typeof Badge>["color"];
const asBadgeColor = (c: string | null | undefined): BadgeColor =>
  (c || undefined) as BadgeColor;

/** A DJ's picture, or their initial while they haven't set one. */
const DjAvatar = memo(
  ({
    url,
    size,
    label,
    onClick,
  }: {
    url: string | null;
    size: number;
    label: string;
    onClick?: () => void;
  }) => {
    const common = {
      width: size,
      height: size,
      borderRadius: "50%",
      flex: `0 0 ${size}px`,
      cursor: onClick ? "pointer" : undefined,
    } as const;

    if (url) {
      return (
        <img
          src={url}
          alt=""
          onClick={onClick}
          style={{ ...common, objectFit: "cover", border: "1px solid var(--gray-5)" }}
        />
      );
    }

    return (
      <Flex
        align="center"
        justify="center"
        onClick={onClick}
        style={{
          ...common,
          background: "var(--gray-3)",
          border: "1px dashed var(--gray-6)",
        }}
      >
        <Text size={size >= 64 ? "6" : "2"} weight="bold" color="gray">
          {(label.trim()[0] ?? "?").toUpperCase()}
        </Text>
      </Flex>
    );
  },
);

/** Square cover art, or a prompt to add one. */
const Cover = memo(
  ({
    url,
    size,
    fluid,
    onClick,
  }: {
    url: string | null;
    size: number;
    /**
     * Follow the container's width instead of pinning to `size`, which is then
     * only the hint for how much detail fits. Lets the player's artwork track
     * a resize without React re-rendering a page of track rows per frame.
     */
    fluid?: boolean;
    onClick?: () => void;
  }) => {
    const common = (
      fluid
        ? { width: "100%", aspectRatio: "1 / 1", flex: "0 0 auto" }
        : { width: size, height: size, flex: `0 0 ${size}px` }
    ) as CSSProperties;
    Object.assign(common, {
      borderRadius: "var(--radius-2)",
      cursor: onClick ? "pointer" : undefined,
    });

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
    style,
    children,
  }: {
    /** Omit to follow the theme accent rather than pinning a colour. */
    color?: React.ComponentProps<typeof Badge>["color"];
    variant: React.ComponentProps<typeof Badge>["variant"];
    style?: React.CSSProperties;
    children: React.ReactNode;
  }) => (
    <Badge
      color={color}
      variant={variant}
      style={{ fontSize: "12px", padding: "3px 9px", ...style }}
    >
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

/**
 * House tags that get to shout. Fixed colours rather than theme tokens, so
 * they look the same whichever theme you're on.
 */
export type TagStyle = {
  bg: string;
  fg: string;
  glow: boolean;
  /** House tags only: shown in capitals. A tag someone colours keeps its own case. */
  shout?: boolean;
};

const BUILTIN_LOUD_TAGS: { test: RegExp; style: TagStyle }[] = [
  // Greek letters or their names, as well as the house name itself.
  { test: /putz|[πτζ]|\b(pi|tau|zeta)\b/i, style: { bg: "#FF6A00", fg: "#1A1A1A", glow: true, shout: true } },
  // \b41w?\b so it matches "41" and "41W" as words, not any stray 41.
  { test: /\b41w?\b/i, style: { bg: "#9B4DE0", fg: "#000000", glow: true, shout: true } },
  { test: /florey|krotus/i, style: { bg: "#E5342E", fg: "#000000", glow: true, shout: true } },
  { test: /tetazoo|squanch/i, style: { bg: "#3DD400", fg: "#FFFFFF", glow: true, shout: true } },
];

/** A tag's own styling wins; otherwise fall back to the house rules. */
export function resolveTagStyle(
  genre: string,
  custom: Map<string, TagStyle>,
): TagStyle | undefined {
  const house = BUILTIN_LOUD_TAGS.find((t) => t.test.test(genre))?.style;
  const own = custom.get(genre);
  // A recoloured house tag still shouts.
  if (own) return house ? { ...own, shout: true } : own;
  return house;
}

const hexToRgb = (hex: string): string => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : "255, 255, 255";
};

const loudTagStyle = (t: TagStyle): React.CSSProperties => ({
  fontSize: "12px",
  padding: "3px 9px",
  backgroundColor: t.bg,
  color: t.fg,
  fontWeight: 800,
  letterSpacing: "0.4px",
  textTransform: t.shout ? "uppercase" : undefined,
  boxShadow: t.glow ? `0 0 10px rgba(${hexToRgb(t.bg)}, 0.75)` : undefined,
});

/** A DJ's name as coloured text: plain lettering in their bubble colour, no glow. */
const djTextStyle = (tag: TagStyle | null): React.CSSProperties | undefined =>
  tag ? { color: tag.bg } : undefined;

/** A DJ's own colours as inline style, or nothing if they use an accent. */
const djTagStyle = (tag: TagStyle | null): React.CSSProperties =>
  tag
    ? {
        backgroundColor: tag.bg,
        color: tag.fg,
        boxShadow: tag.glow ? `0 0 10px rgba(${hexToRgb(tag.bg)}, 0.75)` : undefined,
      }
    : {};

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
    loud,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    /** Overrides the default tint, so a DJ's chip matches their tag. */
    color?: BadgeColor;
    /** Rendered lighter after the label, so the name reads first. */
    count?: number;
    /** A tag's own colours, which beat both of the above. */
    loud?: TagStyle;
    children: React.ReactNode;
  }) => (
    <Button
      size="1"
      radius="full"
      variant={active ? "solid" : "surface"}
      // Unset follows the theme accent; a DJ colour wins when there is one.
      color={color ?? (active ? undefined : "gray")}
      onClick={onClick}
      style={{
        height: "24px",
        // Nothing left under this chip with the current filters: still
        // clickable, just quieter.
        opacity: count === 0 && !active ? 0.4 : undefined,
        ...(loud && {
          backgroundColor: loud.bg,
          color: loud.fg,
          fontWeight: 800,
          // Its own colours don't change when selected, so it glows instead.
          boxShadow: active ? `0 0 10px rgba(${hexToRgb(loud.bg)}, 0.75)` : undefined,
        }),
      }}
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

/** Phone-sized screens, where the sidebar folds away and rows stack. Matches index.css. */
const NARROW_QUERY = "(max-width: 767px)";

/** Tracks a media query, so layout that CSS can't reach can follow the screen size. */
const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
};

/** Drag payload: the track ids being dropped onto a playlist. */
const DRAG_TRACKS = "application/x-wokenet-tracks";
/** A playlist dragged within the sidebar to reorder it. */
const DRAG_PLAYLIST = "application/x-wokenet-playlist";

/** How many genre chips fit on one line before we collapse the rest. */
/** Corner player widths, cycled by clicking its artwork. */
const PLAYER_SIZES = ["small", "normal", "large"] as const;
type PlayerSize = (typeof PLAYER_SIZES)[number];
/** Kept narrow at every step: the player is a corner card, not a sidebar. */
const PLAYER_WIDTH: Record<PlayerSize, number> = { small: 200, normal: 250, large: 300 };

/** The card's margin from the window edge, and from the track rows. */
const PLAYER_GAP = 16;
const PLAYER_SIZE_KEY = "wokenet.djs.playerSize";

const loadPlayerSize = (): PlayerSize => {
  try {
    const saved = localStorage.getItem(PLAYER_SIZE_KEY);
    if (saved && (PLAYER_SIZES as readonly string[]).includes(saved)) return saved as PlayerSize;
  } catch {
    // Storage can be off; the default is fine.
  }
  return "normal";
};

const COLLAPSED_FACET_COUNT = 8;

/**
 * The entries a facet shows while collapsed: the first row's worth, plus any
 * that are currently filtering, so an active chip is never hidden behind
 * "show more".
 */
/** Tags on fewer tracks than this don't get a chip in the filter bar. */
const MIN_TAG_TRACKS = 2;

const collapseFacet = <T extends [string, unknown]>(
  entries: T[],
  active: Set<string>,
  showAll: boolean,
): T[] => {
  if (showAll || entries.length <= COLLAPSED_FACET_COUNT) return entries;
  const head = entries.slice(0, COLLAPSED_FACET_COUNT);
  const activeTail = entries.slice(COLLAPSED_FACET_COUNT).filter(([key]) => active.has(key));
  return [...head, ...activeTail];
};

/** The expand / collapse pair at the end of a long facet row. */
const ShowMore = memo(
  ({
    hidden,
    expanded,
    onToggle,
  }: {
    hidden: number;
    expanded: boolean;
    onToggle: (next: boolean) => void;
  }) => (
    <>
      {hidden > 0 && (
        <Button
          size="1"
          radius="full"
          variant="ghost"
          color="gray"
          onClick={() => onToggle(true)}
          style={{ height: "22px" }}
        >
          show {hidden} more
        </Button>
      )}
      {expanded && (
        <Button
          size="1"
          radius="full"
          variant="ghost"
          color="gray"
          onClick={() => onToggle(false)}
          style={{ height: "22px" }}
        >
          show less
        </Button>
      )}
    </>
  ),
);

/** The filter rows, so one can be left out when counting its own chips. */
type Facet = "tags" | "dj" | "quality" | "bpm" | "cues";

type SortMode = "alphabetical" | "added" | "popular" | "bpm" | "key" | "quality" | "dj" | "genre";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortMode, string> = {
  alphabetical: "Alphabetical",
  added: "Date added",
  popular: "Popularity",
  bpm: "BPM",
  key: "Key",
  quality: "Quality",
  dj: "DJ",
  genre: "Tags",
};

/** What each direction means per mode, so the label isn't just asc/desc. */
const DIRECTION_LABELS: Record<SortMode, { asc: string; desc: string }> = {
  alphabetical: { asc: "A–Z", desc: "Z–A" },
  added: { asc: "Oldest", desc: "Newest" },
  popular: { asc: "Least downloaded", desc: "Most downloaded" },
  bpm: { asc: "Slowest", desc: "Fastest" },
  key: { asc: "1A–12B", desc: "12B–1A" },
  quality: { asc: "Best first", desc: "Worst first" },
  dj: { asc: "A–Z", desc: "Z–A" },
  genre: { asc: "A–Z", desc: "Z–A" },
};

/** Newest-first and most-downloaded-first are the useful defaults; everything else reads up. */
const DEFAULT_DIRECTION: Record<SortMode, SortDir> = {
  alphabetical: "asc",
  added: "desc",
  popular: "desc",
  bpm: "asc",
  key: "asc",
  quality: "asc",
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
      case "popular":
        // Most tracks tie (at 0 early on), and the list gets reversed for
        // most-downloaded-first; flip the title tiebreak so ties still read A–Z.
        return (
          (a.downloadCount ?? 0) - (b.downloadCount ?? 0) ||
          (dir === "desc" ? -byTitle(a, b) : byTitle(a, b))
        );
      case "bpm":
        return (a.bpm ?? 0) - (b.bpm ?? 0) || byTitle(a, b);
      case "key":
        return camelotOrder(a.musicalKey) - camelotOrder(b.musicalKey) || byTitle(a, b);
      case "quality":
        // "Ascending" is best first: QUALITY_ORDER runs best to worst, and
        // within a tier the higher bitrate wins.
        return (
          QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality) ||
          (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0) ||
          byTitle(a, b)
        );
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
  /** Same as the server's kerbOf, to tell which playlists are this DJ's own. */
  const myKerb = user?.email?.split("@")[0].split("+")[0].toLowerCase() ?? null;

  const tracks = useQuery(api.djs.listTracks);
  const ripRequests = useQuery(api.djs.listRipRequests);
  const myRecentRips = useQuery(api.djs.myRecentRips);
  const playlists = useQuery(api.djs.listPlaylists);
  const tagStyles = useQuery(api.djs.listTagStyles);

  /** Custom tag colours, keyed by tag, overriding the built-in house rules. */
  const customTagStyles = useMemo(() => {
    const m = new Map<string, TagStyle>();
    for (const s of tagStyles ?? []) {
      m.set(s.tag, {
        bg: s.bg ?? "#2A2A2E",
        fg: s.fg ?? "#EDEDEF",
        glow: !!s.glow,
      });
    }
    return m;
  }, [tagStyles]);

  const tagStyleFor = useCallback(
    (genre: string) => resolveTagStyle(genre, customTagStyles),
    [customTagStyles],
  );

  /**
   * Dialogs a tag on a row opens. Held here rather than inside each row so a
   * few hundred rows share one of each.
   */
  const [tagEditing, setTagEditing] = useState<string | null>(null);
  const [profileKerb, setProfileKerb] = useState<string | null>(null);

  /** null = the whole library; otherwise the playlist being viewed. */
  const [activePlaylistId, setActivePlaylistId] = useState<Id<"djPlaylists"> | null>(null);
  const playlistTrackIds = useQuery(
    api.djs.listPlaylistTrackIds,
    activePlaylistId ? { playlistId: activePlaylistId } : "skip",
  );

  const createPlaylist = useMutation(api.djs.createPlaylist);
  const addTracksToPlaylist = useMutation(api.djs.addTracksToPlaylist);
  // Reorder locally straight away, so a dropped playlist doesn't jump back
  // while the server catches up.
  const reorderPlaylists = useMutation(api.djs.reorderPlaylists).withOptimisticUpdate(
    (store, { playlistIds }) => {
      const current = store.getQuery(api.djs.listPlaylists, {});
      if (!current) return;
      const rank = new Map(playlistIds.map((id, i) => [id, i]));
      store.setQuery(
        api.djs.listPlaylists,
        {},
        [...current].sort(
          (a, b) => (rank.get(a._id) ?? Infinity) - (rank.get(b._id) ?? Infinity),
        ),
      );
    },
  );
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
  const recordDownloads = useMutation(api.djs.recordDownloads);

  // ---- filters (within a facet: OR; across facets: AND) ----
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState<Set<string>>(new Set());
  const [matchAllGenres, setMatchAllGenres] = useState(false);
  const [onlyUntagged, setOnlyUntagged] = useState(false);
  // The genre list runs to ~40 chips, which swamps the filter card. Collapse
  // it to one line until asked for more.
  const [showAllGenres, setShowAllGenres] = useState(false);
  const [showAllDjs, setShowAllDjs] = useState(false);
  const narrow = useMediaQuery(NARROW_QUERY);
  // On a phone the playlists live in a drawer rather than a column.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // The filter rows run a screen tall on a phone, so they fold behind a toggle.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [djFilter, setDjFilter] = useState<Set<string>>(new Set());
  const [qualityFilter, setQualityFilter] = useState<Set<Quality>>(new Set());
  const [bpmFilter, setBpmFilter] = useState<Set<string>>(new Set());
  const [needHotCues, setNeedHotCues] = useState(false);
  const [needMemoryCues, setNeedMemoryCues] = useState(false);

  // ---- playback ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  /** Source waiting to be given to the <audio> element (see the effect below). */
  const [pendingPlay, setPendingPlay] = useState<{ url: string } | null>(null);
  const [shuffle, setShuffle] = useState(false);
  /**
   * The order shuffle will play in, fixed when shuffle is switched on. A
   * permutation rather than a random pick each time, so the queue has a real
   * order: previous goes back where you came from, and nothing repeats until
   * the list is exhausted.
   */
  const [shuffleOrder, setShuffleOrder] = useState<Id<"djTracks">[]>([]);
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

  /**
   * Whether a track passes every active filter, optionally ignoring one facet.
   * Each facet's chip counts come from skipping that facet, so the numbers
   * answer "how many would I see if I clicked this" given everything else
   * that's selected.
   */
  const passes = useCallback(
    (t: Track, skip?: Facet) => {
      const q = search.trim().toLowerCase();
      if (q) {
        // Search both the kerb and the DJ's chosen name.
        const haystack =
          `${t.title} ${t.artist ?? ""} ${t.dj} ${t.djDisplay} ${t.genres.join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (skip !== "tags") {
        if (onlyUntagged && t.genres.length > 0) return false;
        if (genreFilter.size > 0) {
          const hits = [...genreFilter].filter((g) => t.genres.includes(g));
          if (matchAllGenres ? hits.length !== genreFilter.size : hits.length === 0) return false;
        }
      }
      if (skip !== "dj" && djFilter.size > 0 && !djFilter.has(t.dj)) return false;
      if (skip !== "quality" && qualityFilter.size > 0 && !qualityFilter.has(t.quality)) return false;
      if (skip !== "bpm" && bpmFilter.size > 0) {
        const bucket = bucketForBpm(t.bpm);
        if (!bucket || !bpmFilter.has(bucket)) return false;
      }
      if (skip !== "cues") {
        if (needHotCues && !(t.hotCues && t.hotCues.length > 0)) return false;
        if (needMemoryCues && !(t.memoryCues && t.memoryCues.length > 0)) return false;
      }
      return true;
    },
    [
      search,
      genreFilter,
      matchAllGenres,
      onlyUntagged,
      djFilter,
      qualityFilter,
      bpmFilter,
      needHotCues,
      needMemoryCues,
    ],
  );

  const filtered = useMemo(() => scoped.filter((t) => passes(t)), [scoped, passes]);

  /** The tracks each facet counts over: everything the other facets let through. */
  const facetPool = useMemo(() => {
    const pool = (skip: Facet) => scoped.filter((t) => passes(t, skip));
    return {
      tags: pool("tags"),
      dj: pool("dj"),
      quality: pool("quality"),
      bpm: pool("bpm"),
      cues: pool("cues"),
    };
  }, [scoped, passes]);

  /**
   * Tag counts. With "match all" on, ticking another tag narrows rather than
   * widens, so each count is what you'd get with that tag added to the ones
   * already ticked.
   */
  const genreCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const pool =
      matchAllGenres && genreFilter.size > 0
        ? facetPool.tags.filter((t) => [...genreFilter].every((g) => t.genres.includes(g)))
        : facetPool.tags;
    for (const t of pool) {
      for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return counts;
  }, [facetPool, matchAllGenres, genreFilter]);

  const allGenres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of scoped) {
      for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    // Alphabetical, so a given genre is always in the same place. localeCompare
    // keeps accented names (Guarachatón) next to their unaccented neighbours.
    // A one-off tag isn't worth a chip, unless it's selected and needs unticking.
    // Which chips exist is decided by the whole scope, so they don't jump
    // around as filters change; the number on each follows the filters.
    return [...counts.entries()]
      .filter(([g, n]) => n >= MIN_TAG_TRACKS || genreFilter.has(g))
      .map(([g]) => [g, genreCounts.get(g) ?? 0] as [string, number])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [scoped, genreFilter, genreCounts]);

  const visibleGenres = useMemo(
    () => collapseFacet(allGenres, genreFilter, showAllGenres),
    [allGenres, genreFilter, showAllGenres],
  );
  const hiddenGenreCount = allGenres.length - visibleGenres.length;

  // Keyed by kerb (stable identity), labelled with the DJ's chosen name.
  const allDjs = useMemo(() => {
    const byKerb = new Map<
      string,
      { label: string; count: number; color: string | null; tag: Track["djTag"] }
    >();
    for (const t of scoped) {
      const entry = byKerb.get(t.dj);
      if (!entry) byKerb.set(t.dj, { label: t.djDisplay, count: 0, color: t.djColor, tag: t.djTag });
    }
    for (const t of facetPool.dj) byKerb.get(t.dj)!.count += 1;
    return [...byKerb.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  }, [scoped, facetPool]);

  const visibleDjs = useMemo(
    () => collapseFacet(allDjs, djFilter, showAllDjs),
    [allDjs, djFilter, showAllDjs],
  );

  const djLabel = useCallback(
    (kerb: string) => allDjs.find(([k]) => k === kerb)?.[1].label ?? kerb,
    [allDjs],
  );

  const availableQualities = useMemo(() => {
    const present = new Set(scoped.map((t) => t.quality));
    const counts = new Map<Quality, number>();
    for (const t of facetPool.quality) counts.set(t.quality, (counts.get(t.quality) ?? 0) + 1);
    return QUALITY_ORDER.filter((q) => present.has(q)).map(
      (q) => [q, counts.get(q) ?? 0] as const,
    );
  }, [scoped, facetPool]);

  /** Whether any track in scope has each kind of cue, so the chip exists at all. */
  const cuesPresent = useMemo(
    () => ({
      hot: scoped.some((t) => (t.hotCues?.length ?? 0) > 0),
      memory: scoped.some((t) => (t.memoryCues?.length ?? 0) > 0),
    }),
    [scoped],
  );

  /** Filtering decides what's shown; this decides the order it's shown in. */
  const ordered = useMemo(
    () => sortTracks(filtered, sortBy, sortDir),
    [filtered, sortBy, sortDir],
  );

  /** Only show BPM buckets that something actually falls into. */
  const availableBpmBuckets = useMemo(() => {
    const present = new Set(scoped.map((t) => bucketForBpm(t.bpm)));
    const counts = new Map<string, number>();
    for (const t of facetPool.bpm) {
      const b = bucketForBpm(t.bpm);
      if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return BPM_BUCKETS.filter((b) => present.has(b.label)).map(
      (b) => [b.label, counts.get(b.label) ?? 0] as const,
    );
  }, [scoped, facetPool]);

  const hasUntagged = useMemo(() => scoped.some((t) => t.genres.length === 0), [scoped]);
  const untaggedCount = useMemo(
    () => facetPool.tags.filter((t) => t.genres.length === 0).length,
    [facetPool],
  );

  const cueCounts = useMemo(
    () => ({
      hot: facetPool.cues.filter((t) => (t.hotCues?.length ?? 0) > 0).length,
      memory: facetPool.cues.filter((t) => (t.memoryCues?.length ?? 0) > 0).length,
    }),
    [facetPool],
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
      // A fresh object every time, so picking the same track again still
      // re-runs the effect below.
      setPendingPlay({ url });
    },
    [convex],
  );

  /**
   * Hand the new source to the <audio> element once React has put it on the
   * page.
   *
   * The player card -- and the element with it -- only exists while something
   * is playing, so on the first play of a session there is nothing to point a
   * ref at yet. Doing this in an effect means it runs after that commit;
   * doing it straight after setNowPlaying quietly did nothing, which is why
   * the first track you picked never started.
   */
  useEffect(() => {
    if (!pendingPlay) return;
    const el = audioRef.current;
    if (!el) return;
    el.src = pendingPlay.url;
    void el.play();
  }, [pendingPlay]);

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
      if (shuffle && shuffleOrder.length > 0) {
        // Walk the shuffled queue, skipping anything filtered out since.
        const visible = new Set(ordered.map((t) => t._id));
        const queue = shuffleOrder.filter((id) => visible.has(id));
        const i = queue.indexOf(nowPlaying._id);
        const nextId = i >= 0 ? queue[i + direction] : queue[0];
        next = ordered.find((t) => t._id === nextId);
      } else {
        const i = ordered.findIndex((t) => t._id === nowPlaying._id);
        next = i >= 0 ? ordered[i + direction] : undefined;
      }

      if (!next) return;
      void playTrack(next);
    },
    [ordered, nowPlaying, playTrack, shuffle, shuffleOrder],
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

  /**
   * How big the corner player is. A fixed set of sizes rather than a drag:
   * tracking a pointer meant re-rendering a page of track rows per frame,
   * which made the whole thing crawl.
   */
  const [playerSize, setPlayerSize] = useState<PlayerSize>(loadPlayerSize);
  const cyclePlayerSize = useCallback(() => {
    setPlayerSize((current) => {
      const next = PLAYER_SIZES[(PLAYER_SIZES.indexOf(current) + 1) % PLAYER_SIZES.length];
      try {
        localStorage.setItem(PLAYER_SIZE_KEY, next);
      } catch {
        // Private window or site data off: it just won't be remembered.
      }
      return next;
    });
  }, []);

  /**
   * What Play starts from: the first track of the shuffled queue while shuffle
   * is on, otherwise the first one on screen. Without this, hitting shuffle
   * and then play always opened on the same song.
   */
  const firstUp = useMemo(() => {
    if (shuffle && shuffleOrder.length > 0) {
      const onScreen = new Map(ordered.map((t) => [t._id, t]));
      for (const id of shuffleOrder) {
        const t = onScreen.get(id);
        if (t) return t;
      }
    }
    return ordered[0];
  }, [shuffle, shuffleOrder, ordered]);

  /**
   * Drop the player when the track it's holding is deleted. Anyone can delete,
   * so the row can disappear from under whoever is listening to it -- and its
   * stored audio goes with it, leaving a card that can't play anything.
   */
  useEffect(() => {
    if (!nowPlaying || tracks === undefined) return;
    if (!tracks.some((t) => t._id === nowPlaying._id)) setNowPlaying(null);
  }, [tracks, nowPlaying]);

  /** Whether what's loaded is one of the tracks currently on screen. */
  const playingHere = useMemo(
    () => nowPlaying !== null && ordered.some((t) => t._id === nowPlaying._id),
    [nowPlaying, ordered],
  );

  /** Pause or resume without changing what's loaded. */
  const togglePlayback = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  /**
   * Switch shuffle on or off. Turning it on fixes a fresh queue order over
   * whatever is currently on screen; it never interrupts what's playing, it
   * only changes what comes next.
   */
  const toggleShuffle = useCallback(() => {
    if (shuffle) {
      setShuffle(false);
      return;
    }
    const ids = ordered.map((t) => t._id);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setShuffleOrder(ids);
    setShuffle(true);
  }, [ordered, shuffle]);

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
        // A miscount isn't worth failing a download over.
        void recordDownloads({ trackIds: [track._id] }).catch(() => {});
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Couldn't download that track.");
      } finally {
        setBusy(null);
      }
    },
    [convex, recordDownloads],
  );

  /**
   * File tracks into the playlist an upload or import asked for, making it
   * first if it's new. Returns the line for the notice.
   */
  const fileIntoPlaylist = useCallback(
    async (playlist: PlaylistTarget, trackIds: Id<"djTracks">[]) => {
      setBusy(playlist.kind === "new" ? `creating playlist "${playlist.name}"` : "adding to playlist");
      try {
        const playlistId =
          playlist.kind === "new"
            ? await createPlaylist({
                name: playlist.name,
                description: playlist.description || undefined,
              })
            : playlist.playlistId;
        await addTracksToPlaylist({ playlistId, trackIds });
        setActivePlaylistId(playlistId);
        return "Added to the playlist.";
      } catch {
        return "Couldn't add them to the playlist.";
      }
    },
    [addTracksToPlaylist, createPlaylist],
  );

  /**
   * Import a whole rekordbox collection from the browser.
   *
   * The XML is only a catalogue, so the DJ also picks the folder their music
   * lives in; entries are matched to real files by name. Everything rekordbox
   * analysed -- tempo, key, cue points -- rides along, so imported tracks are
   * accurate rather than estimated.
   *
   * With a playlist chosen, everything matched goes in -- tracks already in the
   * library as well as new ones -- in the export's order.
   *
   * The export's own playlists can come over too, each as a playlist here with
   * the same name. One this DJ already made under that name is added to rather
   * than duplicated, so re-running an import only tops them up.
   */
  const importLibrary = useCallback(
    async (
      xml: ParsedXml,
      audioFiles: File[],
      playlist: PlaylistTarget | null,
      rb: { playlists: ParsedXmlPlaylist[]; onlyTheirTracks: boolean },
    ) => {
      setNotice(null);
      setBusy("matching files");
      try {
        // Only what's in the chosen rekordbox playlists, if that's what was asked.
        const wanted = rb.onlyTheirTracks ? new Set(rb.playlists.flatMap((p) => p.entries)) : null;
        const parsed = xml.tracks.filter((_, i) => !wanted || wanted.has(i));

        const byName = new Map<string, File>();
        for (const f of audioFiles) byName.set(matchKey(f.name), f);

        const library = tracks ?? [];
        const byLibName = new Map(library.map((t) => [matchKey(t.filename), t]));
        const byLibTitle = new Map(library.map((t) => [matchKey(t.title), t]));

        // Split into tracks we need to upload and tracks we already hold,
        // which only need rekordbox's analysis attaching.
        const queue: { entry: ParsedXmlTrack; file: File }[] = [];
        const attach: {
          trackId: Id<"djTracks">;
          hotCues: ParsedXmlTrack["hotCues"];
          memoryCues: ParsedXmlTrack["memoryCues"];
          bpm?: number;
          musicalKey?: string;
        }[] = [];
        // The library track each export entry ended up as, for the playlist.
        const landed = new Map<ParsedXmlTrack, Id<"djTracks">>();

        for (const entry of parsed) {
          const key = matchKey(entry.filename);
          const existing = byLibName.get(key) ?? byLibTitle.get(matchKey(entry.title));
          if (existing) {
            landed.set(entry, existing._id);
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

        if (queue.length === 0 && landed.size === 0) {
          setNotice(
            `Matched nothing — ${parsed.length} tracks in that export, ` +
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
            // Rekordbox's export has no artwork, so the file's own tags are the only source.
            const tags = await readTags(file);
            const coverId = await uploadEmbeddedCover(tags.cover, generateUploadUrl);

            const uploadUrl = await generateUploadUrl();
            const res = await fetch(uploadUrl, {
              method: "POST",
              headers: { "Content-Type": file.type || "application/octet-stream" },
              body: file,
            });
            if (!res.ok) throw new Error(`upload failed (${res.status})`);
            const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };

            const hasCues = entry.hotCues.length > 0 || entry.memoryCues.length > 0;
            const trackId = await addTrack({
              storageId,
              title: entry.title || tags.title || file.name.replace(/\.[^.]+$/, ""),
              artist: entry.artist || tags.artist,
              rawGenres: tags.genres,
              coverId,
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
            landed.set(entry, trackId);
          } catch {
            failed += 1;
          }
        }

        const summary =
          queue.length > 0
            ? [`Imported ${done - failed} of ${queue.length} new tracks`]
            : ["Nothing new to upload"];
        if (attach.length > 0) summary.push(`updated ${attach.length} you already had`);
        if (failed > 0) summary.push(`${failed} failed`);
        let notice = summary.join(", ") + ".";

        const trackIds = parsed.flatMap((e) => landed.get(e) ?? []);
        if (playlist && trackIds.length > 0) {
          notice += " " + (await fileIntoPlaylist(playlist, trackIds));
        }

        if (rb.playlists.length > 0) {
          const mine = new Map(
            (playlists ?? [])
              .filter((p) => p.createdBy === myKerb)
              .map((p) => [p.name.trim().toLowerCase(), p._id]),
          );
          let made = 0;
          let toppedUp = 0;
          let failedLists = 0;
          for (const [n, p] of rb.playlists.entries()) {
            const ids = p.entries.flatMap((i) => landed.get(xml.tracks[i]) ?? []);
            if (ids.length === 0) continue;
            setBusy(`playlist ${n + 1}/${rb.playlists.length}: ${p.name.slice(0, 40)}`);
            try {
              const name = p.name.slice(0, 60);
              let playlistId = mine.get(name.trim().toLowerCase());
              if (playlistId) toppedUp += 1;
              else {
                playlistId = await createPlaylist({ name });
                mine.set(name.trim().toLowerCase(), playlistId);
                made += 1;
              }
              await addTracksToPlaylist({ playlistId, trackIds: ids });
            } catch {
              failedLists += 1;
            }
          }
          const lists = [];
          if (made > 0) lists.push(`made ${made} playlist${made === 1 ? "" : "s"}`);
          if (toppedUp > 0) lists.push(`added to ${toppedUp} you already had`);
          if (failedLists > 0) lists.push(`${failedLists} couldn't be made`);
          if (lists.length > 0) notice += " From rekordbox: " + lists.join(", ") + ".";
        }
        setNotice(notice);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Couldn't read that export.");
      } finally {
        setBusy(null);
      }
    },
    [
      addTrack,
      addTracksToPlaylist,
      createPlaylist,
      fileIntoPlaylist,
      generateUploadUrl,
      myKerb,
      playlists,
      tracks,
    ],
  );

  /** Zip up the selected tracks and hand them over as one download. */
  /** Zip up tracks with a rekordbox collection alongside, and save it. Returns whether it worked. */
  const downloadTracks = useCallback(async (chosen: Track[], zipName: string) => {
    if (chosen.length === 0) return false;

    setNotice(null);
    const entries: ZipEntry[] = [];
    const fetched: Id<"djTracks">[] = [];
    try {
      for (let i = 0; i < chosen.length; i += 1) {
        const t = chosen[i];
        setBusy(`fetching ${i + 1}/${chosen.length}: ${t.title.slice(0, 36)}`);
        const url = await convex.query(api.djs.getTrackUrl, { trackId: t._id });
        if (!url) continue;
        const res = await fetch(url);
        if (!res.ok) continue;
        entries.push({ name: t.filename, data: await res.blob() });
        fetched.push(t._id);
      }

      // Every playlist holding any of these tracks comes along too, cut down
      // to the tracks in the zip, so rekordbox gets the crates as well.
      setBusy("gathering playlists");
      const indexOf = new Map(chosen.map((t, i) => [t._id, i]));
      const crates = [];
      for (const p of playlists ?? []) {
        const ids = await convex.query(api.djs.listPlaylistTrackIds, { playlistId: p._id });
        const entries = ids.map((id) => indexOf.get(id)).filter((i) => i !== undefined);
        if (entries.length > 0) crates.push({ name: p.name, entries });
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
        crates,
      );
      entries.push({
        name: "wokenet-rekordbox.xml",
        data: new Blob([xml], { type: "application/xml" }),
      });

      // The last entry is the XML, not a track.
      const count = entries.length - 1;
      setBusy(`building zip (${count} tracks)`);
      saveBlob(await buildZip(entries), zipName.replace("{n}", String(count)));
      // Only the tracks that actually made it into the zip count.
      void recordDownloads({ trackIds: fetched }).catch(() => {});
      setNotice(`Downloaded ${count} track${count === 1 ? "" : "s"}.`);
      return true;
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't build that download.");
      return false;
    } finally {
      setBusy(null);
    }
  }, [convex, playlists, recordDownloads]);

  const downloadSelected = useCallback(async () => {
    const chosen = (tracks ?? []).filter((t) => selected.has(t._id));
    if (await downloadTracks(chosen, "wokenet-{n}-tracks.zip")) {
      setSelectMode(false);
      setSelected(new Set());
    }
  }, [downloadTracks, selected, tracks]);

  /** Everything a finished rip landed, in the order it landed, named after the link. */
  const downloadRip = useCallback(
    (request: FinishedRip) => {
      const byId = new Map((tracks ?? []).map((t) => [t._id, t]));
      // Tracks deleted since the rip simply drop out.
      const chosen = (request.trackIds ?? []).flatMap((id) => byId.get(id) ?? []);
      const slug =
        request.url.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop()?.replace(/[^\w-]+/g, "-") ||
        "rip";
      void downloadTracks(chosen, `wokenet-${slug}.zip`);
    },
    [downloadTracks, tracks],
  );

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
        const picture = await shrinkImage(file);
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": picture.type || "image/jpeg" },
          body: picture,
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
    async (files: File[], playlist: PlaylistTarget | null) => {
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
          const tags = await readTags(file);
          setBusy(`uploading ${file.name}`);

          const coverId = await uploadEmbeddedCover(tags.cover, generateUploadUrl);
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
            title: tags.title || file.name.replace(/\.[^.]+$/, ""),
            artist: tags.artist,
            rawGenres: tags.genres,
            coverId,
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
        parts.push(await fileIntoPlaylist(playlist, uploadedIds));
      }

      setBusy(null);
      if (parts.length > 0) setNotice(parts.join(" "));
    },
    [addTrack, fileIntoPlaylist, generateUploadUrl],
  );

  /** Queue a SoundCloud URL for a DJ's ripper to pick up. */
  const submitRip = useCallback(async (playlist: PlaylistTarget | null) => {
    const url = ripUrl.trim();
    if (!url) return;
    setBusy("queueing rip");
    setNotice(null);
    try {
      await requestRip({
        url,
        playlistId: playlist?.kind === "existing" ? playlist.playlistId : undefined,
        newPlaylistName: playlist?.kind === "new" ? playlist.name : undefined,
        newPlaylistDescription: playlist?.kind === "new" ? playlist.description || undefined : undefined,
      });
      setRipUrl("");
      setNotice("Queued. It'll appear once a DJ's ripper picks it up.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message.replace(/^.*Error: /, "") : "Couldn't queue.");
    } finally {
      setBusy(null);
    }
  }, [requestRip, ripUrl]);

  const pendingRips = useMemo(
    () =>
      (ripRequests ?? [])
        .filter((r) => r.status === "pending" || r.status === "claimed")
        .sort((a, b) => (a.place ?? 0) - (b.place ?? 0)),
    [ripRequests],
  );

  /**
   * Your own finished rips from the last week, newest first, to download as a
   * set. Counted by the tracks still in the library, and dropped once none are.
   */
  const myFinishedRips = useMemo(() => {
    const have = new Set((tracks ?? []).map((t) => t._id));
    return (myRecentRips ?? [])
      .map((r) => ({ ...r, trackIds: (r.trackIds ?? []).filter((id) => have.has(id)) }))
      .filter((r) => r.trackIds.length > 0)
      .slice(0, 5);
  }, [myRecentRips, tracks]);

  /** Finished rips that left tracks behind, so they can be queued again. */
  const throttledRips = useMemo(
    () => (ripRequests ?? []).filter((r) => (r.rateLimited?.length ?? 0) > 0).slice(0, 3),
    [ripRequests],
  );

  // Starts whatever is on screen, so there's a way to start playing without
  // hunting for a row. Doubles as pause once it's going.
  const playButton = (
    <Button
      size="1"
      radius="full"
      variant={playingHere && isPlaying ? "solid" : "surface"}
      disabled={ordered.length === 0}
      onClick={() => {
        if (playingHere) togglePlayback();
        else if (firstUp) void play(firstUp);
      }}
    >
      <PlayIcon playing={playingHere && isPlaying} />
      {playingHere && isPlaying ? "Pause" : "Play"}
    </Button>
  );

  return (
    <Flex width="100%" height="100%" style={{ minHeight: 0 }}>
      {narrow && sidebarOpen && (
        <Box className="djs-drawer-backdrop" onClick={() => setSidebarOpen(false)} />
      )}
      {(!narrow || sidebarOpen) && (
      <Box className={narrow ? "djs-drawer" : undefined} style={{ display: "flex" }}>
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
          setSidebarOpen(false);
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
        onReorder={(playlistIds) => void reorderPlaylists({ playlistIds })}
      />
      </Box>
      )}

      {/* Left-aligned against the sidebar rather than centred, so the page
          doesn't leave a dead gutter on wide screens. */}
      <Flex
        direction="column"
        p={{ initial: "3", sm: "5" }}
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          overflowY: "auto",
          // Keep the list clear of the card in the corner, with the same gap
          // either side of it: row to card, card to window edge. On a phone
          // the player is a bar along the bottom instead, so clear that.
          paddingRight: nowPlaying && !narrow
            ? PLAYER_WIDTH[playerSize] + PLAYER_GAP * 2
            : undefined,
          paddingBottom: nowPlaying && narrow ? 150 : undefined,
        }}
      >
        <Flex direction="column" width="100%" style={{ maxWidth: 1600 }} gap="4" pb="9">
        <Flex
          justify="between"
          align="center"
          wrap="wrap"
          gap="3"
          // On a phone the title and its actions stack, centred.
          direction={narrow ? "column" : "row"}
          style={narrow ? { textAlign: "center" } : undefined}
        >
          <Flex direction="column" gap="1" align={narrow ? "center" : undefined} style={{ minWidth: 0 }}>
            <Flex align="baseline" gap="3" wrap="wrap" justify={narrow ? "center" : undefined}>
              <Heading size={{ initial: "6", sm: "8" }} truncate>
                {activePlaylist ? activePlaylist.name : "Library"}
              </Heading>
              {/* In a playlist, play sits by its name; in the library, with the actions. */}
              {activePlaylist && <Box style={{ alignSelf: "center" }}>{playButton}</Box>}
              {activePlaylist?.description && (
                <Text size="2" color="gray" style={{ opacity: 0.8 }}>
                  {activePlaylist.description}
                </Text>
              )}
            </Flex>
            {activePlaylist && (
              <Text size="1" color="gray" style={{ opacity: 0.7 }}>
                playlist by{" "}
                <Text
                  size="1"
                  color={asBadgeColor(activePlaylist.createdByColor) ?? "gray"}
                  style={djTextStyle(activePlaylist.createdByTag)}
                >
                  {activePlaylist.createdByName}
                </Text>
                {activePlaylist.contributors.length > 0 && (
                  <>
                    {" · colonized by "}
                    {activePlaylist.contributors.map((c, i) => (
                      <Fragment key={c.kerb}>
                        {i > 0 ? ", " : ""}
                        <Text size="1" color={asBadgeColor(c.color) ?? "gray"} style={djTextStyle(c.tag)}>
                          {c.name}
                        </Text>
                      </Fragment>
                    ))}
                  </>
                )}
              </Text>
            )}
          </Flex>

          <Flex gap="2" align="center" wrap="wrap" justify={narrow ? "center" : undefined}>
            {narrow && (
              <Button
                size="1"
                radius="full"
                variant="surface"
                onClick={() => setSidebarOpen(true)}
                aria-label="Show playlists"
              >
                ☰ Playlists
              </Button>
            )}
            <RipDialog
              playlists={playlists ?? []}
              value={ripUrl}
              onChange={setRipUrl}
              onSubmit={submitRip}
              pending={pendingRips}
              recent={throttledRips}
              finished={myFinishedRips}
              onDownload={downloadRip}
              busy={busy !== null}
            />
            <UploadDialog
              playlists={playlists ?? []}
              onRun={(f, p) => void upload(f, p)}
              busy={busy !== null}
            />
            <LibraryImportDialog
              playlists={playlists ?? []}
              onRun={(x, a, p, rb) => void importLibrary(x, a, p, rb)}
              busy={busy !== null}
            />
            {!activePlaylist && playButton}
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
                placeholder="Search title, artist, dj, tag…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: "1 1 240px" }}
              />
              {narrow && (
                <Button
                  size="1"
                  radius="full"
                  variant={filtersOpen ? "solid" : "surface"}
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  Filters {filtersOpen ? "▴" : "▾"}
                </Button>
              )}
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
                {QUALITY_ORDER.filter((q) => qualityFilter.has(q)).map((q) => (
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

            {(!narrow || filtersOpen) && (
            <>
            <FacetRow label="Tags" empty={allGenres.length === 0 && !hasUntagged}>
              {hasUntagged && (
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
                  // House tags keep their fixed colour here too, so a chip
                  // matches the tag it filters on.
                  loud={tagStyleFor(genre)}
                  onClick={() => setGenreFilter((s) => toggleIn(s, genre))}
                >
                  {genre}
                </FilterChip>
              ))}
              <ShowMore
                hidden={hiddenGenreCount}
                expanded={showAllGenres && allGenres.length > COLLAPSED_FACET_COUNT}
                onToggle={setShowAllGenres}
              />
              {genreFilter.size > 1 && (
                <FilterChip active={matchAllGenres} onClick={() => setMatchAllGenres((v) => !v)}>
                  {matchAllGenres ? "match all" : "match any"}
                </FilterChip>
              )}
            </FacetRow>

            <FacetRow label="DJ" empty={allDjs.length === 0}>
              {visibleDjs.map(([kerb, { label, count, color, tag }]) => (
                <FilterChip
                  key={kerb}
                  active={djFilter.has(kerb)}
                  color={asBadgeColor(color)}
                  loud={tag ?? undefined}
                  count={count}
                  onClick={() => setDjFilter((s) => toggleIn(s, kerb))}
                >
                  {label}
                </FilterChip>
              ))}
              <ShowMore
                hidden={allDjs.length - visibleDjs.length}
                expanded={showAllDjs && allDjs.length > COLLAPSED_FACET_COUNT}
                onToggle={setShowAllDjs}
              />
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

            {/* Same rule as the tags: a filter that would match nothing isn't
                worth a chip. */}
            <FacetRow label="Cues" empty={!cuesPresent.hot && !cuesPresent.memory}>
              {cuesPresent.hot && (
                <FilterChip
                  active={needHotCues}
                  count={cueCounts.hot}
                  onClick={() => setNeedHotCues((v) => !v)}
                >
                  hot cues
                </FilterChip>
              )}
              {cuesPresent.memory && (
                <FilterChip
                  active={needMemoryCues}
                  count={cueCounts.memory}
                  onClick={() => setNeedMemoryCues((v) => !v)}
                >
                  memory cues
                </FilterChip>
              )}
            </FacetRow>
            </>
            )}
          </Flex>
        </Card>

        {/* On a phone the count sits centred above the controls. */}
        <Flex
          justify={narrow ? "center" : "between"}
          align="center"
          gap={narrow ? "2" : "3"}
          wrap="wrap"
          direction={narrow ? "column" : "row"}
        >
          <Text size="2" color="gray">
            {tracks === undefined
              ? "Loading…"
              : `${ordered.length} of ${scoped.length} track${scoped.length === 1 ? "" : "s"}`}
          </Text>

          {/* Selection controls sit on the count line, next to what they act on. */}
          <Flex gap="2" align="center" wrap="wrap" justify={narrow ? "center" : undefined}>
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
                    // Smaller on a phone, so the whole row fits on one line.
                    size={narrow ? "1" : "2"}
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
                  onClick={toggleShuffle}
                >
                  Shuffle
                </Button>
                <Button
                  size="1"
                  radius="full"
                  variant="surface"
                  onClick={() => setSelectMode(true)}
                >
                  {narrow ? "Select" : "Select tracks"}
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
                tagStyleFor={tagStyleFor}
                onEditTag={setTagEditing}
                onShowProfile={setProfileKerb}
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

      <TagStyleDialog tag={tagEditing} onClose={() => setTagEditing(null)} />
      <DjProfileCard kerb={profileKerb} onClose={() => setProfileKerb(null)} />

      {/* ---- now playing card ----
           A corner card rather than a full-width bar, so it doesn't sit on
           top of the sidebar and hide the DJ settings button. */}
      {nowPlaying && (
        <Flex
          direction="column"
          gap="2"
          p="2"
          className="djs-player"
          style={{
            position: "fixed",
            right: PLAYER_GAP,
            bottom: PLAYER_GAP,
            width: PLAYER_WIDTH[playerSize],
            zIndex: 50,
            backgroundColor: "var(--gray-2)",
            border: "1px solid var(--accent-7)",
            borderRadius: "var(--radius-3)",
          }}
        >
          {/* Stops the audio by unmounting the player altogether. */}
          <IconButton
            size="1"
            variant="ghost"
            onClick={() => setNowPlaying(null)}
            title="Close the player"
            aria-label="Close the player"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              zIndex: 1,
              margin: 0,
              background: "none",
              color: "var(--accent-9)",
              fontWeight: 700,
              // Keeps it legible over a light patch of artwork.
              textShadow: "0 1px 3px rgba(0, 0, 0, 0.9)",
            }}
          >
            ✕
          </IconButton>

          {/* Click the artwork to cycle the player through its sizes. */}
          <Box
            onClick={cyclePlayerSize}
            className="djs-player-cover"
            style={{ cursor: "pointer" }}
            title="Click to resize the player"
          >
            <Cover url={nowPlaying.coverUrl} size={PLAYER_WIDTH[playerSize]} fluid />
          </Box>

          <Flex direction="column" style={{ minWidth: 0 }}>
            <Text size="2" weight="bold" truncate>
              {nowPlaying.title}
            </Text>
            <Text size="1" color="gray" truncate>
              {nowPlaying.artist ? `${nowPlaying.artist} · ` : ""}
              <Text
                size="1"
                color={asBadgeColor(nowPlaying.djColor) ?? "gray"}
                style={nowPlaying.djTag ? { color: nowPlaying.djTag.bg } : undefined}
              >
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
                onClick={toggleShuffle}
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
          </Flex>
        </Flex>
      )}
    </Flex>
  );
});

const FacetRow = memo(
  ({ label, empty, children }: { label: string; empty?: boolean; children: React.ReactNode }) => (
    <Flex gap="2" align="start" className="djs-facet-row">
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
    tagStyleFor,
    onEditTag,
    onShowProfile,
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
    tagStyleFor: (genre: string) => TagStyle | undefined;
    onEditTag: (genre: string) => void;
    onShowProfile: (kerb: string) => void;
  }) => {
    // Lets you set cover art straight from the row, without opening the editor.
    const rowCoverInput = useRef<HTMLInputElement | null>(null);
    /**
     * The row's own edit button. Tapping a value tag (bpm, key) clicks it, so
     * those tags lead to the editor without every tag carrying a dialog.
     */
    const editButton = useRef<HTMLButtonElement | null>(null);

    /** Tag clicks must not reach the row, or they'd start the track. */
    const tagClick = (run: () => void) => (e: React.MouseEvent) => {
      e.stopPropagation();
      run();
    };
    const openEditor = tagClick(() => editButton.current?.click());

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
          className="djs-track-row"
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

          <Flex direction="column" className="djs-track-title" style={{ minWidth: 0, flex: "1 1 220px" }}>
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
            className="djs-track-tags"
            style={{ flex: "1 1 auto", minWidth: 0 }}
          >
            <span
              onClick={tagClick(() => onShowProfile(track.dj))}
              style={{ display: "inline-flex", cursor: "pointer" }}
            >
              <Tag
                color={asBadgeColor(track.djColor)}
                variant="soft"
                style={djTagStyle(track.djTag)}
              >
                {track.djDisplay}
              </Tag>
            </span>
            <Tag color={track.quality === "lossless" ? "green" : "gray"} variant="soft">
              {QUALITY_LABEL[track.quality]}
            </Tag>
            {track.bpm ? (
              <span onClick={openEditor} style={{ display: "inline-flex", cursor: "pointer" }}>
                <Tag color="gray" variant="outline">
                  {Math.round(track.bpm)} bpm
                  {track.analysisSource === "detected" ? "?" : ""}
                </Tag>
              </span>
            ) : null}
            {track.musicalKey ? (
              <span onClick={openEditor} style={{ display: "inline-flex", cursor: "pointer" }}>
                <Tag color="gray" variant="outline">
                  {track.musicalKey}
                  {track.analysisSource === "detected" ? "?" : ""}
                </Tag>
              </span>
            ) : null}
            {track.genres.map((g) => {
              const loud = tagStyleFor(g);
              return (
                <span
                  key={g}
                  onClick={tagClick(() => onEditTag(g))}
                  style={{ display: "inline-flex", cursor: "pointer" }}
                >
                  {loud ? (
                    <Badge variant="solid" style={loudTagStyle(loud)}>
                      {g}
                    </Badge>
                  ) : (
                    <Tag color="gray" variant="outline">
                      {g}
                    </Tag>
                  )}
                </span>
              );
            })}
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
              triggerRef={editButton}
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
/**
 * The two links at the foot of the sidebar. Styled as muted section labels:
 * the label itself is the thing you click, which reads better than a button
 * wearing your own name.
 */
const SIDEBAR_LINK: React.CSSProperties = {
  justifyContent: "flex-start",
  width: "fit-content",
  opacity: 0.6,
  letterSpacing: "0.5px",
};

/** Starting points offered for a tag with no colours of its own yet. */
const TAG_PRESETS: TagStyle[] = [
  { bg: "#FF6A00", fg: "#1A1A1A", glow: false },
  { bg: "#9B4DE0", fg: "#000000", glow: false },
  { bg: "#E5342E", fg: "#000000", glow: false },
  { bg: "#3DD400", fg: "#FFFFFF", glow: false },
  { bg: "#00C2FF", fg: "#001018", glow: false },
  { bg: "#FFD400", fg: "#1A1A1A", glow: false },
  { bg: "#FF4FA3", fg: "#FFFFFF", glow: false },
  { bg: "#2A2A2E", fg: "#EDEDEF", glow: false },
];

const DEFAULT_DRAFT: TagStyle = { bg: "#FF6A00", fg: "#1A1A1A", glow: false };

/** Custom tag colours keyed by tag, as the queries hand them over. */
const tagStyleMap = (rows: Doc<"djTagStyles">[] | undefined): Map<string, TagStyle> => {
  const m = new Map<string, TagStyle>();
  for (const r of rows ?? []) {
    m.set(r.tag, { bg: r.bg ?? DEFAULT_DRAFT.bg, fg: r.fg ?? DEFAULT_DRAFT.fg, glow: !!r.glow });
  }
  return m;
};

/**
 * Rename one tag and pick its colours. Used both from the tag list and
 * straight off a tag on a track, so there's one editor rather than two.
 */
const TagStyleEditor = memo(({ tag, onDone }: { tag: string; onDone: () => void }) => {
  const tagStyles = useQuery(api.djs.listTagStyles);
  const setTagStyle = useMutation(api.djs.setTagStyle);
  const renameTag = useMutation(api.djs.renameTag);

  const custom = useMemo(() => tagStyleMap(tagStyles), [tagStyles]);
  const stored = custom.get(tag);

  const [nameDraft, setNameDraft] = useState(tag);
  const [draft, setDraft] = useState<TagStyle | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-seed when pointed at a different tag, so reopening never shows the
  // last tag's colours.
  useEffect(() => {
    setNameDraft(tag);
    setDraft(null);
  }, [tag]);

  const style = draft ?? stored ?? resolveTagStyle(tag, custom) ?? DEFAULT_DRAFT;

  const save = async () => {
    setBusy(true);
    try {
      let target = tag;
      // Rename first, so the colours land on the name it ends up with.
      const wanted = nameDraft.trim();
      if (wanted && wanted !== tag) {
        const res = await renameTag({ from: tag, to: wanted });
        if (res?.renamed) target = res.renamed;
      }
      await setTagStyle({ tag: target, bg: style.bg, fg: style.fg, glow: style.glow });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await setTagStyle({ tag });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex direction="column" gap="4">
      <Flex align="center" gap="3">
        <Badge variant="solid" style={loudTagStyle(style)}>
          {nameDraft.trim() || tag}
        </Badge>
        <Text size="1" color="gray">
          preview
        </Text>
      </Flex>

      <Flex direction="column" gap="1">
        <Text size="2" weight="bold">
          Name
        </Text>
        <TextField.Root
          value={nameDraft}
          maxLength={40}
          onChange={(e) => setNameDraft(e.target.value)}
        />
        <Text size="1" color="gray">
          Renaming updates every track carrying this tag. Renaming onto a tag that already exists
          merges the two.
        </Text>
      </Flex>

      <Flex gap="5" wrap="wrap">
        <Flex direction="column" gap="1">
          <Text size="2" weight="bold">
            Bubble
          </Text>
          <Flex align="center" gap="2">
            <input
              type="color"
              value={style.bg}
              onChange={(e) => setDraft({ ...style, bg: e.target.value })}
              style={{ width: 44, height: 28, border: "none", background: "none" }}
            />
            <Text size="1" color="gray" style={{ fontVariantNumeric: "tabular-nums" }}>
              {style.bg.toUpperCase()}
            </Text>
          </Flex>
        </Flex>

        <Flex direction="column" gap="1">
          <Text size="2" weight="bold">
            Letters
          </Text>
          <Flex align="center" gap="2">
            <input
              type="color"
              value={style.fg}
              onChange={(e) => setDraft({ ...style, fg: e.target.value })}
              style={{ width: 44, height: 28, border: "none", background: "none" }}
            />
            <Text size="1" color="gray" style={{ fontVariantNumeric: "tabular-nums" }}>
              {style.fg.toUpperCase()}
            </Text>
          </Flex>
        </Flex>

        <Flex direction="column" gap="1">
          <Text size="2" weight="bold">
            Glow
          </Text>
          <Text as="label" size="2">
            <Flex align="center" gap="2" style={{ height: "28px" }}>
              <Checkbox
                checked={style.glow}
                onCheckedChange={(v) => setDraft({ ...style, glow: v === true })}
              />
              obnoxious
            </Flex>
          </Text>
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Presets
        </Text>
        <Flex gap="2" wrap="wrap">
          {TAG_PRESETS.map((p) => (
            <Badge
              key={p.bg}
              variant="solid"
              onClick={() => setDraft({ ...p, glow: style.glow })}
              style={{ ...loudTagStyle(p), cursor: "pointer" }}
            >
              {nameDraft.trim() || tag}
            </Badge>
          ))}
        </Flex>
      </Flex>

      <Flex justify="between" gap="2" mt="2">
        <Button size="2" variant="soft" color="gray" disabled={busy || !stored} onClick={clear}>
          {stored ? "remove colours" : "no colours set"}
        </Button>
        <Flex gap="2">
          <Button size="2" variant="soft" color="gray" onClick={onDone}>
            back
          </Button>
          <Button size="2" disabled={busy} onClick={save}>
            {busy ? "saving…" : "save"}
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
});

/**
 * The tag editor on its own, opened by tapping a tag on a track. Mounted once
 * at page level rather than per row, so a few hundred rows don't each carry a
 * dialog around.
 */
const TagStyleDialog = memo(({ tag, onClose }: { tag: string | null; onClose: () => void }) => (
  <Dialog.Root open={tag !== null} onOpenChange={(open) => !open && onClose()}>
    <Dialog.Content maxWidth="520px">
      <Dialog.Title>{tag ?? "Tag"}</Dialog.Title>
      <Dialog.Description size="2" color="gray" mb="4">
        Rename this tag or give it colours, everywhere it appears.
      </Dialog.Description>
      {tag !== null && <TagStyleEditor tag={tag} onDone={onClose} />}
    </Dialog.Content>
  </Dialog.Root>
));

/**
 * Every tag in the library as a block you can click to rename and colour.
 *
 * Reads the track list rather than taking it as a prop: Convex caches by
 * query, so this is the same subscription the page already holds.
 */
const TagSettingsDialog = memo(() => {
  const tracks = useQuery(api.djs.listTracks);
  const tagStyles = useQuery(api.djs.listTagStyles);

  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const custom = useMemo(() => tagStyleMap(tagStyles), [tagStyles]);

  /**
   * Tags with at least one track behind them. A tag nothing is using any more
   * is nothing to style, so it doesn't belong in the list.
   */
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tracks ?? []) {
      for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [tracks]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? tags.filter(([t]) => t.toLowerCase().includes(q)) : tags;
  }, [tags, search]);

  const close = () => {
    setSelected(null);
    setSearch("");
  };

  return (
    <Dialog.Root onOpenChange={(open) => !open && close()}>
      <Dialog.Trigger>
        <Button size="1" variant="ghost" color="gray" style={SIDEBAR_LINK}>
          TAG SETTINGS
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>Tag settings</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Every tag in the library. Click one to rename it or give it colours.
        </Dialog.Description>

        {selected !== null ? (
          <TagStyleEditor tag={selected} onDone={() => setSelected(null)} />
        ) : (
          <Flex direction="column" gap="3">
            <TextField.Root
              placeholder="find a tag"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Box style={{ maxHeight: "48vh", overflowY: "auto" }}>
              {shown.length === 0 ? (
                <Text size="2" color="gray">
                  {tags.length === 0 ? "No tags yet." : "Nothing matches that."}
                </Text>
              ) : (
                <Flex gap="2" wrap="wrap">
                  {shown.map(([tag, count]) => {
                    const style = resolveTagStyle(tag, custom);
                    return (
                      <Badge
                        key={tag}
                        variant={style ? "solid" : "outline"}
                        color="gray"
                        onClick={() => setSelected(tag)}
                        style={{
                          cursor: "pointer",
                          ...(style
                            ? loudTagStyle(style)
                            : { fontSize: "12px", padding: "3px 9px" }),
                        }}
                      >
                        {tag}
                        <Text style={{ opacity: 0.6, marginLeft: "4px" }}>{count}</Text>
                      </Badge>
                    );
                  })}
                </Flex>
              )}
            </Box>
            <Text size="1" color="gray">
              {tags.length} tag{tags.length === 1 ? "" : "s"}, most used first. A tag no track
              carries isn't shown.
            </Text>
          </Flex>
        )}

        {selected === null && (
          <Flex justify="end" mt="4">
            <Dialog.Close>
              <Button size="2" variant="soft" color="gray">
                done
              </Button>
            </Dialog.Close>
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
});

/**
 * Someone's profile card, opened by tapping their tag on a track.
 *
 * Reads the profile roster rather than the user list, so a DJ who has since
 * graduated and lost their account still has a name, a colour and a face.
 * Controlled and mounted once per page, so rows stay cheap.
 */
const DjProfileCard = memo(({ kerb, onClose }: { kerb: string | null; onClose: () => void }) => {
  const profiles = useQuery(api.djs.listDjProfiles);
  const tracks = useQuery(api.djs.listTracks);

  const profile = useMemo(() => profiles?.find((p) => p.kerb === kerb), [profiles, kerb]);
  const trackCount = useMemo(
    () => (kerb ? (tracks ?? []).filter((t) => t.dj === kerb).length : 0),
    [tracks, kerb],
  );

  const name = profile?.djName || kerb || "";

  return (
    <Dialog.Root open={kerb !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content maxWidth="420px">
        <Dialog.Title style={{ display: "none" }}>{name}</Dialog.Title>
        <Flex gap="4" align="start">
          <DjAvatar url={profile?.avatarUrl ?? null} size={88} label={name} />
          <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
            {/* Their own colours if they picked a pair, otherwise their accent. */}
            <Heading
              size="6"
              color={asBadgeColor(profile?.djColor)}
              style={
                profile?.djTag
                  ? {
                      color: profile.djTag.bg,
                      textShadow: profile.djTag.glow
                        ? `0 0 14px rgba(${hexToRgb(profile.djTag.bg)}, 0.7)`
                        : undefined,
                      wordBreak: "break-word",
                    }
                  : { wordBreak: "break-word" }
              }
            >
              {name}
            </Heading>
            <Text size="2" color="gray">
              {kerb}
            </Text>
            <Text size="1" color="gray" style={{ opacity: 0.7 }}>
              {trackCount} track{trackCount === 1 ? "" : "s"} in the library
            </Text>
          </Flex>
        </Flex>

        {profile?.djBio ? (
          <Text as="p" size="2" mt="4" style={{ whiteSpace: "pre-wrap" }}>
            {profile.djBio}
          </Text>
        ) : (
          <Text as="p" size="2" color="gray" mt="4">
            No bio yet.
          </Text>
        )}

        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button size="1" variant="soft" color="gray">
              close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
});

/**
 * Your own tag at the foot of the sidebar. Clicking it shows your card the way
 * everyone else sees it; changing it is the DJ SETTINGS link above.
 */
const MyDjTag = memo(() => {
  const me = useQuery(api.djs.myDjSettings);
  const [open, setOpen] = useState(false);
  if (!me) return null;

  const tag =
    me.tagBg && me.tagFg ? { bg: me.tagBg, fg: me.tagFg, glow: me.tagGlow } : null;

  return (
    <>
      <Button
        size="1"
        radius="full"
        variant="surface"
        color={asBadgeColor(me.djColor)}
        onClick={() => setOpen(true)}
        style={tag ? djTagStyle(tag) : undefined}
      >
        {me.djName || me.kerb}
      </Button>
      <DjProfileCard kerb={open ? me.kerb : null} onClose={() => setOpen(false)} />
    </>
  );
});

const DjSettingsDialog = memo(() => {
  const me = useQuery(api.djs.myDjSettings);
  const save = useMutation(api.djs.setMyDjSettings);
  const generateUploadUrl = useMutation(api.djs.generateUploadUrl);
  const setAvatar = useMutation(api.djs.setMyDjAvatar);
  const clearAvatar = useMutation(api.djs.clearMyDjAvatar);

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [bioDraft, setBioDraft] = useState<string | null>(null);
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  /** null = not touched, "" = back to the accent, hex = a custom pair. */
  const [bgDraft, setBgDraft] = useState<string | null>(null);
  const [fgDraft, setFgDraft] = useState<string | null>(null);
  const [glowDraft, setGlowDraft] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  const name = nameDraft ?? me?.djName ?? "";
  const bio = bioDraft ?? me?.djBio ?? "";
  const color = colorDraft ?? me?.djColor ?? "";
  const bg = bgDraft ?? me?.tagBg ?? "";
  const fg = fgDraft ?? me?.tagFg ?? "";
  const glow = glowDraft ?? me?.tagGlow ?? false;
  const custom = bg !== "" && fg !== "";
  const preview = name.trim() || me?.kerb || "you";

  const reset = () => {
    setNameDraft(null);
    setBioDraft(null);
    setColorDraft(null);
    setBgDraft(null);
    setFgDraft(null);
    setGlowDraft(null);
    setError(null);
  };

  const commit = async () => {
    setSaving(true);
    try {
      await save({
        djName: name,
        djColor: color,
        djBio: bio,
        tagBg: bg,
        tagFg: fg,
        tagGlow: glow,
      });
      reset();
    } finally {
      setSaving(false);
    }
  };

  /** Same flow as a track's cover art: upload, then point the profile at it. */
  const uploadAvatar = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("That isn't an image.");
      return;
    }
    setSaving(true);
    try {
      const picture = await shrinkImage(file);
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": picture.type || file.type },
        body: picture,
      });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await setAvatar({ storageId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set that picture.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root onOpenChange={(open) => !open && reset()}>
      <Dialog.Trigger>
        <Button size="1" variant="ghost" color="gray" style={SIDEBAR_LINK}>
          DJ SETTINGS
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>DJ settings</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          How you're credited on every track you add, and what people see when they tap your tag.
        </Dialog.Description>

        <Flex gap="4" align="start">
          {/* Picture on the left, same shape as editing a track's cover. */}
          <Flex direction="column" gap="1" align="center">
            <DjAvatar
              url={me?.avatarUrl ?? null}
              size={96}
              label={preview}
              onClick={() => avatarInput.current?.click()}
            />
            <input
              ref={avatarInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
                e.target.value = "";
              }}
            />
            <Button
              size="1"
              variant="ghost"
              color="gray"
              onClick={() => avatarInput.current?.click()}
            >
              {me?.avatarUrl ? "change" : "add picture"}
            </Button>
            {me?.avatarUrl && (
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => void clearAvatar()}
                style={{ opacity: 0.6 }}
              >
                remove
              </Button>
            )}
          </Flex>

          <Flex direction="column" gap="4" style={{ flex: "1 1 auto", minWidth: 0 }}>
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
                Blank uses your kerb{me?.kerb ? ` (${me.kerb})` : ""}. Renaming updates your
                existing tracks too — they're stored against your kerb, not the name, so they stay
                yours even after you graduate.
              </Text>
            </Flex>

            <Flex direction="column" gap="1">
              <Text size="2" weight="bold">
                Bio
              </Text>
              <TextArea
                placeholder="what you play, where you play it, whatever"
                value={bio}
                maxLength={280}
                rows={3}
                onChange={(e) => setBioDraft(e.target.value)}
              />
              <Text size="1" color="gray">
                {280 - bio.length} left. Shown when someone taps your tag on a track.
              </Text>
            </Flex>
          </Flex>
        </Flex>

        <Flex direction="column" gap="2" mt="4">
          <Text size="2" weight="bold">
            Tag colour
          </Text>
          <Flex gap="2" wrap="wrap">
            {/* Each swatch shows the actual tag, so you pick what you'll see. */}
            <Badge
              variant="soft"
              onClick={() => {
                setColorDraft("");
                setBgDraft("");
                setFgDraft("");
              }}
              style={{
                cursor: "pointer",
                outline: color === "" && !custom ? "2px solid var(--gray-12)" : undefined,
              }}
            >
              {preview}
            </Badge>
            {DJ_COLORS.map((c) => (
              <Badge
                key={c}
                color={c}
                variant="soft"
                onClick={() => {
                  setColorDraft(c);
                  // Picking an accent drops a custom pair, or it would win.
                  setBgDraft("");
                  setFgDraft("");
                }}
                style={{
                  cursor: "pointer",
                  outline: color === c && !custom ? "2px solid var(--gray-12)" : undefined,
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

        <Flex direction="column" gap="2" mt="4">
          <Text size="2" weight="bold">
            Or pick your own
          </Text>
          <Flex gap="4" wrap="wrap" align="end">
            <Flex direction="column" gap="1">
              <Text size="1" color="gray">
                Bubble
              </Text>
              <Flex align="center" gap="2">
                <input
                  type="color"
                  value={bg || "#FF6A00"}
                  onChange={(e) => {
                    setBgDraft(e.target.value);
                    // Both halves or neither, so a tag is never half-styled.
                    if (fg === "") setFgDraft("#1A1A1A");
                  }}
                  style={{ width: 44, height: 28, border: "none", background: "none" }}
                />
                <Text size="1" color="gray" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {(bg || "—").toUpperCase()}
                </Text>
              </Flex>
            </Flex>

            <Flex direction="column" gap="1">
              <Text size="1" color="gray">
                Letters
              </Text>
              <Flex align="center" gap="2">
                <input
                  type="color"
                  value={fg || "#1A1A1A"}
                  onChange={(e) => {
                    setFgDraft(e.target.value);
                    if (bg === "") setBgDraft("#FF6A00");
                  }}
                  style={{ width: 44, height: 28, border: "none", background: "none" }}
                />
                <Text size="1" color="gray" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {(fg || "—").toUpperCase()}
                </Text>
              </Flex>
            </Flex>

            <Flex direction="column" gap="1">
              <Text size="1" color="gray">
                Glow
              </Text>
              <Text as="label" size="2">
                <Flex align="center" gap="2" style={{ height: "28px" }}>
                  <Checkbox
                    checked={glow}
                    disabled={!custom}
                    onCheckedChange={(v) => setGlowDraft(v === true)}
                  />
                  obnoxious
                </Flex>
              </Text>
            </Flex>

            <Flex direction="column" gap="1">
              <Text size="1" color="gray">
                Preview
              </Text>
              <Badge
                variant="soft"
                color={asBadgeColor(color)}
                style={custom ? djTagStyle({ bg, fg, glow }) : undefined}
              >
                {preview}
              </Badge>
            </Flex>

            {custom && (
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => {
                  setBgDraft("");
                  setFgDraft("");
                }}
              >
                back to accent
              </Button>
            )}
          </Flex>
        </Flex>

        {error && (
          <Text size="1" color="red" mt="3" as="p">
            {error}
          </Text>
        )}

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
    triggerRef,
  }: {
    track: Track;
    onSave: (edits: TrackEdits) => void;
    onSetCover: (file: File) => void;
    onDetectBpm: () => Promise<number | undefined>;
    /** Lets the row open this dialog from a tag rather than the pencil. */
    triggerRef?: React.Ref<HTMLButtonElement>;
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
          <IconButton size="1" variant="soft" color="gray" aria-label="Edit track" ref={triggerRef}>
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
            <Field label="Tags">
              <TextField.Root
                value={genres}
                placeholder="comma separated, e.g. Baile Funk, Jersey Club"
                onChange={(e) => setGenres(e.target.value)}
              />
            </Field>
            <Text size="1" color="gray">
              Separate tags with commas. Tags get normalized, so "ukgarage" and "UK Garage" end up
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
            <ReadOnly
              label="Downloads"
              value={`${track.downloadCount ?? 0} time${track.downloadCount === 1 ? "" : "s"}`}
            />
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
  createdByTag: TagStyle | null;
  contributors: { kerb: string; name: string; color: string | null; tag: TagStyle | null }[];
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
    onReorder,
  }: {
    playlists: PlaylistRow[] | undefined;
    activeId: Id<"djPlaylists"> | null;
    libraryCount: number;
    onSelect: (id: Id<"djPlaylists"> | null) => void;
    onCreate: (name: string, description: string) => void;
    onDropTracks: (playlistId: Id<"djPlaylists">, trackIds: Id<"djTracks">[]) => void;
    onReorder: (playlistIds: Id<"djPlaylists">[]) => void;
  }) => {
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [dropTarget, setDropTarget] = useState<Id<"djPlaylists"> | null>(null);
    // A playlist being dragged to a new spot, and where it would land: above
    // or below the row under the pointer.
    const [dragging, setDragging] = useState<Id<"djPlaylists"> | null>(null);
    const [insertAt, setInsertAt] = useState<{ id: Id<"djPlaylists">; before: boolean } | null>(
      null,
    );

    const endReorder = () => {
      setDragging(null);
      setInsertAt(null);
    };

    const dropPlaylist = (targetId: Id<"djPlaylists">, before: boolean) => {
      if (!playlists || !dragging || dragging === targetId) return;
      const ids = playlists.map((p) => p._id).filter((id) => id !== dragging);
      const at = ids.indexOf(targetId);
      if (at === -1) return;
      ids.splice(before ? at : at + 1, 0, dragging);
      if (ids.some((id, i) => id !== playlists[i]._id)) onReorder(ids);
    };

    const Row = ({
      label,
      byline,
      bylineColor,
      bylineTag,
      count,
      active,
      onClick,
      dropId,
    }: {
      label: string;
      /** Creator credit, tinted with their DJ colour. */
      byline?: string;
      bylineColor?: BadgeColor;
      bylineTag?: TagStyle | null;
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
        draggable={dropId !== undefined}
        onDragStart={
          dropId
            ? (e) => {
                e.dataTransfer.setData(DRAG_PLAYLIST, dropId);
                e.dataTransfer.effectAllowed = "move";
                setDragging(dropId);
              }
            : undefined
        }
        onDragEnd={dropId ? endReorder : undefined}
        onDragOver={
          dropId
            ? (e) => {
                if (e.dataTransfer.types.includes(DRAG_PLAYLIST)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  const before = e.clientY < rect.top + rect.height / 2;
                  setInsertAt((cur) =>
                    cur?.id === dropId && cur.before === before ? cur : { id: dropId, before },
                  );
                  return;
                }
                if (!e.dataTransfer.types.includes(DRAG_TRACKS)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setDropTarget(dropId);
              }
            : undefined
        }
        onDragLeave={
          dropId
            ? () => {
                setDropTarget(null);
                setInsertAt(null);
              }
            : undefined
        }
        onDrop={
          dropId
            ? (e) => {
                e.preventDefault();
                setDropTarget(null);
                if (e.dataTransfer.types.includes(DRAG_PLAYLIST)) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  dropPlaylist(dropId, e.clientY < rect.top + rect.height / 2);
                  endReorder();
                  return;
                }
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
          // Where a dragged playlist would land: a line on the near edge.
          boxShadow:
            dropId && insertAt?.id === dropId && dragging !== dropId
              ? `inset 0 ${insertAt.before ? 2 : -2}px 0 var(--accent-9)`
              : undefined,
          opacity: dropId && dragging === dropId ? 0.4 : undefined,
        }}
      >
        <Text size="2" truncate color={active ? undefined : "gray"} weight={active ? "bold" : "regular"}>
          {label}
          {byline && (
            <Text size="1" color={bylineColor ?? "gray"} style={{ opacity: 0.9, ...djTextStyle(bylineTag ?? null) }}>
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
        {/* Called rather than rendered as <Row>: Row is redefined every render,
            so as a component React would remount the rows, which cancels a
            drag that's in progress. */}
        {Row({
          label: "Library",
          count: libraryCount,
          active: activeId === null,
          onClick: () => onSelect(null),
        })}

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
            <Fragment key={p._id}>
              {Row({
                label: p.name,
                byline: p.createdByName,
                bylineColor: asBadgeColor(p.createdByColor),
                bylineTag: p.createdByTag,
                count: p.trackCount,
                active: activeId === p._id,
                onClick: () => onSelect(p._id),
                dropId: p._id,
              })}
            </Fragment>
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

        <Flex direction="column" gap="2" align="start" mt="auto" pt="3">
          <Separator size="4" />
          <DjSettingsDialog />
          <TagSettingsDialog />
          <MyDjTag />
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
/** Where an upload or rip should file its tracks. */
type PlaylistTarget =
  | { kind: "new"; name: string; description: string }
  | { kind: "existing"; playlistId: Id<"djPlaylists"> };

/** What the playlist picker is showing, kept by the dialog that owns it. */
type PlaylistDraft = {
  on: boolean;
  mode: "new" | "existing";
  name: string;
  description: string;
  playlistId: Id<"djPlaylists"> | null;
};

const EMPTY_PLAYLIST_DRAFT: PlaylistDraft = {
  on: false,
  mode: "new",
  name: "",
  description: "",
  playlistId: null,
};

/** The target a draft describes: null for "no playlist", "incomplete" while it's half filled in. */
const targetOf = (d: PlaylistDraft): PlaylistTarget | null | "incomplete" => {
  if (!d.on) return null;
  if (d.mode === "existing") return d.playlistId ? { kind: "existing", playlistId: d.playlistId } : "incomplete";
  return d.name.trim()
    ? { kind: "new", name: d.name.trim(), description: d.description.trim() }
    : "incomplete";
};

/** "Put these in a playlist": a new one, or one that already exists. Shared by upload and rip. */
const PlaylistPicker = memo(
  ({
    playlists,
    draft,
    onChange,
  }: {
    playlists: PlaylistRow[];
    draft: PlaylistDraft;
    onChange: (d: PlaylistDraft) => void;
  }) => {
    const set = (patch: Partial<PlaylistDraft>) => onChange({ ...draft, ...patch });
    return (
      <Flex direction="column" gap="2">
        <Text as="label" size="2">
          <Flex gap="2" align="center">
            <Checkbox checked={draft.on} onCheckedChange={(v) => set({ on: v === true })} />
            Put these in a playlist
          </Flex>
        </Text>

        {draft.on && (
          <Flex direction="column" gap="2" pl="5">
            <SegmentedControl.Root
              size="1"
              value={draft.mode}
              onValueChange={(v) => set({ mode: v as PlaylistDraft["mode"] })}
            >
              <SegmentedControl.Item value="new">New playlist</SegmentedControl.Item>
              <SegmentedControl.Item value="existing">
                Existing playlist
              </SegmentedControl.Item>
            </SegmentedControl.Root>

            {draft.mode === "new" ? (
              <>
                <TextField.Root
                  placeholder="playlist name"
                  value={draft.name}
                  maxLength={60}
                  onChange={(e) => set({ name: e.target.value })}
                />
                <TextField.Root
                  placeholder="short description (optional)"
                  value={draft.description}
                  maxLength={140}
                  onChange={(e) => set({ description: e.target.value })}
                />
              </>
            ) : playlists.length === 0 ? (
              <Text size="1" color="gray">
                No playlists yet — make a new one instead.
              </Text>
            ) : (
              <Select.Root
                value={draft.playlistId ?? undefined}
                onValueChange={(v) => set({ playlistId: v as Id<"djPlaylists"> })}
              >
                <Select.Trigger placeholder="choose a playlist" />
                <Select.Content position="popper">
                  {playlists.map((p) => (
                    <Select.Item key={p._id} value={p._id}>
                      {p.name} ({p.trackCount})
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            )}
          </Flex>
        )}
      </Flex>
    );
  },
);

const UploadDialog = memo(
  ({
    playlists,
    onRun,
    busy,
  }: {
    playlists: PlaylistRow[];
    onRun: (files: File[], playlist: PlaylistTarget | null) => void;
    busy: boolean;
  }) => {
    const input = useRef<HTMLInputElement | null>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [draft, setDraft] = useState(EMPTY_PLAYLIST_DRAFT);
    const target = targetOf(draft);

    const ready = files.length > 0 && target !== "incomplete";

    return (
      <Dialog.Root
        onOpenChange={(open) => {
          if (!open) {
            setFiles([]);
            setDraft(EMPTY_PLAYLIST_DRAFT);
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

            <PlaylistPicker playlists={playlists} draft={draft} onChange={setDraft} />

            <Dialog.Close>
              <Button
                size="1"
                disabled={!ready || busy}
                onClick={() => target !== "incomplete" && onRun(files, target)}
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
  ({
    playlists,
    onRun,
    busy,
  }: {
    playlists: PlaylistRow[];
    onRun: (
      xml: ParsedXml,
      audio: File[],
      playlist: PlaylistTarget | null,
      rb: { playlists: ParsedXmlPlaylist[]; onlyTheirTracks: boolean },
    ) => void;
    busy: boolean;
  }) => {
    const xmlInput = useRef<HTMLInputElement | null>(null);
    const folderInput = useRef<HTMLInputElement | null>(null);
    // Read as soon as it's picked, so its playlists can be offered up front.
    const [xml, setXml] = useState<{ name: string; parsed: ParsedXml } | null>(null);
    const [xmlError, setXmlError] = useState<string | null>(null);
    const [audio, setAudio] = useState<File[]>([]);
    const [draft, setDraft] = useState(EMPTY_PLAYLIST_DRAFT);
    const target = targetOf(draft);
    const [bringPlaylists, setBringPlaylists] = useState(true);
    const [chosen, setChosen] = useState<Set<number>>(new Set());
    const [onlyTheirTracks, setOnlyTheirTracks] = useState(false);

    const audioCount = audio.length;
    const rbPlaylists = xml?.parsed.playlists ?? [];
    const picked = bringPlaylists ? rbPlaylists.filter((_, i) => chosen.has(i)) : [];
    const nothingPicked = bringPlaylists && onlyTheirTracks && picked.length === 0;

    const readXml = async (file: File | undefined) => {
      setXml(null);
      setXmlError(null);
      if (!file) return;
      try {
        const parsed = parseRekordboxXml(await file.text());
        setXml({ name: file.name, parsed });
        setChosen(new Set(parsed.playlists.map((_, i) => i)));
      } catch (err) {
        setXmlError(err instanceof Error ? err.message : "Couldn't read that file.");
      }
    };

    return (
      <Dialog.Root onOpenChange={(open) => !open && setDraft(EMPTY_PLAYLIST_DRAFT)}>
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
                onChange={(e) => void readXml(e.target.files?.[0])}
              />
              <Button size="1" variant="surface" onClick={() => xmlInput.current?.click()}>
                {xml ? xml.name.slice(0, 40) : "Choose rekordbox.xml"}
              </Button>
              {xml && (
                <Text size="1" color="gray">
                  {xml.parsed.tracks.length} tracks, {rbPlaylists.length} playlist
                  {rbPlaylists.length === 1 ? "" : "s"}
                </Text>
              )}
              {xmlError && (
                <Text size="1" color="red">
                  {xmlError}
                </Text>
              )}
            </Flex>

            <Flex direction="column" gap="1">
              <Text size="2" weight="bold">
                2. Music folder
              </Text>
              <Text size="1" color="gray">
                The folder holding those tracks — if they're spread out, one that holds all of
                them. Nothing is uploaded until you start the import.
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

            {rbPlaylists.length > 0 && (
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  3. Your rekordbox playlists
                </Text>
                <Text as="label" size="2">
                  <Flex gap="2" align="center">
                    <Checkbox
                      checked={bringPlaylists}
                      onCheckedChange={(v) => setBringPlaylists(v === true)}
                    />
                    Bring these playlists over too
                  </Flex>
                </Text>
                {bringPlaylists && (
                  <Flex direction="column" gap="2" pl="5">
                    <Flex gap="3">
                      <Button
                        size="1"
                        variant="ghost"
                        onClick={() => setChosen(new Set(rbPlaylists.map((_, i) => i)))}
                      >
                        all
                      </Button>
                      <Button
                        size="1"
                        variant="ghost"
                        onClick={() => setChosen(new Set())}
                      >
                        none
                      </Button>
                    </Flex>
                    <Flex
                      direction="column"
                      gap="1"
                      style={{ maxHeight: 180, overflowY: "auto" }}
                    >
                      {rbPlaylists.map((p, i) => (
                        <Text as="label" size="1" key={i}>
                          <Flex gap="2" align="center">
                            <Checkbox
                              size="1"
                              checked={chosen.has(i)}
                              onCheckedChange={(v) => {
                                const next = new Set(chosen);
                                if (v === true) next.add(i);
                                else next.delete(i);
                                setChosen(next);
                              }}
                            />
                            {p.name} ({p.entries.length})
                          </Flex>
                        </Text>
                      ))}
                    </Flex>
                    <Text as="label" size="2">
                      <Flex gap="2" align="center">
                        <Checkbox
                          checked={onlyTheirTracks}
                          onCheckedChange={(v) => setOnlyTheirTracks(v === true)}
                        />
                        Only import tracks that are in a ticked playlist
                      </Flex>
                    </Text>
                  </Flex>
                )}
              </Flex>
            )}

            <PlaylistPicker playlists={playlists} draft={draft} onChange={setDraft} />

            <Separator size="4" />

            <Button
              size="1"
              disabled={
                !xml || audioCount === 0 || target === "incomplete" || nothingPicked || busy
              }
              onClick={() =>
                xml &&
                target !== "incomplete" &&
                onRun(xml.parsed, audio, target, {
                  playlists: picked,
                  onlyTheirTracks: bringPlaylists && onlyTheirTracks,
                })
              }
            >
              {busy ? "importing…" : "Start import"}
            </Button>
            <Text size="1" color="gray">
              Tracks already in the library aren't uploaded again, so running it again only adds
              what's new, and tops up playlists it made last time. Large or unsupported files are
              skipped too.
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
    playlists,
    value,
    onChange,
    onSubmit,
    pending,
    recent,
    finished,
    onDownload,
    busy,
  }: {
    playlists: PlaylistRow[];
    value: string;
    onChange: (v: string) => void;
    onSubmit: (playlist: PlaylistTarget | null) => void;
    pending: RipRequest[];
    recent: RipRequest[];
    /** The viewer's own finished rips, offered as zips. */
    finished: FinishedRip[];
    onDownload: (request: FinishedRip) => void;
    busy: boolean;
  }) => {
    const cancelRip = useMutation(api.djs.cancelRipRequest);
    const dismissRip = useMutation(api.djs.dismissRip);
    const [draft, setDraft] = useState(EMPTY_PLAYLIST_DRAFT);
    const target = targetOf(draft);
    const ready = value.trim().length > 0 && target !== "incomplete";
    const queue = () => {
      if (target === "incomplete") return;
      onSubmit(target);
      setDraft(EMPTY_PLAYLIST_DRAFT);
    };
    return (
    <Dialog.Root onOpenChange={(open) => !open && setDraft(EMPTY_PLAYLIST_DRAFT)}>
      <Dialog.Trigger>
        <Button size="1" radius="full" variant="surface">
          Rip{pending.length > 0 ? ` (${pending.length})` : ""}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Rip from SoundCloud</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Queues a playlist or track. The ripping runs on a Mac mini in Halo, which checks for
          new requests every 30 seconds — requests wait in line rather than failing when it's off.
        </Dialog.Description>
        {/* Rips also send "queued" and "ready" emails (convex/email.ts), but only once
            RESEND_API_KEY is set on the deployment; until then they're skipped. Mention
            the emails here again when they're switched on. See dj-ripper/README.md. */}

        <Flex gap="2" align="center">
          <TextField.Root
            placeholder="https://soundcloud.com/…"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: "1 1 auto" }}
          />
          <Button size="1" onClick={queue} disabled={busy || !ready}>
            Queue
          </Button>
        </Flex>

        {/* Tracks are filed as they land, including ones already in the library. */}
        <Box mt="3">
          <PlaylistPicker playlists={playlists} draft={draft} onChange={setDraft} />
        </Box>

        {pending.length > 0 && (
          <>
            <Separator size="4" my="4" />
            <Text size="2" weight="bold">
              In the queue
            </Text>
            <Text size="1" color="gray" as="p" mt="1" style={{ opacity: 0.8 }}>
              Worked through one at a time, oldest first.
            </Text>
            <Flex direction="column" gap="2" mt="2">
              {pending.map((r) => {
                // How many are actually still waiting ahead of this one, so
                // the one that goes next says so even while another is ripping.
                const waitingAhead = pending.filter(
                  (x) => x.status === "pending" && (x.place ?? 0) < (r.place ?? 0),
                ).length;
                return (
                <Flex key={r._id} justify="between" gap="2" align="start">
                  <Flex gap="2" style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <Text size="1" color="gray" style={{ opacity: 0.5, width: "16px" }}>
                      {r.place ?? "—"}
                    </Text>
                    <Flex direction="column" style={{ minWidth: 0 }}>
                      <Text size="1" color="gray" truncate>
                        {r.url}
                      </Text>
                      {r.playlistName && (
                        <Text size="1" color="gray" truncate style={{ opacity: 0.6 }}>
                          → {r.playlistName}
                        </Text>
                      )}
                      {/* The ripper's own note: "ripping", or what it's
                          waiting on while it backs off a rate limit. */}
                      {r.status === "claimed" && r.message && r.message !== "ripping" && (
                        <Text size="1" color="gray" style={{ opacity: 0.6 }}>
                          {r.message}
                        </Text>
                      )}
                      {/* Bar follows tracks tried, so DRM-locked or failed
                          ones still move it; the count is what actually landed. */}
                      {r.status === "claimed" && r.tracksTotal ? (
                        <Flex direction="column" gap="1" mt="1">
                          <Progress
                            size="1"
                            color="orange"
                            value={((r.tracksTried ?? 0) / r.tracksTotal) * 100}
                          />
                          <Text size="1" color="gray" style={{ opacity: 0.6 }}>
                            {r.tracksDone ?? 0}/{r.tracksTotal} tracks downloaded
                          </Text>
                        </Flex>
                      ) : null}
                    </Flex>
                  </Flex>
                  <Flex gap="2" align="center" style={{ flexShrink: 0 }}>
                    <Badge size="1" color={r.status === "claimed" ? "orange" : "gray"} variant="soft">
                      {r.status === "claimed"
                        ? "ripping"
                        : waitingAhead === 0
                          ? "next up"
                          : `${waitingAhead} ahead`}
                    </Badge>
                    {r.canCancel && (
                      <Button
                        size="1"
                        variant="ghost"
                        color="red"
                        // A running rip stops between tracks, so it can take a
                        // moment; anything already uploaded stays.
                        onClick={() => void cancelRip({ requestId: r._id })}
                      >
                        Cancel
                      </Button>
                    )}
                  </Flex>
                </Flex>
                );
              })}
            </Flex>
          </>
        )}

        {finished.length > 0 && (
          <>
            <Separator size="4" my="4" />
            <Text size="2" weight="bold">
              Your rips
            </Text>
            <Text size="1" color="gray" as="p" mt="1" style={{ opacity: 0.8 }}>
              Download a finished rip as a zip, with a rekordbox collection alongside. Rips
              stay here for a week.
            </Text>
            <Flex direction="column" gap="2" mt="2">
              {finished.map((r) => {
                const n = r.trackIds?.length ?? 0;
                return (
                  <Flex key={r._id} justify="between" gap="2" align="center">
                    <Flex direction="column" style={{ minWidth: 0, flex: "1 1 auto" }}>
                      <Text size="1" color="gray" truncate>
                        {r.url}
                      </Text>
                      <Text size="1" color="gray" style={{ opacity: 0.6 }}>
                        {n} track{n === 1 ? "" : "s"}
                        {r.finishedAt ? ` · ${new Date(r.finishedAt).toLocaleDateString()}` : ""}
                        {r.playlistName ? ` · → ${r.playlistName}` : ""}
                      </Text>
                    </Flex>
                    <Flex gap="2" align="center" style={{ flexShrink: 0 }}>
                      <Button size="1" variant="surface" disabled={busy} onClick={() => onDownload(r)}>
                        Download zip
                      </Button>
                      <IconButton
                        size="1"
                        variant="ghost"
                        color="gray"
                        title="Remove from this list (the tracks stay in the library)"
                        aria-label="Remove from this list"
                        onClick={() => void dismissRip({ requestId: r._id })}
                      >
                        ✕
                      </IconButton>
                    </Flex>
                  </Flex>
                );
              })}
            </Flex>
          </>
        )}

        {recent.length > 0 && (
          <>
            <Separator size="4" my="4" />
            <Text size="2" weight="bold">
              Couldn't get these
            </Text>
            <Text size="1" color="gray" as="p" mt="1" style={{ opacity: 0.8 }}>
              SoundCloud rate-limited them. Queue the same link again — anything already in the
              library is skipped, so it only picks up what's missing.
            </Text>
            <Flex direction="column" gap="1" mt="2">
              {recent.map((r) => (
                <Flex key={r._id} direction="column" gap="1">
                  <Text size="1" color="gray" truncate style={{ opacity: 0.7 }}>
                    {r.url}
                  </Text>
                  {(r.rateLimited ?? []).map((title) => (
                    <Text key={title} size="1" color="gray" truncate style={{ paddingLeft: "10px" }}>
                      · {title}
                    </Text>
                  ))}
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
    );
  },
);
