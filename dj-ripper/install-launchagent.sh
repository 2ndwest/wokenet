#!/bin/bash
# Installs a macOS LaunchAgent so ripper.py starts at login and restarts if it
# dies. Reads config from the environment at install time and bakes it into the
# plist, so set WOKENET_SITE_URL / DJ_RIPPER_SECRET / SC_OAUTH_TOKEN first.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$HERE/venv/bin/python"
LABEL="net.woke.djripper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/wokenet-djripper.log"

[ -x "$PY" ] || { echo "No venv found. Run: python3 -m venv venv && ./venv/bin/pip install -r requirements.txt"; exit 1; }
[ -n "$WOKENET_SITE_URL" ] || { echo "Set WOKENET_SITE_URL first."; exit 1; }
[ -n "$DJ_RIPPER_SECRET" ] || { echo "Set DJ_RIPPER_SECRET first."; exit 1; }

KERB="${1:-$(id -un)}"

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>$HERE/ripper.py</string>
    <string>--me</string>
    <string>$KERB</string>
  </array>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WOKENET_SITE_URL</key><string>$WOKENET_SITE_URL</string>
    <key>DJ_RIPPER_SECRET</key><string>$DJ_RIPPER_SECRET</string>
    <key>SC_OAUTH_TOKEN</key><string>${SC_OAUTH_TOKEN:-}</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST_EOF

chmod 600 "$PLIST"   # it holds your secrets

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "installed $LABEL (running as '$KERB')"
echo "  logs:    tail -f $LOG"
echo "  stop:    launchctl unload $PLIST"
