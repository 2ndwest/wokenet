# Vendored from the putz-djs tool so dj-ripper is self-contained.
# Source of truth: https://github.com/<you>/putz-djs  -- re-copy to update.
#
#!/usr/bin/env python3
"""
putz-djs — download SoundCloud playlists or single tracks at the best quality
SoundCloud will actually give you.

Quality ladder (first available wins, per track):
    1. download        the uploader's ORIGINAL file (WAV/FLAC/AIFF) -- lossless
    2. hls_aac_256k    SoundCloud Go+ "Premium" stream  (needs a Go+ token)
    3. hls_aac_160k    free-tier stream
    4. hls_aac_96k     last resort

Rate-limited tracks (HTTP 403/429) are retried automatically with exponential
backoff. DRM-protected tracks are flagged as permanently unavailable and are
never retried.
"""

import argparse
import getpass
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

try:
    from yt_dlp import YoutubeDL
except ImportError:
    sys.exit("yt-dlp is not installed.  Run:  pip install -r requirements.txt")

ROOT = Path(__file__).resolve().parent
# Never the 30-second preview: SoundCloud offers one even for DRM-locked
# tracks, and taking it would pass a clip off as the song.
FORMAT_LADDER = "download/hls_aac_256k/hls_aac_160k/hls_aac_96k/bestaudio[format_id!*=preview]"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
AUDIO_EXT = (".m4a", ".mp3", ".wav", ".flac", ".aiff", ".aif", ".opus", ".ogg")

# Human-readable labels for the format ids in the ladder.
QUALITY_LABEL = {
    "download": "ORIGINAL (lossless)",
    "hls_aac_256k": "AAC 256k (Go+)",
    "hls_aac_160k": "AAC 160k",
    "hls_aac_96k": "AAC 96k",
}


# ---------------------------------------------------------------- token

def load_token(cli_token):
    """Tokens are passed as an argument only.

    Deliberately never read from or written to a file: an oauth_token grants
    full access to the account, so it should not end up sitting on disk.
    """
    return cli_token.strip() if cli_token else None


def auth_headers(token):
    return {"Authorization": f"OAuth {token}"} if token else {}


# ---------------------------------------------------------------- prompts

def prompt_url():
    print("Paste a SoundCloud playlist/set URL, or a single track URL.\n")
    while True:
        try:
            url = input("  url: ").strip().strip('"').strip("'")
        except EOFError:
            sys.exit("\nno url given")
        if not url:
            print("  ...required\n")
        elif "soundcloud.com" not in url:
            print("  ...that doesn't look like a SoundCloud URL\n")
        else:
            return url


def prompt_token():
    """Ask for an oauth_token, with instructions and the quality tradeoff."""
    print()
    print("-" * 62)
    print("Optional: a SoundCloud token gets you much better audio.")
    print("-" * 62)
    print("  How to find it:")
    print("    1. log into soundcloud.com in your browser")
    print("    2. open DevTools        (Cmd+Opt+I on mac, F12 on windows)")
    print("    3. Application  >  Cookies  >  https://soundcloud.com")
    print("    4. copy the value of  oauth_token   (looks like 2-123456-...)")
    print()
    print("  with a token : ORIGINAL lossless files where the uploader allows it,")
    print("                 otherwise AAC 256kbps if you have Go+")
    print("  left blank   : AAC 160kbps only, and no original files")
    print()
    print("  Input is hidden as you paste, and the token is never saved to disk.")
    print()
    # getpass writes its prompt straight to the terminal, so make sure
    # everything above has actually been flushed first or it prints out of order.
    sys.stdout.flush()
    try:
        tok = getpass.getpass("  oauth_token (leave blank to skip -- files will be 160kbps): ").strip()
    except EOFError:
        return None
    return tok or None


# ---------------------------------------------------------------- input resolution

def _api_info(url, token):
    opts = {"quiet": True, "no_warnings": True, "extract_flat": True, "skip_download": True}
    if token:
        opts["http_headers"] = auth_headers(token)
    with YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


