const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkWritableDir, appDataErrorMessage } = require('../../electron/appDataCheck');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-appdata-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe('app-data folder check', () => {
  it('an existing writable folder passes and keeps no probe file', () => {
    const dir = path.join(root, 'existing');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'records.json'), '{}');
    assert.equal(checkWritableDir(dir), null);
    assert.deepEqual(fs.readdirSync(dir), ['records.json'], 'only what was there before');
  });

  it('a missing folder is created (first launch on a new laptop)', () => {
    const dir = path.join(root, 'new-user', 'AppData', 'Roaming', 'weighingdesktop');
    assert.equal(checkWritableDir(dir), null);
    assert.equal(fs.statSync(dir).isDirectory(), true);
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  it('a folder that cannot be created is reported with its system error code', () => {
    const blocker = path.join(root, 'blocker');
    fs.writeFileSync(blocker, 'a file, not a folder');
    const problem = checkWritableDir(path.join(blocker, 'weighingdesktop'));
    assert.ok(problem, 'must not pass');
    assert.match(problem.code, /^(ENOTDIR|EEXIST|ENOENT)$/);
  });

  it('a folder that exists but cannot be written to is reported', () => {
    const blocked = path.join(root, 'is-a-file');
    fs.writeFileSync(blocked, 'x');
    assert.ok(checkWritableDir(blocked), 'writing a file inside a file must fail');
  });
});

describe('app-data error message', () => {
  const dir = 'C:\\Users\\someone\\AppData\\Roaming\\weighingdesktop';

  it('names the folder and tells the user what to do', () => {
    const text = appDataErrorMessage(dir, 'EACCES');
    assert.match(text, /cannot save its data on this computer/);
    assert.ok(text.includes(dir));
    assert.match(text, /Windows denied access to it/);
    assert.match(text, /start Seed Management again/);
    assert.match(text, /IT administrator/);
  });

  it('gives a plain reason for common failures and a generic one otherwise', () => {
    assert.match(appDataErrorMessage(dir, 'ENOSPC'), /the drive is full/);
    assert.match(appDataErrorMessage(dir, 'EROFS'), /read-only drive/);
    assert.match(appDataErrorMessage(dir, 'ENOTDIR'), /a file with the same name is in the way/);
    assert.match(appDataErrorMessage(dir, 'SOMETHING_ELSE'), /could not be written to/);
    assert.match(appDataErrorMessage(dir, undefined), /could not be written to/);
  });

  it('never includes a raw error code or system message', () => {
    for (const code of ['EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'ENOTDIR', 'EEXIST', 'UNKNOWN']) {
      const text = appDataErrorMessage(dir, code);
      assert.equal(text.includes(code), false, code);
    }
  });
});

describe('startup wiring (main.js)', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('checks the data folder before anything else uses it — even before the single-instance lock — and stops with the message', () => {
    const check = code.indexOf('checkWritableDir(dataDir)');
    const lock = code.indexOf('requestSingleInstanceLock()');
    const core = code.indexOf('createCore(');
    // Electron keeps its single-instance lock file in the data folder; if the
    // lock were taken first, an unwritable folder would make the app quit
    // silently (found by launching it against such a folder).
    assert.ok(check > 0 && lock > check, 'the check runs before the single-instance lock');
    assert.ok(core > lock, 'and so before the core is created');
    assert.match(code, /if \(dataDirProblem\) \{\s*cannotStart\(dataDirProblem\.code\);\s*\} else if \(!app\.requestSingleInstanceLock\(\)\)/);
    assert.match(code, /catch \(err\) \{\s*return cannotStart\(err && err\.code\);/);
    assert.match(code, /dialog\.showErrorBox\('Seed Management cannot start', appDataErrorMessage\(dataDir, code\)\);\s*app\.exit\(1\);/);
  });

  it('the data folder and workbook folder are still Electron\'s per-user locations', () => {
    assert.match(code, /const dataDir = app\.getPath\('userData'\);/);
    assert.match(code, /workbookDir: config\.workbookDir \|\| app\.getPath\('documents'\)/);
    assert.match(code, /filePath: path\.join\(dataDir, 'session\.bin'\)/);
  });
});
