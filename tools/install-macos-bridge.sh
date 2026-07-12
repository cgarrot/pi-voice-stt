#!/usr/bin/env bash
#
# install-macos-bridge.sh — install the Pi Voice STT Mac microphone bridge.
#
# This lets Pi running on a VPS (over SSH) use your Mac's microphone: a small
# local daemon captures audio and a reverse SSH tunnel exposes it to the VPS.
#
# Usage:
#   ./install-macos-bridge.sh <vps-ssh-host-alias> [options]
#
#   vps-ssh-host-alias   SSH host alias of your VPS, as configured in ~/.ssh/config.
#                        (e.g. "my-vps", "prod", "user@1.2.3.4")
#
# Environment overrides:
#   PI_STT_BRIDGE_PORT                local port shared by the daemon and tunnel (default 18765)
#   PI_STT_BRIDGE_TUNNEL_HOST_ALIAS   ssh alias for the tunnel host (default <vps>-voice-tunnel)
#   PI_STT_BRIDGE_NODE                node binary (default: PATH)
#   PI_STT_BRIDGE_FFMPEG              ffmpeg binary (default: PATH)
#   PI_STT_BRIDGE_CMUX                optional cmux binary (auto-detected if unset)
#
# What it creates (all under $HOME):
#   - ~/.local/share/pi-voice-stt-bridge/   daemon + launcher + tunnel script
#   - ~/.config/pi-voice-stt-bridge/token   shared bearer token (chmod 600)
#   - ~/Applications/Pi Voice STT Bridge.app native macOS capture app (if swiftc is available)
#   - LaunchAgents: app.pi-voice-stt.bridge and app.pi-voice-stt.tunnel
#   - an SSH config block for <vps>-voice-tunnel with RemoteForward
#
# Uninstall:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/app.pi-voice-stt.bridge.plist 2>/dev/null
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/app.pi-voice-stt.tunnel.plist 2>/dev/null
#   rm -rf ~/.local/share/pi-voice-stt-bridge ~/.config/pi-voice-stt-bridge \
#          ~/Library/LaunchAgents/app.pi-voice-stt.{bridge,tunnel}.plist \
#          ~/Applications/"Pi Voice STT Bridge.app"
#   (and remove the "<vps>-voice-tunnel" Host block from ~/.ssh/config if desired)
set -euo pipefail

VPS_HOST_ALIAS="${1:-${PI_STT_BRIDGE_VPS_HOST_ALIAS:-}}"
if [[ -z "$VPS_HOST_ALIAS" ]]; then
  echo "Usage: $(basename "$0") <vps-ssh-host-alias>" >&2
  echo "  Provide the SSH host alias of your VPS (as configured in ~/.ssh/config)." >&2
  echo "  Example: $(basename "$0") my-vps" >&2
  exit 1
fi

PORT="${PI_STT_BRIDGE_PORT:-18765}"
TUNNEL_HOST_ALIAS="${PI_STT_BRIDGE_TUNNEL_HOST_ALIAS:-${VPS_HOST_ALIAS}-voice-tunnel}"
TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SRC="$TOOLS_DIR/macos-bridge-server.mjs"
NATIVE_SRC="$TOOLS_DIR/macos-bridge-native.swift"
INSTALL_DIR="$HOME/.local/share/pi-voice-stt-bridge"
CONFIG_DIR="$HOME/.config/pi-voice-stt-bridge"
TOKEN_FILE="$CONFIG_DIR/token"
SERVER_DST="$INSTALL_DIR/server.mjs"
LAUNCHER_DST="$INSTALL_DIR/launch.sh"
TUNNEL_SCRIPT="$INSTALL_DIR/tunnel.sh"
NODE_BIN="${PI_STT_BRIDGE_NODE:-$(command -v node)}"
FFMPEG_BIN="${PI_STT_BRIDGE_FFMPEG:-$(command -v ffmpeg)}"
APP_DIR="$HOME/Applications/Pi Voice STT Bridge.app"
APP_EXEC="$APP_DIR/Contents/MacOS/PiVoiceSttBridge"
CMUX_BIN="${PI_STT_BRIDGE_CMUX:-}"
if [[ -z "$CMUX_BIN" ]]; then
  if command -v cmux >/dev/null 2>&1; then
    CMUX_BIN="$(command -v cmux)"
  elif [[ -x /Applications/cmux.app/Contents/Resources/bin/cmux ]]; then
    CMUX_BIN="/Applications/cmux.app/Contents/Resources/bin/cmux"
  fi
