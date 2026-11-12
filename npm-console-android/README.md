# Task Progress for Android

The same dashboard as the desktop apps, packaged as an Android app (Capacitor). The phone layout is built in: the planner opens in Day view,
the tab bar and buttons scroll sideways, dialogs fit the screen, and the back button closes a dialog first.
Sync with Windows: see ../SYNC.md.

## Get the APK without installing anything (recommended)
1. Put the whole `task-progress-final` folder in a GitHub repository (private is fine).
2. Open the Actions tab > "Build Android APK" > Run workflow. After about 5 to 10 minutes download the artifact "task-progress-android-apk"
   (it contains app-debug.apk). It also builds by itself on every push.
3. Copy the APK to the phone and open it. Android asks to allow "install unknown apps" for your file manager or browser; Play Protect may
   warn because the APK is signed with a debug key and not from the Play Store. That is expected for your own app.

## Build it yourself
Needs Node 22, JDK 21 and the Android SDK (Android Studio installs it).

    npm install
    npm run sync        copies ../npm-progress-pwa into the app and updates the Android project
    npm run open        opens it in Android Studio (Build > Build APK)
    npm run apk         or build from the command line: android/app/build/outputs/apk/debug/app-debug.apk

Whenever the dashboard changes (anything in npm-progress-pwa), run `npm run sync` and build again.
Every build, on any machine, is signed with the same key (android/app/debug.keystore), so a new APK installs over the old one and keeps its data.
It is a personal sideload key: anyone who has this folder can sign an update, so do not publish the repository publicly.

## Release-signed APK (optional)
Create a keystore (keytool -genkey ...), add it to android/app/build.gradle as a signingConfig, and run `npm run apk:release`.
Keep the keystore safe: it is what lets later versions update the installed app.

## Limits on the phone
- Printing the daily pages and file exports (Excel, PDF, backup download) are meant for the PC; Android's web view may not offer a save dialog for them.
  Sync replaces the need for backups between devices.
- No background sync; the app syncs when opened and while it is open.
- http addresses (a PC hub on your Wi-Fi) are allowed in this app on purpose; use a passphrase so the data stays encrypted on the wire.
