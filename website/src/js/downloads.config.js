// Download configuration — the ONLY place the installer links are set.
//
// The installers are published as GitHub Release assets in
// chardevedant67-code/daptari-agro: Android in `apps-v1.1`, Windows in
// `apps-v1.0` (see README → "Published installers"). An empty `url` would make the site show
// "not available yet" instead of a download button; it never points at a
// guessed or placeholder address.
//
// Rules enforced by `npm run check` and at runtime (download-rules.js):
//   - android.url must end in .apk, windows.url in .exe
//   - the two URLs must be different files
//   - https only (plain http is accepted for localhost / LAN preview)
//
// fileName is the release asset's name (what the browser saves the file
// as); sizeBytes and sha256 match the published assets. If you publish a
// rebuilt installer, update url, fileName, version, sizeBytes and sha256.

export const DOWNLOADS = {
  android: {
    url: 'https://github.com/chardevedant67-code/daptari-agro/releases/download/apps-v1.1/app-release.apk',
    productName: 'WeighingQR for Android',
    fileName: 'app-release.apk',
    format: 'APK',
    version: '1.1 (build 2)',
    sizeBytes: 327265846,
    sha256: '5d47dff0187f9dd52d41007152605fcb0566c91716afcf7764935d2558918a78',
    requirements: 'Android 7.0 or later, a camera and internet access. Keep roughly 700 MB free while installing (the download itself is 312 MB).',
    note: 'Signed release build. Compatibility depends on your device.',
  },
  windows: {
    url: 'https://github.com/chardevedant67-code/daptari-agro/releases/download/apps-v1.0/SeedManagement-Setup-0.1.1.exe',
    productName: 'Seed Management for Windows',
    fileName: 'SeedManagement-Setup-0.1.1.exe',
    format: 'EXE installer',
    version: '0.1.1',
    sizeBytes: 116139210,
    sha256: 'e540aa443f9b90550b0ac915f4dbd9d5e84342bfc957c6e860672f5915890514',
    requirements: 'Windows 10 or 11 (64-bit) and internet access. No administrator rights needed.',
    note: 'The installer is not code-signed, so Windows SmartScreen may show a warning.',
  },
};
