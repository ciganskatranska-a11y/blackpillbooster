BLACKPILL BOOSTER 7 · SOURCE
============================

NEED
Node.js 20 or newer (https://nodejs.org, LTS installer). Nothing else.

RUN WITHOUT BUILDING
Double-click run.bat   (or: npm install, then npm start)

BUILD THE INSTALLER
Double-click build.bat (or: npm install, then npm run dist)
Result: dist\Blackpill Booster Setup.exe
The installer puts the app in Program Files, adds shortcuts and an uninstaller,
then downloads and installs the free VB-CABLE driver from vb-audio.com.
Click Install when Windows asks about device software.

Portable folder instead of an installer: npm run portable
Result: dist\win-unpacked\Blackpill Booster.exe

VIRTUAL CABLE
Windows only lets a driver touch system audio, so the booster uses VB-CABLE as
the hand-off point. If you run from source or portable, open the app and use
Route > "Install the virtual cable for me". Restart the PC once if the cable
does not show up.

If Windows blocks capture: Settings > Privacy & security > Microphone >
"Let desktop apps access your microphone" must be on.

NO SOUND AFTER A CRASH OR FORCED SHUTDOWN?
Start the app once (it puts your device back), or pick your speakers in
Windows Settings > System > Sound.

FILES
main.js            Electron main: window, tray, hotkeys, device switching
preload.js         Bridge between the window and main
index.html app.js  The interface
engine.js          Audio graph
processors.js      Audio worklets (limiter, multiband, clipper, pitch...)
shared.js ui.js    Settings, presets, controls
devices.ps1        Lists and sets the Windows default audio device
install-cable.ps1  Downloads and installs VB-CABLE
build/             Installer icon and installer hook
tests/run.js       npm test

EARS AND SPEAKERS
Digital audio tops out at full scale. Past that point more gain means more
crushing, not more level. Panic (Alt+Shift+P) drops everything back to 100%.
