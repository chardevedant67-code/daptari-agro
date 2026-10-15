const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The app keeps its record cache, unsent changes and remembered sign-in in
// one per-user folder (Electron's userData). If that folder cannot be
// created or written, nothing the user does could be kept, so startup stops
// with a message saying what to fix instead of opening a window that
// silently cannot save anything. Only the folder and a plain-language reason
// are shown — never the raw system error.

const REASONS = {
  EACCES: 'Windows denied access to it',
  EPERM: 'Windows denied access to it',
  EROFS: 'it is on a read-only drive',
  ENOSPC: 'the drive is full',
  ENOTDIR: 'a file with the same name is in the way',
  EEXIST: 'a file with the same name is in the way',
};

// Returns null when `dir` exists (or could be created) and accepts a new
// file; otherwise { code } with the system error code. The probe file is
// always removed again.
function checkWritableDir(dir) {
  const probe = path.join(dir, `.write-check-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return null;
  } catch (err) {
    try { fs.rmSync(probe, { force: true }); } catch (_) {}
    return { code: (err && err.code) || 'UNKNOWN' };
  }
}

function appDataErrorMessage(dir, code) {
  const reason = REASONS[code] || 'it could not be written to';
  return [
    'Seed Management cannot save its data on this computer.',
    '',
    `It needs to create and write to this folder, but ${reason}:`,
    dir,
    '',
    'Make sure your Windows account can write to that folder and that the drive has free space, '
      + 'then start Seed Management again. On a work computer, ask your IT administrator.',
  ].join('\n');
}

module.exports = { checkWritableDir, appDataErrorMessage };
