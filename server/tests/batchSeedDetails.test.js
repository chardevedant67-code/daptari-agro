// Seed-management details on batch creation (SeedBatch.js DETAIL_FIELDS,
// POST /api/batches) — what is accepted, what is stored, and that batches
// and QR generation otherwise behave exactly as before. Same approach as the
// rest of this suite: the real router/middleware against mocked model
// methods, no database connection.
require('./setup');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockRes, authHeaderFor, fullStackFor, runStack, freshRequireCache } = require('./helpers');

const Admin = require('../models/Admin');
const SeedBatch = require('../models/SeedBatch');
const SeedPacket = require('../models/SeedPacket');
const qrStorage = require('../utils/qrStorage');

// Installed before the first require of batchRoutes.js in this process (see
// batchAuthorization.test.js for why an indirection wrapper is used).
let uploads;
qrStorage.uploadQrPng = async (buffer, fileName, meta) => { uploads.push({ fileName, meta }); return `file-${uploads.length}`; };

function loadBatchRoutes() {
  freshRequireCache('../routes/batchRoutes');
  return require('../routes/batchRoutes');
}

const BASE = { seedType: 'Maize hybrid', seedCategory: 'Hybrid', seedCode: 'ma', batchNumber: 'BA-09', batchCode: 'ba09', count: 2, month: 6, year: 2026, warehouse: 'Warehouse A', rack: 'Rack 1', shelf: 'Shelf 2' };

// Every detail filled in, the way the form sends them (numbers as numbers).
// Total deliberately differs from Yield 1 + Yield 2.
const DETAILS = {
  crop: 'Maize', previousYear: 2025, yearCode: 'Y26', previousYearCode: 'Y25', farmLocationCode: 'FL-07',
  femaleCode: 'F-101', maleCode: 'M-202', sptScore: '7/9', diseaseScore: 'MR',
  yield1: 41.5, yield2: 38.25, total: 99, varietyName: 'DKC-9144', varietyCode: 'V-9144',
  previousLocationCode: 'PL-03', locationCode: 'LC-11', gene: 'Rf1', comments: 'Trial lot', finalReport: 'Advance',
};

let created;
let insertedPackets;
beforeEach(() => {
  uploads = [];
  created = [];
  insertedPackets = [];
  Admin.findById = async () => ({ _id: 'adm1', role: 'admin', isActive: true });
  SeedBatch.create = async (doc) => { created.push(doc); return { ...doc, _id: 'batch1', createdAt: new Date(), save: async () => {} }; };
  SeedPacket.insertMany = async (packets) => { insertedPackets.push(...packets); return packets.map((p, i) => ({ ...p, _id: `pkt${i}` })); };
});

async function post(body, headers = authHeaderFor('adm1')) {
  const router = loadBatchRoutes();
  const res = mockRes();
  await runStack(fullStackFor(router, 'post', '/'), 0, { body, headers }, res);
  return res;
}

describe('batch seed details — the schema', () => {
  it('has the 19 details, each a real path of the declared type', () => {
    assert.deepEqual(SeedBatch.DETAIL_FIELDS.map((d) => d.label), [
      'Crop', 'Previous Year', 'Year_code', 'PreviousYear_code', 'FarmLocation_code', 'Female_code', 'Male_code',
      'Spt Score', 'Disease score', 'Yield 1', 'Yield 2', 'Total', 'Name Of Variety', 'Varity_Code',
      'PreviousLocation_code', 'Location code', 'Gene', 'Comments', 'Final report',
    ]);
    for (const { field, type } of SeedBatch.DETAIL_FIELDS) {
      const schemaPath = SeedBatch.schema.path(field);
      assert.ok(schemaPath, `${field} is not in the schema`);
      assert.equal(schemaPath.instance, type === 'number' ? 'Number' : 'String');
      assert.notEqual(schemaPath.isRequired, true, `${field} must stay optional`);
    }
  });

  it('only Previous Year, Yield 1, Yield 2 and Total are numbers — the scores stay text', () => {
    assert.deepEqual(SeedBatch.DETAIL_FIELDS.filter((d) => d.type === 'number').map((d) => d.field), ['previousYear', 'yield1', 'yield2', 'total']);
  });

  it('Year, warehouse, rack and shelf are reused, not duplicated', () => {
    const names = SeedBatch.DETAIL_FIELDS.map((d) => d.field);
    for (const existing of ['year', 'warehouse', 'rack', 'shelf', 'rackShelf', 'month']) assert.equal(names.includes(existing), false);
    assert.deepEqual(names, [...new Set(names)]);
  });

  it('the existing paths are exactly as they were', () => {
    for (const required of ['batchName', 'seedType', 'seedCode', 'batchNumber', 'batchCode', 'count']) {
      assert.equal(SeedBatch.schema.path(required).isRequired, true, required);
    }
    assert.equal(SeedBatch.schema.path('seedCode').options.maxlength, 4);
    assert.equal(SeedBatch.schema.path('seedCode').options.uppercase, true);
    assert.equal(SeedBatch.schema.path('year').instance, 'Number');
    assert.equal(SeedBatch.schema.path('packets').instance, 'Array');
    assert.deepEqual(SeedBatch.schema.indexes(), []);
  });

  it('a batch stored before these details existed is still valid and reads back blank', () => {
    const legacy = SeedBatch.hydrate({ _id: '64b000000000000000000001', batchName: 'Soybean BA-01', seedType: 'Soybean', seedCode: 'SO', batchNumber: 'BA-01', batchCode: 'BA01', count: 3, year: 2024, warehouse: 'Warehouse B' });
    assert.equal(legacy.validateSync(), undefined);
    assert.equal(legacy.year, 2024);
    assert.equal(legacy.warehouse, 'Warehouse B');
    assert.equal(legacy.varietyName, '');
    assert.equal(legacy.total, null);
    assert.deepEqual(legacy.modifiedPaths(), [], 'reading it must not mark anything for writing');
  });
});