def _scrape(url):
    """Read the tracklist straight off the public web page.

    SoundCloud throttles its API endpoints hard, but the plain web page keeps
    serving and embeds what we need in window.__sc_hydration. This is what lets
    the tool survive a 403 on the playlist API.
    Returns (tracks, name, is_playlist).
    """
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    m = re.search(r"window\.__sc_hydration\s*=\s*(\[.*?\]);", html, re.S)
    if not m:
        sys.exit("Could not read the page. Is the URL a public SoundCloud track or playlist?")
    blob = json.loads(m.group(1))

    # A set/playlist page.
    for item in blob:
        d = item.get("data")
        if isinstance(d, dict) and d.get("kind") in ("playlist", "system-playlist"):
            tracks = [
                {"id": str(t.get("id")), "title": (t.get("title") or "").strip()}
                for t in d.get("tracks", []) if t.get("id")
            ]
            if tracks:
                return tracks, (d.get("title") or "playlist").strip(), True

    # A single track page.
    for item in blob:
        d = item.get("data")
        if isinstance(d, dict) and d.get("kind") == "sound" and d.get("id"):
            title = (d.get("title") or "").strip()
            user = ((d.get("user") or {}).get("username") or "").strip()
            full = f"{user} - {title}" if user and title else (title or f"track {d['id']}")
            return [{"id": str(d["id"]), "title": full}], full, False

    sys.exit("No track or playlist found on that page.")


def resolve_input(url, token):
    """Figure out whether the URL is a playlist/set/profile or a single track.

    Returns (tracks, name, is_playlist).
    """
    try:
        info = _api_info(url, token)
        if info.get("_type") == "playlist" or info.get("entries"):
            entries = [e for e in (info.get("entries") or []) if e and e.get("id")]
            tracks = [
                {"id": str(e["id"]), "title": (e.get("title") or "").strip()}
                for e in entries
            ]
            if tracks:
                print(f"  playlist via API: {len(tracks)} tracks")
                return tracks, (info.get("title") or "playlist").strip(), True
        elif info.get("id"):
            title = (info.get("title") or "").strip()
            up = (info.get("uploader") or "").strip()
            full = f"{up} - {title}" if up and title else (title or f"track {info['id']}")
            print("  single track via API")
            return [{"id": str(info["id"]), "title": full}], full, False
    except Exception as exc:
        print(f"  API unavailable ({exc.__class__.__name__}) -- falling back to page scrape")

    tracks, name, is_playlist = _scrape(url)
    print(f"  via page scrape: {len(tracks)} track(s)")
    return tracks, name, is_playlist


def fill_titles(tracks, token):
    """Look up real titles in bulk from api-v2.

    SoundCloud's playlist listing returns bare track ids with no titles, so
    without this a failed or DRM-flagged track would only ever be named by its
    numeric id in the report. Titles come back 50 at a time.
    """
    missing = [t for t in tracks if not t["title"]]
    if not missing:
        return
    by_id = {t["id"]: t for t in tracks}
    found = 0
    for i in range(0, len(missing), 50):
        chunk = missing[i:i + 50]
        ids = ",".join(t["id"] for t in chunk)
        req = urllib.request.Request(
            f"https://api-v2.soundcloud.com/tracks?ids={ids}",
            headers={"User-Agent": UA, **auth_headers(token)},
        )
        try:
            payload = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace"))
        except Exception:
            continue
        for item in payload if isinstance(payload, list) else []:
            tid = str(item.get("id"))
            title = (item.get("title") or "").strip()
            user = ((item.get("user") or {}).get("username") or "").strip()
            if tid in by_id and title:
                by_id[tid]["title"] = f"{user} - {title}" if user else title
                found += 1
        time.sleep(0.4)
    if found:
        print(f"  resolved {found} track titles")


# ---------------------------------------------------------------- errors

def classify(msg):
    """Bucket a yt-dlp error into: drm | throttled | unavailable | error."""
    m = (msg or "").lower()
    if "drm" in m:
        return "drm"
    if any(s in m for s in ("403", "429", "forbidden", "too many requests", "rate limit")):
        return "throttled"
    if any(s in m for s in ("404", "not found", "private", "no longer available", "gone", "410")):
        return "unavailable"
    return "error"


