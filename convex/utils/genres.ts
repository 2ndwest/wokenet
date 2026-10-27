// Genre normalization for the DJs library.
//
// SoundCloud's genre field is free text, so the same genre arrives in many
// shapes ("ukgarage", "UK Garage", "nukg") and often carries several genres in
// one string ("baile funk / jersey"). This turns that mess into a small set of
// canonical tags so filtering actually groups things.

/** Separators that mean "this string holds more than one genre". */
const SPLIT_PATTERN = /\s*(?:\/|,|;|\||\+|\bx\b|\band\b)\s*/i;

/**
 * Genres whose canonical form contains a separator, so they'd be torn in half
 * by SPLIT_PATTERN. Matched against the whole string before any splitting.
 */
const ATOMIC_ALIASES: Record<string, string> = {
  "dance & edm": "Dance & EDM",
  "drum & bass": "Drum & Bass",
  "drum and bass": "Drum & Bass",
  "drum n bass": "Drum & Bass",
  "drum'n'bass": "Drum & Bass",
  dnb: "Drum & Bass",
  "d&b": "Drum & Bass",
  "r&b": "R&B",
  rnb: "R&B",
  "r and b": "R&B",
  "rhythm and blues": "R&B",
  "rock & roll": "Rock & Roll",
  "rock and roll": "Rock & Roll",
  "drill & bass": "Drill & Bass",
  // SoundCloud's own upload categories. Most uploads carry one of these
  // verbatim, so the compound ones fold onto the tag we already use.
  "hip-hop & rap": "Hip Hop",
  "hip hop & rap": "Hip Hop",
  "hip hop and rap": "Hip Hop",
  "rap & hip hop": "Hip Hop",
  "r&b & soul": "R&B",
  "jazz & blues": "Jazz",
  "folk & singer-songwriter": "Folk",
  "folk & singer songwriter": "Folk",
  "alternative rock": "Rock",
  "drum 'n' bass": "Drum & Bass",
  "drum n' bass": "Drum & Bass",
  "drumnbass": "Drum & Bass",
};

