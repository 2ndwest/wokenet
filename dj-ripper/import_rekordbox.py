#!/usr/bin/env python3
"""
Import a whole rekordbox collection into the wokenet DJs library.

A rekordbox.xml holds no audio -- it is a catalogue of file paths plus the
analysis rekordbox did (tempo, key, cue points). This reads that catalogue,
uploads the audio it points at, and carries the analysis across, so tracks
arrive with accurate BPM, key and cues rather than estimates.

    export WOKENET_SITE_URL="https://<your-deployment>.convex.site"
    export DJ_RIPPER_SECRET="<same secret as on the Convex dashboard>"
    python3 import_rekordbox.py ~/Documents/library.xml --dj nicorios --dry-run

Tracks already in the library (matched by filename) are skipped, so running it
again only adds what's new.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

import wokenet

AUDIO_EXTS = {".m4a", ".mp3", ".wav", ".flac", ".aiff", ".aif"}

# Rekordbox ships its own sampler and demo content. Nobody wants SINEWAVE.wav
# in a shared music library.
SYSTEM_PATH_HINTS = (
    "/rekordbox/Sampler/",
    "/PRESET ONESHOT/",
    "/rekordbox/Demo",
)
SYSTEM_NAME_HINTS = ("demo track",)


def local_path(location: str) -> Path:
    """Turn a rekordbox Location URI into a path on this machine."""
    return Path(urllib.parse.unquote(location).replace("file://localhost", ""))


def is_system_content(path: Path, title: str) -> bool:
    s = str(path)
    if any(h in s for h in SYSTEM_PATH_HINTS):
        return True
    return any(h in title.lower() for h in SYSTEM_NAME_HINTS)


def cues_from(track: ET.Element) -> tuple[list[dict], list[dict]]:
    """Split POSITION_MARKs into hot cues (Num 0-7) and memory cues (Num -1)."""
    hot: list[dict] = []
    memory: list[dict] = []

    for mark in track.findall("POSITION_MARK"):
        try:
            start_ms = round(float(mark.get("Start", "nan")) * 1000)
        except ValueError:
            continue

        cue: dict = {"name": (mark.get("Name") or "").strip(), "timeMs": start_ms}
        num = int(mark.get("Num", "-1") or -1)

        if num >= 0:
            cue["slot"] = num
            r, g, b = mark.get("Red"), mark.get("Green"), mark.get("Blue")
            if r and g and b:
                cue["colorHex"] = "#%02x%02x%02x" % (int(r), int(g), int(b))
            hot.append(cue)
        else:
            memory.append(cue)

    hot.sort(key=lambda c: c.get("slot", 0))
    memory.sort(key=lambda c: c["timeMs"])
    return hot, memory


def parse(xml_path: Path) -> list[dict]:
    root = ET.parse(xml_path).getroot()
    collection = root.find("COLLECTION")
    if collection is None:
        raise SystemExit("No <COLLECTION> in that file -- is it a rekordbox export?")

    out = []
    for t in collection.findall("TRACK"):
        location = t.get("Location")
        if not location:
            continue
        path = local_path(location)
        if path.suffix.lower() not in AUDIO_EXTS:
            continue

        title = (t.get("Name") or path.stem).strip()
        hot, memory = cues_from(t)

        bpm = None
        try:
            raw = float(t.get("AverageBpm") or 0)
            if raw > 0:
                bpm = round(raw, 2)
        except ValueError:
            pass

        out.append({
            "path": path,
            "title": title,
            "artist": (t.get("Artist") or "").strip(),
            "genre": (t.get("Genre") or "").strip(),
            "bpm": bpm,
            "musicalKey": (t.get("Tonality") or "").strip(),
            "hotCues": hot,
            "memoryCues": memory,
            "system": is_system_content(path, title),
        })
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Import a rekordbox collection into wokenet.")
    ap.add_argument("xml", help="rekordbox collection export (File > Export Collection in xml)")
    ap.add_argument("--dj", required=True, help="kerb to credit, e.g. nicorios")
    ap.add_argument("--site-url", help="Convex site URL (or set WOKENET_SITE_URL)")
    ap.add_argument("--secret", help="DJ_RIPPER_SECRET (or set the env var)")
    ap.add_argument("--limit", type=int, help="only import the first N new tracks")
    ap.add_argument("--dry-run", action="store_true", help="report what would import, send nothing")
    ap.add_argument(
        "--include-system",
        action="store_true",
        help="also import rekordbox's bundled sampler and demo content",
    )
    args = ap.parse_args()

    xml_path = Path(args.xml).expanduser().resolve()
    if not xml_path.is_file():
        raise SystemExit(f"not a file: {xml_path}")

    entries = parse(xml_path)
    system = [e for e in entries if e["system"]]
    if not args.include_system:
        entries = [e for e in entries if not e["system"]]

    missing = [e for e in entries if not e["path"].exists()]
    entries = [e for e in entries if e["path"].exists()]

    dj = args.dj.strip().lower().split("@")[0]

    print(f"{xml_path.name}: {len(entries)} importable tracks")
    if system and not args.include_system:
        print(f"  skipping {len(system)} rekordbox sampler/demo files (--include-system to keep)")
    if missing:
        print(f"  skipping {len(missing)} entries whose file is missing from disk")

    if args.dry_run:
        size = sum(e["path"].stat().st_size for e in entries)
        cued = sum(1 for e in entries if e["hotCues"] or e["memoryCues"])
        analysed = sum(1 for e in entries if e["bpm"])
        print(f"  {size / 1024**3:.2f} GB, {analysed} with BPM, {cued} with cue points\n")
        for e in entries[: args.limit or 15]:
            cues = f"{len(e['hotCues'])}h/{len(e['memoryCues'])}m"
            print(f"  {str(e['bpm'] or '-'):>6}  {e['musicalKey'] or '-':<4} {cues:<8} {e['title'][:52]}")
        return

    cfg = wokenet.Config(args.site_url, args.secret)

    existing = set(wokenet.existing_filenames(cfg))
    fresh = [e for e in entries if e["path"].name not in existing]
    print(f"  {len(entries) - len(fresh)} already in the library, {len(fresh)} to upload")
    if args.limit:
        fresh = fresh[: args.limit]
    if not fresh:
        return

    tmp_dir = Path(tempfile.mkdtemp(prefix="wokenet-rbimport-"))
    added = failed = 0

    for i, e in enumerate(fresh, start=1):
        path: Path = e["path"]
        print(f"  [{i:>4}/{len(fresh)}] {e['title'][:46]:<48}", end=" ", flush=True)
        try:
            payload = wokenet.track_payload(path, dj)
            payload["title"] = e["title"] or payload["title"]
            if e["artist"]:
                payload["artist"] = e["artist"]
            if e["genre"]:
                payload["rawGenres"] = [e["genre"]]
            if e["bpm"]:
                payload["bpm"] = e["bpm"]
            if e["musicalKey"]:
                payload["musicalKey"] = e["musicalKey"]
            if e["hotCues"] or e["memoryCues"]:
                payload["hotCues"] = e["hotCues"]
                payload["memoryCues"] = e["memoryCues"]
                payload["cueSource"] = "rekordbox-xml"

            payload["storageId"] = wokenet.upload_file(cfg, path)
            cover = wokenet.upload_cover(cfg, path, tmp_dir)
            if cover:
                payload["coverId"] = cover

            wokenet.register_track(cfg, payload)
            added += 1
            bits = [payload["quality"]]
            if e["bpm"]:
                bits.append(f"{e['bpm']:g}bpm")
            if e["hotCues"] or e["memoryCues"]:
                bits.append(f"{len(e['hotCues'])}h/{len(e['memoryCues'])}m")
            print("OK  " + " ".join(bits))
        except Exception as exc:
            failed += 1
            print(f"FAILED: {exc}"[:110])

    shutil.rmtree(tmp_dir, ignore_errors=True)
    print(f"\nadded {added}, failed {failed}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\ninterrupted")
