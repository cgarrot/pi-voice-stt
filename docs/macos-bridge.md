# Mac microphone bridge for VPS usage

Pi Voice STT normally records audio on the same machine that runs Pi. When you
run Pi on a **VPS over SSH** but your microphone is on your **Mac**, the bridge
lets you keep the exact same `Ctrl+R` experience: audio is captured on the Mac
by a tiny local daemon and streamed to the VPS through a reverse SSH tunnel.

This is **opt-in and non-native**: it only activates when you set
`capture.type: "bridge"`. The default `ffmpeg` recorder is unchanged, so users
running Pi locally are not affected.

```
   ┌─────────────────────┐         reverse SSH tunnel          ┌──────────────────────┐
   │  Your Mac           │  127.0.0.1:18765  ◄──────────────   │  VPS                 │
   │                     │  ──────────────────────────────────► │                      │
   │  Pi Voice STT       │       /start /stop /cancel          │  Pi (pi-voice-stt)   │
   │  Bridge daemon      │  ◄──── WAV audio response ──────    │  capture.type=bridge │
   │  (mic capture)      │                                     │  → STT provider      │
   └─────────────────────┘                                     └──────────────────────┘
```

The daemon listens only on the Mac loopback. The VPS reaches it through an SSH
`RemoteForward`, so **no port is ever exposed to the public internet**.

---

## When to use this

- You run Pi on a remote VPS / cloud box over SSH.
- Your physical microphone is on your Mac.
- You want the same `Ctrl+R` dictation flow you'd have locally.

If Pi runs on your Mac (or on a machine with a real audio input), you do **not**
need this — use the default `ffmpeg` recorder.

---

## Prerequisites

On your **Mac**:

- macOS (the installer refuses to run elsewhere).
- `node` (Node.js ≥ 20) and `ffmpeg` in `PATH` (or point to them with
  `PI_STT_BRIDGE_NODE` / `PI_STT_BRIDGE_FFMPEG`).
- *Optional but recommended:* Xcode Command Line Tools (`swiftc`) so the
  installer can build the native background app — this makes microphone
  permission work without keeping a terminal window open.
