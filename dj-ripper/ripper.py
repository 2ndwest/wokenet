#!/usr/bin/env python3
"""
Serves rip requests from the wokenet DJs page on your own machine.

Ripping needs yt-dlp and ffmpeg, which Convex and Vercel can't run, so this
polls wokenet for queued requests, does the work locally, and uploads the
results. It only makes outbound requests -- nothing listens on a port, and your
SoundCloud token never leaves this machine.

    export WOKENET_SITE_URL="https://<your-deployment>.convex.site"
    export DJ_RIPPER_SECRET="<same secret as on the Convex dashboard>"
    export SC_OAUTH_TOKEN="2-..."        # optional, unlocks originals / 256k
    python3 ripper.py --me nicorios

Requests queue up while this isn't running and get picked up when it starts.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
import time
from pathlib import Path

import wokenet

try:
    import putz_djs
except SystemExit:  # the module exits if yt-dlp is missing
    raise SystemExit("yt-dlp is not installed. Run: pip install -r requirements.txt")



def sweep_stale_workdirs() -> None:
    """
    Clear out rip directories a previous run left behind.

    Each run deletes its own in a finally, so this only ever finds dirs from a
    process that was killed outright (or a machine that lost power). Without
    it they'd sit in the system temp dir holding on to disk space until the OS
    got round to it.
    """
    for leftover in Path(tempfile.gettempdir()).glob("wokenet-rip-*"):
        if leftover.is_dir():
            shutil.rmtree(leftover, ignore_errors=True)


def rip_one(
    cfg: wokenet.Config,
    request: dict,
    token: str | None,
    pace: float,
    rounds: int,
    backoff: float,
) -> tuple[int, str, list[str]]:
    """
    Rip everything behind one URL and upload it.

    Returns (uploaded, message, still_rate_limited_titles).

    SoundCloud throttles by IP, so a long playlist will start returning 403s
    partway through however politely it's paced. Those tracks aren't failures:
    they're collected and retried in later rounds, each waiting twice as long
    as the one before. Anything still throttled after the last round is left
    for a re-submission rather than silently dropped.
    """
    url = request["url"]
    credit = request.get("requestedBy", "unknown")

    tracks, name, is_playlist = putz_djs.resolve_input(url, token)
    putz_djs.fill_titles(tracks, token)
    print(f"    {name}: {len(tracks)} track(s)")

    uploaded = 0
    skipped = 0
    drm = 0
    failed = 0
    sweep_stale_workdirs()
    workdir = Path(tempfile.mkdtemp(prefix="wokenet-rip-"))

    def attempt(idx: int, track: dict) -> None:
        """Download, upload and register one track. Raises on any failure."""
        nonlocal uploaded, skipped
        path, fmt = putz_djs.download_one(track, idx, token, workdir, False)
        if path is None:
            raise RuntimeError("no file produced")
        try:
            payload = wokenet.track_payload(path, credit)
            # The rip knows the permalink even when the file's tags don't.
            payload.setdefault("sourceUrl", url if not is_playlist else payload.get("sourceUrl"))
            payload["storageId"] = wokenet.upload_file(cfg, path)

            cover_id = wokenet.upload_cover(cfg, path, workdir)
            if cover_id:
                payload["coverId"] = cover_id

            result = wokenet.register_track(cfg, payload)
            print("already in library" if result.get("skipped") else f"OK  {fmt}")
            if result.get("skipped"):
                skipped += 1
            else:
                uploaded += 1
        finally:
            # Whether or not it registered, the file has served its purpose.
            path.unlink(missing_ok=True)

    try:
        pending = list(enumerate(tracks, start=1))
        for rnd in range(1, max(1, rounds) + 1):
            if rnd > 1:
                wait = backoff * (2 ** (rnd - 2))
                print(f"    {len(pending)} rate-limited; waiting {wait:.0f}s before round {rnd}")
                # Tell whoever submitted it why their request is still going.
                wokenet.progress(
                    cfg,
                    request["requestId"],
                    f"{uploaded} done, {len(pending)} rate-limited — retrying in {wait:.0f}s",
                )
                time.sleep(wait)

            throttled: list[tuple[int, dict]] = []
            for n, (idx, track) in enumerate(pending, start=1):
                label = (track.get("title") or f"track {track['id']}")[:44]
                print(f"    [{idx:>3}/{len(tracks)}] {label:<46}", end=" ", flush=True)
                try:
                    attempt(idx, track)
                except Exception as exc:
                    kind = putz_djs.classify(str(exc))
                    if kind == "drm":
                        drm += 1
                        print("DRM (skipped)")
                    elif kind == "throttled":
                        throttled.append((idx, track))
                        print("rate-limited (will retry)")
                    else:
                        failed += 1
                        print(f"failed: {exc}"[:90])
                if pace and n < len(pending):
                    time.sleep(pace)

            pending = throttled
            if not pending:
                break

        # Still throttled after every round: worth re-submitting later, so name
        # them rather than counting them as plain failures.
        stuck = [(t.get("title") or f"track {t['id']}") for _, t in pending]
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    parts = [f"{uploaded} uploaded"]
    if skipped:
        parts.append(f"{skipped} already in the library")
    if drm:
        parts.append(f"{drm} DRM-locked")
    if failed:
        parts.append(f"{failed} failed")
    if stuck:
        parts.append(f"{len(stuck)} still rate-limited — submit again later")
    # Skipped tracks count as a result: re-submitting a link to pick up what
    # was rate-limited last time shouldn't come back as a failure just because
    # everything else was already there.
    return uploaded + skipped, ", ".join(parts), stuck

def main() -> None:
    ap = argparse.ArgumentParser(description="Serve wokenet rip requests from this machine.")
    ap.add_argument("--me", required=True, help="your kerb, recorded as the machine that ripped")
    ap.add_argument("--site-url", help="Convex site URL (or set WOKENET_SITE_URL)")
    ap.add_argument("--secret", help="DJ_RIPPER_SECRET (or set the env var)")
    ap.add_argument("--token", help="SoundCloud oauth_token (or set SC_OAUTH_TOKEN)")
    ap.add_argument("--interval", type=float, default=30.0, help="seconds between polls")
    ap.add_argument("--pace", type=float, default=2.0, help="seconds between tracks")
    ap.add_argument("--rounds", type=int, default=4, help="retry rounds for rate-limited tracks")
    ap.add_argument("--backoff", type=float, default=90.0, help="base backoff seconds, doubles each round")
    ap.add_argument("--once", action="store_true", help="handle at most one request, then exit")
    args = ap.parse_args()

    cfg = wokenet.Config(args.site_url, args.secret)
    token = putz_djs.load_token(args.token)
    me = args.me.strip().lower().split("@")[0]

    print(f"ripper up as '{me}', polling {cfg.site_url} every {args.interval:.0f}s")
    print("  token:", f"...{token[-4:]} (originals / 256k unlocked)" if token else "none (160k cap)")
    print("  ctrl-c to stop\n")

    idle_logged = False
    while True:
        try:
            request = wokenet.claim_rip(cfg, me)
        except Exception as exc:
            print(f"  poll failed: {exc}"[:150])
            time.sleep(args.interval)
            continue

        if not request:
            if not idle_logged:
                print("  waiting for requests…")
                idle_logged = True
            if args.once:
                return
            time.sleep(args.interval)
            continue

        idle_logged = False
        print(f"  got request from {request.get('requestedBy')}: {request['url']}")
        try:
            # "handled" counts tracks that are in the library because of this
            # request, whether this run fetched them or a previous one did --
            # which is what the email means by "now in the library".
            handled, message, stuck = rip_one(
                cfg, request, token, args.pace, args.rounds, args.backoff
            )
            status = "done" if handled else "failed"
            wokenet.finish_rip(cfg, request["requestId"], status, message, handled, stuck)
            print(f"  {status}: {message}\n")
        except Exception as exc:
            wokenet.finish_rip(cfg, request["requestId"], "failed", str(exc), 0)
            print(f"  failed: {exc}\n"[:200])

        if args.once:
            return


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nstopped")