describe('batch seed details — POST /api/batches', () => {
  it('stores every entered detail and returns it as stored', async () => {
    const res = await post({ ...BASE, ...DETAILS });
    assert.equal(res.statusCode, 201);
    assert.equal(created.length, 1);
    for (const { field } of SeedBatch.DETAIL_FIELDS) {
      assert.equal(created[0][field], DETAILS[field], `stored ${field}`);
      assert.equal(res.body.batch[field], DETAILS[field], `returned ${field}`);
    }
    // The document as built satisfies the schema (the test admin's id is
    // not a real ObjectId, so that one path is left out of the check).
    const { createdBy, ...doc } = created[0];
    assert.equal(createdBy, 'adm1');
    assert.equal(new SeedBatch(doc).validateSync(), undefined);
  });

  it('Total is saved as entered — never calculated', async () => {
    await post({ ...BASE, yield1: 10, yield2: 20, total: 99 });
    assert.equal(created[0].total, 99);
    await post({ ...BASE, yield1: 10, yield2: 20 });
    assert.equal(created[1].total, null);
  });

  it('nothing is invented: details that were not sent are stored blank', async () => {
    const res = await post(BASE);
    assert.equal(res.statusCode, 201);
    for (const { field, type } of SeedBatch.DETAIL_FIELDS) {
      assert.equal(created[0][field], type === 'number' ? null : '', field);
    }
    assert.equal(created[0].crop, '', 'Crop is not copied from the seed name');
    assert.equal(created[0].varietyName, '');
    assert.equal(created[0].varietyCode, '');
  });

  it('trims text, treats empty strings as blank and accepts numbers typed as text', async () => {
    await post({ ...BASE, gene: '  Rf1 ', comments: '   ', yield1: ' 12.5 ', yield2: '', total: null, previousYear: '2025', sptScore: 7 });
    assert.equal(created[0].gene, 'Rf1');
    assert.equal(created[0].comments, '');
    assert.equal(created[0].yield1, 12.5);
    assert.equal(created[0].yield2, null);
    assert.equal(created[0].total, null);
    assert.equal(created[0].previousYear, 2025);
    assert.equal(created[0].sptScore, '7', 'a score stays text');
  });

  it('a zero is a value, not a blank', async () => {
    await post({ ...BASE, yield1: 0, total: '0' });
    assert.equal(created[0].yield1, 0);
    assert.equal(created[0].total, 0);
  });

  for (const [label, extra, message] of [
    ['a non-numeric Yield 1',              { yield1: 'lots' },                /Yield 1 must be a number/],
    ['a non-finite Total',                 { total: Infinity },               /Total must be a number/],
    ['Previous Year given as an object',   { previousYear: { $gt: 0 } },      /Previous Year must be a number/],
    ['Yield 2 given as an array',          { yield2: [1] },                   /Yield 2 must be a number/],
    ['an operator object as a text value', { gene: { $ne: null } },           /Gene must be text/],
    ['text given as an array',             { comments: ['a'] },               /Comments must be text/],
    ['text given as a boolean',            { finalReport: true },             /Final report must be text/],
    ['text longer than the limit',         { comments: 'x'.repeat(2001) },    /Comments must be at most 2000 characters/],
  ]) {
    it(`rejects ${label} (400) before anything is written or any QR is generated`, async () => {
      const res = await post({ ...BASE, ...extra });
      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, message);
      assert.deepEqual(created, []);
      assert.deepEqual(uploads, []);
      assert.deepEqual(insertedPackets, []);
    });
  }

  it('text of exactly the limit is accepted', async () => {
    const res = await post({ ...BASE, comments: 'x'.repeat(2000) });
    assert.equal(res.statusCode, 201);
    assert.equal(created[0].comments.length, 2000);
  });

  it('a field that is not a batch detail is ignored, never stored', async () => {
    await post({ ...BASE, weight: 5, rackShelf: 'R-S', isAdmin: true, packets: ['x'], createdBy: 'someone-else' });
    for (const key of ['weight', 'rackShelf', 'isAdmin', 'packets']) assert.equal(key in created[0], false, key);
    assert.equal(created[0].createdBy, 'adm1');
  });
});

