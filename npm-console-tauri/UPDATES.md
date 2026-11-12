# Installer and updates (Tauri build)

## Build the installer
    npm install
    npm run build
The installer is in src-tauri\target\release\bundle\nsis\ (and an .msi in bundle\msi\).
Windows may show a SmartScreen warning because the installer is not code-signed.

## One-time setup for updates (updates are signed so nobody can slip in a fake one)
1. Create a key pair:   npx tauri signer generate -w %USERPROFILE%\.tauri\taskprogress.key
   Keep the private key file safe (and its password). Never put it in the project.
2. Open src-tauri\tauri.conf.json and paste the PUBLIC key text into  plugins -> updater -> pubkey.

## Publish an update
1. Raise "version" in src-tauri\tauri.conf.json (for example 1.0.1).
2. In PowerShell:
       $env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\taskprogress.key"
       $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password, if you set one>"
       npm run build:release
       npm run make-latest -- http://<server>:8099/ "What changed"
   This creates an "updates" folder with the installer and latest.json.
3. Serve that folder: npm run serve-updates   (or copy it to any web server).
4. In the installed app, open the console and type:
       /update url http://<server>:8099/
       /update            (check now)
       /update install    (when it says the update is ready)
The app also checks by itself shortly after start and every 6 hours and downloads in the background.
