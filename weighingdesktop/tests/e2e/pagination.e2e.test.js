// End to end, at volume: "existing MongoDB data -> backend API -> desktop
// app -> Excel" with far more records than one page holds. Real server,
// real (local, throwaway) MongoDB — see testBackend.js.
//
// The packets inserted here stand in for data that already exists in the
// database before the desktop app is ever used; they are created with the
// server's own SeedBatch/SeedPacket models, in the test database only.
// Nothing in this file ever asks for an import: the packets must simply be
// there after an authorized login.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ExcelJS = require('exceljs');
const { createTestBackend, sleep } = require('./testBackend');
const { createCore } = require('../../electron/core');
const { createMemoryTokenStore } = require('../../electron/tokenStore');

const FIRST_BATCH = 650;
const SECOND_BATCH = 600;
const TOTAL = FIRST_BATCH + SECOND_BATCH;

let backend;
let Records;
const cores = [];

// Records every request the app itself makes, and can intercept record pages.
function newCore(label, { pageSize, overlapMs, onListPage } = {}) {
  const dir = backend.tempDir(label);
  const stats = { listRequests: 0, requests: [] };
  const handle = { stats, lastPageSize: null };
  const fetchImpl = async (url, options) => {
    const response = await fetch(url, options);
    const parsed = new URL(url);
    stats.requests.push(`${options.method || 'GET'} ${parsed.pathname}`);
    if (parsed.pathname === '/api/desktop-records' && (!options.method || options.method === 'GET')) {
      stats.listRequests += 1;
      const page = await response.clone().json();
      handle.lastPageSize = Array.isArray(page.records) ? page.records.length : null;
      if (onListPage) await onListPage(page, stats.listRequests);
    }
    return response;
  };
  const core = createCore({
    apiUrl: backend.baseUrl,
    dataDir: path.join(dir, 'appdata'),
    workbookDir: path.join(dir, 'documents'),
    tokenStore: createMemoryTokenStore(),
    fetchImpl,
    syncConfig: { retryBaseMs: 300, kickDelayMs: 3600000, intervalMs: 3600000, workbookRetryMs: 3600000, ...(pageSize ? { pageSize } : {}), ...(overlapMs ? { cursorOverlapMs: overlapMs } : {}) },
  });
  cores.push(core);
  handle.core = core;
  return handle;
}

async function signIn(core, key) {
  await core.login(backend.accounts[key].email, backend.accounts[key].password);
  return core.syncNow();
}

async function seedBatch(code, count, extra = {}) {
  const batch = await backend.model('SeedBatch').create({
    batchName: `Volume ${code}`, seedType: extra.seedType || 'Paddy', seedCode: 'PDY', batchNumber: code, batchCode: code,
    count, year: extra.year || 2024, warehouse: 'Warehouse C', rack: 'R9', shelf: 'S1',
  });
  await backend.model('SeedPacket').insertMany(Array.from({ length: count }, (_, i) => ({
    uniqueId: `PRD-PDY${code}-${String(i + 1).padStart(4, '0')}`,
    batchId: batch._id,
    status: 'empty',
  })));
}

async function workbookIds(core) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(core.workbookPath);
  const ids = [];
  book.worksheets[0].eachRow((row, index) => { if (index > 1) ids.push(row.getCell(25).value); });
  return ids;
}

const expectedIds = async () => (await backend.model('SeedPacket').find().select('uniqueId').lean()).map((p) => `PKT-${p.uniqueId}`).sort();
const recordIdsInDb = async () => (await Records.find().select('recordId').lean()).map((r) => r.recordId);

before(async () => {
  backend = await createTestBackend({ label: 'pages' });
  Records = backend.model('DesktopSeedRecord');
  await backend.createAdmin('Superadmin', 'superadmin');
  await backend.createAdmin('Admin', 'admin');
  await seedBatch('VOLA', FIRST_BATCH);
}, { timeout: 600000 });

after(async () => {
  for (const core of cores) core.dispose();
  if (backend) await backend.dispose();
});