describe('batch seed details — the existing batch and QR behaviour is unchanged', () => {
  it('the same batch fields, packet ids, QR files and response as before', async () => {
    const res = await post({ ...BASE, ...DETAILS });
    assert.equal(res.statusCode, 201);

    const doc = created[0];
    assert.equal(doc.batchName, 'Maize hybrid BA-09');
    assert.equal(doc.seedType, 'Maize hybrid');
    assert.equal(doc.seedCategory, 'Hybrid');
    assert.equal(doc.seedCode, 'MA');
    assert.equal(doc.batchCode, 'BA09');
    assert.equal(doc.count, 2);
    assert.equal(doc.month, 6);
    assert.equal(doc.year, 2026);
    assert.equal(doc.warehouse, 'Warehouse A');
    assert.equal(doc.rack, 'Rack 1');
    assert.equal(doc.shelf, 'Shelf 2');

    assert.deepEqual(uploads.map((u) => u.fileName).sort(), ['PRD-MABA09-001.png', 'PRD-MABA09-002.png']);
    assert.deepEqual(insertedPackets.map((p) => p.uniqueId), ['PRD-MABA09-001', 'PRD-MABA09-002']);
    for (const packet of insertedPackets) {
      assert.deepEqual(Object.keys(packet).sort(), ['batchId', 'qrCodeUrl', 'status', 'uniqueId']);
      assert.equal(packet.batchId, 'batch1');
      assert.equal(packet.status, 'empty');
      assert.match(packet.qrCodeUrl, /^\/api\/qr\/file-\d$/);
    }

    assert.equal(res.body.message, '2 QR codes generated');
    assert.deepEqual(res.body.packets.map((p) => p.uniqueId), ['PRD-MABA09-001', 'PRD-MABA09-002']);
    assert.equal(res.body.batch.seedCode, 'MA');
    assert.equal(res.body.batch.count, 2);
  });

  it('the required-field and count checks still answer as before', async () => {
    assert.equal((await post({ ...DETAILS, seedType: 'Maize' })).body.message, 'seedCode, batchCode, count required');
    assert.equal((await post({ ...BASE, ...DETAILS, count: 5001 })).body.message, 'count must be 1–5000');
    assert.equal((await post({ ...BASE, ...DETAILS, month: 13 })).body.message, 'month must be 1–12');
    assert.deepEqual(created, []);
  });

  it('authorization is unchanged: no token 401, Admin role "operator" 403 — nothing written either way', async () => {
    assert.equal((await post({ ...BASE, ...DETAILS }, {})).statusCode, 401);
    Admin.findById = async () => ({ _id: 'op1', role: 'operator', isActive: true });
    assert.equal((await post({ ...BASE, ...DETAILS }, authHeaderFor('op1'))).statusCode, 403);
    assert.deepEqual(created, []);
    assert.deepEqual(uploads, []);
  });

  it('the route stack is still [protect, allowRoles, handler] and the read routes still [protect, handler]', () => {
    const router = loadBatchRoutes();
    const layer = (method, p) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    assert.equal(layer('post', '/').route.stack.length, 3);
    for (const p of ['/', '/inventory', '/:id/qr-list', '/:id']) assert.equal(layer('get', p).route.stack.length, 2);
    assert.equal(router.stack.filter((l) => l.route).length, 5, 'no route was added');
  });
});