- *Optional:* [`cmux`](https://github.com/earendil-works/cmux) — if present, the
  daemon runs inside a cmux workspace; otherwise it runs as a plain LaunchAgent.

On your **VPS**:

- SSH access from your Mac, ideally with an SSH host alias in `~/.ssh/config`
  (e.g. `Host my-vps`) and key-based auth.
- Pi Voice STT installed and a working transcription provider
  (Mistral, OpenAI/Groq, Deepgram, ElevenLabs, Gladia, AssemblyAI, or a local
  OpenAI-compatible server).

---

## Quick start

### 1. Install the daemon on your Mac

From the repo root on your Mac, pass the SSH alias of your VPS:

```bash
tools/install-macos-bridge.sh my-vps
```

The installer reads the `HostName`/`User`/`Port`/`IdentityFile` of `my-vps`
from `~/.ssh/config` and creates a tunnel host alias `my-vps-voice-tunnel` with:

```sshconfig
RemoteForward 127.0.0.1:18765 127.0.0.1:18765
ExitOnForwardFailure yes
ServerAliveInterval 30
```

It also:

- Copies `tools/macos-bridge-server.mjs` to `~/.local/share/pi-voice-stt-bridge/`.
- Generates a random bearer token at `~/.config/pi-voice-stt-bridge/token`
  (`chmod 600`).
- Builds `~/Applications/Pi Voice STT Bridge.app` (native capture) if `swiftc`
  is available, otherwise falls back to the `ffmpeg` node daemon.
- Installs two LaunchAgents (`app.pi-voice-stt.bridge`,
  `app.pi-voice-stt.tunnel`) that start at login and stay alive.

> **Port / paths:** set `PI_STT_BRIDGE_PORT` before running the installer to use
> a different port (it is shared by the daemon and the tunnel). Other overrides:
> `PI_STT_BRIDGE_TUNNEL_HOST_ALIAS`, `PI_STT_BRIDGE_NODE`,
> `PI_STT_BRIDGE_FFMPEG`, `PI_STT_BRIDGE_CMUX`.

### 2. Copy the token to your VPS

Pi on the VPS must present the same bearer token as the Mac daemon. Copy it:

```bash
scp ~/.config/pi-voice-stt-bridge/token my-vps:~/.pi/agent/pi-voice-stt-bridge.token
```

(Choose any path on the VPS; you'll reference it with `capture.tokenFile` below.)

### 3. Configure Pi on the VPS

In your STT config (e.g. `~/.pi/agent/stt.json`, or the path in `PI_STT_CONFIG`):

```json
{
  "capture": {
    "type": "bridge",
    "endpoint": "http://127.0.0.1:18765",
    "tokenFile": "~/.pi/agent/pi-voice-stt-bridge.token",
    "requestTimeoutSeconds": 30,
    "maxSeconds": 120,
    "minBytes": 4096
  },
  "provider": {
    "type": "groq",
    "model": "whisper-large-v3-turbo",
    "apiKeyEnv": "GROQ_API_KEY",
    "language": "fr"
  }
}
```

A ready-made example is provided at `examples/bridge-groq.json`.

### 4. Verify

In Pi, run:

```
/stt doctor
```

It will call the bridge `/health` endpoint and report readiness. Then press
`Ctrl+R`, speak, and `Ctrl+R` again (or `Enter`) to transcribe.

---

## Security model

- **Loopback only.** The daemon binds to `127.0.0.1` and is never reachable from
  the public internet. The VPS reaches it solely through the SSH reverse tunnel.
- **Bearer token.** Every request must carry `Authorization: Bearer <token>`.
  If no token is set, requests are accepted only from loopback — but you should
  always set one (the installer generates it automatically).
- **HTTPS not needed here.** Traffic stays inside the encrypted SSH tunnel
  between Mac and VPS, so plain HTTP on loopback is safe. (The extension's
  endpoint security helper still permits HTTP only on `localhost`/`127.0.0.1`.)
- **Mic accessed on demand.** The daemon process is long-lived, but it only
  opens the microphone during a `/start`…`/stop` window triggered by `Ctrl+R`.
  `/cancel` (e.g. on `Esc`) stops and discards immediately.
- **Plain HTTP endpoints are rejected** for non-loopback hosts by the extension;
  the bridge endpoint is loopback by construction.

---

## Configuration reference

### VPS-side Pi config (`capture.*`)

| Field                    | Type   | Default                  | Meaning                                                       |
| ------------------------ | ------ | ------------------------ | ------------------------------------------------------------- |
| `type`                   | string | `ffmpeg`                 | Must be `"bridge"` to use the Mac bridge.                     |
| `endpoint`               | string | `http://127.0.0.1:18765` | Daemon URL (loopback on the VPS, reached via the tunnel).     |
| `token`                  | string | `""`                     | Token literal (use `tokenFile`/`tokenEnv` instead).           |
| `tokenEnv`               | string | `PI_STT_BRIDGE_TOKEN`    | Env var that holds the token.                                 |
| `tokenFile`              | string | `""`                     | Path to a file containing the token.                          |
| `requestTimeoutSeconds`  | number | `30`                     | Per-request timeout for `/start`, `/stop`.                    |
| `maxSeconds`             | number | `120`                    | Hard cap on a single recording length.                        |
| `minBytes`               | number | `4096`                   | Reject recordings smaller than this (likely a dead mic).      |

### Mac daemon env vars (`PI_STT_BRIDGE_*`)

These are set automatically by the installer; you normally don't touch them.

| Env var                          | Default      | Meaning                                              |
| -------------------------------- | ------------ | ---------------------------------------------------- |
| `PI_STT_BRIDGE_HOST`             | `127.0.0.1`  | Bind address (keep loopback).                        |
| `PI_STT_BRIDGE_PORT`             | `18765`      | Listen port (must match the tunnel `RemoteForward`). |
| `PI_STT_BRIDGE_TOKEN` / `…_TOKEN_FILE` | _generated_ | Bearer token / file containing it.             |
| `PI_STT_BRIDGE_FFMPEG`           | `ffmpeg`     | ffmpeg binary (fallback recorder).                   |
| `PI_STT_BRIDGE_INPUT_FORMAT`     | `avfoundation` | ffmpeg input format.                               |
| `PI_STT_BRIDGE_INPUT`            | `:0`         | ffmpeg input device (`:0` = default mic).            |
| `PI_STT_BRIDGE_SAMPLE_RATE`      | `16000`      | WAV sample rate.                                     |
| `PI_STT_BRIDGE_CHANNELS`         | `1`          | Mono.                                                |
| `PI_STT_BRIDGE_MIN_BYTES`        | `4096`       | Server-side min-size check.                          |
| `PI_STT_BRIDGE_MAX_SECONDS`      | `120`        | Server-side recording cap.                           |

### Daemon HTTP API

| Method | Path      | Auth | Purpose                                            |
| ------ | --------- | ---- | -------------------------------------------------- |
| `GET`  | `/health` | yes  | Liveness + active state + config (`/stt doctor`).  |
| `POST` | `/start`  | yes  | Begin a recording (409 if one is already active).  |
| `POST` | `/stop`   | yes  | Stop and return the WAV body (422 if too small).    |
| `POST` | `/cancel` | yes  | Stop and discard (used on `Esc` / reload / exit).   |

---

## Troubleshooting

**`/stt doctor` says the bridge is unreachable**
- Check the tunnel LaunchAgent is running:
  `launchctl kickstart -k gui/$(id -u)/app.pi-voice-stt.tunnel` and inspect
  `~/Library/Logs/pi-voice-stt-tunnel.err.log`.
- Confirm `ssh my-vps-voice-tunnel` connects and forwards without error
  (`ExitOnForwardFailure yes` will fail fast if the remote port is taken).
- If the VPS holds a stale reverse-forward listener (e.g. after the Mac slept),
  the tunnel script tries to clear it with `ss`/`kill` (best-effort, requires
  passwordless `sudo` for `ss` on the VPS, otherwise it is skipped).

**"Bridge recording is too small" / silent audio**
- Grant microphone permission to the app that launched the daemon. With the
  native app, that's `Pi Voice STT Bridge.app`; with the ffmpeg fallback, it's
  the terminal/cmux host. See *System Settings → Privacy & Security → Microphone*.
- Verify the input device: `ffmpeg -f avfoundation -list_devices true -i ""` and
  set `PI_STT_BRIDGE_INPUT` (e.g. `:1`) in the daemon's environment, then
  rebuild the LaunchAgent by re-running the installer.

**"remote port forwarding failed" for the tunnel**
- Another SSH session or a stale sshd listener occupies `127.0.0.1:18765` on the
  VPS. Disconnect other sessions, or let the tunnel script's cleanup run. You can
  also pick a different port: set `PI_STT_BRIDGE_PORT` on the Mac **and** match it
  in `capture.endpoint` on the VPS, then reinstall.

**Native app didn't build**
- The installer falls back to the node+ffmpeg daemon if `swiftc` is missing.
  Install Xcode Command Line Tools (`xcode-select --install`) and re-run the
  installer to get the native app (recommended for reliable mic permission).

**Token mismatch (401 unauthorized)**
- The token on the VPS must exactly match `~/.config/pi-voice-stt-bridge/token`
  on the Mac. Re-copy it with `scp` and confirm `capture.tokenFile` points to it.

---

## Logs

- Mac daemon: `~/Library/Logs/pi-voice-stt-bridge.{out,err}.log`
- Tunnel: `~/Library/Logs/pi-voice-stt-tunnel.{out,err}.log`

Tail with:

```bash
tail -f ~/Library/Logs/pi-voice-stt-bridge.err.log
```

---

## Uninstall

```bash
launchctl bootout gui/$(id -u)/app.pi-voice-stt.bridge  2>/dev/null
launchctl bootout gui/$(id -u)/app.pi-voice-stt.tunnel  2>/dev/null
rm -rf ~/.local/share/pi-voice-stt-bridge \
       ~/.config/pi-voice-stt-bridge \
       ~/Library/LaunchAgents/app.pi-voice-stt.bridge.plist \
       ~/Library/LaunchAgents/app.pi-voice-stt.tunnel.plist \
       ~/Applications/"Pi Voice STT Bridge.app"
```

Optionally remove the `my-vps-voice-tunnel` block from `~/.ssh/config` and the
token copy on the VPS.

---

## How it fits into Pi Voice STT

The bridge is one of two `AudioRecorder` backends selected by
`capture.type` in `src/audio/factory.ts`:

- `ffmpeg` (default) — local capture via `ffmpeg`.
- `bridge` — delegates to this Mac daemon over the reverse SSH tunnel.

Everything downstream (the dictation controller, indicators, providers, optional
AI cleanup, modes, replacements, voice commands) is identical regardless of the
capture backend, so the bridge is a drop-in for VPS users.