describe('before anyone has logged in', () => {
  it('the packets exist, and nothing has been prepared for the desktop yet', async () => {
    assert.equal(await backend.model('SeedPacket').countDocuments(), FIRST_BATCH);
    assert.equal(await Records.countDocuments(), 0);
  });

  it('a caller without access cannot cause anything to be prepared', async () => {
    assert.equal((await backend.http('GET', '/api/desktop-records')).status, 401);
    const operator = await backend.http('POST', '/api/user/register', { body: { name: 'Op', email: 'op@desktop-test.local', password: 'operator-pass-1' } });
    assert.equal(operator.status, 201);
    assert.equal((await backend.http('GET', '/api/desktop-records', { token: operator.data.token })).status, 401);
    assert.equal((await backend.http('GET', '/api/desktop-records/summary', { token: operator.data.token })).status, 401);
    assert.equal(await Records.countDocuments(), 0);
  });
});

describe('existing packets appear automatically after an authorized login', () => {
  let first;

  it(`a view-only Admin logs in and all ${FIRST_BATCH} existing packets are in the table — no import of any kind`, async () => {
    first = newCore('first-login');
    const status = await signIn(first.core, 'Admin');
    const rows = first.core.getRows();

    assert.equal(status.state, 'synced');
    assert.equal(rows.length, FIRST_BATCH);
    assert.equal(first.stats.requests.some((r) => r.includes('import')), false, 'the app never asks for an import');
    assert.equal(first.stats.requests.some((r) => r.startsWith('POST /api/desktop-records')), false, 'and sends no write at all');
    assert.ok(first.stats.listRequests >= 4, `expected at least 4 pages of 200, saw ${first.stats.listRequests} requests`);

    const ids = rows.map((r) => r.recordId);
    assert.equal(new Set(ids).size, ids.length, 'no duplicates');
    assert.deepEqual([...ids].sort(), await expectedIds());
  });

  it('the counts agree: what was loaded is everything the server has', async () => {
    const status = first.core.getStatus();
    assert.equal(status.recordCount, FIRST_BATCH);
    assert.equal(status.serverRecordCount, FIRST_BATCH);
    assert.equal(status.packetCount, FIRST_BATCH);
    assert.equal(status.packetsNotImported, 0);
  });

  it('each row carries only the confirmed columns; the rest are blank', async () => {
    for (const row of first.core.getRows()) {
      assert.equal(row.syncState, 'synced');
      assert.equal(row.linked, true);
      assert.equal(row.crop, 'Paddy');
      assert.equal(row.year, 2024);
      assert.equal(row.warehouse, 'Warehouse C');
      assert.equal(row.rackShelf, 'R9-S1');
      assert.equal(row.weight, null);
      assert.equal(row.varietyName, '');
      assert.equal(row.varietyCode, '');
      assert.equal(row.total, null);
    }
  });

  it('in MongoDB there is exactly one record per packet, with no user recorded as its author', async () => {
    assert.equal(await Records.countDocuments(), FIRST_BATCH);
    assert.equal(await Records.countDocuments({ createdBy: null }), FIRST_BATCH);
    const ids = await recordIdsInDb();
    assert.equal(new Set(ids).size, FIRST_BATCH);
    assert.deepEqual(ids.sort(), await expectedIds());
  });

  it('the Excel workbook was generated with one row for each of them', async () => {
    const ids = await workbookIds(first.core);
    assert.equal(ids.length, FIRST_BATCH);
    assert.equal(new Set(ids).size, FIRST_BATCH);
    assert.deepEqual([...ids].sort(), await expectedIds());
  });

  it('walking the API page by page returns each record exactly once, in a stable order', async () => {
    const token = await backend.login('Admin');
    const seen = [];
    let query = '?limit=100';
    let pages = 0;
    let previous = '';
    for (;;) {
      const res = await backend.http('GET', `/api/desktop-records${query}`, { token });
      assert.equal(res.status, 200);
      pages += 1;
      assert.ok(res.data.records.length <= 100);
      for (const record of res.data.records) {
        assert.ok(record.updatedAt >= previous, 'pages are ordered by time of last change');
        previous = record.updatedAt;
        seen.push(record.recordId);
      }
      if (!res.data.hasMore) break;
      query = `?limit=100&since=${encodeURIComponent(res.data.nextCursor.since)}&afterId=${res.data.nextCursor.afterId}`;
      assert.ok(pages < 50, 'pagination must terminate');
    }
    assert.equal(pages, 7);
    assert.equal(seen.length, FIRST_BATCH);
    assert.equal(new Set(seen).size, FIRST_BATCH);
  });

  it('a page is never larger than 500 however much is asked for', async () => {
    const token = await backend.login('Admin');
    const res = await backend.http('GET', '/api/desktop-records?limit=100000', { token });
    assert.equal(res.data.records.length, 500);
    assert.equal(res.data.hasMore, true);
  });
});

