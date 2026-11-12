# Task Progress (Tauri)

## Requirements
- Node.js
- Rust (https://rustup.rs). On Windows also the "Desktop development with C++" build tools; WebView2 is already part of Windows 11.

## Run
    npm install
    npm run dev        # opens the app (first compile takes several minutes)
    npm run build      # installer in src-tauri/target/release/bundle/

## Installer and updates
See UPDATES.md  (npm run build, then the signed release steps for updates).

## Use
- Ctrl+Shift+Space opens the console from anywhere (Ctrl+` inside the app).
- Closing the window hides it to the tray; quit from the tray menu.
- Data lives in store.json inside the app data folder (daily backups kept for 14 days).
- Move your tasks over with Save Backup (old version) and Restore Backup (this one).
- Plain sentences in the console go to the planning assistant (for example "I have a customer call Tuesday 10 to 12, move everything else"
  or "plan my week, VoLTE first"). /undo reverts it. Commands: /event, /focus, /plan, /agenda, /evidence <#>, /update, /help.
- Evidence: attach files or paste screenshots on a task (planner popover, card view, sub-task dialog, or /evidence <#>).
- Calendar link: Planner -> settings (gear) -> Calendar link, then subscribe from Outlook or a phone on the same network.
- Zoom: Ctrl + / Ctrl - / Ctrl 0 (or Ctrl + mouse wheel), the buttons in the title bar, or /zoom 125 in the console. The level is remembered.
  In the calendar, + and - (or Ctrl + wheel over it) change only the time scale.
- Right-click anything: table rows, cards, Today items, calendar blocks, events, empty time slots, days, evidence files, text fields, the console, tabs, or the page.
- Every dialog and popup can be moved: drag its title (or the small grip at the top), double-click the title to put it back, or press Alt + arrow keys.
- Print daily pages for your notebook: click "Print pages" in the dashboard header (or Planner -> ... menu, or /print). Each day is one 13 x 20 cm page, two per landscape A4 sheet, filled from your app: the day's meetings, hourly schedule, and every task with its status, progress bar and percentage, last note, due date and overdue/due-today flags, plus tasks completed that day. Print the PDF at 100% (actual size) and cut along the dashed lines.

## Sync
This build syncs as a client (server, hub, WebDAV). Hosting the hub and the shared-file mode are in the Electron build. The change to src-tauri/src/main.rs (response headers in net_fetch) could not be compiled where it was written: if `npm run dev` reports a Rust error there, tell me the message. See ../SYNC.md.
