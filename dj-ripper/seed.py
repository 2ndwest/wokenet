#!/usr/bin/env python3
"""
Bulk-upload a folder of audio into the wokenet DJs library.

Use this to seed the library from tracks you already have on disk. Genres,
artist, duration and bitrate are read off each file with ffprobe; the server
normalizes the genre strings.

    export WOKENET_SITE_URL="https://<your-deployment>.convex.site"
    export DJ_RIPPER_SECRET="<same secret as on the Convex dashboard>"
    python3 seed.py ~/Downloads/putz-djs/downloads --dj nicorios

Re-running is safe: anything whose source URL is already in the library is
skipped server-side.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

import wokenet


def main() -> None:
    ap = argparse.ArgumentParser(description="Upload a folder of audio to the wokenet DJs library.")
    ap.add_argument("folder", help="folder of audio files")
    ap.add_argument("--dj", required=True, help="kerb to credit, e.g. nicorios")
    ap.add_argument("--site-url", help="Convex site URL (or set WOKENET_SITE_URL)")
    ap.add_argument("--secret", help="DJ_RIPPER_SECRET (or set the env var)")
    ap.add_argument("--limit", type=int, help="only upload the first N files")
    ap.add_argument("--dry-run", action="store_true", help="show what would upload, send nothing")
    ap.add_argument(
        "--covers-only",
        action="store_true",
        help="only extract and attach cover art to tracks already in the library "
             "(matched by filename); skips re-uploading any audio",
    )
    args = ap.parse_args()

    folder = Path(args.folder).expanduser().resolve()
    if not folder.is_dir():
        raise SystemExit(f"not a folder: {folder}")

    files = wokenet.audio_files(folder)
    if args.limit:
        files = files[: args.limit]
    if not files:
        raise SystemExit(f"no audio files in {folder}")

    dj = args.dj.strip().lower().split("@")[0]
    total_bytes = sum(f.stat().st_size for f in files)
    print(f"{len(files)} files, {total_bytes / 1024 / 1024:.0f} MB, crediting '{dj}'")

    if args.dry_run:
        for f in files:
            p = wokenet.track_payload(f, dj)
            genres = ", ".join(p.get("rawGenres", [])) or "-"
            print(f"  {p['quality']:<9} {genres:<28} {p['title'][:46]}")
        return

    cfg = wokenet.Config(args.site_url, args.secret)
    tmp_dir = Path(tempfile.mkdtemp(prefix="wokenet-seed-"))

    if args.covers_only:
        attached = none = missing = 0
        for i, path in enumerate(files, start=1):
            print(f"  [{i:>3}/{len(files)}] {path.name[:50]:<52}", end=" ", flush=True)
            cover_id = wokenet.upload_cover(cfg, path, tmp_dir)
            if not cover_id:
                none += 1
                print("no embedded art")
            elif wokenet.attach_cover(cfg, path.name, cover_id):
                attached += 1
                print("OK")
            else:
                missing += 1
                print("no matching track in library")
        shutil.rmtree(tmp_dir, ignore_errors=True)
        print(f"\nattached {attached}, {none} had no art, {missing} unmatched")
        return

    uploaded = skipped = failed = covers = 0
    for i, path in enumerate(files, start=1):
        label = path.name[:48]
        print(f"  [{i:>3}/{len(files)}] {label:<50}", end=" ", flush=True)
        try:
            payload = wokenet.track_payload(path, dj)
            payload["storageId"] = wokenet.upload_file(cfg, path)

            cover_id = wokenet.upload_cover(cfg, path, tmp_dir)
            if cover_id:
                payload["coverId"] = cover_id
                covers += 1

            result = wokenet.register_track(cfg, payload)
            if result.get("skipped"):
                skipped += 1
                print("already in library")
            else:
                uploaded += 1
                print(f"OK  {payload['quality']}")
        except Exception as exc:  # keep going; report at the end
            failed += 1
            print(f"FAILED: {exc}"[:120])

    shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"\nuploaded {uploaded}, skipped {skipped}, failed {failed}, {covers} with cover art")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\ninterrupted")