/** Maps a single normalized fragment onto its canonical display name. */
const ALIASES: Record<string, string> = {
  // UK garage family
  ukg: "UK Garage",
  ukgarage: "UK Garage",
  "uk garage": "UK Garage",
  nukg: "UK Garage",
  "nu uk garage": "UK Garage",
  "speed garage": "Speed Garage",
  garage: "Garage",
  // House family
  house: "House",
  "tech house": "Tech House",
  "deep house": "Deep House",
  "bass house": "Bass House",
  "afro house": "Afro House",
  "funky house": "Funky House",
  "jackin house": "House",
  // Techno family
  techno: "Techno",
  "hard techno": "Hard Techno",
  "hardgroove": "Hard Techno",
  // Bass / breaks
  dubstep: "Dubstep",
  bass: "Bass",
  breakbeat: "Breakbeat",
  breaks: "Breakbeat",
  jungle: "Jungle",
  // Brazilian / Latin club
  "baile funk": "Baile Funk",
  bailefunk: "Baile Funk",
  baile: "Baile Funk",
  "funk brasileiro": "Baile Funk",
  "brazilian funk": "Baile Funk",
  funk: "Funk",
  mandelao: "Baile Funk",
  "baile tech": "Baile Tech",
  "jersey club": "Jersey Club",
  jerseyclub: "Jersey Club",
  jersey: "Jersey Club",
  "jersey drill": "Jersey Drill",
  "baltimore club": "Baltimore Club",
  reggaeton: "Reggaeton",
  regeton: "Reggaeton",
  reguetón: "Reggaeton",
  regueton: "Reggaeton",
  perreo: "Perreo",
  dariaperreo: "Perreo",
  dembow: "Dembow",
  guaracha: "Guaracha",
  guarachaton: "Guarachatón",
  gurachaton: "Guarachatón",
  guarachatón: "Guarachatón",
  uwuaracha: "Guaracha",
  latincore: "Latincore",
  latinclub: "Latin Club",
  "latin club": "Latin Club",
  latin: "Latin",
  tribal: "Tribal",
  kremayera: "Kremayera",
  // Rap / pop. Hip hop and rap are one tag: SoundCloud files them together
  // and nobody wants to tick both chips.
  "hip hop": "Hip Hop",
  hiphop: "Hip Hop",
  rap: "Hip Hop",
  "hip hop rap": "Hip Hop",
  "rap music": "Hip Hop",
  "us rap": "Hip Hop",
  "uk rap": "Hip Hop",
  "underground rap": "Hip Hop",
  "underground hip hop": "Hip Hop",
  "gangsta rap": "Hip Hop",
  "east coast": "Hip Hop",
  "west coast": "Hip Hop",
  "southern hip hop": "Hip Hop",
  "trap rap": "Trap",
  "uk drill": "Drill",
  "ny drill": "Drill",
  "bronx drill": "Drill",
  "brooklyn drill": "Drill",
  "chicago drill": "Drill",
  trap: "Trap",
  phonk: "Phonk",
  drill: "Drill",
  pop: "Pop",
  hyperpop: "Hyperpop",
  // Rave / hard
  rave: "Rave",
  hardstyle: "Hardstyle",
  hardcore: "Hardcore",
  gabber: "Gabber",
  trance: "Trance",
  edm: "EDM",
  electronic: "Electronic",
  electronica: "Electronic",
  electro: "Electro",
  hardtekk: "Hardtekk",
  hypertechno: "Hypertechno",
  "speed house": "Speed House",
  "miami bass": "Miami Bass",
  club: "Club",
  dance: "Dance",
  // Descriptors people genuinely filter on
  edit: "Edit",
  edits: "Edit",
  remix: "Remix",
  remixes: "Remix",
  bootleg: "Bootleg",
  mashup: "Mashup",
  flip: "Flip",
  vip: "VIP",

  // --- broader coverage, so unknown fragments stay rare ---
  // House
  "progressive house": "Progressive House",
  "future house": "Future House",
  "tribal house": "Tribal House",
  "acid house": "Acid House",
  "disco house": "Disco House",
  "ghetto house": "Ghetto House",
  "jackin": "House",
  amapiano: "Amapiano",
  afrobeats: "Afrobeats",
  afrobeat: "Afrobeats",
  // Techno / hard
  "melodic techno": "Melodic Techno",
  "acid techno": "Acid Techno",
  "detroit techno": "Techno",
  "minimal techno": "Techno",
  minimal: "Minimal",
  schranz: "Hard Techno",
  "hard dance": "Hard Dance",
  hardtechno: "Hard Techno",
  hands_up: "Hardstyle",
  "happy hardcore": "Hardcore",
  frenchcore: "Hardcore",
  uptempo: "Hardcore",
  donk: "Donk",
  makina: "Makina",
  // Bass / breaks / garage
  "future garage": "Future Garage",
  bassline: "Bassline",
  grime: "Grime",
  "uk funky": "UK Funky",
  "liquid dnb": "Drum & Bass",
  neurofunk: "Drum & Bass",
  "jump up": "Drum & Bass",
  footwork: "Footwork",
  juke: "Footwork",
  "jungle terror": "Jungle",
  riddim: "Riddim",
  brostep: "Dubstep",
  "future bass": "Future Bass",
  "wave": "Wave",
  "hard wave": "Hardwave",
  hardwave: "Hardwave",
  // Club / regional
  "ballroom": "Ballroom",
  vogue: "Ballroom",
  "philly club": "Philly Club",
  "nj club": "Jersey Club",
  "chicago juke": "Footwork",
  kuduro: "Kuduro",
  gqom: "Gqom",
  "singeli": "Singeli",
  "funk carioca": "Baile Funk",
  "funk mandelao": "Baile Funk",
  "brega funk": "Brega Funk",
  "funk automotivo": "Funk Automotivo",
  "rasteirinha": "Baile Funk",
  // Latin
  "latin house": "Latin House",
  salsa: "Salsa",
  bachata: "Bachata",
  cumbia: "Cumbia",
  merengue: "Merengue",
  "tribal guarachero": "Tribal",
  aleteo: "Aleteo",
  zapateo: "Aleteo",
  "changa tuki": "Changa Tuki",
  "neoperreo": "Neoperreo",
  "neo perreo": "Neoperreo",
  "perreo intenso": "Perreo",
  corridos: "Corridos",
  "corridos tumbados": "Corridos",
  // Rap / pop / rock
  "boom bap": "Hip Hop",
  "cloud rap": "Cloud Rap",
  "rage": "Rage",
  "plugg": "Plugg",
  "pluggnb": "PluggnB",
  "jersey rap": "Jersey Club",
  "sped up": "Sped Up",
  spedup: "Sped Up",
  nightcore: "Nightcore",
  "bedroom pop": "Bedroom Pop",
  indie: "Indie",
  "indie rock": "Indie Rock",
  punk: "Punk",
  metal: "Metal",
  emo: "Emo",
  "shoegaze": "Shoegaze",
  rock: "Rock",
  pop_punk: "Pop Punk",
  // Downtempo / ambient / other
  ambient: "Ambient",
  downtempo: "Downtempo",
  "trip hop": "Trip Hop",
  "lo fi": "Lo-Fi",
  lofi: "Lo-Fi",
  jazz: "Jazz",
  soul: "Soul",
  disco: "Disco",
  "nu disco": "Nu Disco",
  "italo disco": "Italo Disco",
  "hi nrg": "Hi-NRG",
  synthpop: "Synthpop",
  "new wave": "New Wave",
  ebm: "EBM",
  industrial: "Industrial",
  "hyper techno": "Hypertechno",
  "girl edm": "Girl EDM",
  "world": "World",

  // --- more of the long tail ---
  // House / techno
  "electro house": "Electro House",
  "big room": "Big Room",
  "melodic house": "Melodic House",
  "organic house": "Organic House",
  "slap house": "Slap House",
  "minimal house": "Minimal",
  "deep tech": "Deep House",
  "uk house": "House",
  "chicago house": "House",
  "classic house": "House",
  "peak time techno": "Techno",
  "industrial techno": "Techno",
  "raw techno": "Hard Techno",
  "hard house": "Hard House",
  psytrance: "Psytrance",
  "psy trance": "Psytrance",
  psy: "Psytrance",
  goa: "Psytrance",
  "progressive trance": "Trance",
  "uplifting trance": "Trance",
  "tech trance": "Trance",
  // Bass / breaks
  "uk bass": "UK Bass",
  "bass music": "Bass",
  breakcore: "Breakcore",
  idm: "IDM",
  "uk hardcore": "Hardcore",
  "uk garage 2step": "UK Garage",
  "2 step": "UK Garage",
  "2step": "UK Garage",
  "liquid": "Drum & Bass",
  "liquid funk": "Drum & Bass",
  // Club / regional
  "club music": "Club",
  "club edit": "Club",
  "jersey club music": "Jersey Club",
  "jerz": "Jersey Club",
  "sexy drill": "Jersey Drill",
  "bmore club": "Baltimore Club",
  "bmore": "Baltimore Club",
  "booty bass": "Miami Bass",
  ghettotech: "Ghettotech",
  "ghetto tech": "Ghettotech",
  "detroit ghettotech": "Ghettotech",
  "funk bh": "Baile Funk",
  "funk rj": "Baile Funk",
  "funk sp": "Baile Funk",
  "funk mtg": "Baile Funk",
  mtg: "Baile Funk",
  montagem: "Baile Funk",
  "phonk brasileiro": "Phonk",
  "brazilian phonk": "Phonk",
  "drift phonk": "Phonk",
  // Caribbean / African
  dancehall: "Dancehall",
  reggae: "Reggae",
  soca: "Soca",
  afroswing: "Afrobeats",
  "afro beats": "Afrobeats",
  "afro pop": "Afrobeats",
  // Latin
  "reggaeton viejo": "Reggaeton",
  "latin trap": "Latin Trap",
  "trap latino": "Latin Trap",
  "dembow dominicano": "Dembow",
  moombahton: "Moombahton",
  "rkt": "RKT",
  "cachengue": "Cachengue",
  "cumbia villera": "Cumbia",
  // Pop / other
  "k pop": "K-Pop",
  kpop: "K-Pop",
  "j pop": "J-Pop",
  jpop: "J-Pop",
  "pop rap": "Hip Hop",
  "r b": "R&B",
  "rnb soul": "R&B",
  "neo soul": "Soul",
  "electro pop": "Synthpop",
  electropop: "Synthpop",
  folk: "Folk",
  country: "Country",
  classical: "Classical",
  piano: "Piano",
  soundtrack: "Soundtrack",
  "trip-hop": "Trip Hop",
  triphop: "Trip Hop",
  chill: "Chill",
  chillout: "Chill",
  "chill out": "Chill",
  experimental: "Experimental",
};

