# Task Progress: final package

Three ways to run the same dashboard. Pick one:

| Folder | What it is | Start it |
|---|---|---|
| npm-console-desktop | Desktop app (Electron). The one you have been running. | npm install, then npm start |
| npm-console-tauri | Desktop app (Tauri). Smaller, needs Rust. | npm install, then npm run dev |
| npm-progress-pwa | Web app / PWA, no installation. | python server.py 8082 |
| npm-console-android | Android app (APK). Same dashboard, phone layout. | see npm-console-android/README.md (cloud build included) |
| sync-relay | Your own sync server (optional), one file. | node sync-relay.js |

Sync between Windows and Android (and any other copy): read SYNC.md. Tests are in tests/.

Windows note for the Electron build: if npm blocks Electron's install script, run  node node_modules\electron\install.js  once.

## Printing your daily pages (13 x 20 cm notebook)
Click "Print pages" in the dashboard header. The first day is tomorrow, and you can pick the number of days.
Every page is filled from your app: the day's meetings and hourly schedule, and each task with its status, progress bar and percentage,
last note, due date and overdue / due-today flags, plus tasks you completed that day. Two pages per landscape A4 sheet: print at 100% (actual size)
and cut along the dashed lines. SAMPLE-filled-pages-demo-data-19-25-Oct-2026.pdf shows what a printed sheet looks like (made-up demo tasks, not your data).
Print again whenever your plan changes: the pages always reflect the app at that moment.

## What it does
- Dashboard: editable task table, cards, Gantt, KPIs, charts, AI tools, Excel and backup export, undo/redo, sub-tasks, change history.
- Planner (Motion style): tasks are scheduled automatically into free time around your meetings, by priority and deadline. Drag, resize, pin,
  recurring tasks, time off, Day/Week/Month, import and export .ics.
- Console (Ctrl+Shift+Space anywhere, or Ctrl+` inside the app). Type plain sentences ("customer call Tuesday 10 to 12, move everything else",
  "plan my week, VoLTE first") or commands: /event /focus /plan /agenda /print /zoom /evidence /update /undo /help.
- Evidence: attach KPI plots, screenshots (paste with Ctrl+V) and exports to any task.
- Calendar link (desktop builds): subscribe to your plan from Outlook or a phone. Planner -> settings -> Calendar link.
- Zoom (desktop builds): Ctrl +, Ctrl -, Ctrl 0, or the buttons in the title bar.
- Right-click on anything. Every dialog and popup can be moved (drag the title, double-click to reset, Alt + arrows to nudge).
- Installer and auto-update (desktop builds): see UPDATES.md inside each desktop folder.

## Things to know
- Your tasks are stored per app. To keep devices identical turn on Sync (SYNC.md); for a one-off move use Save Backup and Restore Backup.
- The planner assumes a Sunday to Thursday working week, 09:00 to 17:30. Change it in the planner settings (gear icon).
- Auto-update and the Windows installers are set up but have not been tried on a real Windows machine. Test on a spare machine first.
- Sync, the PC hub and the Android app were tested in a simulated setup (two browsers, a relay, the Electron hub code with a stubbed Electron). The APK itself and the hub inside the real Windows app have not been run on real devices yet: try them on a spare phone and PC first, and keep a backup.