fi
LAUNCH_DIR="$HOME/Library/LaunchAgents"
BRIDGE_LABEL="app.pi-voice-stt.bridge"
TUNNEL_LABEL="app.pi-voice-stt.tunnel"
BRIDGE_PLIST="$LAUNCH_DIR/${BRIDGE_LABEL}.plist"
TUNNEL_PLIST="$LAUNCH_DIR/${TUNNEL_LABEL}.plist"
LOG_DIR="$HOME/Library/Logs"
UID_VALUE="$(id -u)"
USE_NATIVE=0
BRIDGE_PROGRAM="$LAUNCHER_DST"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer must run on macOS." >&2
  exit 1
fi

if [[ -z "$NODE_BIN" || -z "$FFMPEG_BIN" ]]; then
  echo "Missing dependencies: node and ffmpeg are required." >&2
  [[ -z "$NODE_BIN" ]] && echo "  - node not found (set PI_STT_BRIDGE_NODE)" >&2
  [[ -z "$FFMPEG_BIN" ]] && echo "  - ffmpeg not found (set PI_STT_BRIDGE_FFMPEG)" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$LAUNCH_DIR" "$LOG_DIR" "$HOME/Applications"
install -m 0755 "$SERVER_SRC" "$SERVER_DST"

if [[ ! -s "$TOKEN_FILE" ]]; then
  umask 077
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32 > "$TOKEN_FILE"
  else
    LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64 > "$TOKEN_FILE"
    printf '\n' >> "$TOKEN_FILE"
  fi
fi
chmod 600 "$TOKEN_FILE"

if command -v swiftc >/dev/null 2>&1 && [[ -f "$NATIVE_SRC" ]]; then
  mkdir -p "$APP_DIR/Contents/MacOS"
  swiftc "$NATIVE_SRC" -o "$APP_EXEC" -framework AVFoundation
  chmod 0755 "$APP_EXEC"
  cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>PiVoiceSttBridge</string>
  <key>CFBundleIdentifier</key>
  <string>app.pi-voice-stt.bridge-native</string>
  <key>CFBundleName</key>
  <string>Pi Voice STT Bridge</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>Pi Voice STT Bridge records audio only when you press Ctrl+R in Pi.</string>
</dict>
</plist>
PLIST
  codesign --force --deep --sign - "$APP_DIR" >/dev/null 2>&1 || true
  USE_NATIVE=1
  BRIDGE_PROGRAM="$APP_EXEC"
fi

cat > "$LAUNCHER_DST" <<LAUNCHER
#!/usr/bin/env bash
set -euo pipefail
PORT="$PORT"
NODE_BIN="$NODE_BIN"
SERVER_DST="$SERVER_DST"
TOKEN_FILE="$TOKEN_FILE"
FFMPEG_BIN="$FFMPEG_BIN"
CMUX_BIN="$CMUX_BIN"
LOG_DIR="$LOG_DIR"

if /usr/sbin/lsof -nP -iTCP:"\$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  exit 0
fi

SERVER_COMMAND="export PI_STT_BRIDGE_HOST=127.0.0.1; export PI_STT_BRIDGE_PORT=\"\$PORT\"; export PI_STT_BRIDGE_TOKEN_FILE=\"\$TOKEN_FILE\"; export PI_STT_BRIDGE_FFMPEG=\"\$FFMPEG_BIN\"; export PI_STT_BRIDGE_INPUT_FORMAT=avfoundation; export PI_STT_BRIDGE_INPUT=:0; exec \"\$NODE_BIN\" \"\$SERVER_DST\" >> \"\$LOG_DIR/pi-voice-stt-bridge.out.log\" 2>> \"\$LOG_DIR/pi-voice-stt-bridge.err.log\""

