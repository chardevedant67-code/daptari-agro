// Drives the REAL application window (Electron, launched by Playwright)
// against the real server and the local throwaway MongoDB — the same test
// backend the e2e suite uses (see tests/e2e/testBackend.js for why this can
// never touch production). The app writes its workbook and its own state
// into a temp folder, never into the real Documents folder.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { _electron: electron } = require('playwright-core');
const { createTestBackend, waitFor, DESKTOP_DIR } = require('../e2e/testBackend');
const { COLUMNS } = require('../../shared/columns');

const HEADERS = COLUMNS.map((c) => c.header);
const APP_VERSION = require('../../package.json').version;

let backend;
let Records;
let runDir;
let shotsDir;
let app;
let page;
let workbookPath;

const tid = (id) => `[data-testid="${id}"]`;

async function launch() {
  const env = {
    ...process.env,
    DESKTOP_API_URL: backend.baseUrl,
    DESKTOP_USER_DATA_DIR: path.join(runDir, 'appdata'),
    DESKTOP_WORKBOOK_DIR: path.join(runDir, 'documents'),
  };
  // Set by Electron-based hosts (e.g. a VS Code task runner); it would make
  // electron.exe start as plain Node instead of opening the app.
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: require('electron'),
    args: [DESKTOP_DIR],
    cwd: DESKTOP_DIR,
    env,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
}

async function shot(name) {
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
}

async function login(key) {
  await page.fill(tid('login-email'), backend.accounts[key].email);
  await page.fill(tid('login-password'), backend.accounts[key].password);
  await page.click(tid('login-submit'));
}

const syncState = () => page.getAttribute(tid('sync-status'), 'data-state');
const waitSynced = () => waitFor(async () => (await syncState()) === 'synced', { timeoutMs: 20000, what: 'the status to show "synced"' });

// Column virtualization means only on-screen headers exist in the DOM, so
// walk the grid sideways and collect them by their position.
async function readAllHeaders() {
  const seen = new Map();
  const scroller = page.locator('.MuiDataGrid-virtualScroller');
  const width = await scroller.evaluate((el) => el.scrollWidth);
  for (let left = 0; left <= width; left += 300) {
    await scroller.evaluate((el, x) => { el.scrollLeft = x; }, left);
    await page.waitForTimeout(60);
    const visible = await page.$$eval('.MuiDataGrid-columnHeader[aria-colindex]', (els) => els.map((el) => [
      Number(el.getAttribute('aria-colindex')),
      (el.querySelector('.MuiDataGrid-columnHeaderTitle') || el).textContent.trim(),
    ]));
    for (const [index, title] of visible) seen.set(index, title);
  }
  await scroller.evaluate((el) => { el.scrollLeft = 0; });
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, title]) => title);
}

async function readWorkbook() {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(workbookPath);
  const sheet = book.worksheets[0];
  const headers = sheet.getRow(1).values.slice(1);
  const rows = [];
  sheet.eachRow((row, i) => {
    if (i === 1) return;
    const values = {};
    headers.forEach((h, c) => { values[h] = row.getCell(c + 1).value; });
    rows.push(values);
  });
  return { headers, rows };
}

const cell = (recordId, field) => page.locator(`.MuiDataGrid-row[data-id="${recordId}"] .MuiDataGrid-cell[data-field="${field}"]`);

// The grid renders only the columns in view: scrolls across until the cell
// is rendered, reads it, and scrolls back.
async function cellText(recordId, field) {
  const scroller = page.locator('.MuiDataGrid-virtualScroller');
  const width = await scroller.evaluate((el) => el.scrollWidth);
  let text = null;
  for (let left = 0; left <= width && text === null; left += 300) {
    await scroller.evaluate((el, x) => { el.scrollLeft = x; }, left);
    await page.waitForTimeout(60);
    if (await cell(recordId, field).count()) text = (await cell(recordId, field).textContent()).trim();
  }
  await scroller.evaluate((el) => { el.scrollLeft = 0; });
  return text;
}

