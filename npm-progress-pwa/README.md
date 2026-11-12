# Task Progress (web / PWA)

## Run
    python server.py 8082        (or double-click start.bat on Windows)
Open http://localhost:8082 and use the browser's "Install" button to get an app window.
Everything is stored in the browser. Zoom is the browser's own (Ctrl + / Ctrl -).

This version has the dashboard, the Planner, evidence, the console, right-click menus, movable windows and daily-page printing.
It does not have the calendar link or the installer/auto-update; those are in the desktop builds.

Print pages: click "Print pages" in the header. It makes one 13 x 20 cm page per day (two per A4 sheet), filled with that day's schedule and the progress of each task.

## Sync
The web app syncs as a client (server/hub or WebDAV; the browser needs the server to allow its address, the relay does). For a passphrase the page must be https or localhost. See ../SYNC.md.
