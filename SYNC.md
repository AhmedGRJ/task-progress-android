# Syncing Windows and Android

Edits on one device reach the others automatically (about every minute, a few seconds after you change something,
when you open the app, and when the phone gets its connection back). Changes made offline on both sides are merged
item by item: two devices editing different tasks never overwrite each other, and a task added on the phone and another
added on the PC while apart both survive. If both edit the very same task, the later edit wins.

What is synced: tasks (all columns, added columns too), sub-tasks, notes and meeting minutes, planner events, recurring
tasks, per-task planner settings, done occurrences and the planner working-hours settings.
What stays on each device: evidence files and screenshots, the archive list, undo history and change log, AI settings,
the calendar-link setup, theme, zoom and window layout. (Evidence files are large; syncing them needs a server that
stores files, which is a possible later step.)

## Pick how the devices find each other

### A. PC hub over Wi-Fi or VPN (no cloud, nothing to install)
1. Windows app: Settings tab (or the Sync chip at the end of the tab bar) > Sync > tab "PC hub / server".
2. Tick "Run a sync hub on this computer", keep "Allow other devices on my network", press Generate for the token,
   enter a passphrase (recommended), tick "Keep this device in sync", press Save & sync now.
3. Windows asks to allow the app through the firewall: allow it on private networks.
4. Press "Copy phone setup code". On the phone open Sync, paste the code in the box, press Use, enter the same passphrase,
   tick "Keep this device in sync", Save & sync now. Choose "Replace this device's data" on a new phone.
The PC must be on and the app running. Away from home Wi-Fi the phone can reach the PC only through a VPN (Tailscale or WireGuard):
use the PC's VPN address in the server address field.

### B. Your own relay server (works anywhere)
Run `sync-relay/sync-relay.js` on any machine that is always on (see sync-relay/README.md; Docker file included).
In every app: Sync > "Server" > address and token, same passphrase. The PC app then needs no hub.

### C. Shared cloud file or WebDAV
- Windows: Sync > "Shared file" > Choose a file inside your OneDrive / Google Drive / Dropbox folder. Every PC pointing at the same
  cloud file stays in sync. (Windows app only.)
- WebDAV (Nextcloud, ownCloud, NAS): Sync > "WebDAV" > the full file address, user and (app) password. Works on Windows and Android.
- OneDrive, Google Drive and Dropbox cannot be read by a phone app without their own sign-in registration, so for the phone
  use A or B (or a WebDAV service).
Tip: a shared file is a good second copy of your data on top of A or B.

## The passphrase
Optional but recommended, and a must for a cloud file or a relay on a network you do not control. Data is encrypted on the device
(AES-256-GCM, key derived from the passphrase) before it leaves, so the server or cloud only ever holds unreadable data.
Same passphrase on every device. If you lose it, the synced copy cannot be recovered; each device still has its own data.
The setup code contains the server address and token, not the passphrase. Treat it like a password anyway.

## Good to know
- Sync runs while the app is open. The Android app does not sync in the background; it catches up when you open it.
- A device that is new to the sync location asks whether to replace its own data (right for a new phone) or merge. Merging two
  devices that each have their own separate, real task lists adds both lists together.
- If two devices add a task with the same Index number while apart, one is renumbered. "Blocked by" references use Index numbers, so
  check those after such a case.
- A column you add appears on the other devices. Removing or reordering columns stays local.
- "Resend everything" in the dialog makes this device upload all its data again. Use it if a server was restored from an old copy.
- Tauri build: acts as a sync client (server, hub, WebDAV); it cannot host the hub or use the shared file mode. Use the Electron build for that.
