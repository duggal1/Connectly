# Connectly

Persistent, full-fidelity remote PTY. A Go daemon runs on the Mac; an Expo (React Native) app on Android renders xterm.js and streams over a binary-framed WebSocket.

## Layout

- `daemon/` — Go daemon (PTY, WebSocket, auth, session store, launchd).
- `app/` — Expo React Native Android client (xterm.js in WebView).

## Mac daemon

Requirements: Go 1.23+.

```
cd daemon
make build
./remote-pty config          # show config
./remote-pty token           # mint a client token
./remote-pty serve            # run (default :8765)
```

Config lives at `~/.config/remote-pty/config.yaml` (auto-created). Set `tls_cert`/`tls_key` for TLS, or put it behind Tailscale/Cloudflare Tunnel.

Install as a service:

```
make install
cp launchd/com.remotepty.daemon.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.remotepty.daemon.plist
```

## Android app

Requirements: Node 20+, Expo CLI.

```
cd app
npm install
npx expo start --android
```

Enter the Mac's host (Tailscale IP or LAN IP), port (8765), and a token from `remote-pty token`. Tap Connect.

## Protocol

Binary framed over WebSocket. Each message: `[1 byte type][4 bytes length (BE)][payload]`.

- 0x01 stdin
- 0x02 stdout
- 0x03 stderr
- 0x04 resize (cols, rows as u16)
- 0x05 control (JSON: op, token, session_id, resume_token, cols, rows, signal)
- 0x06 heartbeat

Auth: first control message `{op:"auth", token}` or `?token=` query param. Sessions can be resumed via `{op:"resume", resume_token}`.

## Known limitations

- Android foreground service / wake lock for background streaming is not yet implemented; the app reconnects on foreground. Add a native foreground-service module for always-on sessions.
- Terminal rendering depends on CDN-hosted xterm.js; bundle locally for offline use.
- Daemon wake lock uses `caffeinate`; lid-closed survival still depends on macOS power settings / clamshell mode.

## Security

- Never expose without auth. Prefer Tailscale.
- Token auth (JWT HS256 or raw shared secret) on every connection.
- Rate limiting per IP.
- Audit log at `~/.local/share/remote-pty/audit.log`.