# ---------------------------------------------------------------- download

def existing_numbered(out_dir, idx):
    """An already-downloaded audio file for this playlist index, if any."""
    for p in sorted(out_dir.glob(f"{idx:03d}. *")):
        if p.suffix.lower() in AUDIO_EXT:
            return p
    return None


def infer_quality(path):
    """Work out what quality an already-downloaded file is.

    Keeps the report honest on re-runs, where tracks are skipped and we never
    see a format id from yt-dlp.
    """
    if path.suffix.lower() in (".wav", ".flac", ".aiff", ".aif"):
        return "download"
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0",
             "-show_entries", "stream=bit_rate", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=20,
        ).stdout.strip()
        kbps = int(out) / 1000
    except Exception:
        return "unknown"
    for fmt, target in (("hls_aac_256k", 256), ("hls_aac_160k", 160), ("hls_aac_96k", 96)):
        if abs(kbps - target) <= 40:
            return fmt
    return "unknown"


def download_one(track, idx, token, out_dir, numbered):
    """Download a single track. Returns (path, format_id).

    Tracks are fetched by their api-v2 track URL rather than through the
    playlist, because the playlist endpoint gets rate-limited long before the
    individual track endpoints do.
    """
    url = f"https://api-v2.soundcloud.com/tracks/{track['id']}"
    name = f"{idx:03d}. %(title)s.%(ext)s" if numbered else "%(title)s.%(ext)s"

    # Record what actually hit disk. Postprocessing (notably embedding artwork
    # into a container that won't take it, e.g. PNG into WAV) can throw after
    # the audio is already downloaded -- without this the track gets reported
    # as failed even though the file is sitting right there.
    landed = []

    def hook(d):
        if d.get("status") == "finished" and d.get("filename"):
            landed.append(Path(d["filename"]))

    opts = {
        "progress_hooks": [hook],
        "outtmpl": str(out_dir / name),
        "format": FORMAT_LADDER,
        "quiet": True, "no_warnings": True, "noprogress": True,
        "overwrites": False,
        "retries": 3, "fragment_retries": 5,
        # A stalled stream should fail and move on, not hang the whole queue.
        "socket_timeout": 30,
        "writethumbnail": True,
        "postprocessors": [
            {"key": "FFmpegMetadata", "add_metadata": True},
            {"key": "EmbedThumbnail", "already_have_thumbnail": False},
        ],
    }
    if token:
        opts["http_headers"] = auth_headers(token)

    def salvage():
        """Find the audio file on disk after a postprocessing failure."""
        for p in reversed(landed):
            if p.exists() and p.suffix.lower() in AUDIO_EXT:
                return p
            # Postprocessors may have renamed/remuxed it to another extension.
            for alt in p.parent.glob(p.stem + ".*"):
                if alt.suffix.lower() in AUDIO_EXT and alt.exists():
                    return alt
        return existing_numbered(out_dir, idx) if numbered else None

    def produced(info):
        for d in (info.get("requested_downloads") or []):
            p = d.get("filepath") or d.get("_filename")
            if p and Path(p).exists():
                return Path(p)
        return salvage()

    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as exc:
        # Artwork embedding is fragile across wav/flac/m4a. If the audio
        # actually landed, treat the track as done rather than failing it.
        got = salvage()
        if got:
            return got, infer_quality(got)
        # Nothing left once the preview is ruled out means every real stream
        # is locked; say so, so it's counted as DRM rather than a failure.
        if "requested format is not available" in str(exc).lower():
            raise RuntimeError("DRM-locked: only a 30s preview is available") from exc
        raise

    fmt = info.get("format_id") or "unknown"
    reqs = info.get("requested_downloads") or []
    if reqs and reqs[0].get("format_id"):
        fmt = reqs[0]["format_id"]
    got = produced(info)
    clean_thumbnail(got)
    return got, fmt


