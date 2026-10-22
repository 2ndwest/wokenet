// Duplicate detection for the DJs library.
//
// The same track commonly arrives twice from different sources -- a SoundCloud
// rip and a rekordbox import, say -- under different filenames and at
// different bitrates. File size is useless for matching those (the encodes
// differ) and so is filename. What does hold is the recording itself: the same
// track is the same length, and its title survives re-encoding.
//
// So the key is a normalized title plus the duration in whole seconds. That is
// deliberately strict: an edit or a remix differs in length and stays separate.

/** Quality tiers, best first. Used to decide which copy of a duplicate wins. */
const QUALITY_RANK: Record<string, number> = {
  lossless: 0,
  "mp3-320": 1,
  "aac-256": 2,
  "aac-160": 3,
  "aac-96": 4,
  other: 5,
};

export const qualityRank = (quality: string): number => QUALITY_RANK[quality] ?? 99;

/**
 * Strip a title down to the recording it names.
 *
 * Removes our NNN. playlist-position prefix, trailing download-site ids
 * (…-639308762), bracketed noise, and punctuation, so two spellings of the
 * same track collapse together.
 */
export function normalizeTitle(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/^\d{3}\.\s*/, "")
      .replace(/-\d{6,}$/, "")
      .replace(/\.(m4a|mp3|wav|flac|aiff|aif|opus|ogg)$/i, "")
      .replace(/[‘’“”]/g, "")
      // Fold accents before stripping punctuation, or "Azótame" and "Azotame"
      // would differ -- common across this library's Spanish titles.
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "")
  );
}

/**
 * The key two tracks must share to count as the same recording, or null when
 * we can't tell (no duration means no confident match, so leave it alone).
 */
export function duplicateKey(title: string, durationSec: number | undefined | null): string | null {
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) {
    return null;
  }
  const name = normalizeTitle(title);
  if (name.length < 3) return null; // too generic to match on
  return `${name}|${Math.round(durationSec)}`;
}

export type DuplicateCandidate = {
  _id: string;
  title: string;
  durationSec?: number;
  quality: string;
  uploadedAt: number;
};

/**
 * Group tracks that are the same recording. Singletons are dropped, so the
 * result only contains groups that actually need merging.
 *
 * Within a group the winner is the highest quality copy; ties go to the oldest,
 * so the original upload keeps its place and its credit.
 */
export function groupDuplicates<T extends DuplicateCandidate>(tracks: T[]): { keep: T; drop: T[] }[] {
  const byKey = new Map<string, T[]>();

  for (const t of tracks) {
    const key = duplicateKey(t.title, t.durationSec);
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(t);
    else byKey.set(key, [t]);
  }

  const groups: { keep: T; drop: T[] }[] = [];
  for (const bucket of byKey.values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort(
      (a, b) => qualityRank(a.quality) - qualityRank(b.quality) || a.uploadedAt - b.uploadedAt,
    );
    groups.push({ keep: sorted[0], drop: sorted.slice(1) });
  }
  return groups;
}