before(async () => {
  assert.ok(fs.existsSync(path.join(DESKTOP_DIR, 'dist', 'index.html')), 'UI bundle missing — run "npm run build:ui" first');
  backend = await createTestBackend({ label: 'ui' });
  Records = backend.model('DesktopSeedRecord');
  await backend.createAdmin('Superadmin', 'superadmin');
  await backend.createAdmin('Admin', 'admin');
  await backend.seedPackets();
  runDir = backend.tempDir('ui');
  shotsDir = path.join(DESKTOP_DIR, '.test-output', 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  workbookPath = path.join(runDir, 'documents', 'Seed_Management.xlsx');
  await launch();
}, { timeout: 600000 });

after(async () => {
  if (app) await app.close().catch(() => {});
  if (backend) await backend.dispose();
});

describe('Screen 1 — Login / Sign Up', () => {
  it('is the first thing shown, and the window loads only the bundled UI', async () => {
    await page.waitForSelector(tid('login-screen'));
    assert.equal(await page.locator(tid('data-screen')).count(), 0);
    assert.match(page.url(), /^file:\/\/.*dist\/index\.html$/);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined', 'no Node access in the UI');
    assert.deepEqual(await page.evaluate(() => Object.keys(window.desktop).sort()), ['call', 'on']);
    assert.equal((await page.textContent(tid('server-url'))).trim(), `Server: ${backend.baseUrl}`);
    assert.equal((await page.textContent(tid('app-version'))).trim(), `Version ${APP_VERSION}`);
    assert.equal(APP_VERSION, '0.1.1');
    await shot('01-login');
  });

  it('validates before sending anything', async () => {
    await page.click(tid('login-submit'));
    await page.waitForSelector('text=Email is required.');
    await page.waitForSelector('text=Password is required.');
    await page.fill(tid('login-email'), 'not-an-email');
    await page.click(tid('login-submit'));
    await page.waitForSelector('text=Enter a valid email address.');
  });

  it('password visibility can be toggled', async () => {
    await page.fill(tid('login-password'), 'visible-check');
    assert.equal(await page.getAttribute(tid('login-password'), 'type'), 'password');
    await page.click(tid('login-password-toggle'));
    assert.equal(await page.getAttribute(tid('login-password'), 'type'), 'text');
    await page.click(tid('login-password-toggle'));
    assert.equal(await page.getAttribute(tid('login-password'), 'type'), 'password');
  });

  it('a wrong password shows the server\'s message and stays on the login screen', async () => {
    await page.fill(tid('login-email'), backend.accounts.Superadmin.email);
    await page.fill(tid('login-password'), 'definitely-wrong');
    await page.click(tid('login-submit'));
    const error = page.locator(tid('auth-error'));
    await error.waitFor();
    assert.match(await error.textContent(), /Invalid email or password/);
    assert.equal(await page.locator(tid('data-screen')).count(), 0);
  });

  it('Sign Up validates, creates an operator through the backend, and does not sign in', async () => {
    await page.click(tid('tab-signup'));
    await page.click(tid('signup-submit'));
    await page.waitForSelector('text=Name is required.');

    await page.fill(tid('signup-name'), 'Ui Operator');
    await page.fill(tid('signup-email'), 'ui.operator@desktop-test.local');
    await page.fill(tid('signup-password'), '123');
    await page.fill(tid('signup-confirm'), '1234');
    await page.click(tid('signup-submit'));
    await page.waitForSelector('text=Password must be at least 6 characters.');
    await page.waitForSelector('text=Passwords do not match.');
    assert.equal(await backend.model('User').countDocuments({ email: 'ui.operator@desktop-test.local' }), 0, 'nothing sent while invalid');

    await page.fill(tid('signup-password'), 'operator-pass-9');
    await page.fill(tid('signup-confirm'), 'operator-pass-9');
    await shot('02-signup');
    await page.click(tid('signup-submit'));

    const notice = page.locator(tid('auth-notice'));
    await notice.waitFor();
    assert.match(await notice.textContent(), /cannot open desktop records/);
    await page.waitForSelector(tid('login-submit'));
    assert.equal(await page.locator(tid('data-screen')).count(), 0, 'still on the login screen');

    const user = await backend.model('User').findOne({ email: 'ui.operator@desktop-test.local' }).lean();
    assert.equal(user.role, 'operator');
    assert.equal(await backend.model('Admin').countDocuments({ email: 'ui.operator@desktop-test.local' }), 0);
  });

  it('the new operator account cannot sign in to the desktop app', async () => {
    await page.fill(tid('login-email'), 'ui.operator@desktop-test.local');
    await page.fill(tid('login-password'), 'operator-pass-9');
    await page.click(tid('login-submit'));
    const error = page.locator(tid('auth-error'));
    await error.waitFor();
    assert.match(await error.textContent(), /Invalid email or password/);
  });

  it('Forgot Password asks the backend and shows its answer', async () => {
    await page.click(tid('forgot-link'));
    await page.fill(tid('forgot-email'), backend.accounts.Admin.email);
    await page.click(tid('forgot-submit'));
    const notice = page.locator(tid('auth-notice'));
    await notice.waitFor();
    assert.match(await notice.textContent(), /If an account exists for this email/);
    await page.click(tid('back-to-login'));
    await page.waitForSelector(tid('login-submit'));
  });
});

describe('Screen 2 — Excel Data Manager, as an ordinary Admin (view only)', () => {
  it('login goes straight to the data table — no dashboard in between', async () => {
    await login('Admin');
    await page.waitForSelector(tid('data-screen'));
    assert.equal(await page.locator(tid('login-screen')).count(), 0);
    assert.equal(await page.getAttribute(tid('account-chip'), 'data-role'), 'admin');
    // Which build this is and which server it uses, without exposing anything else.
    const label = (await page.textContent(tid('app-version'))).trim();
    assert.equal(label, `v${APP_VERSION} · ${backend.baseUrl}`);
    assert.doesNotMatch(label, /token|password|Bearer/i);
    await waitSynced();
  });

  it('shows the 24 columns in the approved order (after one on-screen status column)', async () => {
    const headers = await readAllHeaders();
    assert.equal(headers[0], 'Status');
    assert.deepEqual(headers.slice(1), HEADERS);
    assert.equal(headers.length, 25);
    assert.equal(headers[headers.indexOf('Before Weight') + 1], 'After Weight');
  });

  it('the existing seed packets are already in the table — nobody had to import anything', async () => {
    assert.equal(await page.locator('.MuiDataGrid-row').count(), 3);
    for (const id of ['PKT-PRD-SOYBLOTA-001', 'PKT-PRD-SOYBLOTA-002', 'PKT-PRD-WHTLOTB-001']) {
      await cell(id, 'crop').waitFor();
      await page.waitForSelector(`.MuiDataGrid-row[data-id="${id}"] ${tid('row-state-synced')}`);
    }
    assert.equal((await cell('PKT-PRD-SOYBLOTA-001', 'crop').textContent()).trim(), 'Soybean');
    assert.equal((await cell('PKT-PRD-WHTLOTB-001', 'crop').textContent()).trim(), 'Wheat');
    // The packet the mobile app already weighed: its before and after weights.
    assert.equal(await cellText('PKT-PRD-SOYBLOTA-001', 'weight'), '0.5');
    assert.equal(await cellText('PKT-PRD-SOYBLOTA-001', 'afterWeight'), '1.75');
    assert.equal(await cellText('PKT-PRD-WHTLOTB-001', 'weight'), '');
    assert.equal(await page.locator(tid('not-imported')).count(), 0);
    assert.equal(await page.locator(tid('grid-empty')).count(), 0);
    assert.match(await page.textContent(tid('sync-details')), /3 records loaded/);

    // In MongoDB: one record per packet, made by the server itself.
    assert.equal(await Records.countDocuments({ packetUniqueId: { $type: 'string' } }), 3);
    assert.equal(await Records.countDocuments({ createdBy: null }), 3);
  });

  it('has no add, edit or import controls', async () => {
    await page.waitForSelector(tid('read-only-banner'));
    assert.equal(await page.locator(tid('add-record')).count(), 0);
    assert.equal(await page.locator(tid('import-packets')).count(), 0);
    assert.equal(await page.locator('.MuiDataGrid-cell--editable').count(), 0);
    assert.equal(await page.locator(tid('sync-error')).count(), 0);
    await shot('03-admin-view-only');
  });

  it('wrote Seed_Management.xlsx with the 24 headers and one row per existing packet', async () => {
    assert.equal((await page.textContent(tid('workbook-path'))).trim(), workbookPath);
    await waitFor(() => fs.existsSync(workbookPath), { what: 'the workbook to be written' });
    const { headers, rows } = await readWorkbook();
    assert.deepEqual(headers.slice(0, 24), HEADERS);
    assert.equal(rows.length, 3);
    assert.equal(rows.length, await Records.countDocuments());
    const soy = rows.find((r) => r.Record_ID === 'PKT-PRD-SOYBLOTA-001');
    assert.equal(soy.Crop, 'Soybean');
    assert.equal(soy.Year, 2025);
    assert.equal(soy.Wearhouse, 'Warehouse A');
    assert.equal(soy.Rack_shelf, 'R1-S2');
    assert.equal(soy['Before Weight'], 0.5);
    assert.equal(soy['After Weight'], 1.75);
    assert.equal(soy['Name Of Variety'], null);
    assert.equal(soy.Varity_Code, null);
    assert.equal(soy.Total, null);
  });

  it('Sign out returns to the login screen', async () => {
    await page.click(tid('logout'));
    await page.waitForSelector(tid('login-screen'));
    assert.equal(await page.locator(tid('data-screen')).count(), 0);
  });
});

describe('Screen 2 — Excel Data Manager, as Superadmin', () => {
  let recordId;

  it('shows the management controls', async () => {
    await login('Superadmin');
    await page.waitForSelector(tid('data-screen'));
    assert.equal(await page.getAttribute(tid('account-chip'), 'data-role'), 'superadmin');
    await page.waitForSelector(tid('add-record'));
    assert.equal(await page.locator(tid('import-packets')).count(), 0, 'there is no import control — it is not needed');
    assert.equal(await page.locator(tid('read-only-banner')).count(), 0);
    await waitSynced();
    assert.equal(await page.locator('.MuiDataGrid-row').count(), 3);
  });

  it('Add record: invalid input is refused in the dialog', async () => {
    await page.click(tid('add-record'));
    await page.waitForSelector(tid('add-dialog'));
    assert.equal(await page.locator(`${tid('add-dialog')} input[data-testid^="add-"], ${tid('add-dialog')} textarea[data-testid^="add-"]`).count(), 24);
    await page.fill(tid('add-crop'), 'Maize');
    await page.fill(tid('add-yield1'), 'lots');
    await page.click(tid('add-save'));
    const error = page.locator(tid('add-error'));
    await error.waitFor();
    assert.match(await error.textContent(), /Yield 1 must be a number/);
    assert.equal(await Records.countDocuments(), 3, 'only the three packet records exist');
  });

  it('Add record: a valid record is saved to MongoDB, then appears in Excel', async () => {
    await page.fill(tid('add-yield1'), '12.5');
    await page.fill(tid('add-year'), '2026');
    await page.fill(tid('add-femaleCode'), 'F-77');
    await page.fill(tid('add-comments'), 'added from the UI');
    await shot('04-add-record');
    await page.click(tid('add-save'));
    await page.waitForSelector(tid('add-dialog'), { state: 'detached' });

    const doc = await waitFor(() => Records.findOne({ crop: 'Maize' }).lean(), { what: 'the record to reach MongoDB' });
    recordId = doc.recordId;
    assert.equal(doc.yield1, 12.5);
    assert.equal(doc.year, 2026);
    assert.equal(doc.femaleCode, 'F-77');
    assert.equal(doc.version, 1);
    assert.equal(String(doc.createdBy), backend.accounts.Superadmin.id);

    await waitSynced();
    assert.equal((await cell(recordId, 'crop').textContent()).trim(), 'Maize');
    assert.equal((await cell(recordId, 'year').textContent()).trim(), '2026');
    await page.waitForSelector(`.MuiDataGrid-row[data-id="${recordId}"] ${tid('row-state-synced')}`);

    const row = await waitFor(async () => (await readWorkbook()).rows.find((r) => r.Record_ID === recordId), { what: 'the record to reach Excel' });
    assert.equal(row.Crop, 'Maize');
    assert.equal(row['Yield 1'], 12.5);
    assert.equal(row.Comments, 'added from the UI');
    assert.equal(row.Version, 1);
  });

  it('editing a cell in the table saves through the backend', async () => {
    await cell(recordId, 'crop').dblclick();
    const input = cell(recordId, 'crop').locator('input');
    await input.fill('Maize (edited)');
    await input.press('Enter');

    const doc = await waitFor(async () => {
      const d = await Records.findOne({ recordId }).lean();
      return d.version === 2 ? d : null;
    }, { what: 'the edit to reach MongoDB' });
    assert.equal(doc.crop, 'Maize (edited)');
    await waitSynced();
    const row = await waitFor(async () => (await readWorkbook()).rows.find((r) => r.Record_ID === recordId && r.Version === 2), { what: 'the edit to reach Excel' });
    assert.equal(row.Crop, 'Maize (edited)');
  });

  it('clearing a number cell blanks it and saves through the backend', async () => {
    await cell(recordId, 'year').dblclick();
    const input = cell(recordId, 'year').locator('input');
    await input.fill('');
    await input.press('Enter');
    const doc = await waitFor(async () => {
      const d = await Records.findOne({ recordId }).lean();
      return d.version === 3 ? d : null;
    }, { what: 'the cleared year to reach MongoDB' });
    assert.equal(doc.year, null);
    await waitSynced();
  });

  it('the packet rows sit alongside the new record, with the unconfirmed columns blank', async () => {
    assert.equal(await Records.countDocuments({ packetUniqueId: { $type: 'string' } }), 3);
    const soy = await Records.findOne({ recordId: 'PKT-PRD-SOYBLOTA-001' }).lean();
    assert.equal(soy.crop, 'Soybean');
    assert.equal(soy.weight, 0.5);
    assert.equal(soy.afterWeight, 1.75);
    assert.equal(soy.varietyName, '');
    assert.equal(soy.varietyCode, '');

    assert.equal(await page.locator('.MuiDataGrid-row').count(), 4);
    assert.equal((await cell('PKT-PRD-SOYBLOTA-001', 'crop').textContent()).trim(), 'Soybean');
    await shot('05-superadmin-table');
  });

  it('on a packet row the batch columns are not editable', async () => {
    const crop = cell('PKT-PRD-SOYBLOTA-001', 'crop');
    assert.equal(await crop.evaluate((el) => el.classList.contains('MuiDataGrid-cell--editable')), false);
    await crop.dblclick();
    assert.equal(await crop.locator('input').count(), 0);
    // …while the same column on a desktop-created row is editable.
    assert.equal(await cell(recordId, 'crop').evaluate((el) => el.classList.contains('MuiDataGrid-cell--editable')), true);
  });

  it('search narrows the table', async () => {
    const total = await page.locator('.MuiDataGrid-row').count();
    assert.equal(total, 4);
    const search = page.locator('.MuiDataGrid-toolbar input, .MuiDataGrid-toolbarQuickFilter input').first();
    if (!(await search.isVisible())) {
      await page.locator('.MuiDataGrid-toolbar button[aria-label*="earch"]').first().click();
    }
    await search.fill('Wheat');
    await waitFor(async () => (await page.locator('.MuiDataGrid-row').count()) === 1, { what: 'the search to filter rows' });
    assert.equal((await page.locator('.MuiDataGrid-row').first().getAttribute('data-id')), 'PKT-PRD-WHTLOTB-001');
    await search.fill('');
    await waitFor(async () => (await page.locator('.MuiDataGrid-row').count()) === 4, { what: 'the search to clear' });
  });

  it('offline: an edit shows as Pending, is not in MongoDB or Excel, and is saved once the server returns', async () => {
    await backend.stopServer();

    await cell(recordId, 'crop').dblclick();
    const input = cell(recordId, 'crop').locator('input');
    await input.fill('Maize (offline edit)');
    await input.press('Enter');

    await page.waitForSelector(`.MuiDataGrid-row[data-id="${recordId}"] ${tid('row-state-pending')}`);
    await waitFor(async () => (await syncState()) === 'offline', { timeoutMs: 20000, what: 'the status to show "offline"' });
    assert.match(await page.textContent(tid('sync-status')), /Offline — 1 change will be sent/);
    const problem = page.locator(tid('sync-error'));
    await problem.waitFor();
    assert.equal(await problem.getAttribute('data-kind'), 'offline');
    assert.match(await problem.textContent(), /Cannot reach the server\./);
    assert.match(await problem.textContent(), /Showing the records from the last successful sync/);
    assert.equal(await page.locator('.MuiDataGrid-row').count(), 4, 'the table is not emptied by an error');

    // Retry while still offline: still an error, still nothing lost.
    await page.click(tid('sync-retry'));
    await page.waitForTimeout(800);
    assert.equal(await syncState(), 'offline');
    await page.waitForSelector(`.MuiDataGrid-row[data-id="${recordId}"] ${tid('row-state-pending')}`);
    await shot('06-offline-pending');
    assert.equal((await Records.findOne({ recordId }).lean()).crop, 'Maize (edited)');
    assert.equal((await readWorkbook()).rows.find((r) => r.Record_ID === recordId).Crop, 'Maize (edited)');

    await backend.startServer();
    await page.click(tid('sync-retry'));
    await waitSynced();
    await page.waitForSelector(tid('sync-error'), { state: 'detached' });
    const doc = await Records.findOne({ recordId }).lean();
    assert.equal(doc.crop, 'Maize (offline edit)');
    assert.equal(doc.version, 4);
    await page.waitForSelector(`.MuiDataGrid-row[data-id="${recordId}"] ${tid('row-state-synced')}`);
    assert.equal((await readWorkbook()).rows.find((r) => r.Record_ID === recordId).Crop, 'Maize (offline edit)');
    await shot('07-back-online-synced');
  });

  it('Excel holds exactly the MongoDB records', async () => {
    const { headers, rows } = await readWorkbook();
    assert.deepEqual(headers, [...HEADERS, 'Record_ID', 'Version']);
    const docs = await Records.find().lean();
    assert.equal(rows.length, docs.length);
    assert.deepEqual(rows.map((r) => r.Record_ID).sort(), docs.map((d) => d.recordId).sort());
  });
});

describe('the signed-in session', () => {
  it('is remembered across an app restart (stored encrypted), with no credentials re-entered', async () => {
    await app.close();
    const sessionFile = path.join(runDir, 'appdata', 'session.bin');
    assert.equal(fs.existsSync(sessionFile), true);
    const raw = fs.readFileSync(sessionFile);
    assert.equal(raw.includes(backend.accounts.Superadmin.email), false, 'not stored in plain text');
    assert.equal(raw.includes('eyJ'), false, 'the token is not stored in plain text');

    await launch();
    await page.waitForSelector(tid('data-screen'));
    assert.equal(await page.getAttribute(tid('account-chip'), 'data-role'), 'superadmin');
    await waitSynced();
    assert.equal(await page.locator('.MuiDataGrid-row').count(), 4);
  });

  it('signing out forgets it', async () => {
    await page.click(tid('logout'));
    await page.waitForSelector(tid('login-screen'));
    assert.equal(fs.existsSync(path.join(runDir, 'appdata', 'session.bin')), false);
    await app.close();
    await launch();
    await page.waitForSelector(tid('login-screen'));
    assert.equal(await page.locator(tid('data-screen')).count(), 0);
  });
});