def clean_thumbnail(audio_path):
    """Delete the sidecar image left behind when artwork embedding fails.

    yt-dlp removes the thumbnail itself once it is embedded, but if embedding
    is unsupported for the container the image stays next to the audio.
    """
    if not audio_path:
        return
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        side = audio_path.with_suffix(ext)
        if side.exists():
            try:
                side.unlink()
            except OSError:
                pass


# ---------------------------------------------------------------- report

def write_report(path, name, results, total):
    done = [r for r in results if r["status"] == "ok"]
    drm = [r for r in results if r["status"] == "drm"]
    gone = [r for r in results if r["status"] == "unavailable"]
    fail = [r for r in results if r["status"] in ("throttled", "error")]

    by_q = {}
    for r in done:
        by_q[r["format"]] = by_q.get(r["format"], 0) + 1

    L = [f"# {name} -- download report\n",
         f"_{time.strftime('%Y-%m-%d %H:%M')}_\n",
         f"**{len(done)} of {total} tracks downloaded.**\n",
         "## Quality breakdown\n"]
    for fmt, n in sorted(by_q.items(), key=lambda kv: -kv[1]):
        L.append(f"- {QUALITY_LABEL.get(fmt, fmt)}: {n}")
    L.append("")

    if drm:
        L.append(f"## Permanently unavailable -- DRM ({len(drm)})\n")
        L.append("SoundCloud encrypts these at the source. No tool can download them.\n")
        for r in drm:
            L.append(f"- `{r['idx']:03d}` {r['title']}")
        L.append("")
    if gone:
        L.append(f"## Permanently unavailable -- deleted/private ({len(gone)})\n")
        for r in gone:
            L.append(f"- `{r['idx']:03d}` {r['title']}")
        L.append("")
    if fail:
        L.append(f"## Failed but retryable ({len(fail)})\n")
        L.append("Rate-limited or transient. Just run the script again to pick these up.\n")
        for r in fail:
            L.append(f"- `{r['idx']:03d}` {r['title']} -- {r['note']}")
        L.append("")

    L.append("## Downloaded\n")
    for r in done:
        L.append(f"- `{r['idx']:03d}` {r['title']} -- {QUALITY_LABEL.get(r['format'], r['format'])}")
    L.append("")
    path.write_text("\n".join(L), encoding="utf-8")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(
        description="Download a SoundCloud playlist or single track at the best available quality.",
        epilog='Examples:\n'
               '  %(prog)s "https://soundcloud.com/artist/sets/my-playlist"\n'
               '  %(prog)s "https://soundcloud.com/artist/some-track"\n',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("url", nargs="?",
                    help="SoundCloud playlist/set URL, or a single track URL "
                         "(omit it and you'll be prompted)")
    ap.add_argument("--token", help="your SoundCloud oauth_token; never stored, used for this run only")
    ap.add_argument("--out", default=str(ROOT / "downloads"), help="output folder")
    ap.add_argument("--pace", type=float, default=2.0, help="seconds between tracks (default 2)")
    ap.add_argument("--rounds", type=int, default=4, help="retry rounds for rate-limited tracks (default 4)")
    ap.add_argument("--backoff", type=float, default=90.0, help="base backoff seconds, doubles each round")
    ap.add_argument("--limit", type=int, help="only process the first N tracks (handy for a test run)")
    ap.add_argument("--no-numbers", action="store_true",
                    help="name files by title only, with no NNN. playlist-position prefix. "
                         "Use this when downloading several playlists into one folder, since "
                         "their position numbers would otherwise collide.")
    args = ap.parse_args()

    print("=" * 62)
    print("putz-djs")
    print("=" * 62)
    print()

    # Run with no url and it walks you through it.
    interactive = args.url is None
    url = args.url or prompt_url()
    if "soundcloud.com" not in url:
        sys.exit("That doesn't look like a SoundCloud URL.")

    token = load_token(args.token)
    if token is None and interactive:
        token = prompt_token()

    out_dir = Path(args.out).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print()
    print("=" * 62)
    print(f"  url      : {url}")
    print(f"  output   : {out_dir}")
    if token:
        print(f"  token    : ...{token[-4:]}  (originals / Go+ 256k unlocked)")
    else:
        print("  token    : none -- capped at AAC 160kbps, no original files")
    print("=" * 62)
    print()

    tracks, name, is_playlist = resolve_input(url, token)
    numbered = is_playlist and not args.no_numbers
    if args.limit:
        tracks = tracks[: args.limit]
        print(f"  limited to first {len(tracks)} tracks")
    fill_titles(tracks, token)
    total = len(tracks)
    print()

    results = {}
    pending = []

    # Pass 0: index everything, skip what is already on disk.
    for i, t in enumerate(tracks, start=1):
        got = existing_numbered(out_dir, i) if numbered else None
        if got:
            results[i] = {"idx": i, "title": t["title"] or got.stem,
                          "status": "ok", "format": infer_quality(got), "note": "already on disk"}
        else:
            pending.append((i, t))

    if results:
        print(f"  {len(results)} already on disk, skipping")
    print(f"  {len(pending)} to fetch\n")

    for rnd in range(1, args.rounds + 1):
        if not pending:
            break
        if rnd > 1:
            wait = args.backoff * (2 ** (rnd - 2))
            print(f"\n--- {len(pending)} rate-limited; waiting {wait:.0f}s before round {rnd} ---\n")
            time.sleep(wait)

        retry_next = []
        for n, (idx, t) in enumerate(pending, start=1):
            label = (t["title"] or f"track {t['id']}")[:46]
            print(f"  [{idx:03d}] {label:<46}", end=" ", flush=True)
            try:
                path, fmt = download_one(t, idx, token, out_dir, numbered)
                title = t["title"] or (path.stem if path else f"track {t['id']}")
                results[idx] = {"idx": idx, "title": title,
                                "status": "ok", "format": fmt, "note": ""}
                print(f"OK  {QUALITY_LABEL.get(fmt, fmt)}")
            except Exception as exc:
                msg = str(exc)
                kind = classify(msg)
                short = msg.strip().splitlines()[-1][:70] if msg.strip() else exc.__class__.__name__
                if kind == "throttled":
                    retry_next.append((idx, t))
                    print("RATE-LIMITED (will retry)")
                else:
                    results[idx] = {"idx": idx, "title": t["title"] or f"track {t['id']}",
                                    "status": kind, "format": "", "note": short}
                    print("DRM (hard flag)" if kind == "drm"
                          else ("UNAVAILABLE" if kind == "unavailable" else f"FAILED: {short}"))
            if args.pace and n < len(pending):
                time.sleep(args.pace)

        pending = retry_next

    # Anything still pending after the last round stays marked retryable.
    for idx, t in pending:
        results[idx] = {"idx": idx, "title": t["title"] or f"track {t['id']}",
                        "status": "throttled", "format": "",
                        "note": "still rate-limited after all retry rounds"}

    ordered = [results[k] for k in sorted(results)]
    report = out_dir.parent / "REPORT.md"
    write_report(report, name, ordered, total)

    ok = [r for r in ordered if r["status"] == "ok"]
    drm = [r for r in ordered if r["status"] == "drm"]
    gone = [r for r in ordered if r["status"] == "unavailable"]
    retry = [r for r in ordered if r["status"] in ("throttled", "error")]

    print("\n" + "=" * 62)
    print(f"  downloaded          {len(ok):>3} / {total}")
    if drm:
        print(f"  DRM (hard flag)     {len(drm):>3}   never downloadable")
    if gone:
        print(f"  deleted/private     {len(gone):>3}")
    if retry:
        print(f"  retryable           {len(retry):>3}   re-run to pick these up")
    print("=" * 62)
    q = {}
    for r in ok:
        q[r["format"]] = q.get(r["format"], 0) + 1
    for fmt, n in sorted(q.items(), key=lambda kv: -kv[1]):
        print(f"  {QUALITY_LABEL.get(fmt, fmt):<22} {n}")
    print(f"\n  files  -> {out_dir}")
    print(f"  report -> {report}")
    if retry:
        print("\n  Some tracks were rate-limited. Re-run the same command later;")
        print("  finished tracks are skipped automatically.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\ninterrupted")
