// What the real application window shows when it is pointed at a backend
// that does NOT have the desktop-records routes yet — i.e. a backend as it is
// before the new server files are deployed.
//
// The stand-in server below answers the existing login endpoints and gives
// every other path the same JSON 404 that server.js gives for an unknown
// route. No database is involved at all. The point of the test: the app must
// say plainly that records could not be loaded — never present an empty
// table as "there are no records" — and must keep a Superadmin's changes.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { _electron: electron } = require('playwright-core');
const { tempDir, DESKTOP_DIR } = require('../e2e/testBackend');

const tid = (id) => `[data-testid="${id}"]`;
const admin = { id: '64b000000000000000000001', name: 'Pre-deploy Superadmin', email: 'someone@desktop-test.local', role: 'superadmin', avatar: '' };

let server;
let baseUrl;
let requests;
let app;
let page;
let runDir;

function startOldBackend() {
  requests = [];
  server = http.createServer((req, res) => {
    const route = `${req.method} ${req.url.split('?')[0]}`;
    requests.push(route);
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    req.resume();
    req.on('end', () => {
      if (route === 'POST /api/auth/login') return send(200, { success: true, token: 'pre-deploy-token', admin });
      if (route === 'GET /api/auth/me') return send(200, { success: true, admin });
      if (route === 'POST /api/auth/logout') return send(200, { success: true, message: 'Logged out successfully' });
      // server.js: res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` })
      return send(404, { success: false, message: `Route ${req.url} not found` });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    resolve();
  }));
}

before(async () => {
  assert.ok(fs.existsSync(path.join(DESKTOP_DIR, 'dist', 'index.html')), 'UI bundle missing — run "npm run build:ui" first');
  await startOldBackend();
  runDir = tempDir('ui-not-deployed');
  const env = {
    ...process.env,
    DESKTOP_API_URL: baseUrl,
    DESKTOP_USER_DATA_DIR: path.join(runDir, 'appdata'),
    DESKTOP_WORKBOOK_DIR: path.join(runDir, 'documents'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [DESKTOP_DIR], cwd: DESKTOP_DIR, env });
  page = await app.firstWindow();
  await page.waitForSelector(tid('login-screen'));
}, { timeout: 120000 });

after(async () => {
  if (app) await app.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe('against a backend without the desktop-records routes', () => {
  it('login still works (it uses the existing endpoint)', async () => {
    await page.fill(tid('login-email'), admin.email);
    await page.fill(tid('login-password'), crypto.randomBytes(9).toString('base64url'));
    await page.click(tid('login-submit'));
    await page.waitForSelector(tid('data-screen'));
    assert.ok(requests.includes('POST /api/auth/login'));
  });

  it('says clearly that records could not be loaded because the backend update is not deployed', async () => {
    const problem = page.locator(tid('sync-error'));
    await problem.waitFor({ timeout: 20000 });
    assert.equal(await problem.getAttribute('data-kind'), 'not-deployed');
    const text = await problem.textContent();
    assert.match(text, /does not provide desktop records yet/);
    assert.match(text, /has not been deployed/);
    assert.match(text, /Nothing has been loaded from the server/);
    assert.equal(await page.getAttribute(tid('sync-status'), 'data-state'), 'error');
    assert.ok(requests.includes('GET /api/desktop-records'), 'it did ask the server');
  });

  it('does not present the empty table as "no records"', async () => {
    const empty = page.locator(tid('grid-empty'));
    await empty.waitFor();
    assert.equal(await empty.getAttribute('data-kind'), 'error');
    assert.match(await empty.textContent(), /could not be loaded/);
    assert.match(await empty.textContent(), /does not mean the database is empty/);
    assert.equal(await page.locator(tid('not-imported')).count(), 0, 'no count is shown when none is known');
    assert.doesNotMatch(await page.textContent(tid('sync-status')), /saved|synced|up to date/i);
    await page.screenshot({ path: path.join(DESKTOP_DIR, '.test-output', 'screenshots', '09-backend-not-deployed.png') });
  });

  it('writes no workbook from a failed first load', async () => {
    assert.equal(fs.existsSync(path.join(runDir, 'documents', 'Seed_Management.xlsx')), false);
  });

  it('Retry asks the server again and stays honest about the result', async () => {
    const before = requests.filter((r) => r === 'GET /api/desktop-records').length;
    await page.click(tid('sync-retry'));
    await page.waitForTimeout(1200);
    assert.ok(requests.filter((r) => r === 'GET /api/desktop-records').length > before);
    assert.equal(await page.getAttribute(tid('sync-error'), 'data-kind'), 'not-deployed');
  });

  it('a record added now is kept as Pending — not lost, not rejected, not reported as saved', async () => {
    await page.click(tid('add-record'));
    await page.fill(tid('add-crop'), 'Entered before deployment');
    await page.click(tid('add-save'));
    await page.waitForSelector(tid('add-dialog'), { state: 'detached' });

    await page.waitForSelector(tid('row-state-pending'));
    await page.waitForTimeout(1500); // long enough for the push attempt
    assert.ok(requests.includes('POST /api/desktop-records'), 'the save was attempted');
    assert.equal(await page.locator(tid('row-state-pending')).count(), 1);
    assert.equal(await page.locator(tid('row-state-synced')).count(), 0);
    assert.equal(await page.locator(tid('row-state-error')).count(), 0);
    assert.equal(await page.getAttribute(tid('sync-error'), 'data-kind'), 'not-deployed');
    assert.equal(fs.existsSync(path.join(runDir, 'documents', 'Seed_Management.xlsx')), false, 'unconfirmed data never reaches Excel');

    const outbox = JSON.parse(fs.readFileSync(fs.readdirSync(path.join(runDir, 'appdata', 'servers'))
      .map((d) => path.join(runDir, 'appdata', 'servers', d, 'outbox.json'))[0], 'utf8'));
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].state, 'pending');
    assert.equal(outbox[0].fields.crop, 'Entered before deployment');
  });
});