if [[ -n "\$CMUX_BIN" && -x "\$CMUX_BIN" ]]; then
  "\$CMUX_BIN" new-workspace --name "Pi Voice STT Bridge" --command "\$SERVER_COMMAND" --focus false >/dev/null
  exit 0
fi

export PI_STT_BRIDGE_HOST=127.0.0.1
export PI_STT_BRIDGE_PORT="\$PORT"
export PI_STT_BRIDGE_TOKEN_FILE="\$TOKEN_FILE"
export PI_STT_BRIDGE_FFMPEG="\$FFMPEG_BIN"
export PI_STT_BRIDGE_INPUT_FORMAT=avfoundation
export PI_STT_BRIDGE_INPUT=:0
exec "\$NODE_BIN" "\$SERVER_DST"
LAUNCHER
chmod 0755 "$LAUNCHER_DST"

cat > "$TUNNEL_SCRIPT" <<'TUNNEL'
#!/usr/bin/env bash
set -euo pipefail
PORT="__PORT__"
VPS_HOST_ALIAS="__VPS_HOST_ALIAS__"
TUNNEL_HOST_ALIAS="__TUNNEL_HOST_ALIAS__"

# If the Mac slept or crashed, the VPS can keep a stale sshd reverse-forward
# listener on 127.0.0.1:$PORT. Free only that stale sshd listener before
# starting a fresh tunnel, otherwise ssh exits with "remote port forwarding failed".
/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=8 "$VPS_HOST_ALIAS" "PORT='$PORT' bash -s" <<'REMOTE' >/dev/null 2>&1 || true
pid=$(sudo -n ss -ltnp 2>/dev/null | awk -v port=":$PORT" '$0 ~ port && $0 ~ /sshd-session/ { if (match($0, /pid=[0-9]+/)) print substr($0, RSTART + 4, RLENGTH - 4) }' | head -n 1)
if [ -n "$pid" ]; then
  sudo -n kill "$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  sleep 1
fi
REMOTE

exec /usr/bin/ssh -NT "$TUNNEL_HOST_ALIAS"
TUNNEL
python3 - "$TUNNEL_SCRIPT" "$PORT" "$VPS_HOST_ALIAS" "$TUNNEL_HOST_ALIAS" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text()
text = text.replace("__PORT__", sys.argv[2]).replace("__VPS_HOST_ALIAS__", sys.argv[3]).replace("__TUNNEL_HOST_ALIAS__", sys.argv[4])
path.write_text(text)
PY
chmod 0755 "$TUNNEL_SCRIPT"

python3 - "$HOME/.ssh/config" "$VPS_HOST_ALIAS" "$TUNNEL_HOST_ALIAS" "$PORT" <<'PY'
from pathlib import Path
import re
import sys

config_path = Path(sys.argv[1]).expanduser()
vps_alias = sys.argv[2]
tunnel_alias = sys.argv[3]
port = sys.argv[4]
config_path.parent.mkdir(parents=True, exist_ok=True)
text = config_path.read_text() if config_path.exists() else ""

if re.search(rf"(?im)^Host\s+.*\b{re.escape(tunnel_alias)}\b", text):
    sys.exit(0)

host_block = None
for block in re.split(r"(?im)(?=^Host\s+)", text):
    if re.match(rf"(?im)^Host\s+.*\b{re.escape(vps_alias)}\b", block):
        host_block = block
        break

values = {}
if host_block:
    for key in ["HostName", "User", "IdentityFile", "Port"]:
        match = re.search(rf"(?im)^\s*{key}\s+(.+)$", host_block)
        if match:
            values[key] = match.group(1).strip()

