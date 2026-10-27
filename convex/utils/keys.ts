// Musical key normalization for the DJs library.
//
// Rekordbox exports Tonality in whichever notation the user has configured, so
// the same key arrives as "8A", "Am", "A min" or Open Key "3m". Everything is
// folded to Camelot, which is what the wheel on a CDJ shows and what DJs
// actually mix by.
//
// Camelot: 1-12 around the wheel, A = minor, B = major. So A minor is 8A and
// C major is 8B -- relative keys share a number.

const MAJOR_TO_CAMELOT: Record<string, number> = {
  b: 1,
  "f#": 2, gb: 2,
  db: 3, "c#": 3,
  ab: 4, "g#": 4,
  eb: 5, "d#": 5,
  bb: 6, "a#": 6,
  f: 7,
  c: 8,
  g: 9,
  d: 10,
  a: 11,
  e: 12,
};

const MINOR_TO_CAMELOT: Record<string, number> = {
  ab: 1, "g#": 1,
  eb: 2, "d#": 2,
  bb: 3, "a#": 3,
  f: 4,
  c: 5,
  g: 6,
  d: 7,
  a: 8,
  e: 9,
  b: 10,
  "f#": 11, gb: 11,
  db: 12, "c#": 12,
};

/** Camelot -> the musical name, for display when someone prefers it. */
export function camelotToMusical(camelot: string): string | undefined {
  const m = /^(\d{1,2})([ab])$/i.exec(camelot.trim());
  if (!m) return undefined;
  const num = Number(m[1]);
  const minor = m[2].toLowerCase() === "a";
  const table = minor ? MINOR_TO_CAMELOT : MAJOR_TO_CAMELOT;
  const root = Object.keys(table).find((k) => table[k] === num && !k.includes("#"));
  if (!root) return undefined;
  const name = root.charAt(0).toUpperCase() + root.slice(1);
  return minor ? `${name}m` : name;
}

/**
 * Normalize any key notation to Camelot, e.g. "Am" -> "8A".
 *
 * Accepts Camelot ("8A", "8 A"), Open Key ("1m", "1d"), and musical names in
 * the shapes Rekordbox and Mixed In Key emit ("Am", "A min", "Amin", "A minor",
 * "C#m", "Dbmaj"). Returns undefined when it can't tell, so a bad value is
 * dropped rather than silently mangled into the wrong key.
 */
export function normalizeKey(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (s.length === 0) return undefined;

  // Already Camelot: 1A-12B.
  const camelot = /^(\d{1,2})([ab])$/.exec(s);
  if (camelot) {
    const n = Number(camelot[1]);
    if (n >= 1 && n <= 12) return `${n}${camelot[2].toUpperCase()}`;
  }

  // Open Key: 1d-12d (major) and 1m-12m (minor). Camelot = openKey + 7, wrapped.
  const openKey = /^(\d{1,2})([dm])$/.exec(s);
  if (openKey) {
    const n = Number(openKey[1]);
    if (n >= 1 && n <= 12) {
      const wheel = ((n + 6) % 12) + 1;
      return `${wheel}${openKey[2] === "m" ? "A" : "B"}`;
    }
  }

  // Musical name: root plus an optional quality.
  const musical = /^([a-g][#b]?)(.*)$/.exec(s);
  if (!musical) return undefined;

  const root = musical[1];
  const rest = musical[2];

  const isMinor =
    rest.startsWith("m") && !rest.startsWith("maj")
      ? true
      : rest.startsWith("min")
        ? true
        : false;
  const isMajor = rest === "" || rest.startsWith("maj") || rest === "d";

  if (!isMinor && !isMajor) return undefined;

  const num = isMinor ? MINOR_TO_CAMELOT[root] : MAJOR_TO_CAMELOT[root];
  if (!num) return undefined;

  return `${num}${isMinor ? "A" : "B"}`;
}
