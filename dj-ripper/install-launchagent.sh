#!/bin/bash
# Installs a macOS LaunchAgent so ripper.py starts at login and restarts if it
# dies.
#
# Config lives in ~/.wokenet-ripper.env rather than in the plist, so pointing
# the ripper at a different deployment -- local today, production once it's
# live -- is editing one line and restarting, not reinstalling.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$HERE/venv/bin/python"
LABEL="net.woke.djripper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/wokenet-djripper.log"
ENVFILE="$HOME/.wokenet-ripper.env"

[ -x "$PY" ] || { echo "No venv found. Run: python3 -m venv venv && ./venv/bin/pip install -r requirements.txt"; exit 1; }

KERB="${1:-$(id -un)}"

# First install writes a template; after that the file is left alone, so
# re-running never clobbers a secret you've already set.
if [ ! -f "$ENVFILE" ]; then
  cat > "$ENVFILE" <<ENV_EOF
# wokenet ripper config. Restart after editing:
#   launchctl kickstart -k gui/\$UID/$LABEL

# Your Convex *site* URL -- the .convex.site one, not .convex.cloud.
WOKENET_SITE_URL="${WOKENET_SITE_URL:-https://your-deployment.convex.site}"

# Must match DJ_RIPPER_SECRET on that Convex deployment.
DJ_RIPPER_SECRET="${DJ_RIPPER_SECRET:-}"

# Optional: a SoundCloud token unlocks originals / 256k instead of a 160k cap.
SC_OAUTH_TOKEN=""
ENV_EOF
  chmod 600 "$ENVFILE"
  echo "wrote $ENVFILE"
fi

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>set -a; . "$ENVFILE"; set +a; exec "$PY" "$HERE/ripper.py" --me "$KERB"</string>
  </array>
  <key>WorkingDirectory</key><string>/</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <!-- Otherwise python buffers its output into the log file and the log
         stays empty for the first few minutes. -->
    <key>PYTHONUNBUFFERED</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"

echo "installed $LABEL (crediting rips to '$KERB')"
echo "  config:  $ENVFILE"
echo "  logs:    tail -f $LOG"
echo "  restart: launchctl kickstart -k gui/\$UID/$LABEL"
echo "  stop:    launchctl bootout gui/\$UID/$LABEL"
