# Blackpill Booster

System-wide volume booster for Windows (Electron, x64). Version in `package.json`.

## Repo

- GitHub: https://github.com/ciganskatranska-a11y/blackpillbooster (public, branch `main`)
- Ignored: `node_modules/`, `dist/`
- `.bat`, `.ps1`, `.nsh` use CRLF (see `.gitattributes`)

## Commands

- Run: `npm start` (or `run.bat`)
- Test: `npm test` (`tests/run.js`)
- Build installer: `npm run dist` → `dist\Blackpill Booster Setup.exe` (or `build.bat`)
- Portable build: `npm run portable` → `dist\win-unpacked\`

## Files

- `main.js` Electron main: window, tray, hotkeys, device switching
- `preload.js` bridge between window and main
- `index.html`, `app.js`, `app.css` interface
- `engine.js` audio graph
- `processors.js` audio worklets (limiter, multiband, clipper, pitch)
- `shared.js`, `ui.js` settings, presets, controls
- `theme.css` shared styles
- `devices.ps1` lists/sets the Windows default audio device
- `install-cable.ps1` downloads and installs VB-CABLE (signature-checked)
- `build/icon.ico`, `build/installer.nsh` installer icon and hook (runs `install-cable.ps1`)

## Notes

- Audio is routed through the VB-CABLE virtual driver; the installer sets it up.
- Auto-update: `electron-updater` checks GitHub Releases on every start (packaged builds only, `checkForUpdates` in `main.js`) and asks the user before downloading; the installer reruns and reinstalls VB-CABLE only if missing.
- Releases: bump `version`, commit, push tag `vX.Y.Z`. `.github/workflows/release.yml` builds on a Windows runner and creates the release with `gh` (local builds fail here because Smart App Control blocks the unsigned build exe). It uploads `Blackpill-Booster-Setup.exe` + `latest.yml` (needed by the updater).
- The installer is one-click (no wizard): installs the app + VB-CABLE, then launches it. Permanent download link: https://github.com/ciganskatranska-a11y/blackpillbooster/releases/latest/download/Blackpill-Booster-Setup.exe
- Don't use electron-builder's `--publish always`: v7.1.0's assets ended up 404 when it uploaded them.

## Workflow

- Run `npm test` before committing.
- Commit with a short message, then push to `main`.
