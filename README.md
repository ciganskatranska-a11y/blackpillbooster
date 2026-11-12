# Blackpill Booster

System-wide volume booster for Windows with a mastering-grade Loudmaxx chain, EQ, voice changer and BONESMASHING.

Electron app · Windows x64 · v7.0.0

## Requirements

- Windows 10/11 x64
- Node.js 20 or newer

## Run from source

```bat
run.bat
```

or `npm install` then `npm start`.

## Build the installer

```bat
build.bat
```

or `npm install` then `npm run dist`. Output: `dist\Blackpill Booster Setup.exe`.

Portable build: `npm run portable` → `dist\win-unpacked\Blackpill Booster.exe`.

## Tests

```bat
npm test
```

## Virtual cable

The booster routes system audio through the free VB-CABLE driver. The installer sets it up automatically; when running from source, use **Route → Install the virtual cable for me** in the app.

See `README.txt` for full notes.
