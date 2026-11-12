# Task Progress sync relay

Your own sync server. One file, no dependencies, needs Node 18 or newer.

```
node sync-relay.js --port 8083 --data ./relay-data
```

Options: `--host` (default 0.0.0.0), `--cert` and `--key` (serve https), `--token` (accept only this token).
Also available as environment variables (`PORT`, `DATA`, `TOKEN`, `CERT`, `KEY`).

## Using it
In every app: **Sync** > tab **Server** > address `http://<this-machine>:8083` and the same **token** on every device
(8+ characters; press Generate). The token also selects the data file, so one relay can serve several people.
Also set the same **sync passphrase** on every device: then the relay only ever stores unreadable data.

## Keeping it running
- Windows: `node sync-relay.js` in a terminal, or a scheduled task "At startup"; or `npm i -g pm2 && pm2 start sync-relay.js -- --port 8083 && pm2 save`.
- Linux (systemd): ExecStart=/usr/bin/node /opt/relay/sync-relay.js --port 8083 --data /var/lib/relay
- Docker: `docker build -t tp-relay . && docker run -d -p 8083:8083 -v tp-data:/data --restart unless-stopped tp-relay`

## Reaching it from outside your network
Plain http is fine on a trusted network. Over the internet use a VPN (Tailscale/WireGuard) or put the relay behind an https
reverse proxy (Caddy, nginx) or give it `--cert/--key`. The Android app allows http, so a LAN or VPN address works as is.

## Protocol (for the curious)
`POST /v1/sync` with `Authorization: Bearer <token>` and `{dev, since, epoch, items:[{k,t,by,d?|v?|e?}]}`
returns `{epoch, seq, items}`: only what is newer than `since`. Conflicts: the newer `t` wins per item.
`GET /v1/health` answers `{ok:true}`.
