"""
Shared helpers for talking to wokenet's DJ endpoints, and for reading audio
metadata off local files.

Both `seed.py` (bulk-upload a folder) and `ripper.py` (serve rip requests) use
this. Authentication is the shared-secret webhook pattern wokenet already uses
for the email and classroom ingests -- these scripts can't hold a Clerk session.
"""

from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

AUDIO_EXTS = {".m4a", ".mp3", ".wav", ".flac", ".aiff", ".aif", ".opus", ".ogg"}
LOSSLESS_EXTS = {".wav", ".flac", ".aiff", ".aif"}


class Config:
    """Where to post, and the secret to post with."""

    def __init__(self, site_url: str | None = None, secret: str | None = None):
        self.site_url = (site_url or os.environ.get("WOKENET_SITE_URL", "")).rstrip("/")
        self.secret = secret or os.environ.get("DJ_RIPPER_SECRET", "")

        if not self.site_url:
            raise SystemExit(
                "Set WOKENET_SITE_URL to your Convex *site* URL "
                "(the .convex.site one, not .convex.cloud), or pass --site-url."
            )
        if not self.secret:
            raise SystemExit("Set DJ_RIPPER_SECRET (same value as on the Convex dashboard).")


# ---------------------------------------------------------------- http


def _post(cfg: Config, path: str, payload: dict) -> dict | None:
    req = urllib.request.Request(
        f"{cfg.site_url}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-webhook-secret": cfg.secret},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            body = res.read().decode().strip()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        raise RuntimeError(f"{path} -> HTTP {e.code}: {detail}") from e


def claim_rip(cfg: Config, claimed_by: str) -> dict | None:
    """Take the next queued rip request, or None if the queue is empty."""
    return claim if (claim := _post(cfg, "/dj-rip/claim", {"claimedBy": claimed_by})) else None


def progress(cfg: Config, request_id: str, message: str) -> None:
    """
    Note progress on a request that's still running.

    Best-effort: a rip that's going fine shouldn't fall over because a status
    note didn't get through.
    """
    try:
        _post(cfg, "/dj-rip/progress", {"requestId": request_id, "message": message})
    except Exception:
        pass


def finish_rip(
    cfg: Config,
    request_id: str,
    status: str,
    message: str = "",
    count: int = 0,
    rate_limited: list[str] | None = None,
) -> None:
    _post(
        cfg,
        "/dj-rip/finish",
        {
            "requestId": request_id,
            "status": status,
            "message": message[:300],
            "trackCount": count,
            # Capped: the server stores these to name them in the email, and a
            # 150-track playlist that throttled wholesale shouldn't be a wall
            # of text.
            "rateLimited": [t[:120] for t in (rate_limited or [])[:40]],
        },
    )


def upload_file(cfg: Config, path: Path) -> str:
    """Push a file into Convex file storage, returning its storageId."""
    res = _post(cfg, "/dj-rip/upload-url", {})
    upload_url = (res or {}).get("uploadUrl")
    if not upload_url:
        raise RuntimeError("no upload URL returned")

    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    req = urllib.request.Request(
        upload_url,
        data=path.read_bytes(),
        headers={"Content-Type": content_type},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode())["storageId"]


def register_track(cfg: Config, payload: dict) -> dict:
    return _post(cfg, "/dj-rip/track", payload) or {}


# ---------------------------------------------------------------- metadata


def ffprobe_tags(path: Path) -> dict:
    """Pull tags, duration and bitrate out of a file with ffprobe."""
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries",
                "format=duration,bit_rate:format_tags=title,artist,genre,comment,purl"
                ":stream=bit_rate,codec_type",
                "-of", "json", str(path),
            ],
            capture_output=True, text=True, timeout=30, check=False,
        ).stdout
        probe = (json.loads(out) or {}) if out.strip() else {}
        fmt = probe.get("format", {})
        streams = probe.get("streams", []) or []
    except Exception:
        return {}

    tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    info: dict = {"tags": tags}

    try:
        info["duration"] = float(fmt["duration"])
    except (KeyError, TypeError, ValueError):
        pass
    # The audio stream's own bitrate, not the container's. Embedded artwork
    # counts towards the container figure -- a 160k rip with a cover measures
    # about 230k -- which used to promote rips a whole quality tier.
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    for source in (audio or {}).get("bit_rate"), fmt.get("bit_rate"):
        try:
            info["bitrate_kbps"] = round(int(source) / 1000)
            break
        except (TypeError, ValueError):
            continue
    return info


