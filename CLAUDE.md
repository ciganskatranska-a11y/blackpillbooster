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
- Auto-update: `electron-updater` checks GitHub Releases on every start (packaged builds only, `checkForUpdates` in `main.js`). If there's an update it opens the styled update window (`update.html`/`update.js`/`update.css`/`update-preload.js`), downloads on "Update now", then runs the installer silently and relaunches. Log: `%APPDATA%\Blackpill Booster\update.log`.
- Install is per-user (`%LOCALAPPDATA%\Programs`), so installs/updates need no admin. Only the VB-CABLE driver needs admin: `install-cable.ps1` elevates itself only when the cable is missing.
- `installer/Setup.cs` is both the styled setup and uninstaller window. `installer/pack.ps1 -Stage stub` compiles it (Windows-bundled .NET Framework `csc`, C# 5 only, no `$""`/`?.`, keep the source ASCII) to `build-stub/Blackpill Booster Uninstaller.exe` before `npm run dist` (shipped via `build.extraFiles`). `-Stage wrap` appends the NSIS installer (`dist/blackpill-booster-core.exe`) to make the Setup and writes `latest.yml` with its sha512.
  - With a payload it's the setup; without one it's the uninstaller. With `/S` there's no window: setup passes args to NSIS (how updates run), uninstaller passes them to the real `Uninstall Blackpill Booster.exe` (how the NSIS upgrade step removes the old version).
  - `build/installer.nsh` points Windows' `UninstallString` at the styled uninstaller. It relaunches from %TEMP%, asks the app to quit with `--quit` (so the audio device is restored), then runs NSIS `/S _?=<dir>`.
  - Setup also removes old per-machine (Program Files) installs from versions up to 7.1.3.
- Smart App Control on the dev PC blocks new unsigned exes: test Setup.cs UI by loading it into PowerShell with `Add-Type` (make `SetupForm` public in the loaded copy).
- Design tab: the `designs` list in `shared.js` (one object per design: colors, `radius`, `noise`). `applyTheme` in `ui.js` writes them to the CSS variables in `theme.css`; `prefs.design` stores the choice, and picking a design also resets `prefs.accent`/`prefs.hot` to that design's colors. Use the variables (`--bg`, `--panel`, `--on-hot`, `--radius`...) in CSS, not hard-coded `#000`/`#fff`. To add a design, add one entry to `designs`.
- Soundboard tab: `soundboard.js`. Sound files live in `%APPDATA%\Blackpill Booster\sounds` (`sounds:*` IPC in `main.js`), the list in the store under `soundboard`. Sound hotkeys are registered with the app's global hotkeys as `sound:<id>` commands.
- Preview the update window: run Electron with `ELECTRON_RUN_AS_NODE` unset (VS Code sets it).
- Releases: bump `version`, commit, push tag `vX.Y.Z`. `.github/workflows/release.yml` builds on a Windows runner and creates the release with `gh` (local builds fail here because Smart App Control blocks the unsigned build exe). It uploads `Blackpill-Booster-Setup.exe` + `latest.yml` (needed by the updater).
- Users download one file, `Blackpill-Booster-Setup.exe` (setup window + embedded NSIS): installs the app + VB-CABLE, then launches it. Permanent download link: https://github.com/ciganskatranska-a11y/blackpillbooster/releases/latest/download/Blackpill-Booster-Setup.exe
- Don't use electron-builder's `--publish always`: v7.1.0's assets ended up 404 when it uploaded them.

## Workflow

- Run `npm test` before committing.
- Commit with a short message, then push to `main`.