/**
 * Values that are technically genres but useless as a filter -- they'd match
 * everything or nothing. Edit this list to taste; it's the only place that
 * decides what gets thrown away.
 */
const JUNK = new Set([
  "music",
  "musica",
  "audio",
  "song",
  "songs",
  "track",
  "tracks",
  "other",
  "others",
  "misc",
  "miscellaneous",
  "unknown",
  "none",
  "null",
  "n/a",
  "na",
  "untitled",
  "random",
  "stuff",
  "things",
  "new",
  "newmusic",
  "free",
  "free dl",
  "freedl",
  "dl",
  "download",
  "free download",
  "soundcloud",
  "sc",
  "mix",
  "mixes",
  "set",
  "dj",
  "djs",
  "idk",
  "whatever",
  "test",
  "-",
  "--",
  "???",
  "?",
  // SoundCloud upload-category leftovers and promo noise
  "business",
  "podcast",
  "podcasts",
  "primicia",
  "moneymusic",
  "boilerroom",
  "spedup",
  "tiktok",
  "nuevo",
  "nueva",
  "session",
  "pack",
  // Uploader-invented labels that aren't genres anyone would filter by.
  "baile brat",
  "kremayera",
  "brat",
  // English/Spanish stopwords that show up when people comma-spam keywords
  "the",
  "for",
  "and",
  "a",
  "an",
  "of",
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "con",
  "mi",
  "my",
  "looking",
]);

