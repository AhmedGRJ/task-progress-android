# Task Progress (Electron)

## Run
    npm install
    npm start

## Build the installer and set up updates
See UPDATES.md  (npm run dist:win, then npm run serve-updates).

## Use
- Ctrl+Shift+Space opens the console from anywhere (Ctrl+` inside the app). Closing the window hides it to the tray; quit from the tray menu.
- Plain sentences in the console go to the planning assistant, for example:
    I have a customer call Tuesday 10 to 12, move everything else
    plan my week, VoLTE first
    finished the drive test, waiting on the X2 config
  It uses the AI settings of the dashboard (Ollama or Ascend). /undo reverts what it did.
- Commands: /event tue 10-12 Customer call, /focus VoLTE, /plan, /agenda, /evidence <#>, /update, /help
- Evidence: attach files or paste screenshots on a task (planner popover, card view, sub-task dialog, or /evidence <#>).
- Calendar link: Planner -> settings (gear) -> Calendar link. Subscribe to it from Outlook (File -> Account Settings -> Internet Calendars)
  or from a phone on the same network.
- Data lives in store.json in the app data folder, with daily backups for 14 days. Evidence files are kept inside the app profile.
- Zoom: Ctrl + / Ctrl - / Ctrl 0 (or Ctrl + mouse wheel), the buttons in the title bar, or /zoom 125 in the console. The level is remembered.
  In the calendar, + and - (or Ctrl + wheel over it) change only the time scale.
- Right-click anything: table rows, cards, Today items, calendar blocks, events, empty time slots, days, evidence files, text fields, the console, tabs, or the page.
- Every dialog and popup can be moved: drag its title (or the small grip at the top), double-click the title to put it back, or press Alt + arrow keys.
- Print daily pages for your notebook: click "Print pages" in the dashboard header (or Planner -> ... menu, or /print). Each day is one 13 x 20 cm page, two per landscape A4 sheet, filled from your app: the day's meetings, hourly schedule, and every task with its status, progress bar and percentage, last note, due date and overdue/due-today flags, plus tasks completed that day. Print the PDF at 100% (actual size) and cut along the dashed lines.

## Sync
This build can run the sync hub for your phone and use a shared cloud file. See ../SYNC.md.
