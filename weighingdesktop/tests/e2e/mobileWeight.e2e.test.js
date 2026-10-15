// End to end: a weight saved by the mobile app reaches the desktop app.
// The real server and a real, local, throwaway MongoDB (see testBackend.js
// for why this can never touch production). A packet is weighed through the
// mobile app's own, unmodified endpoints (POST /api/sessions, before-weight,
// after-weight, link) with a real mobile operator token, and followed into
// the packet's desktop record, the desktop rows and the Excel workbook.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ExcelJS = require('exceljs');
const { createTestBackend } = require('./testBackend');
const { createCore } = require('../../electron/core');
const { createMemoryTokenStore } = require('../../electron/tokenStore');
const { COLUMNS } = require('../../shared/columns');

let backend;
let Records;
let Packets;
let operatorToken;
let adminToken;
let core;
let coreDirs;
const cores = [];

function newCore(label, dirs = null) {
  const dir = dirs ? null : backend.tempDir(label);
  const paths = dirs || { dataDir: path.join(dir, 'appdata'), workbookDir: path.join(dir, 'documents') };
  const made = createCore({
    apiUrl: backend.baseUrl,
    ...paths,
    tokenStore: createMemoryTokenStore(),
    syncConfig: { retryBaseMs: 300, retryMaxMs: 1000, kickDelayMs: 3600000, intervalMs: 3600000, workbookRetryMs: 3600000 },
  });
  cores.push(made);
  return { core: made, dirs: paths };
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
  return { headers, rows, byId: new Map(rows.map((r) => [r.Record_ID, r])) };
}

const rowOf = (target, recordId) => target.getRows().find((r) => r.recordId === recordId);
const dbRecord = (recordId) => Records.findOne({ recordId }).lean();

// Exactly the calls WeighScanScreen.jsx makes, in its order.
async function weighOnMobile(uniqueId, beforeWeight, afterWeight) {
  const call = async (method, urlPath, body) => {
    const res = await backend.http(method, urlPath, { token: operatorToken, body });
    assert.ok(res.status === 200 || res.status === 201, `${urlPath} -> ${res.status} ${JSON.stringify(res.data)}`);
    return res.data;
  };
  const { sessionId } = await call('POST', '/api/sessions', { uniqueId });
  await call('POST', `/api/sessions/${sessionId}/before-weight`, { weight: beforeWeight });
  await call('POST', `/api/sessions/${sessionId}/after-weight`, { weight: afterWeight });
  await call('POST', `/api/sessions/${sessionId}/link/${uniqueId}`, {});
}

before(async () => {
  backend = await createTestBackend({ label: 'mobileweight' });
  Records = backend.model('DesktopSeedRecord');
  Packets = backend.model('SeedPacket');
  await backend.createAdmin('Superadmin', 'superadmin');
  await backend.createAdmin('Admin', 'admin');
  await backend.seedPackets();
  adminToken = await backend.login('Admin');

  // A mobile operator, signed up through the real endpoint.
  const signup = await backend.http('POST', '/api/user/register', {
    body: { name: 'Scale Operator', email: 'scale.operator@desktop-test.local', password: 'operator-pass-1' },
  });
  assert.equal(signup.status, 201);
  operatorToken = signup.data.token;

  // The desktop app is already in use: every packet already has its record.
  ({ core, dirs: coreDirs } = newCore('mobileweight'));
  await signIn(core, 'Superadmin');
}, { timeout: 600000 });

after(async () => {
  for (const made of cores) made.dispose();
  if (backend) await backend.dispose();
});

