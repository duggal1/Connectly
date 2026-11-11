#!/bin/bash
set -euo pipefail

LISTEN_IP="${1:-127.0.0.1}"
PORT="${2:-7681}"
ME="$(id -un)"
LABEL="dev.connectly.termd"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

cd "$(dirname "$0")"
go mod tidy
go build -o termd .
sudo mkdir -p /usr/local/bin
sudo install -m 755 termd /usr/local/bin/termd

SUDOERS_TMP="$(mktemp)"
trap 'rm -f "$SUDOERS_TMP"' EXIT
echo "$ME ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1" > "$SUDOERS_TMP"
sudo visudo -cf "$SUDOERS_TMP"
sudo install -m 440 -o root -g wheel "$SUDOERS_TMP" /etc/sudoers.d/connectly-pmset

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/termd</string>
    <string>--listen</string><string>$LISTEN_IP:$PORT</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>$HOME</string>
    <key>SHELL</key><string>${SHELL:-/bin/zsh}</string>
  </dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/termd.log</string>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/termd.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

printf '\ntermd is running on %s:%s\n' "$LISTEN_IP" "$PORT"
printf 'Token: '
/usr/local/bin/termd --print-token
printf 'If the Mac ever stays awake unexpectedly: sudo pmset -a disablesleep 0\n'
