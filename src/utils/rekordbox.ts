// Rekordbox cue import/export.
//
// Rekordbox keeps hot cues and memory cues in its own database, never in the
// audio file, so the only way to move them between machines is its XML export.
// That means the round trip has to be symmetric: we parse an XML the DJ
// exported, and we generate one they can import next to downloaded audio.
//
// Parsing lives on the client because Convex's runtime has no DOMParser.

export type Cue = {
  name: string;
  timeMs: number;
  /** Hot cue slot (0 = A, 1 = B, ...). Absent for memory cues. */
  slot?: number;
  colorHex?: string;
};

export type ParsedXmlTrack = {
  /** Basename of the file Rekordbox had, used to match our library. */
  filename: string;
  title: string;
  artist: string;
  bpm?: number;
  musicalKey?: string;
  hotCues: Cue[];
  memoryCues: Cue[];
};

const toHex = (r: string | null, g: string | null, b: string | null): string | undefined => {
  if (r === null || g === null || b === null) return undefined;
  const h = (s: string) => Number(s).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
};

/** Pull the basename out of a Rekordbox Location URI. */
const basenameFromLocation = (location: string): string => {
  try {
    // Locations look like file://localhost/Users/me/Music/track.mp3
    const path = decodeURIComponent(location.replace(/^file:\/\/(localhost)?/, ""));
    return path.split("/").pop() ?? "";
  } catch {
    return "";
  }
};

/**
 * Parse a rekordbox.xml collection export.
 *
 * Cue points are <POSITION_MARK> children of each <TRACK>. Num="-1" is a
 * memory cue; Num="0".."7" are hot cues A..H. Start is in seconds.
 */
export function parseRekordboxXml(xml: string): ParsedXmlTrack[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("That file isn't valid XML.");

  const trackNodes = Array.from(doc.querySelectorAll("DJ_PLAYLISTS > COLLECTION > TRACK"));
  if (trackNodes.length === 0) {
    throw new Error("No <COLLECTION> tracks found — is this a rekordbox collection export?");
  }

  const out: ParsedXmlTrack[] = [];

  for (const node of trackNodes) {
    const hotCues: Cue[] = [];
    const memoryCues: Cue[] = [];

    for (const mark of Array.from(node.querySelectorAll("POSITION_MARK"))) {
      const startSec = Number(mark.getAttribute("Start") ?? "NaN");
      if (!Number.isFinite(startSec)) continue;

      const num = Number(mark.getAttribute("Num") ?? "-1");
      const cue: Cue = {
        name: (mark.getAttribute("Name") ?? "").trim(),
        timeMs: Math.round(startSec * 1000),
      };

      if (num >= 0) {
        cue.slot = num;
        cue.colorHex = toHex(
          mark.getAttribute("Red"),
          mark.getAttribute("Green"),
          mark.getAttribute("Blue"),
        );
        hotCues.push(cue);
      } else {
        memoryCues.push(cue);
      }
    }

    const bpmRaw = Number(node.getAttribute("AverageBpm") ?? "NaN");
    const location = node.getAttribute("Location") ?? "";

    out.push({
      filename: basenameFromLocation(location),
      title: (node.getAttribute("Name") ?? "").trim(),
      artist: (node.getAttribute("Artist") ?? "").trim(),
      bpm: Number.isFinite(bpmRaw) && bpmRaw > 0 ? bpmRaw : undefined,
      musicalKey: (node.getAttribute("Tonality") ?? "").trim() || undefined,
      hotCues: hotCues.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)),
      memoryCues: memoryCues.sort((a, b) => a.timeMs - b.timeMs),
    });
  }

  return out;
}

/** Loose key for matching XML entries to library tracks. */
export function matchKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, "") // drop extension
    .replace(/^\d{3}\.\s*/, "") // drop our NNN. prefix
    .replace(/[^a-z0-9]+/g, "");
}

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export type ExportTrack = {
  title: string;
  artist?: string;
  filename: string;
  durationSec?: number;
  bpm?: number;
  musicalKey?: string;
  hotCues?: Cue[];
  memoryCues?: Cue[];
};

/**
 * Build a rekordbox.xml the DJ can import alongside downloaded audio.
 *
 * `folder` is where they'll keep the files. Rekordbox matches on path, so if it
 * doesn't line up they'll be asked to relocate the folder once on import.
 */
export function buildRekordboxXml(tracks: ExportTrack[], folder = "/Users/you/Music/wokenet"): string {
  const base = folder.replace(/\/+$/, "");

  const marks = (cues: Cue[] | undefined, isHot: boolean): string =>
    (cues ?? [])
      .map((c) => {
        const attrs = [
          `Name="${escapeXml(c.name)}"`,
          `Type="0"`,
          `Start="${(c.timeMs / 1000).toFixed(3)}"`,
          `Num="${isHot ? (c.slot ?? 0) : -1}"`,
        ];
        if (isHot && c.colorHex && /^#[0-9a-f]{6}$/i.test(c.colorHex)) {
          const r = parseInt(c.colorHex.slice(1, 3), 16);
          const g = parseInt(c.colorHex.slice(3, 5), 16);
          const b = parseInt(c.colorHex.slice(5, 7), 16);
          attrs.push(`Red="${r}"`, `Green="${g}"`, `Blue="${b}"`);
        }
        return `      <POSITION_MARK ${attrs.join(" ")}/>`;
      })
      .join("\n");

  const entries = tracks
    .map((t, i) => {
      const attrs = [
        `TrackID="${i + 1}"`,
        `Name="${escapeXml(t.title)}"`,
        `Artist="${escapeXml(t.artist ?? "")}"`,
        `Location="file://localhost${encodeURI(`${base}/${t.filename}`)}"`,
      ];
      if (t.durationSec) attrs.push(`TotalTime="${Math.round(t.durationSec)}"`);
      if (t.bpm) attrs.push(`AverageBpm="${t.bpm.toFixed(2)}"`);
      if (t.musicalKey) attrs.push(`Tonality="${escapeXml(t.musicalKey)}"`);

      const body = [marks(t.memoryCues, false), marks(t.hotCues, true)]
        .filter((s) => s.length > 0)
        .join("\n");

      return body.length > 0
        ? `    <TRACK ${attrs.join(" ")}>\n${body}\n    </TRACK>`
        : `    <TRACK ${attrs.join(" ")}/>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="wokenet" Version="1.0.0" Company="PUTZ"/>
  <COLLECTION Entries="${tracks.length}">
${entries}
  </COLLECTION>
</DJ_PLAYLISTS>
`;
}
