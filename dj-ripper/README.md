# dj-ripper

Helpers for the wokenet **DJs** library. Both run on a DJ's own machine, because
ripping needs `yt-dlp` and `ffmpeg` and neither Convex nor Vercel can run them.

- **`seed.py`** — bulk-upload a folder of audio you already have.
- **`ripper.py`** — poll wokenet for rip requests, rip them, upload the results.

## Setup

Needs Python 3.10+ and ffmpeg (`brew install ffmpeg`).

```bash
cd dj-ripper
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

Then set two env vars. `WOKENET_SITE_URL` is your Convex **site** URL — the
`.convex.site` one, not `.convex.cloud`:

```bash
export WOKENET_SITE_URL="https://your-deployment.convex.site"
export DJ_RIPPER_SECRET="<a long random string>"
```

Set the same `DJ_RIPPER_SECRET` on the Convex dashboard (Settings →
Environment Variables), or the endpoints return 500.

Optionally add a SoundCloud token to unlock better audio — originals where the
uploader allows it, otherwise 256k with Go+. Without it you're capped at 160k:

```bash
export SC_OAUTH_TOKEN="2-..."
```

## Seed the library

```bash
./venv/bin/python seed.py ~/Downloads/putz-djs/downloads --dj nicorios
```

Add `--dry-run` first to see what it would send and how each file's genre and
quality were read. Re-running is safe — tracks already in the library are
skipped server-side.

## Serve rip requests

```bash
./venv/bin/python ripper.py --me nicorios
```

It polls every 30s, claims one request at a time, and uploads each track as it
finishes. Requests queue while it isn't running and get picked up when it starts.

Only outbound requests are made: nothing listens on a port, and your SoundCloud
token never leaves the machine.

Flags: `--interval` (poll seconds), `--pace` (seconds between tracks — raise it
if SoundCloud starts returning 403s), `--once` (handle one request and exit,
handy for cron or testing).

## Keep it running (macOS)

To have it start at login and restart if it dies, install a LaunchAgent:

```bash
./install-launchagent.sh
```

That writes `~/Library/LaunchAgents/net.woke.djripper.plist` and loads it. Logs
go to `~/Library/Logs/wokenet-djripper.log`. To stop:

```bash
launchctl unload ~/Library/LaunchAgents/net.woke.djripper.plist
```

## Notes

- `putz_djs.py` is vendored from the standalone putz-djs tool so this folder is
  self-contained. Re-copy it to update.
- Tracks are credited to whoever *requested* the rip, not to whoever's machine
  did it.
- DRM-locked tracks are skipped and counted in the request's result message.
  SoundCloud encrypts those at the source; nothing can download them.
