# WeighingQR website

Product and download website for **WeighingQR — Seed Packet Weighing & QR Tracking System**.
It explains the system, offers the two app installers as separate downloads, and gives
step-by-step installation guides and an FAQ.

Everything for the website lives in this `website/` folder. It does not change, import from
or depend on the mobile app, the desktop app, the backend or the admin dashboard.

## Stack

A static site: plain HTML, CSS and JavaScript modules, with small Node scripts for the
preview server, checks and build. **There are no npm dependencies**, so nothing needs to be
installed. Node 18 or later is enough.

```
website/
├── package.json            scripts only — no dependencies
├── scripts/
│   ├── serve.mjs           local preview server (optionally serves local installers for testing)
│   ├── check.mjs           checks: download config, HTML references, JS syntax, CSS variables
│   └── build.mjs           check, then copy src/ → dist/
└── src/
    ├── index.html          the page (all sections)
    ├── styles/tokens.css   colours, type scale, spacing (palette taken from the mobile app)
    ├── styles/main.css     components and sections
    ├── js/downloads.config.js   ← the two download links are configured here
    ├── js/download-rules.js     rules shared by the page and the checks
    ├── js/main.js          download buttons, mobile menu, reveal animation, year
    └── assets/weighingqr-icon.png   product icon (copied from ../images/icon_preview.png)
```

## Commands

Run these from the `website/` folder.

| Command | What it does |
|---|---|
| `npm run dev` | Serves `src/` at http://127.0.0.1:4173 |
| `npm run dev -- --host 0.0.0.0` | Also reachable from a phone on the same Wi-Fi (prints the addresses) |
| `npm run check` | Runs all checks. Missing download URLs are warnings |
| `npm run check -- --strict` | Same, but missing download URLs are errors (use before publishing) |
| `npm run build` | Runs the checks, then writes the site to `dist/` |
| `npm run build -- --strict` | Production build: refuses to build until both download URLs are set |
| `npm run preview` | Serves the built `dist/` |

There is no separate type-check step. The JavaScript is plain modules; `npm run check` verifies
its syntax with `node --check` and the download rules with a built-in self-test.

## Download configuration

Both download links are set in **`src/js/downloads.config.js`**, one entry per platform:

```js
android: { url: 'https://github.com/chardevedant67-code/daptari-agro/releases/download/apps-v1.0/WeighingQR-Android-1.0.apk', fileName: 'WeighingQR-Android-1.0.apk', ... }
windows: { url: 'https://github.com/chardevedant67-code/daptari-agro/releases/download/apps-v1.0/SeedManagement-Setup-0.1.1.exe', fileName: 'SeedManagement-Setup-0.1.1.exe', ... }
```

While a `url` is empty, that card shows **“Not available yet”** with a disabled button, and the
hero, footer and call-to-action buttons lead to that card instead of to a file. On a local preview a
developer note also says what to configure.

Rules, enforced by `npm run check` and again by the page itself:

- `android.url` must end in `.apk`; `windows.url` must end in `.exe`.
- The two URLs must be different files.
- Only `https` is allowed (plain `http` only for localhost or LAN previews).
- A misconfigured URL is never shown as a working download. The card shows an error state instead.

The published files:

| | Android | Windows |
|---|---|---|
| Release asset | `WeighingQR-Android-1.0.apk` | `SeedManagement-Setup-0.1.1.exe` |
| Built from | `weighingqrauto/android/app/build/outputs/apk/release/app-release.apk` | `weighingdesktop/release/Seed Management Setup 0.1.1.exe` |
| Size | 327,258,922 bytes (312 MB) | 116,139,210 bytes (111 MB) |
| SHA-256 | `833daebd3fd3d5da4a0a29b0ebd4009ba5777ecc1afa59c7ef8182a619e75f99` | `e540aa443f9b90550b0ac915f4dbd9d5e84342bfc957c6e860672f5915890514` |
| Version | 1.0 (versionCode 1), signed with the release key | 0.1.1, not code-signed |

If you publish a rebuilt installer, update `fileName`, `version`, `sizeBytes` and `sha256` too.
To get the SHA-256 on Windows, run `Get-FileHash -Algorithm SHA256 <file>` in PowerShell.