describe('repeating it is safe', () => {
  it('five simultaneous listings create nothing extra', async () => {
    const token = await backend.login('Admin');
    const results = await Promise.all(Array.from({ length: 5 }, () => backend.http('GET', '/api/desktop-records?limit=50', { token })));
    for (const r of results) assert.equal(r.status, 200);
    assert.equal(await Records.countDocuments(), FIRST_BATCH);
  });

  it('more logins, from other desktops and other accounts, create no duplicates', async () => {
    for (const [label, account] of [['second-desktop', 'Admin'], ['third-desktop', 'Superadmin']]) {
      const { core } = newCore(label);
      await signIn(core, account);
      assert.equal(core.getRows().length, FIRST_BATCH);
    }
    assert.equal(await Records.countDocuments(), FIRST_BATCH);
    assert.equal(new Set(await recordIdsInDb()).size, FIRST_BATCH);
    assert.equal(await Records.countDocuments({ version: 1 }), FIRST_BATCH, 'and no record was rewritten');
  });
});

describe('packets created later appear by themselves too', () => {
  let viewer;
  // The app re-reads a short window before its position once after each
  // move (see syncEngine.js). 250 ms here instead of 5 s keeps the test quick.
  const OVERLAP_MS = 250;

  before(async () => {
    viewer = newCore('long-running-viewer', { overlapMs: OVERLAP_MS });
    await signIn(viewer.core, 'Admin');
    assert.equal(viewer.core.getRows().length, FIRST_BATCH);
    // Let the one-off overlap re-read happen, as it would in normal use.
    await sleep(OVERLAP_MS + 50);
    await viewer.core.syncNow();
    await seedBatch('VOLB', SECOND_BATCH, { seedType: 'Mustard', year: 2025 });
  });

  it(`an already-running desktop gets the ${SECOND_BATCH} new ones at its next sync — only those, over several pages`, async () => {
    const before = viewer.stats.listRequests;
    const status = await viewer.core.syncNow();
    const rows = viewer.core.getRows();

    assert.equal(rows.length, TOTAL);
    assert.equal(new Set(rows.map((r) => r.recordId)).size, TOTAL);
    assert.equal(rows.filter((r) => r.crop === 'Mustard').length, SECOND_BATCH);
    assert.equal(rows.filter((r) => r.crop === 'Paddy').length, FIRST_BATCH);
    assert.equal(status.serverRecordCount, TOTAL);
    assert.equal(status.packetsNotImported, 0);
    assert.equal(viewer.stats.listRequests - before, 3, `only the ${SECOND_BATCH} additions should be downloaded (3 pages of 200)`);
    assert.equal(viewer.stats.requests.some((r) => r.includes('import')), false);
    assert.equal((await workbookIds(viewer.core)).length, TOTAL);
  });

  it(`MongoDB now holds ${TOTAL} records, one per packet`, async () => {
    assert.equal(await Records.countDocuments(), TOTAL);
    const ids = await recordIdsInDb();
    assert.equal(new Set(ids).size, TOTAL);
    assert.deepEqual(ids.sort(), await expectedIds());
  });

  it('the on-demand import finds nothing left to do', async () => {
    const token = await backend.login('Superadmin');
    const res = await backend.http('POST', '/api/desktop-records/import-packets', { token, body: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { success: true, totalPackets: TOTAL, created: 0, skipped: TOTAL });
  });

  it('a later single edit arrives without re-downloading everything', async () => {
    const token = await backend.login('Superadmin');
    const target = 'PKT-PRD-PDYVOLA-0007';
    await sleep(OVERLAP_MS + 50);
    await viewer.core.syncNow();
    const res = await backend.http('PUT', `/api/desktop-records/${target}`, { token, body: { baseVersion: 1, fields: { gene: 'Xa21', comments: 'checked by Superadmin' } } });
    assert.equal(res.status, 200);

    const before = viewer.stats.listRequests;
    await viewer.core.syncNow();
    assert.equal(viewer.stats.listRequests - before, 1, 'one small request');
    assert.equal(viewer.lastPageSize, 1, 'carrying just the one changed record');
    const rows = viewer.core.getRows();
    assert.equal(rows.length, TOTAL);
    const row = rows.find((r) => r.recordId === target);
    assert.equal(row.gene, 'Xa21');
    assert.equal(row.version, 2);
  });
});

describe('a record that changes while the download is in progress is not lost', () => {
  it('it is still delivered, with its new contents', async () => {
    const token = await backend.login('Superadmin');
    let changedId = null;
    const { core, stats } = newCore('mid-download', {
      pageSize: 100,
      // Right after the first page has been read, someone edits a record
      // that was on that page — which moves it to the end of the order.
      onListPage: async (page, requestNumber) => {
        if (requestNumber !== 1) return;
        const victim = page.records.find((r) => r.version === 1);
        changedId = victim.recordId;
        const res = await backend.http('PUT', `/api/desktop-records/${changedId}`, { token, body: { baseVersion: 1, fields: { comments: 'edited mid-download' } } });
        assert.equal(res.status, 200);
      },
    });
    await signIn(core, 'Admin');

    const rows = core.getRows();
    assert.ok(stats.listRequests >= 13, 'many pages were needed');
    assert.equal(rows.length, TOTAL, 'nothing skipped, nothing duplicated');
    assert.equal(new Set(rows.map((r) => r.recordId)).size, TOTAL);
    const row = rows.find((r) => r.recordId === changedId);
    assert.equal(row.comments, 'edited mid-download');
    assert.equal(row.version, 2);
    assert.deepEqual(rows.map((r) => r.recordId).sort(), await expectedIds());
  });
});

describe('edits made in the desktop are never overwritten by the automatic step', () => {
  it('after a server restart and a fresh login, the edited records are exactly as the Superadmin left them', async () => {
    const edited = JSON.parse(JSON.stringify(await Records.find({ version: { $gt: 1 } }).sort({ recordId: 1 }).lean()));
    assert.equal(edited.length, 2, 'the two records edited above');
    assert.equal(edited.find((r) => r.recordId === 'PKT-PRD-PDYVOLA-0007').gene, 'Xa21');

    // A restarted server no longer remembers having checked the packets, so
    // its first listing walks all 1,250 of them again.
    await backend.stopServer();
    await backend.startServer();

    const { core, stats } = newCore('after-restart');
    const status = await signIn(core, 'Admin');
    assert.equal(status.state, 'synced');
    assert.equal(core.getRows().length, TOTAL);
    assert.equal(stats.requests.some((r) => r.includes('import')), false);

    assert.equal(await Records.countDocuments(), TOTAL, 'nothing was added twice');
    assert.equal(new Set(await recordIdsInDb()).size, TOTAL);
    assert.deepEqual(JSON.parse(JSON.stringify(await Records.find({ version: { $gt: 1 } }).sort({ recordId: 1 }).lean())), edited);
    assert.equal(await Records.countDocuments({ version: 1 }), TOTAL - 2, 'and no other record was rewritten');

    const row = core.getRows().find((r) => r.recordId === 'PKT-PRD-PDYVOLA-0007');
    assert.equal(row.gene, 'Xa21');
    assert.equal(row.comments, 'checked by Superadmin');
    assert.equal(row.crop, 'Paddy');
  });
});

describe('the existing collections were only read', () => {
  it('packets and batches are exactly as they were inserted', async () => {
    assert.equal(await backend.model('SeedPacket').countDocuments(), TOTAL);
    assert.equal(await backend.model('SeedPacket').countDocuments({ status: 'empty' }), TOTAL);
    assert.equal(await backend.model('SeedBatch').countDocuments(), 2);
    const untouched = await backend.model('SeedPacket').countDocuments({ $expr: { $eq: ['$createdAt', '$updatedAt'] } });
    assert.equal(untouched, TOTAL, 'no packet was updated after it was created');
    const batchesUntouched = await backend.model('SeedBatch').countDocuments({ $expr: { $eq: ['$createdAt', '$updatedAt'] } });
    assert.equal(batchesUntouched, 2, 'no batch was updated after it was created');
  });
});