describe('a packet weighed on the mobile app after its desktop record exists', () => {
  const id = 'PKT-PRD-SOYBLOTA-002';
  let recordsBefore;

  it('before weighing, its Weight and After Weight are blank', async () => {
    const doc = await dbRecord(id);
    assert.equal(doc.weight, null);
    assert.equal(doc.afterWeight, null);
    assert.equal(doc.version, 1);
    assert.equal(rowOf(core, id).weight, null);
    assert.equal(rowOf(core, id).afterWeight, null);
    recordsBefore = await Records.countDocuments();
  });

  it('the mobile app saves the weights to the packet in MongoDB', async () => {
    await weighOnMobile('PRD-SOYBLOTA-002', 0.42, 2.17);
    const packet = await Packets.findOne({ uniqueId: 'PRD-SOYBLOTA-002' }).lean();
    assert.equal(packet.status, 'filled');
    assert.equal(packet.beforeWeight, 0.42);
    assert.equal(packet.afterWeight, 2.17);
    assert.ok(Math.abs(packet.difference - 1.75) < 1e-9);
  });

  it('the next desktop sync shows Weight = before weight and After Weight = after weight — nobody types them', async () => {
    await core.syncNow();
    const row = rowOf(core, id);
    assert.equal(row.weight, 0.42);
    assert.equal(row.afterWeight, 2.17);
    assert.equal(row.syncState, 'synced');

    const doc = await dbRecord(id);
    assert.equal(doc.weight, 0.42);
    assert.equal(doc.afterWeight, 2.17);
    assert.equal(doc.version, 3, 'one version per filled column, so an older desktop edit is detected');
    assert.ok(new Date(doc.updatedAt) > new Date(doc.createdAt), 'updatedAt moved, so delta syncs download it');
  });

  it('no record was created twice', async () => {
    assert.equal(await Records.countDocuments(), recordsBefore);
    assert.equal(await Records.countDocuments({ packetUniqueId: 'PRD-SOYBLOTA-002' }), 1);
    const ids = core.getRows().map((r) => r.recordId);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('Excel shows both, with After Weight directly after Before Weight', async () => {
    const excel = await readWorkbook(core);
    const at = excel.headers.indexOf('Before Weight');
    assert.ok(at >= 0, 'Before Weight column present');
    assert.equal(excel.headers.includes('Weight'), false, 'no column is still called just Weight');
    assert.equal(excel.headers[at + 1], 'After Weight');
    assert.deepEqual(excel.headers.slice(0, COLUMNS.length), COLUMNS.map((c) => c.header));
    const row = excel.byId.get(id);
    assert.equal(row['Before Weight'], 0.42);
    assert.equal(row['After Weight'], 2.17);
    assert.equal(row.Version, 3);
  });

  it('existing records still load unchanged: a packet weighed before the desktop existed has its weights from the start', async () => {
    const doc = await dbRecord('PKT-PRD-SOYBLOTA-001');
    assert.equal(doc.weight, 0.5);
    assert.equal(doc.afterWeight, 1.75);
    assert.equal(doc.version, 1);
    const empty = await dbRecord('PKT-PRD-WHTLOTB-001');
    assert.equal(empty.weight, null);
    assert.equal(empty.afterWeight, null);
  });
});

describe('values already in a desktop record and unsent desktop edits', () => {
  it('a Weight typed on the desktop before weighing is kept; only the blank After Weight is filled', async () => {
    const id = 'PKT-PRD-WHTLOTB-001';
    assert.equal(core.updateRecord(id, { weight: '9.99' }), true);
    await core.syncNow();
    assert.equal((await dbRecord(id)).weight, 9.99);

    await weighOnMobile('PRD-WHTLOTB-001', 0.3, 1.3);
    await core.syncNow();
    const doc = await dbRecord(id);
    assert.equal(doc.weight, 9.99, 'never overwritten');
    assert.equal(doc.afterWeight, 1.3);
    assert.equal(rowOf(core, id).weight, 9.99);
    assert.equal(rowOf(core, id).afterWeight, 1.3);
  });

  it('a desktop edit queued before the weights arrived is not lost: it is shown as a conflict and "keep mine" saves it on top', async () => {
    await backend.addPacket('PRD-WHTLOTB-002');
    await core.syncNow();
    const id = 'PKT-PRD-WHTLOTB-002';
    assert.equal(rowOf(core, id).version, 1);

    // Queued locally but not yet sent (the test core never pushes by itself).
    assert.equal(core.updateRecord(id, { comments: 'Checked at the warehouse' }), true);
    await weighOnMobile('PRD-WHTLOTB-002', 0.25, 1.05);
    // Another desktop lists the records first, so the weights land before
    // this desktop's edit is sent.
    assert.equal((await backend.http('GET', '/api/desktop-records', { token: adminToken })).status, 200);
    assert.equal((await dbRecord(id)).version, 3);

    await core.syncNow();
    let row = rowOf(core, id);
    assert.equal(row.syncState, 'conflict');
    assert.equal(row.comments, 'Checked at the warehouse', 'the local change is still shown');

    assert.equal(core.resolveConflict(id, 'mine'), true);
    await core.syncNow();
    row = rowOf(core, id);
    assert.equal(row.syncState, 'synced');
    const doc = await dbRecord(id);
    assert.equal(doc.comments, 'Checked at the warehouse');
    assert.equal(doc.weight, 0.25);
    assert.equal(doc.afterWeight, 1.05);
    assert.equal(doc.version, 4);
  });
});

describe('restarts', () => {
  it('reopening the desktop app shows the saved weights from its own cache, then again after syncing', async () => {
    core.dispose();
    const { core: reopened } = newCore(null, coreDirs);
    const cached = rowOf(reopened, 'PKT-PRD-SOYBLOTA-002');
    assert.equal(cached.weight, 0.42);
    assert.equal(cached.afterWeight, 2.17);

    await signIn(reopened, 'Superadmin');
    await reopened.syncNow({ full: true });
    assert.equal(rowOf(reopened, 'PKT-PRD-SOYBLOTA-002').weight, 0.42);
    assert.equal(rowOf(reopened, 'PKT-PRD-SOYBLOTA-002').afterWeight, 2.17);
  });

  it('a restarted server walks every weighed packet again but changes nothing and adds nothing', async () => {
    const before = JSON.parse(JSON.stringify(await Records.find().sort({ _id: 1 }).lean()));
    await backend.stopServer();
    await backend.startServer();
    const { core: fresh } = newCore('mobileweight-fresh');
    await signIn(fresh, 'Admin');
    assert.deepEqual(JSON.parse(JSON.stringify(await Records.find().sort({ _id: 1 }).lean())), before);
    const excel = await readWorkbook(fresh);
    assert.equal(excel.byId.get('PKT-PRD-SOYBLOTA-002')['Before Weight'], 0.42);
    assert.equal(excel.byId.get('PKT-PRD-SOYBLOTA-002')['After Weight'], 2.17);
    assert.equal(excel.byId.get('PKT-PRD-WHTLOTB-001')['Before Weight'], 9.99);
    assert.equal(excel.rows.length, await Records.countDocuments());
  });

  it('the desktop side never wrote to a packet: each one holds exactly what the mobile app saved', async () => {
    const packets = await Packets.find().sort({ uniqueId: 1 }).lean();
    const weights = Object.fromEntries(packets.map((p) => [p.uniqueId, [p.beforeWeight, p.afterWeight]]));
    assert.deepEqual(weights, {
      'PRD-SOYBLOTA-001': [0.5, 1.75],
      'PRD-SOYBLOTA-002': [0.42, 2.17],
      'PRD-WHTLOTB-001': [0.3, 1.3],
      'PRD-WHTLOTB-002': [0.25, 1.05],
    });
  });
});
