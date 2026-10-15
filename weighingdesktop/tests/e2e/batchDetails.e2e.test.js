// End to end: seed-management details entered on the Create New Batch form.
// The real server and a real, local, throwaway MongoDB (see testBackend.js
// for why this can never touch production) — a batch is created through the
// real POST /api/batches, read back through the API, and followed all the
// way into the desktop app's rows and the Excel workbook.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ExcelJS = require('exceljs');
const { createTestBackend } = require('./testBackend');
const { createCore } = require('../../electron/core');
const { createMemoryTokenStore } = require('../../electron/tokenStore');
const { COLUMNS, HIDDEN_COLUMNS } = require('../../shared/columns');

// What the form sends. Total deliberately differs from Yield 1 + Yield 2.
const BASE = {
  batchName: 'Maize hybrid BA-09', seedType: 'Maize hybrid', seedCategory: 'Hybrid', seedCode: 'MA',
  batchNumber: 'BA-09', batchCode: 'BA09', count: 2, month: '6', year: '2026',
  warehouse: 'Warehouse A', rack: 'Rack 1', shelf: 'Shelf 2',
};
const DETAILS = {
  crop: 'Maize', previousYear: 2025, yearCode: 'Y26', previousYearCode: 'Y25', farmLocationCode: 'FL-07',
  femaleCode: 'F-101', maleCode: 'M-202', sptScore: '7/9', diseaseScore: 'MR',
  yield1: 41.5, yield2: 38.25, total: 99, varietyName: 'DKC-9144', varietyCode: 'V-9144',
  previousLocationCode: 'PL-03', locationCode: 'LC-11', gene: 'Rf1', comments: 'Trial lot', finalReport: 'Advance',
};
// Excel header -> expected cell, for a packet of the batch above.
const EXPECTED_EXCEL = {
  Crop: 'Maize', 'Previous Year': 2025, Year: 2026, Year_code: 'Y26', PreviousYear_code: 'Y25',
  FarmLocation_code: 'FL-07', Female_code: 'F-101', Male_code: 'M-202', 'Spt Score': '7/9', 'Disease score': 'MR',
  'Yield 1': 41.5, 'Yield 2': 38.25, Total: 99, 'Name Of Variety': 'DKC-9144', Varity_Code: 'V-9144',
  PreviousLocation_code: 'PL-03', Wearhouse: 'Warehouse A', Rack_shelf: 'Rack 1-Shelf 2', 'Location code': 'LC-11',
  Gene: 'Rf1', 'Before Weight': null, 'After Weight': null, Comments: 'Trial lot', 'Final report': 'Advance',
};
const NEW_IDS = ['PKT-PRD-MABA09-001', 'PKT-PRD-MABA09-002'];

let backend;
let Records;
let Batches;
let Packets;
let tokens;
let core;
let legacyBatches;
let legacyPackets;
let legacyRecords;
let batchId;
const cores = [];

function newCore(label) {
  const dir = backend.tempDir(label);
  const made = createCore({
    apiUrl: backend.baseUrl,
    dataDir: path.join(dir, 'appdata'),
    workbookDir: path.join(dir, 'documents'),
    tokenStore: createMemoryTokenStore(),
    syncConfig: { retryBaseMs: 300, retryMaxMs: 1000, kickDelayMs: 3600000, intervalMs: 3600000, workbookRetryMs: 3600000 },
  });
  cores.push(made);
  return made;
}

async function signIn(target, key) {
  await target.login(backend.accounts[key].email, backend.accounts[key].password);
  await target.syncNow();
}

// Used ONLY by these tests to check the output — the app never reads it.
async function readWorkbook(target) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(target.workbookPath);
  const sheet = book.worksheets[0];
  const headers = sheet.getRow(1).values.slice(1);
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const values = {};
    headers.forEach((header, i) => {
      const cell = row.getCell(i + 1).value;
      values[header] = cell === undefined ? null : cell;
    });
    rows.push(values);
  });
  return { sheet, headers, rows, byId: new Map(rows.map((r) => [r.Record_ID, r])) };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const snapshot = async (model, filter = {}) => plain(await model.find(filter).sort({ _id: 1 }).lean());