/**
 * More fragments than this and the string is a keyword list rather than a
 * genre -- e.g. "House, Dombresky, SHELLS" (a genre plus two artists) or
 * "Sexyy Red, DJ Sliink, Remix, Rap, Looking, For, The, Hoes".
 *
 * Above the threshold we keep only fragments we actually recognize. Genuine
 * multi-genre strings still come through whole, because known genres always
 * pass -- it's only unknown fragments that get dropped.
 */
const SPAM_FRAGMENT_THRESHOLD = 2;

/**
 * Find the canonical tag for one cleaned fragment, trying the spellings people
 * actually use for the same thing: "hip-hop", "hip hop" and "hiphop" are one
 * genre, and "house music" is just house.
 */
function lookup(frag: string): string | undefined {
  const candidates = [frag, frag.replace(/-/g, " "), frag.replace(/[-\s]/g, "")];
  const withoutMusic = frag.replace(/\s+(?:music|musik|musica)$/, "");
  if (withoutMusic !== frag) candidates.push(withoutMusic, withoutMusic.replace(/-/g, " "));
  for (const c of candidates) {
    const hit = ATOMIC_ALIASES[c] ?? ALIASES[c];
    if (hit) return hit;
  }
  return undefined;
}

/** Technical metadata that leaks into the genre field. */
function isTechnicalJunk(frag: string): boolean {
  return frag.includes("=") || frag.includes(":") || frag.startsWith("soundcloud");
}