def quality_for(path: Path, bitrate_kbps: int | None) -> str:
    """Map a file onto one of wokenet's quality tiers."""
    ext = path.suffix.lower()
    if ext in LOSSLESS_EXTS:
        return "lossless"
    if not bitrate_kbps:
        return "other"
    if ext == ".mp3":
        if bitrate_kbps >= 290:
            return "mp3-320"
        return "aac-160" if bitrate_kbps >= 130 else "aac-96"
    if bitrate_kbps >= 290:
        return "mp3-320"
    if bitrate_kbps >= 210:
        return "aac-256"
    if bitrate_kbps >= 130:
        return "aac-160"
    if bitrate_kbps >= 70:
        return "aac-96"
    return "other"


def track_payload(path: Path, dj: str) -> dict:
    """Build the /dj-rip/track body for a local audio file."""
    info = ffprobe_tags(path)
    tags = info.get("tags", {})
    bitrate = info.get("bitrate_kbps")

    # Our rips put the SoundCloud permalink in the purl/comment tag.
    source = tags.get("purl") or tags.get("comment") or None
    if source and not source.startswith("http"):
        source = None

    # Strip the NNN. playlist-position prefix our ripper adds, if present.
    stem = path.stem
    if len(stem) > 5 and stem[:3].isdigit() and stem[3:5] == ". ":
        stem = stem[5:]

    payload = {
        "dj": dj,
        "title": (tags.get("title") or stem).strip(),
        "filename": path.name,
        "ext": path.suffix.lstrip(".").lower(),
        "mimeType": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        "sizeBytes": path.stat().st_size,
        "quality": quality_for(path, bitrate),
    }
    if tags.get("artist"):
        payload["artist"] = tags["artist"].strip()
    if tags.get("genre"):
        # The server normalizes these; send the raw string.
        payload["rawGenres"] = [tags["genre"]]
    if info.get("duration"):
        payload["durationSec"] = round(info["duration"], 3)
    if bitrate:
        payload["bitrateKbps"] = bitrate
    if source:
        payload["sourceUrl"] = source
    return payload


def extract_cover(path: Path, dest_dir: Path) -> Path | None:
    """Pull embedded cover art out of an audio file, if it has any.

    Rips carry artwork because yt-dlp embeds the SoundCloud thumbnail, so this
    recovers it without a second download.
    """
    try:
        codec = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=20, check=False,
        ).stdout.strip()
    except Exception:
        return None
    if not codec:
        return None

    ext = "png" if codec == "png" else "jpg"
    out = dest_dir / f"{path.stem[:60]}.cover.{ext}"
    try:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(path),
             "-map", "0:v:0", "-c", "copy", str(out)],
            capture_output=True, timeout=60, check=False,
        )
    except Exception:
        return None
    return out if out.exists() and out.stat().st_size > 0 else None


def existing_filenames(cfg: Config) -> list[str]:
    """Filenames already in the library, so imports can skip duplicates."""
    res = _post(cfg, "/dj-rip/filenames", {})
    return list((res or {}).get("filenames", []))


def attach_cover(cfg: Config, filename: str, cover_id: str) -> bool:
    """Point an already-ingested track at a freshly uploaded cover."""
    res = _post(cfg, "/dj-rip/cover", {"filename": filename, "coverId": cover_id})
    return bool((res or {}).get("matched"))


def upload_cover(cfg: Config, path: Path, tmp_dir: Path) -> str | None:
    """Extract and upload a track's cover art; returns its storageId."""
    cover = extract_cover(path, tmp_dir)
    if not cover:
        return None
    try:
        return upload_file(cfg, cover)
    except Exception:
        return None
    finally:
        cover.unlink(missing_ok=True)


def audio_files(folder: Path) -> list[Path]:
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXTS)