### Testing the downloads locally (no upload, no copying)

```
npm run dev -- --android "..\weighingqrauto\android\app\build\outputs\apk\release\app-release.apk" --windows "..\weighingdesktop\release\Seed Management Setup 0.1.1.exe"
```

The preview server streams the two files from where they are and points the buttons at them,
for this local preview only. Nothing is copied into the website, and `downloads.config.js` is
not changed. Add `--host 0.0.0.0` to test the APK download from a phone on the same Wi-Fi.

## Published installers

Both installers are assets of the GitHub Release
[`apps-v1.0`](https://github.com/chardevedant67-code/daptari-agro/releases/tag/apps-v1.0)
in this repository. They are not in git; `website/.gitignore` excludes `*.apk` and `*.exe`.
GitHub's own SHA-256 digest and size for each asset match the table above.

To publish a new version:

1. Upload the new installer to a new **published** (not draft) release. Use a file name without
   spaces, because GitHub renames assets that contain spaces.
2. Check the URL before using it: `curl -sIL <url>` should end in `200` with the expected
   `content-length`. Then compare the SHA-256 with `Get-FileHash`, or with the digest GitHub
   shows for the asset.
3. Update `url`, `fileName`, `version`, `sizeBytes` and `sha256` in `downloads.config.js`, plus
   any file names written in `index.html`, then run `npm run build -- --strict`.

## Deploying the website (needs approval; not done)

`dist/` is a plain static folder; any static host works. If you use Vercel, create a **separate**
project with root directory `website`, build command `npm run build -- --strict` and output
directory `dist`. Do not change the existing admin-dashboard project.

## What the content is based on

All app behaviour described on the page was checked against the source code:

- **Mobile app** (`weighingqrauto/src`): Sign In with Create Account (Full Name, Email Address,
  Password, Confirm Password → “Account created!” → back to Sign In); the Dashboard shows
  System Online, Weigh & Record and Product Info; History, Analytics and Settings tabs.
- **Weigh & Record steps:** Scan QR → Before Weight → Before Photo → After Weight → After Photo →
  Save Measurement → “Saved to the server and linked to this packet”. The scale display can be
  read with 📷 Scan Scale Display. An unfinished weighing resumes when the same packet is
  scanned again.
- **Release APK:** minSdk 24 (Android 7.0). It talks to the HTTPS backend; plain-HTTP traffic
  is disabled, so the same Wi-Fi is not required.
- **Desktop app** (`weighingdesktop`, product name “Seed Management”):
  - Windows 10/11 64-bit, installed per user with no admin rights; not code-signed.
  - Sign-in with admin accounts only. Admin accounts can view; Superadmin accounts can also add
    and edit.
  - Writes `Seed_Management.xlsx` to Documents.
  - It does not weigh or scan.

The phone image in the hero is an HTML/CSS illustration based on the app's Dashboard and Weigh &
Record screens, with example values. It is captioned as such and is not a screenshot. (The mobile
screenshots mentioned in the original request were not available; the app's own screen code was
used instead.)

## Verified on this machine

- `npm run check` and `npm run build` pass; the only warnings are the two unset download URLs.
- Headless Chrome at 360, 412, 768, 1366 and 1920 px wide:
  - no horizontal scrolling, no clipped elements, no console errors and no failed requests;
  - the mobile menu opens and closes with Escape, and the first Tab reaches the skip link;
  - both download states work (not configured, and configured with the real local files).
- A browser download of the Windows installer through the button had the expected SHA-256. The
  APK was downloaded through the same route with matching size and SHA-256, and resumable
  (Range) requests work.

## Still needs testing

- **Downloading from GitHub on a real phone and a real Windows PC** (the URLs and file contents
  were verified from this PC; see “Verified on this machine”).
- **Android APK on real phones** (none tested yet):
  - installation;
  - sign-up and sign-in;
  - camera, QR scanning and 📷 Scan Scale Display;
  - saving a measurement to the server;
  - a second phone model.
- **Windows installer on another PC:**
  - the SmartScreen prompt;
  - installation and sign-in;
  - syncing records.
- **Real devices and browsers:** layout on actual devices (only headless Chrome was used here),
  and a screen-reader pass.