/** Word count ignoring "&", so "dance & edm" counts as two words. */
function wordCount(frag: string): number {
  return frag.replace(/&/g, " ").split(/\s+/).filter(Boolean).length;
}

/** Lowercase, strip decoration, collapse whitespace. */
function clean(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[[\](){}<>*_~"'!.#]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that should stay fully capitalized when we title-case an unknown tag. */
const ACRONYMS = new Set([
  "edm", "uk", "us", "dj", "vip", "nyc", "la", "atl", "bpm", "idm", "ukg",
  "dnb", "rnb", "nrg", "ebm", "psy", "mpc", "jp", "br", "cdj", "hq",
]);

/** Title-case a fragment we have no alias for, so display stays tidy. */
function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => {
      if (ACRONYMS.has(w)) return w.toUpperCase();
      return w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}

/**
 * Turn one raw genre string into zero or more canonical genre tags.
 *
 * Returns [] when the input is empty or entirely junk -- callers should treat
 * that as "untagged" rather than inventing a genre.
 */
export function normalizeGenre(raw: string | undefined | null): string[] {
  if (!raw) return [];
  if (isTechnicalJunk(raw.toLowerCase())) return [];

  const base = clean(raw);
  if (base.length === 0 || JUNK.has(base)) return [];

  // Whole-string match first, so "drum & bass" survives splitting.
  const whole = lookup(base);
  if (whole) return [whole];

  const fragments = base
    .split(SPLIT_PATTERN)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Long fragment lists are keyword spam, so demand a known genre.
  const knownOnly = fragments.length > SPAM_FRAGMENT_THRESHOLD;

  const out: string[] = [];
  for (const frag of fragments) {
    if (JUNK.has(frag) || isTechnicalJunk(frag)) continue;
    if (/^\d+$/.test(frag)) continue;

    const known = lookup(frag);
    if (!known && knownOnly) continue;
    // Unknown multi-word fragments are usually track/pack names, not genres.
    if (!known && wordCount(frag) > 2) continue;

    const mapped = known ?? titleCase(frag);
    if (mapped.length < 2) continue;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * Normalize a genre a person typed by hand.
 *
 * Deliberately gentler than normalizeGenre: someone typing "certified banger
 * music" means it, so none of the junk/spam/length heuristics apply. Those
 * exist to clean up scraped file metadata, not to overrule a human. We still
 * tidy whitespace and fold aliases so hand-typed "ukgarage" lands on the same
 * tag as everything else.
 */
export function normalizeUserGenre(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const base = clean(raw);
  if (base.length === 0) return [];

  // Known genres still fold to one canonical spelling, so the library doesn't
  // end up with "Techno" and "TECHNO" as separate chips.
  const known = lookup(base);
  if (known) return [known];

  // For anything we don't recognize, respect how it was typed: any capital
  // ("PUTZ PARTY", "BIG Room", "hElO") is a deliberate choice on a custom tag,
  // not something to tidy away. Only all-lowercase gets title-cased.
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (/[A-Z]/.test(trimmed)) return [trimmed];

  return [titleCase(base)];
}

/** Normalize a list of hand-typed genres, deduped. */
export function normalizeUserGenres(raws: (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const raw of raws) {
    for (const g of normalizeUserGenre(raw)) {
      if (!out.includes(g)) out.push(g);
    }
  }
  return out;
}

/** Normalize a whole list of raw genres into a deduped canonical set. */
export function normalizeGenres(raws: (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const raw of raws) {
    for (const g of normalizeGenre(raw)) {
      if (!out.includes(g)) out.push(g);
    }
  }
  return out;
}
