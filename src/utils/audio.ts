// Audio helpers for the DJs library.

import type { Quality } from "../../convex/schema";

export const LOSSLESS_EXTS = ["wav", "flac", "aiff", "aif"];

export const QUALITY_LABEL: Record<Quality, string> = {
  lossless: "Lossless",
  "mp3-320": "MP3 320",
  "aac-256": "AAC 256",
  "aac-160": "AAC 160",
  "aac-96": "AAC 96",
  other: "Other",
};

/** Best first, for sorting and for the filter row. */
export const QUALITY_ORDER: Quality[] = [
  "lossless",
  "mp3-320",
  "aac-256",
  "aac-160",
  "aac-96",
  "other",
];

export const extOf = (filename: string): string =>
  (filename.split(".").pop() ?? "").toLowerCase();

/**
 * Work out a quality tier for an uploaded file.
 *
 * The browser can't read a container's declared bitrate without pulling in a
 * parser, so for lossy files we estimate from size and duration and snap to the
 * nearest tier. The ripper sends exact values instead, since it has ffprobe.
 */
export function inferQuality(
  filename: string,
  sizeBytes: number,
  durationSec: number | undefined,
): { quality: Quality; bitrateKbps?: number } {
  const ext = extOf(filename);
  if (LOSSLESS_EXTS.includes(ext)) return { quality: "lossless" };

  if (!durationSec || durationSec <= 0) return { quality: "other" };

  const kbps = Math.round((sizeBytes * 8) / durationSec / 1000);

  if (ext === "mp3") {
    if (kbps >= 290) return { quality: "mp3-320", bitrateKbps: kbps };
    if (kbps >= 130) return { quality: "aac-160", bitrateKbps: kbps };
    return { quality: "aac-96", bitrateKbps: kbps };
  }

  if (kbps >= 290) return { quality: "mp3-320", bitrateKbps: kbps };
  if (kbps >= 210) return { quality: "aac-256", bitrateKbps: kbps };
  if (kbps >= 130) return { quality: "aac-160", bitrateKbps: kbps };
  if (kbps >= 70) return { quality: "aac-96", bitrateKbps: kbps };
  return { quality: "other", bitrateKbps: kbps };
}

/** Read a local file's duration by letting the browser decode its header. */
export function readDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");

    const done = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      done(Number.isFinite(audio.duration) ? audio.duration : undefined);
    audio.onerror = () => done(undefined);
    audio.src = url;

    // Some containers never fire either event; don't hang the upload on it.
    setTimeout(() => done(undefined), 8000);
  });
}

/**
 * Upload limits, mirrored from convex/djs.ts so the UI can refuse a file
 * before spending time uploading it. The server enforces these too.
 */
export const MAX_AUDIO_BYTES = 300 * 1024 * 1024;
export const MAX_COVER_BYTES = 10 * 1024 * 1024;
export const ALLOWED_EXTS = ["m4a", "mp3", "wav", "flac", "aiff", "aif", "opus", "ogg"];

/** Tempos outside this range are detection or typing errors, not music. */
export const MIN_BPM = 80;
export const MAX_BPM = 200;

/** Why a file can't be uploaded, or null if it's fine. */
export function rejectReason(file: File): string | null {
  const ext = extOf(file.name);
  if (!ALLOWED_EXTS.includes(ext)) {
    return `${file.name}: .${ext || "?"} isn't a supported audio format (${ALLOWED_EXTS.join(", ")})`;
  }
  if (file.size <= 0) return `${file.name}: file is empty`;
  if (file.size > MAX_AUDIO_BYTES) {
    return `${file.name}: ${Math.round(file.size / 1024 / 1024)} MB is over the ${Math.round(
      MAX_AUDIO_BYTES / 1024 / 1024,
    )} MB limit`;
  }
  return null;
}