const rowOf = (target, recordId) => target.getRows().find((r) => r.recordId === recordId);
const createBatch = (body, token = tokens.admin) => backend.http('POST', '/api/batches', { token, body });

before(async () => {
  backend = await createTestBackend({ label: 'batchdetails' });
  Records = backend.model('DesktopSeedRecord');
  Batches = backend.model('SeedBatch');
  Packets = backend.model('SeedPacket');
  await backend.createAdmin('Superadmin', 'superadmin');
  await backend.createAdmin('Admin', 'admin');
  await backend.createAdmin('AdminOperator', 'operator');
  // Batches and packets from before the details existed (inserted with only
  // the old fields — see testBackend.js).
  await backend.seedPackets();
  tokens = {
    superadmin: await backend.login('Superadmin'),
    admin: await backend.login('Admin'),
    adminOperator: await backend.login('AdminOperator'),
  };

  // The desktop app has already been in use: the old packets have their
  // records, and a Superadmin has typed into one of them.
  core = newCore('details');
  await signIn(core, 'Superadmin');
  core.updateRecord('PKT-PRD-SOYBLOTA-001', { gene: 'Rps1', varietyName: 'Typed by hand' });
  await core.syncNow();

  // Strip the details from the stored legacy batches so they are exactly
  // what production holds today: documents with none of the new fields.
  await Batches.collection.updateMany({}, { $unset: Object.fromEntries(Object.keys(DETAILS).map((k) => [k, ''])) });
  legacyBatches = plain(await Batches.collection.find().sort({ _id: 1 }).toArray());
  legacyPackets = await snapshot(Packets);
  legacyRecords = await snapshot(Records);
}, { timeout: 600000 });

after(async () => {
  for (const made of cores) made.dispose();
  if (backend) await backend.dispose();
});

describe('test environment', () => {
  it('is a local throwaway database', () => {
    const uri = new URL(backend.mongoUri);
    assert.equal(uri.hostname, '127.0.0.1');
    assert.equal(uri.pathname, '/weighing_desktop_test');
    assert.match(backend.serverLog, /MongoDB Connected: 127\.0\.0\.1/);
  });

  it('the legacy batches really have none of the new fields stored', () => {
    assert.equal(legacyBatches.length, 2);
    for (const doc of legacyBatches) for (const key of Object.keys(DETAILS)) assert.equal(key in doc, false, key);
  });
});