if "HostName" not in values:
    raise SystemExit(f"Cannot find HostName for SSH host {vps_alias!r} in {config_path}")

lines = [
    "",
    f"Host {tunnel_alias}",
    f"  HostName {values['HostName']}",
]
if "User" in values:
    lines.append(f"  User {values['User']}")
if "Port" in values:
    lines.append(f"  Port {values['Port']}")
if "IdentityFile" in values:
    lines.append(f"  IdentityFile {values['IdentityFile']}")
lines.extend([
    f"  RemoteForward 127.0.0.1:{port} 127.0.0.1:{port}",
    "  ExitOnForwardFailure yes",
    "  ServerAliveInterval 30",
    "  ServerAliveCountMax 3",
    "",
])

config_path.write_text(text.rstrip() + "\n" + "\n".join(lines))
config_path.chmod(0o600)
PY

if [[ "$USE_NATIVE" == "1" ]]; then
  cat > "$BRIDGE_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$BRIDGE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BRIDGE_PROGRAM</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PI_STT_BRIDGE_HOST</key>
    <string>127.0.0.1</string>
    <key>PI_STT_BRIDGE_PORT</key>
    <string>$PORT</string>
    <key>PI_STT_BRIDGE_TOKEN_FILE</key>
    <string>$TOKEN_FILE</string>
    <key>PI_STT_BRIDGE_SAMPLE_RATE</key>
    <string>16000</string>
    <key>PI_STT_BRIDGE_CHANNELS</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/pi-voice-stt-bridge.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/pi-voice-stt-bridge.err.log</string>
</dict>
</plist>
PLIST
else
  cat > "$BRIDGE_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$BRIDGE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BRIDGE_PROGRAM</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/pi-voice-stt-bridge.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/pi-voice-stt-bridge.err.log</string>
</dict>
</plist>
PLIST
fi

cat > "$TUNNEL_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$TUNNEL_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$TUNNEL_SCRIPT</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/pi-voice-stt-tunnel.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/pi-voice-stt-tunnel.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$UID_VALUE" "$BRIDGE_LABEL" >/dev/null 2>&1 || true
launchctl bootout "gui/$UID_VALUE" "$TUNNEL_LABEL" >/dev/null 2>&1 || true
# Best-effort cleanup of legacy personal-label agents from earlier previews.
launchctl bootout "gui/$UID_VALUE/com.cgarrot.pi-voice-stt-bridge" >/dev/null 2>&1 || true
launchctl bootout "gui/$UID_VALUE/com.cgarrot.pi-voice-stt-tunnel" >/dev/null 2>&1 || true
rm -f "$LAUNCH_DIR/com.cgarrot.pi-voice-stt-bridge.plist" "$LAUNCH_DIR/com.cgarrot.pi-voice-stt-tunnel.plist" 2>/dev/null || true
for pid in $(/usr/sbin/lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
  kill "$pid" 2>/dev/null || true
done
launchctl bootstrap "gui/$UID_VALUE" "$BRIDGE_PLIST"
launchctl bootstrap "gui/$UID_VALUE" "$TUNNEL_PLIST"
launchctl kickstart -k "gui/$UID_VALUE/$BRIDGE_LABEL" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$UID_VALUE/$TUNNEL_LABEL" >/dev/null 2>&1 || true

echo "Installed Pi Voice STT Mac bridge on http://127.0.0.1:$PORT"
echo "  VPS host alias : $VPS_HOST_ALIAS"
echo "  Tunnel alias   : $TUNNEL_HOST_ALIAS"
echo "  Recorder       : $([[ "$USE_NATIVE" == "1" ]] && echo native-macos-app || echo ffmpeg-node-fallback)"
echo "  Token file     : $TOKEN_FILE"
echo ""
echo "Next: on your VPS, point Pi at the bridge with capture.type \"bridge\","
echo "endpoint http://127.0.0.1:$PORT and tokenFile pointing at a copy of the token."
echo "See docs/macos-bridge.md for the full setup guide."