/** BPM buckets for the filter row, chosen around club tempo ranges. */
export const BPM_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "<100", min: 0, max: 99.999 },
  { label: "100–119", min: 100, max: 119.999 },
  { label: "120–129", min: 120, max: 129.999 },
  { label: "130–139", min: 130, max: 139.999 },
  { label: "140–149", min: 140, max: 149.999 },
  { label: "150–169", min: 150, max: 169.999 },
  { label: "170+", min: 170, max: Infinity },
];

export const bucketForBpm = (bpm: number | undefined): string | undefined =>
  bpm === undefined ? undefined : BPM_BUCKETS.find((b) => bpm >= b.min && bpm <= b.max)?.label;

/**
 * Estimate a single tempo for a whole track.
 *
 * Runs in the browser so it covers uploads as well as rips. The approach is
 * deliberately simple: isolate the kick band, build an onset-energy envelope,
 * and autocorrelate it. That gives one global BPM, which is what a DJ library
 * wants -- no attempt is made to follow tempo changes.
 *
 * Returns undefined rather than a guess when the signal is too weak to call.
 */
export async function detectBpm(file: File | ArrayBuffer): Promise<number | undefined> {
  const AudioCtx: typeof OfflineAudioContext =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!AudioCtx) return undefined;

  const bytes = file instanceof ArrayBuffer ? file : await file.arrayBuffer();

  // Decode, then re-render through a low-pass so the envelope tracks the kick
  // rather than hats and vocals.
  let decoded: AudioBuffer;
  try {
    const probe = new AudioCtx(1, 1, 44100);
    decoded = await probe.decodeAudioData(bytes.slice(0));
  } catch {
    return undefined;
  }

  // Analyse a middle slice; intros and outros are often free-time.
  const sr = decoded.sampleRate;
  const wantSec = Math.min(60, decoded.duration);
  const startSec = Math.max(0, (decoded.duration - wantSec) / 2);
  const length = Math.floor(wantSec * sr);
  if (length < sr * 5) return undefined;

  const offline = new AudioCtx(1, length, sr);
  const src = offline.createBufferSource();

  const slice = offline.createBuffer(1, length, sr);
  const mono = slice.getChannelData(0);
  const chans = Math.min(decoded.numberOfChannels, 2);
  const offset = Math.floor(startSec * sr);
  for (let c = 0; c < chans; c += 1) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < length; i += 1) mono[i] += (data[offset + i] ?? 0) / chans;
  }

  src.buffer = slice;
  const lp = offline.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 160;
  lp.Q.value = 1;
  src.connect(lp);
  lp.connect(offline.destination);
  src.start(0);

  const filtered = (await offline.startRendering()).getChannelData(0);

  // Onset envelope: positive frame-to-frame energy change, ~5ms frames.
  const hop = Math.floor(sr * 0.005);
  const frames = Math.floor(filtered.length / hop);
  const env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i += 1) sum += filtered[i] * filtered[i];
    const rms = Math.sqrt(sum / hop);
    env[f] = Math.max(0, rms - prev);
    prev = rms;
  }

  // Autocorrelate over lags covering 60–200 BPM.
  const envRate = sr / hop;
  const minLag = Math.floor((60 / 200) * envRate);
  const maxLag = Math.ceil((60 / 60) * envRate);
  if (maxLag >= frames) return undefined;

  let bestLag = 0;
  let best = 0;
  let total = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let acc = 0;
    for (let f = 0; f + lag < frames; f += 1) acc += env[f] * env[f + lag];
    acc /= frames - lag;
    total += acc;
    if (acc > best) {
      best = acc;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || best <= 0) return undefined;

  // A flat autocorrelation means no steady pulse -- don't invent one.
  const mean = total / (maxLag - minLag + 1);
  if (best < mean * 1.6) return undefined;

  let bpm = (60 * envRate) / bestLag;
  // Octave-snap into the range club tracks actually live in. Autocorrelation
  // happily locks onto half or double time, so this folds those back.
  while (bpm < MIN_BPM) bpm *= 2;
  while (bpm > MAX_BPM) bpm /= 2;

  return Math.round(bpm * 10) / 10;
}

export const formatDuration = (sec: number | undefined): string => {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${Math.round(bytes / 1024 / 1024)} MB`;
