# dj-ripper

The machine-side half of the wokenet **DJs** library. When someone pastes a
SoundCloud link into **Rip** on the DJs page, the request waits in a queue on
Convex. A Mac mini in Halo runs `ripper.py`, which picks the request up, rips it
with `yt-dlp` and `ffmpeg`, and uploads the tracks back into the library.
Neither Convex nor Vercel can run those tools, so this has to live on a real
computer.

If you're a future PUTZ person setting this up on a new machine, start at
[Setting up a new machine](#setting-up-a-new-machine) and go top to bottom.

## What's in here

| file | what it does |
|---|---|
| `ripper.py` | The long-running service. Polls wokenet for rip requests, rips, uploads. |
| `sc_token.py` | Keeps a SoundCloud token fresh, so the ripper never needs a new one pasted in. |
| `install-launchagent.sh` | Makes `ripper.py` start at login and restart if it dies (macOS). |
| `seed.py` | One-off: bulk-upload a folder of audio you already have. |
| `import_rekordbox.py` | One-off: import a rekordbox collection, keeping its BPM, key and cues. |
| `wokenet.py` | Shared helpers for talking to wokenet. Nothing to run. |
| `putz_djs.py` | The SoundCloud ripping code, copied from the standalone putz-djs tool so this folder is self-contained. |

## How it works

- **It only makes outgoing requests.** Nothing listens on a port, so there's no
  port forwarding or firewall setup. It works on any network that reaches the
  internet.
- **It authenticates with a shared secret.** `DJ_RIPPER_SECRET` is set both on
  the Convex deployment and on the machine; the `/dj-rip/*` endpoints in
  `convex/http.ts` refuse requests without it.
- **It handles one request at a time.** That's deliberate: SoundCloud rate-limits
  by IP address, and going one at a time keeps it calm. A long playlist holds up
  the queue behind it.
- **Requests queue while it's off.** If the mini is asleep or unplugged, nothing
  fails; requests wait and get picked up when it comes back.
- **It keeps nothing.** Each rip goes to a temp folder, every file is deleted
  right after it uploads, and the folder is removed when the rip ends. A
  startup sweep clears anything a crash left behind.
- **Tracks are credited to whoever requested them,** not to the machine's owner.
  `--me` only records which machine did the work.
- **Cancel and progress work from the site.** The ripper checks in before every
  track, so cancelling on the DJs page stops it between tracks, and the site's
  progress bar shows how far it's got.

## Setting up a new machine

These steps assume macOS (the mini). For Linux, see [Not a Mac](#not-a-mac).

### 1. Prepare the machine

- **Stop it sleeping:** System Settings → Energy (or Battery → Options) → turn on
  *Prevent automatic sleeping* and *Start up automatically after a power failure*.
  A sleeping mini doesn't rip.
- **Keep a user logged in.** The LaunchAgent runs inside a user session. Turning
  on automatic login (System Settings → Users & Groups) means it comes back
  after a power cut without anyone typing a password.
- **Install Homebrew** from <https://brew.sh>, then:

  ```bash
  brew install python ffmpeg git
  ```

  Python 3.10 or newer is required. Check with `python3 --version`.

### 2. Get the code and install dependencies

```bash
git clone <the wokenet repo URL>
cd wokenet/dj-ripper
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

The `venv` folder is gitignored. Make it on each machine; don't copy it from
another one.

### 3. Find the site URL and the secret

You need two values from the Convex deployment you're pointing at (production,
for the real library):

- **`WOKENET_SITE_URL`** is the deployment's **site** URL. It ends in
  **`.convex.site`**, not `.convex.cloud` (the `.cloud` one is for the web app
  and returns 404 here). It's on the Convex dashboard under Settings → URL &
  Deploy Key, under "HTTP Actions URL".
- **`DJ_RIPPER_SECRET`** is a long random string that has to match the value on
  the deployment. If you can run Convex commands for the project:

  ```bash
  npx convex env get DJ_RIPPER_SECRET --prod
  ```

  Or read it on the dashboard under Settings → Environment Variables. If none is
  set yet, make one up (`openssl rand -hex 32`) and set it in both places:

  ```bash
  npx convex env set DJ_RIPPER_SECRET "<the string>" --prod
  ```

  If you change it, every machine running the ripper needs the new value too.

### 4. Install the service

```bash
./install-launchagent.sh <your-kerb>
```

The first run writes a config template at `~/.wokenet-ripper.env` (readable
only by you). Open it, fill in `WOKENET_SITE_URL` and `DJ_RIPPER_SECRET`, then
restart the service:

```bash
launchctl kickstart -k gui/$UID/net.woke.djripper
```

The config lives in that file rather than in the LaunchAgent itself, so
pointing the ripper somewhere else later means editing one line and restarting.
Re-running the installer never overwrites the file once it exists.

### 5. Give it a SoundCloud token (optional, but you want it)

Without a token, rips are capped at 160kbps. With a logged-in account's token,
you get the original upload where the uploader allows downloads, and 256kbps
otherwise if the account has Go+.

SoundCloud access tokens expire after 24 hours. `sc_token.py` stores the access
token together with its refresh token and swaps in a new pair before the old one
expires. **The mini refreshes the token itself; nobody has to paste in a new one.**
It checks on every poll, including while idle.

Seed it once on the machine, with an access token and the matching refresh
token from a signed-in soundcloud.com session:

```bash
./venv/bin/python sc_token.py seed <access_token> <refresh_token>
./venv/bin/python sc_token.py status     # shows how long the current token has left
```

That writes `~/.wokenet-ripper-sc.json` (readable only by you). The LaunchAgent
always points the ripper at that file, so there's nothing else to configure.
Restart the service to pick it up straight away; otherwise it's picked up on the
next poll.

Use an account the house is happy to dedicate to this. A token gives full
access to the account it came from.

If the token file is missing, the ripper falls back to `SC_OAUTH_TOKEN` in
`~/.wokenet-ripper.env`. That token isn't refreshed, so it stops working after
a day. It's for testing only.

### 6. Check it works

```bash
tail -f ~/Library/Logs/wokenet-djripper.log
```

On startup it should log:

```
ripper up as '<kerb>', polling https://….convex.site every 30s
  token: ...abcd (originals / 256k unlocked)
  waiting for requests…
```

Then paste a single track into **Rip** on the DJs page. Within 30 seconds the
log shows the request, and the track appears in the library shortly after.

### 7. Retire the old machine

Only one machine should serve requests. Two will both work, but they compete for
SoundCloud's rate limit from different IPs and you'll lose track of which one
did what. On the old one:

```bash
launchctl bootout gui/$UID/net.woke.djripper
rm ~/Library/LaunchAgents/net.woke.djripper.plist
rm ~/.wokenet-ripper.env ~/.wokenet-ripper-sc.json   # removes the secret and token
```

## Day to day

| | |
|---|---|
| logs | `tail -f ~/Library/Logs/wokenet-djripper.log` |
| restart | `launchctl kickstart -k gui/$UID/net.woke.djripper` |
| stop | `launchctl bootout gui/$UID/net.woke.djripper` |
| start again | `./install-launchagent.sh <kerb>` |
| token status | `./venv/bin/python sc_token.py status` |
| update the code | `git pull`, then restart |
| update yt-dlp | `./venv/bin/pip install -U yt-dlp`, then restart |

Update yt-dlp whenever SoundCloud rips start failing for no clear reason.
SoundCloud changes things, and yt-dlp is usually patched within days.

To run it by hand instead of as a service (useful for debugging), stop the
service first, then:

```bash
set -a; . ~/.wokenet-ripper.env; set +a
./venv/bin/python ripper.py --me <kerb> --token-file ~/.wokenet-ripper-sc.json
```

### Flags

| flag | default | |
|---|---|---|
| `--interval` | 30 | seconds between polls |
| `--pace` | 2 | seconds between tracks. Raise it if SoundCloud starts returning 403s. |
| `--rounds` | 4 | retry rounds for rate-limited tracks |
| `--backoff` | 90 | seconds before the first retry round; doubles each round |
| `--once` | | handle one request and exit (for testing) |

To change flags for the service, edit the `ProgramArguments` line in
`~/Library/LaunchAgents/net.woke.djripper.plist` and restart.

## Troubleshooting

**Nothing happens when I rip.** Check the log. If it's empty or old, the
service isn't running: `launchctl print gui/$UID/net.woke.djripper` shows its
state; re-run the installer. If the mini was asleep, see step 1.

**`poll failed: HTTP Error 401`:** the secret doesn't match the
deployment. Compare `~/.wokenet-ripper.env` with `npx convex env get DJ_RIPPER_SECRET --prod`.

**`poll failed: HTTP Error 500`:** the deployment has no `DJ_RIPPER_SECRET` set at all.

**`poll failed: HTTP Error 404`:** the URL is wrong. Usually it's the
`.convex.cloud` URL instead of `.convex.site`, or a stale deployment name.

**`token: none (160k cap)`:** there's no token file, or the refresh failed and the
token expired. `sc_token.py status` says which. Refresh failures are logged
(`soundcloud token refresh failed: …`) and retried every 10 minutes. If the
refresh token itself was revoked (password change, logging out everywhere),
seed a new pair.

**Some tracks come back as "rate limited":** SoundCloud throttles by IP. The
ripper already paces itself, falls back to scraping the page when the API
refuses, and retries 4 times with doubling waits. Whatever's still stuck is
listed by name on the request and in the email. Re-submitting the same link
later fetches only the missing tracks. If it keeps happening, raise `--pace`
and `--backoff`.

**Some tracks are skipped as DRM:** SoundCloud encrypts some tracks at the
source. Nothing can download those.

**`yt-dlp is not installed`:** the venv is missing or broken. Redo step 2.

## Not a Mac

`ripper.py` itself is plain Python and runs anywhere with Python 3.10+, ffmpeg
and the requirements installed. Only `install-launchagent.sh` is macOS-specific.
On Linux, a systemd user service does the same job. This setup is untested here,
so check it with `journalctl --user -u wokenet-ripper -f` before relying on it:

```ini
# ~/.config/systemd/user/wokenet-ripper.service
[Unit]
Description=wokenet dj-ripper
After=network-online.target

[Service]
EnvironmentFile=%h/.wokenet-ripper.env
ExecStart=%h/wokenet/dj-ripper/venv/bin/python %h/wokenet/dj-ripper/ripper.py --me <kerb> --token-file %h/.wokenet-ripper-sc.json
Environment=PYTHONUNBUFFERED=1
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now wokenet-ripper
loginctl enable-linger $USER   # keep it running when nobody is logged in
```

## The one-off scripts

All of them read `WOKENET_SITE_URL` and `DJ_RIPPER_SECRET` the same way the
ripper does (`set -a; . ~/.wokenet-ripper.env; set +a` loads them). Every one
takes `--dry-run`, and you should use it first.

**Seed from a folder of audio:**

```bash
./venv/bin/python seed.py ~/Downloads/putz-djs/downloads --dj <kerb> --dry-run
```

Reads artist, genre, duration and bitrate off each file with ffprobe (so
ffmpeg must be installed). Re-running is safe; tracks already in the library
are skipped. `--limit N` uploads only the first N files.

**Import a rekordbox collection:**

```bash
./venv/bin/python import_rekordbox.py ~/Documents/rekordbox.xml --dj <kerb> --dry-run
```

Export the XML from rekordbox (File → Export Collection in xml format). It holds
file paths and analysis, not audio, so run this on the machine that has the
files. Tracks arrive with rekordbox's BPM, key and cue points instead of
estimates.

## Emails (built, not switched on)

The site can email whoever requested a rip twice: once when the request is
queued and once when the tracks are in the library, including any that
couldn't be fetched. The code is in `convex/email.ts` and is triggered from
`requestRip` and `finishRipRequest` in `convex/djs.ts`. It's off right now
because the deployment has no `RESEND_API_KEY`. Without one, each send is
skipped with a log line and rips work exactly the same.

To switch it on:

1. Make an account at <https://resend.com> and verify a sending domain (add
   the DNS records it gives you, which can take a while to propagate). Clerk's
   email sender doesn't carry over. `onboarding@resend.dev` works without a
   domain, but it only delivers to the Resend account owner's own address.
2. Set these on the Convex deployment:

   ```bash
   npx convex env set RESEND_API_KEY re_… --prod
   npx convex env set WOKENET_FROM "WOKENET <noreply@your-domain>" --prod
   npx convex env set WOKENET_ORIGIN "https://your-site" --prod   # for links back to the site
   ```

3. Put the line about emails back in the Rip dialog (`RipDialog` in
   `src/pages/DJs.tsx`; there's a comment marking the spot), so people know to
   expect them.

Nothing on the ripper machine changes. The emails are sent by Convex, not by
the mini.

## Notes for whoever maintains this

- `putz_djs.py` is a copy of the standalone putz-djs tool. Update it by
  re-copying, not by editing it here.
- Genre strings are sent raw; the server normalizes them
  (`convex/utils/genres.ts`), so new aliases apply without touching this folder.
- Nothing here writes a SoundCloud token to disk except `sc_token.py`, into its
  own 600-mode file. `putz_djs.py` deliberately never stores one.
