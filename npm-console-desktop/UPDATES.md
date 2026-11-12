# Installer and updates (Electron build)

## Build the installer
    npm install
    npm run dist:win
The installer is dist\Task Progress Setup <version>.exe, next to latest.yml (the update description).
Windows may show a SmartScreen warning because the installer is not code-signed.

## Publish an update
1. Raise "version" in package.json (for example 1.0.1) and run npm run dist:win again.
2. Put the new .exe, the .blockmap and latest.yml on a web server (any plain HTTP/HTTPS folder).
   To test on your own network:  npm run serve-updates   (serves the dist folder on port 8099)
3. In the installed app, open the console and type:
       /update url http://<server>:8099/
       /update            (check now)
       /update install    (when it says the update is ready)
The app also checks by itself shortly after start and every 6 hours, downloads in the background, and installs when you quit
or when you choose "Restart to update" in the tray menu.

To bake the address into the installer instead, build with:  set UPDATE_URL=https://your-server/updates/  and then npm run dist:win