describe('Create New Batch saves the seed-management details in MongoDB', () => {
  let response;

  it('the batch is created and the response returns every detail as stored', async () => {
    response = await createBatch({ ...BASE, ...DETAILS });
    assert.equal(response.status, 201);
    assert.equal(response.data.success, true);
    batchId = response.data.batch._id;
    for (const [field, value] of Object.entries(DETAILS)) assert.equal(response.data.batch[field], value, field);
  });

  it('QR generation works exactly as before: ids, packets, and a real PNG per packet', async () => {
    assert.equal(response.data.message, '2 QR codes generated');
    assert.deepEqual(response.data.packets.map((p) => p.uniqueId), ['PRD-MABA09-001', 'PRD-MABA09-002']);
    assert.equal(response.data.batch.seedCode, 'MA');
    assert.equal(response.data.batch.batchCode, 'BA09');

    const packets = await Packets.find({ batchId }).sort({ uniqueId: 1 }).lean();
    assert.deepEqual(packets.map((p) => p.uniqueId), ['PRD-MABA09-001', 'PRD-MABA09-002']);
    for (const packet of packets) {
      assert.equal(packet.status, 'empty');
      const res = await fetch(`${backend.baseUrl}${packet.qrCodeUrl}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      const png = Buffer.from(await res.arrayBuffer());
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
    }
    const batch = await Batches.findById(batchId).lean();
    assert.deepEqual(batch.packets.map(String), packets.map((p) => String(p._id)));
    assert.equal(String(batch.createdBy), backend.accounts.Admin.id);
  });

  it('MongoDB holds every value, with numbers as numbers and scores as text', async () => {
    const doc = await Batches.collection.findOne({ batchCode: 'BA09' });
    for (const [field, value] of Object.entries(DETAILS)) {
      assert.equal(doc[field], value, field);
      assert.equal(typeof doc[field], typeof value, `${field} type`);
    }
    assert.equal(typeof doc.sptScore, 'string');
    assert.equal(typeof doc.diseaseScore, 'string');
    assert.equal(doc.total, 99, 'Total is what was entered, not 41.5 + 38.25');
    assert.equal(doc.year, 2026);
    assert.equal(doc.month, 6);
    assert.equal(doc.warehouse, 'Warehouse A');
    assert.equal(doc.rack, 'Rack 1');
    assert.equal(doc.shelf, 'Shelf 2');
    assert.equal(doc.seedType, 'Maize hybrid');
  });

  it('the values come back through GET /api/batches/:id and GET /api/batches', async () => {
    const one = await backend.http('GET', `/api/batches/${batchId}`, { token: tokens.admin });
    assert.equal(one.status, 200);
    for (const [field, value] of Object.entries(DETAILS)) assert.equal(one.data.batch[field], value, field);
    assert.equal(one.data.packets.length, 2);

    const all = await backend.http('GET', '/api/batches', { token: tokens.adminOperator });
    assert.equal(all.status, 200);
    const listed = all.data.batches.find((b) => b._id === batchId);
    for (const [field, value] of Object.entries(DETAILS)) assert.equal(listed[field], value, field);
    assert.equal(listed.filledCount, 0);
  });

  it('an old batch reads back through the API with the details blank', async () => {
    const legacyId = legacyBatches[0]._id;
    const one = await backend.http('GET', `/api/batches/${legacyId}`, { token: tokens.admin });
    assert.equal(one.status, 200);
    assert.equal(one.data.batch.seedType, 'Soybean');
    assert.equal(one.data.batch.varietyName, '');
    assert.equal(one.data.batch.total, null);
    assert.equal(one.data.packets.length, 2);
  });

  it('they survive a restart of the database and of the server', async () => {
    await backend.stopServer();
    await backend.restartDatabase();
    await backend.startServer();
    const one = await backend.http('GET', `/api/batches/${batchId}`, { token: tokens.admin });
    assert.equal(one.status, 200);
    for (const [field, value] of Object.entries(DETAILS)) assert.equal(one.data.batch[field], value, field);
  });
});

describe('validation and authorization', () => {
  const counts = async () => [await Batches.countDocuments(), await Packets.countDocuments(), await backend.model('Admin').countDocuments()];

  for (const [label, extra, message] of [
    ['a non-numeric Yield 1', { yield1: 'lots' }, 'Yield 1 must be a number'],
    ['an operator object as Gene', { gene: { $ne: null } }, 'Gene must be text'],
    ['Comments over the limit', { comments: 'x'.repeat(2001) }, 'Comments must be at most 2000 characters'],
  ]) {
    it(`${label} is refused with a clear message and nothing is saved`, async () => {
      const before = await counts();
      const res = await createBatch({ ...BASE, batchCode: 'BAD1', ...DETAILS, ...extra });
      assert.equal(res.status, 400);
      assert.equal(res.data.message, message);
      assert.deepEqual(await counts(), before);
      assert.equal(await Batches.countDocuments({ batchCode: 'BAD1' }), 0);
    });
  }

  it('authorization is unchanged: no token 401, Admin role "operator" 403, nothing saved', async () => {
    const before = await counts();
    assert.equal((await backend.http('POST', '/api/batches', { body: { ...BASE, batchCode: 'BAD2', ...DETAILS } })).status, 401);
    assert.equal((await createBatch({ ...BASE, batchCode: 'BAD2', ...DETAILS }, tokens.adminOperator)).status, 403);
    assert.deepEqual(await counts(), before);
  });
});

describe('the saved details reach the desktop app and Excel', () => {
  it('each packet of the new batch has one record carrying the batch values', async () => {
    await core.syncNow();
    const docs = await Records.find({ recordId: { $in: NEW_IDS } }).sort({ recordId: 1 }).lean();
    assert.deepEqual(docs.map((d) => d.recordId), NEW_IDS);
    for (const doc of docs) {
      for (const [field, value] of Object.entries(DETAILS)) assert.equal(doc[field], value, field);
      assert.equal(doc.year, 2026);
      assert.equal(doc.warehouse, 'Warehouse A');
      assert.equal(doc.rackShelf, 'Rack 1-Shelf 2');
      assert.equal(doc.weight, null, 'an unweighed packet has no Weight');
      assert.equal(doc.afterWeight, null, 'an unweighed packet has no After Weight');
      assert.equal(doc.version, 1);
    }
  });

  it('the desktop rows show them', () => {
    for (const id of NEW_IDS) {
      const row = rowOf(core, id);
      assert.equal(row.syncState, 'synced');
      assert.equal(row.linked, true);
      for (const [field, value] of Object.entries(DETAILS)) assert.equal(row[field], value, field);
    }
  });

  it('Excel shows each value in its own column', async () => {
    const excel = await readWorkbook(core);
    for (const id of NEW_IDS) {
      const row = excel.byId.get(id);
      for (const [header, value] of Object.entries(EXPECTED_EXCEL)) assert.equal(row[header], value, `${id} / ${header}`);
      assert.equal(row.Version, 1);
    }
  });

  it('the workbook still has exactly the 24 columns in order, then hidden Record_ID and Version', async () => {
    const excel = await readWorkbook(core);
    assert.deepEqual(Object.keys(EXPECTED_EXCEL), COLUMNS.map((c) => c.header));
    assert.deepEqual(excel.headers.slice(0, 24), COLUMNS.map((c) => c.header));
    assert.deepEqual(excel.headers.slice(24), HIDDEN_COLUMNS.map((c) => c.header));
    assert.equal(excel.headers.length, 26);
    assert.equal(excel.sheet.getColumn(25).hidden, true);
    assert.equal(excel.sheet.getColumn(26).hidden, true);
  });

  it('a view-only Admin on another computer gets the same values', async () => {
    const other = newCore('details-viewer');
    await signIn(other, 'Admin');
    const excel = await readWorkbook(other);
    for (const id of NEW_IDS) {
      assert.equal(rowOf(other, id).varietyName, 'DKC-9144');
      assert.equal(excel.byId.get(id)['Name Of Variety'], 'DKC-9144');
      assert.equal(excel.byId.get(id).Total, 99);
    }
  });
});

describe('no duplicates, and Superadmin edits are never overwritten', () => {
  it('repeated syncs, a full re-sync and the on-demand import create nothing new', async () => {
    const before = await snapshot(Records);
    await core.syncNow();
    await core.syncNow({ full: true });
    await core.syncNow();
    const res = await backend.http('POST', '/api/desktop-records/import-packets', { token: tokens.superadmin, body: {} });
    assert.deepEqual(res.data, { success: true, totalPackets: 5, created: 0, skipped: 5 });
    assert.deepEqual(await snapshot(Records), before);
    assert.equal(await Records.countDocuments({ packetUniqueId: { $type: 'string' } }), 5);
    const ids = core.getRows().map((r) => r.recordId);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal((await readWorkbook(core)).rows.length, before.length);
  });

  it('a Superadmin can correct a pre-filled value, and it is not put back — even after a server restart', async () => {
    const id = NEW_IDS[0];
    assert.equal(core.updateRecord(id, { varietyName: 'DKC-9144 (corrected)', comments: '' }), true);
    await core.syncNow();
    const edited = plain(await Records.findOne({ recordId: id }).lean());
    assert.equal(edited.varietyName, 'DKC-9144 (corrected)');
    assert.equal(edited.comments, '');
    assert.equal(edited.version, 2);

    // A restarted server has forgotten which packets it already handled.
    await backend.stopServer();
    await backend.startServer();
    await core.syncNow({ full: true });
    await backend.http('POST', '/api/desktop-records/import-packets', { token: tokens.superadmin, body: {} });

    assert.deepEqual(plain(await Records.findOne({ recordId: id }).lean()), edited);
    assert.equal(rowOf(core, id).varietyName, 'DKC-9144 (corrected)');
    assert.equal((await readWorkbook(core)).byId.get(id)['Name Of Variety'], 'DKC-9144 (corrected)');
    // The batch itself keeps what was entered on the form.
    assert.equal((await Batches.findById(batchId).lean()).varietyName, 'DKC-9144');
    // The sibling packet's record was not touched by that edit.
    assert.equal((await Records.findOne({ recordId: NEW_IDS[1] }).lean()).varietyName, 'DKC-9144');
  });

  it('on these records Crop, Year, Wearhouse and Rack_shelf stay fixed to the batch, as before', async () => {
    const id = NEW_IDS[1];
    assert.equal(core.updateRecord(id, { crop: 'Changed', warehouse: 'Elsewhere' }), false);
    const res = await backend.http('PUT', `/api/desktop-records/${id}`, { token: tokens.superadmin, body: { baseVersion: 1, fields: { crop: 'Changed', year: 1999, gene: 'Rf3' } } });
    assert.equal(res.status, 200);
    const doc = await Records.findOne({ recordId: id }).lean();
    assert.equal(doc.crop, 'Maize');
    assert.equal(doc.year, 2026);
    assert.equal(doc.gene, 'Rf3');
  });
});

describe('existing data is untouched', () => {
  it('the old batches and packets are byte-for-byte what they were', async () => {
    const ids = legacyBatches.map((b) => b._id);
    const now = plain(await Batches.collection.find({ batchCode: { $in: ['LOTA', 'LOTB'] } }).sort({ _id: 1 }).toArray());
    assert.deepEqual(now, legacyBatches);
    assert.deepEqual(await snapshot(Packets, { batchId: { $in: ids } }), legacyPackets);
  });

  it('the old records are unchanged — including what a Superadmin had typed — and nothing was back-filled', async () => {
    const legacyIds = legacyRecords.map((r) => r.recordId);
    assert.deepEqual(await snapshot(Records, { recordId: { $in: legacyIds } }), legacyRecords);
    const edited = await Records.findOne({ recordId: 'PKT-PRD-SOYBLOTA-001' }).lean();
    assert.equal(edited.gene, 'Rps1');
    assert.equal(edited.varietyName, 'Typed by hand');
    const untouched = await Records.findOne({ recordId: 'PKT-PRD-SOYBLOTA-002' }).lean();
    assert.equal(untouched.crop, 'Soybean');
    for (const { field, type } of COLUMNS) {
      if (['crop', 'year', 'warehouse', 'rackShelf'].includes(field)) continue;
      assert.equal(untouched[field], type === 'number' ? null : '', `${field} must stay blank`);
    }
  });
});

describe('a batch created without any details', () => {
  it('saves blanks, and its records carry only what the batch really has', async () => {
    const res = await createBatch({ batchName: 'Wheat BA-10', seedType: 'Wheat', seedCode: 'WH', batchNumber: 'BA-10', batchCode: 'BA10', count: 1, month: '', year: '', warehouse: '', rack: '', shelf: '' });
    assert.equal(res.status, 201);
    const stored = await Batches.findById(res.data.batch._id).lean();
    assert.equal(stored.crop, '');
    assert.equal(stored.varietyName, '');
    assert.equal(stored.varietyCode, '');
    assert.equal(stored.total, null);

    await core.syncNow();
    const doc = await Records.findOne({ recordId: 'PKT-PRD-WHBA10-001' }).lean();
    assert.equal(doc.crop, 'Wheat', 'Crop falls back to the seed name, as it always has');
    for (const { field, type } of COLUMNS) {
      if (field === 'crop') continue;
      assert.equal(doc[field], type === 'number' ? null : '', `${field} must be blank`);
    }
    const excel = (await readWorkbook(core)).byId.get('PKT-PRD-WHBA10-001');
    assert.equal(excel.Crop, 'Wheat');
    assert.equal(excel['Name Of Variety'], null);
    assert.equal(excel.Varity_Code, null);
  });
});
