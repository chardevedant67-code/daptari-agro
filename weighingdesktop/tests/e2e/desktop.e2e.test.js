// End to end: the desktop app's real core (everything except the window)
// against the real server and a real, local, throwaway MongoDB.
// See testBackend.js for why this can never touch production.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { createTestBackend, waitFor, SERVER_DIR } = require('./testBackend');
const { createCore } = require('../../electron/core');
const { createMemoryTokenStore } = require('../../electron/tokenStore');
const { COLUMNS, HIDDEN_COLUMNS } = require('../../shared/columns');

const HEADERS = COLUMNS.map((c) => c.header);

let backend;
let Records;          // DesktopSeedRecord model, for looking straight into the test database
let seededPackets;    // the pre-existing packets/batches, exactly as first stored
let seededBatches;
const cores = [];

function newCore(label, overrides = {}) {
  const dir = backend.tempDir(label);
  const core = createCore({
    apiUrl: backend.baseUrl,
    dataDir: path.join(dir, 'appdata'),
    workbookDir: path.join(dir, 'documents'),
    tokenStore: createMemoryTokenStore(),
    // Fast retries so the offline tests finish quickly; a long interval so
    // the only syncs are the ones a test asks for (or a retry it waits on).
    syncConfig: { retryBaseMs: 300, retryMaxMs: 1000, kickDelayMs: 3600000, intervalMs: 3600000, workbookRetryMs: 3600000 },
    ...overrides,
  });
  cores.push(core);
  return core;
}

async function signIn(core, key) {
  const session = await core.login(backend.accounts[key].email, backend.accounts[key].password);
  await core.syncNow();
  return session;
}

// Reads the workbook the app wrote. Used ONLY by these tests to check the
// output — the app itself has no code that reads the workbook.
async function readWorkbook(core) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(core.workbookPath);
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
  return { book, sheet, headers, rows, byId: new Map(rows.map((r) => [r.Record_ID, r])) };
}

const dbRecord = (recordId) => Records.findOne({ recordId }).lean();
// Whole-collection snapshot as plain JSON, for "nothing changed" comparisons.
const snapshot = async (model) => JSON.parse(JSON.stringify(await model.find().sort({ _id: 1 }).lean()));
const rowOf = (core, recordId) => core.getRows().find((r) => r.recordId === recordId);

before(async () => {
  backend = await createTestBackend({ label: 'core' });
  Records = backend.model('DesktopSeedRecord');
  await backend.createAdmin('Superadmin', 'superadmin');
  await backend.createAdmin('SecondSuperadmin', 'superadmin');
  await backend.createAdmin('Admin', 'admin');
  await backend.createAdmin('AdminOperator', 'operator');
  await backend.seedPackets();
  seededPackets = await snapshot(backend.model('SeedPacket'));
  seededBatches = await snapshot(backend.model('SeedBatch'));
}, { timeout: 600000 });

after(async () => {
  for (const core of cores) core.dispose();
  if (backend) await backend.dispose();
});

describe('test environment is isolated from production', () => {
  it('the database is a local throwaway instance', () => {
    const uri = new URL(backend.mongoUri);
    assert.equal(uri.hostname, '127.0.0.1');
    assert.equal(uri.pathname, '/weighing_desktop_test');
    assert.match(backend.serverLog, /MongoDB Connected: 127\.0\.0\.1/);
  });

  it('the server was started without access to any .env file', () => {
    assert.equal(fs.existsSync(path.join(backend.serverCwd, '.env')), false);
    assert.notEqual(path.resolve(backend.serverCwd), path.resolve(SERVER_DIR));
  });

  it('the desktop column list is identical to the server model', () => {
    assert.deepEqual(COLUMNS, Records.DATA_FIELDS);
  });
});

describe('login and sign up (existing backend authentication)', () => {
  it('a wrong password is refused with the server message and no session', async () => {
    const core = newCore('wrongpw');
    await assert.rejects(core.login(backend.accounts.Superadmin.email, 'not-the-password'), /Invalid email or password/);
    assert.equal(core.getSession(), null);
  });

  it('a Superadmin signs in and may manage records', async () => {
    const core = newCore('sa-login');
    const session = await signIn(core, 'Superadmin');
    assert.equal(session.admin.role, 'superadmin');
    assert.equal(session.canManage, true);
    assert.equal(session.verified, true);
  });

  it('an ordinary Admin signs in but is view-only', async () => {
    const core = newCore('admin-login');
    const session = await signIn(core, 'Admin');
    assert.equal(session.admin.role, 'admin');
    assert.equal(session.canManage, false);
    assert.throws(() => core.createRecord({ crop: 'Maize' }), /Only a Superadmin/);
  });

  it('Sign Up creates a mobile operator, signs nobody in, and that account cannot use the desktop', async () => {
    const core = newCore('signup');
    const email = 'new.operator@desktop-test.local';
    const result = await core.register('New Operator', email, 'operator-pass-1');
    assert.match(result.message, /cannot open desktop records/);
    assert.equal(core.getSession(), null);

    const user = await backend.model('User').findOne({ email }).lean();
    assert.equal(user.role, 'operator');
    assert.equal(await backend.model('Admin').countDocuments({ email }), 0, 'sign-up must never create an Admin account');

    // The same credentials do not work on the desktop (Admin) login.
    await assert.rejects(core.login(email, 'operator-pass-1'), /Invalid email or password/);
  });

  it('Sign Up cannot be used to obtain a role', async () => {
    const email = 'sneaky@desktop-test.local';
    const { status, data } = await backend.http('POST', '/api/user/register', {
      body: { name: 'Sneaky', email, password: 'sneaky-pass-1', role: 'superadmin', isActive: true },
    });
    assert.equal(status, 201);
    const user = await backend.model('User').findOne({ email }).lean();
    assert.equal(user.role, 'operator');
    backend.operatorToken = data.token;
  });

  it('server-side validation messages reach the caller', async () => {
    const core = newCore('signup-invalid');
    await assert.rejects(core.register('X', 'not-an-email', 'longenough'), /valid email/i);
    await assert.rejects(core.register('Dup', 'new.operator@desktop-test.local', 'operator-pass-1'), /already registered/i);
  });

  it('Forgot Password returns the backend\'s generic answer for known and unknown emails alike', async () => {
    const core = newCore('forgot');
    const known = await core.forgotPassword(backend.accounts.Admin.email);
    const unknown = await core.forgotPassword('nobody@desktop-test.local');
    assert.equal(known.message, unknown.message);
    assert.match(known.message, /If an account exists/);
  });
});

describe('authorization is enforced by the backend', () => {
  const uuid = () => crypto.randomUUID();
  let tokens;
  let existingId;

  before(async () => {
    tokens = {
      superadmin: await backend.login('Superadmin'),
      admin: await backend.login('Admin'),
      adminOperator: await backend.login('AdminOperator'),
      operatorUser: backend.operatorToken,
    };
    existingId = uuid();
    const created = await backend.http('POST', '/api/desktop-records', { token: tokens.superadmin, body: { recordId: existingId, fields: { crop: 'Authz fixture' } } });
    assert.equal(created.status, 201);
  });

  const writes = () => [
    ['POST /', () => ['POST', '/api/desktop-records', { recordId: uuid(), fields: { crop: 'Denied' } }]],
    ['PUT /:recordId', () => ['PUT', `/api/desktop-records/${existingId}`, { baseVersion: 1, fields: { crop: 'Denied' } }]],
    ['POST /import-packets', () => ['POST', '/api/desktop-records/import-packets', {}]],
  ];

  for (const [who, tokenKey, readStatus, writeStatus] of [
    ['no token', null, 401, 401],
    ['a signed-up mobile operator (User token)', 'operatorUser', 401, 401],
    ['Admin role "operator"', 'adminOperator', 200, 403],
    ['Admin role "admin"', 'admin', 200, 403],
  ]) {
    it(`${who}: read -> ${readStatus}`, async () => {
      const res = await backend.http('GET', '/api/desktop-records', { token: tokenKey ? tokens[tokenKey] : undefined });
      assert.equal(res.status, readStatus);
      if (readStatus !== 200) assert.equal(res.data.records, undefined, 'no records may leak in a refusal');
    });

    for (const [label, build] of writes()) {
      it(`${who}: ${label} -> ${writeStatus}, database unchanged`, async () => {
        const before = await snapshot(Records);
        const [method, urlPath, body] = build();
        const res = await backend.http(method, urlPath, { token: tokenKey ? tokens[tokenKey] : undefined, body });
        assert.equal(res.status, writeStatus);
        assert.deepEqual(await snapshot(Records), before);
      });
    }
  }

  it('a forged token (wrong signing key) is refused', async () => {
    const jwt = require(path.join(SERVER_DIR, 'node_modules', 'jsonwebtoken'));
    const forged = jwt.sign({ id: backend.accounts.Superadmin.id }, 'guessed-secret');
    assert.equal((await backend.http('GET', '/api/desktop-records', { token: forged })).status, 401);
  });

  it('a deactivated Superadmin loses access immediately, with the same token', async () => {
    const Admin = backend.model('Admin');
    const token = await backend.login('SecondSuperadmin');
    assert.equal((await backend.http('GET', '/api/desktop-records', { token })).status, 200);
    await Admin.updateOne({ _id: backend.accounts.SecondSuperadmin.id }, { isActive: false });
    try {
      assert.equal((await backend.http('GET', '/api/desktop-records', { token })).status, 401);
      assert.equal((await backend.http('POST', '/api/desktop-records', { token, body: { recordId: uuid(), fields: { crop: 'x' } } })).status, 401);
    } finally {
      await Admin.updateOne({ _id: backend.accounts.SecondSuperadmin.id }, { isActive: true });
    }
  });

  it('a Superadmin demoted to Admin can no longer write, with the same token', async () => {
    const Admin = backend.model('Admin');
    const token = await backend.login('SecondSuperadmin');
    await Admin.updateOne({ _id: backend.accounts.SecondSuperadmin.id }, { role: 'admin' });
    try {
      assert.equal((await backend.http('POST', '/api/desktop-records', { token, body: { recordId: uuid(), fields: { crop: 'x' } } })).status, 403);
      assert.equal((await backend.http('GET', '/api/desktop-records', { token })).status, 200);
    } finally {
      await Admin.updateOne({ _id: backend.accounts.SecondSuperadmin.id }, { role: 'superadmin' });
    }
  });

  it('existing endpoints still answer exactly as before for the same accounts', async () => {
    assert.equal((await backend.http('GET', '/api/batches', { token: tokens.admin })).status, 200);
    assert.equal((await backend.http('GET', '/api/packets', { token: tokens.operatorUser })).status, 200);
    assert.equal((await backend.http('GET', '/api/packets', { token: tokens.admin })).status, 401);
    assert.equal((await backend.http('GET', '/api/health')).status, 200);
    assert.equal((await backend.http('GET', '/api/records', { token: tokens.admin })).status, 200);
  });
});

describe('create and update: MongoDB first, then Excel', () => {
  let core;
  let recordId;

  before(async () => {
    core = newCore('crud');
    await signIn(core, 'Superadmin');
  });

  it('a new record is Pending and absent from MongoDB and Excel until the backend confirms it', async () => {
    recordId = core.createRecord({ crop: 'Maize', year: '2026', yield1: '12.5', yield2: 7, femaleCode: 'F-101', comments: '  first  ' });
    const row = rowOf(core, recordId);
    assert.equal(row.syncState, 'pending');
    assert.equal(await dbRecord(recordId), null);
    assert.equal((await readWorkbook(core)).byId.has(recordId), false);
    assert.equal(core.getStatus().pending, 1);
  });

  it('after sync it is Synced, stored in MongoDB with version 1, and written to Excel', async () => {
    const status = await core.syncNow();
    assert.equal(status.state, 'synced');
    assert.equal(rowOf(core, recordId).syncState, 'synced');

    const doc = await dbRecord(recordId);
    assert.equal(doc.version, 1);
    assert.equal(doc.crop, 'Maize');
    assert.equal(doc.year, 2026);
    assert.equal(doc.yield1, 12.5);
    assert.equal(doc.yield2, 7);
    assert.equal(doc.femaleCode, 'F-101');
    assert.equal(doc.comments, 'first');
    assert.equal(String(doc.createdBy), backend.accounts.Superadmin.id);

    const excel = (await readWorkbook(core)).byId.get(recordId);
    assert.equal(excel.Crop, 'Maize');
    assert.equal(excel.Year, 2026);
    assert.equal(excel['Yield 1'], 12.5);
    assert.equal(excel.Female_code, 'F-101');
    assert.equal(excel.Version, 1);
  });

  it('an edit follows the same path and bumps the version', async () => {
    assert.equal(core.updateRecord(recordId, { gene: 'Rf1', total: 19.5 }), true);
    assert.equal(rowOf(core, recordId).syncState, 'pending');
    assert.equal((await dbRecord(recordId)).gene, '', 'not in MongoDB before sync');
    assert.equal((await readWorkbook(core)).byId.get(recordId).Gene, null, 'not in Excel before sync');

    await core.syncNow();
    const doc = await dbRecord(recordId);
    assert.equal(doc.version, 2);
    assert.equal(doc.gene, 'Rf1');
    assert.equal(doc.total, 19.5);
    assert.equal(doc.crop, 'Maize', 'untouched columns are preserved');
    const excel = (await readWorkbook(core)).byId.get(recordId);
    assert.equal(excel.Gene, 'Rf1');
    assert.equal(excel.Total, 19.5);
    assert.equal(excel.Version, 2);
  });

  it('several quick edits to one record are sent as a single update', async () => {
    core.updateRecord(recordId, { comments: 'a' });
    core.updateRecord(recordId, { comments: 'b' });
    core.updateRecord(recordId, { comments: 'c', maleCode: 'M-9' });
    await core.syncNow();
    const doc = await dbRecord(recordId);
    assert.equal(doc.version, 3);
    assert.equal(doc.comments, 'c');
    assert.equal(doc.maleCode, 'M-9');
  });

  it('an edit that changes nothing is not queued', async () => {
    assert.equal(core.updateRecord(recordId, { comments: 'c' }), false);
    assert.equal(core.getStatus().pending, 0);
  });

  it('invalid input is refused locally and nothing is queued', () => {
    assert.throws(() => core.createRecord({ yield1: 'lots' }), /Yield 1 must be a number/);
    assert.throws(() => core.createRecord({ crop: '   ' }), /at least one value/);
    assert.throws(() => core.updateRecord(recordId, { weight: 'heavy' }), /Before Weight must be a number/);
    assert.equal(core.getStatus().pending, 0);
  });

  it('the record is really in MongoDB: it survives a restart of the database itself', async () => {
    await backend.stopServer();
    await backend.restartDatabase();
    await backend.startServer();
    const doc = await dbRecord(recordId);
    assert.equal(doc.version, 3);
    assert.equal(doc.comments, 'c');

    const fresh = newCore('after-restart');
    await signIn(fresh, 'Admin');
    assert.equal(rowOf(fresh, recordId).comments, 'c');
  });
});

describe('duplicate prevention', () => {
  let token;
  before(async () => { token = await backend.login('Superadmin'); });

  it('repeating a create returns the stored record and inserts nothing', async () => {
    const recordId = crypto.randomUUID();
    const first = await backend.http('POST', '/api/desktop-records', { token, body: { recordId, fields: { crop: 'Once' } } });
    const second = await backend.http('POST', '/api/desktop-records', { token, body: { recordId, fields: { crop: 'Twice' } } });
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.data.created, false);
    assert.equal(second.data.record.crop, 'Once');
    assert.equal(await Records.countDocuments({ recordId }), 1);
  });

  it('five simultaneous creates of the same record leave exactly one document', async () => {
    const recordId = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => backend.http('POST', '/api/desktop-records', { token, body: { recordId, fields: { crop: 'Race' } } })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 200).length, 4);
    assert.equal(await Records.countDocuments({ recordId }), 1);
  });

  it('a second desktop syncing the same data ends up with the same rows, no extras', async () => {
    const a = newCore('dup-a');
    const b = newCore('dup-b');
    await signIn(a, 'Admin');
    await signIn(b, 'Admin');
    await a.syncNow({ full: true });
    await a.syncNow();
    const total = await Records.countDocuments();
    assert.equal(a.getRows().length, total);
    assert.equal(b.getRows().length, total);
    const ids = a.getRows().map((r) => r.recordId);
    assert.deepEqual(ids, [...new Set(ids)]);
    assert.equal((await readWorkbook(a)).rows.length, total);
  });
});

describe('version conflicts', () => {
  let a;
  let b;
  let recordId;

  before(async () => {
    a = newCore('conflict-a');
    b = newCore('conflict-b');
    await signIn(a, 'Superadmin');
    await signIn(b, 'SecondSuperadmin');
    recordId = a.createRecord({ crop: 'Conflict crop', gene: 'original' });
    await a.syncNow();
    await b.syncNow();
  });

  it('the second editor is told about the conflict; the first edit is not overwritten', async () => {
    b.updateRecord(recordId, { gene: 'from B' });
    await b.syncNow();                       // B wins: version 2
    a.updateRecord(recordId, { gene: 'from A' }); // A still believes version 1
    const status = await a.syncNow();

    assert.equal(status.state, 'conflict');
    assert.equal(status.conflicts, 1);
    const row = rowOf(a, recordId);
    assert.equal(row.syncState, 'conflict');
    assert.equal(row.gene, 'from A', 'my unsaved value is still shown to me');
    assert.equal(row.conflictRecord.gene, 'from B');

    const doc = await dbRecord(recordId);
    assert.equal(doc.gene, 'from B');
    assert.equal(doc.version, 2);
    assert.equal((await readWorkbook(a)).byId.get(recordId).Gene, 'from B', 'Excel shows only what the server has');
  });

  it('"keep mine" saves my value on top of theirs', async () => {
    assert.equal(a.resolveConflict(recordId, 'mine'), true);
    const status = await a.syncNow();
    assert.equal(status.state, 'synced');
    const doc = await dbRecord(recordId);
    assert.equal(doc.gene, 'from A');
    assert.equal(doc.version, 3);
    assert.equal((await readWorkbook(a)).byId.get(recordId).Gene, 'from A');
  });

  it('"use the server\'s" drops my change', async () => {
    a.updateRecord(recordId, { comments: 'A note' });   // A is at version 3
    await a.syncNow();                                  // version 4
    b.updateRecord(recordId, { comments: 'B note' });   // B still believes version 2
    const status = await b.syncNow();
    assert.equal(status.state, 'conflict');

    assert.equal(b.resolveConflict(recordId, 'server'), true);
    const after = await b.syncNow();
    assert.equal(after.state, 'synced');
    assert.equal(rowOf(b, recordId).comments, 'A note');
    const doc = await dbRecord(recordId);
    assert.equal(doc.comments, 'A note');
    assert.equal(doc.version, 4);
  });

  it('five simultaneous updates from the same version: exactly one is accepted', async () => {
    const token = await backend.login('Superadmin');
    const { version } = await dbRecord(recordId);
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => backend.http('PUT', `/api/desktop-records/${recordId}`, { token, body: { baseVersion: version, fields: { locationCode: `L${i}` } } })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.status === 409 && r.data.code === 'VERSION_CONFLICT').length, 4);
    const doc = await dbRecord(recordId);
    assert.equal(doc.version, version + 1);
    assert.equal(doc.locationCode, results.find((r) => r.status === 200).data.record.locationCode);
  });
});

describe('existing packets appear automatically — no import step', () => {
  let core;
  const linked = () => Records.find({ packetUniqueId: { $type: 'string' } }).sort({ recordId: 1 }).lean();

  before(async () => {
    core = newCore('auto');
    await signIn(core, 'Superadmin');
  });

  it('they are already in the table after login', async () => {
    const rows = core.getRows().filter((r) => r.linked);
    assert.deepEqual(rows.map((r) => r.recordId).sort(), ['PKT-PRD-SOYBLOTA-001', 'PKT-PRD-SOYBLOTA-002', 'PKT-PRD-WHTLOTB-001']);
    for (const row of rows) assert.equal(row.syncState, 'synced');
    assert.equal(core.getStatus().packetsNotImported, 0);
  });

  it('one record per existing packet, created by the server itself (no user as author)', async () => {
    const docs = await linked();
    assert.deepEqual(docs.map((d) => d.recordId), ['PKT-PRD-SOYBLOTA-001', 'PKT-PRD-SOYBLOTA-002', 'PKT-PRD-WHTLOTB-001']);
    for (const doc of docs) {
      assert.equal(doc.createdBy, null);
      assert.equal(doc.packetUniqueId, doc.recordId.slice(4));
    }
  });

  it('copies Crop, Year, Wearhouse and Rack_shelf from the batch', async () => {
    const soy = await dbRecord('PKT-PRD-SOYBLOTA-001');
    assert.equal(soy.crop, 'Soybean');
    assert.equal(soy.year, 2025);
    assert.equal(soy.warehouse, 'Warehouse A');
    assert.equal(soy.rackShelf, 'R1-S2');
    const wheat = await dbRecord('PKT-PRD-WHTLOTB-001');
    assert.equal(wheat.crop, 'Wheat');
    assert.equal(wheat.year, null);
    assert.equal(wheat.warehouse, '');
    assert.equal(wheat.rackShelf, '');
  });

  it('Weight and After Weight are the packet\'s before and after weights; Name Of Variety and Varity_Code stay blank', async () => {
    const packet = seededPackets.find((p) => p.uniqueId === 'PRD-SOYBLOTA-001');
    const batch = seededBatches.find((b) => String(b._id) === String(packet.batchId));
    assert.equal(packet.beforeWeight, 0.5);
    assert.equal(packet.afterWeight, 1.75);
    assert.equal(packet.difference, 1.25);
    assert.equal(batch.batchName, 'JS-335 Lot A');
    assert.equal(batch.seedCode, 'SOYB');

    const doc = await dbRecord('PKT-PRD-SOYBLOTA-001');
    assert.equal(doc.weight, 0.5);
    assert.equal(doc.afterWeight, 1.75);
    assert.equal(doc.varietyName, '');
    assert.equal(doc.varietyCode, '');

    const row = rowOf(core, 'PKT-PRD-SOYBLOTA-001');
    assert.equal(row.weight, 0.5);
    assert.equal(row.afterWeight, 1.75);

    const excel = (await readWorkbook(core)).byId.get('PKT-PRD-SOYBLOTA-001');
    assert.equal(excel['Before Weight'], 0.5);
    assert.equal(excel['After Weight'], 1.75);
    assert.equal(excel['Name Of Variety'], null);
    assert.equal(excel.Varity_Code, null);
    assert.equal(excel.Crop, 'Soybean');
    assert.equal(excel.Rack_shelf, 'R1-S2');
  });

  it('every other column of such a record is blank', async () => {
    const doc = await dbRecord('PKT-PRD-SOYBLOTA-002');
    for (const { field, type } of COLUMNS) {
      if (['crop', 'year', 'warehouse', 'rackShelf'].includes(field)) continue;
      assert.equal(doc[field], type === 'number' ? null : '', `${field} should be blank`);
    }
  });

  it('the existing packets and batches themselves are not modified in any way', async () => {
    assert.deepEqual(await snapshot(backend.model('SeedPacket')), seededPackets);
    assert.deepEqual(await snapshot(backend.model('SeedBatch')), seededBatches);
  });

  it('a packet created later shows up at the next sync, again without any import', async () => {
    await backend.addPacket('PRD-WHTLOTB-002');
    await core.syncNow();
    const row = rowOf(core, 'PKT-PRD-WHTLOTB-002');
    assert.equal(row.crop, 'Wheat');
    assert.equal(row.syncState, 'synced');
    assert.equal(await Records.countDocuments({ packetUniqueId: 'PRD-WHTLOTB-002' }), 1);
    assert.equal((await readWorkbook(core)).byId.get('PKT-PRD-WHTLOTB-002').Crop, 'Wheat');
  });

  it('the on-demand import (Superadmin only) finds nothing left to do', async () => {
    const token = await backend.login('Superadmin');
    const res = await backend.http('POST', '/api/desktop-records/import-packets', { token, body: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { success: true, totalPackets: 4, created: 0, skipped: 4 });
    assert.equal(await Records.countDocuments({ packetUniqueId: { $type: 'string' } }), 4);
  });

  it('three passes racing over the same new packet still create its record exactly once', async () => {
    await backend.addPacket('PRD-WHTLOTB-003');
    const token = await backend.login('Superadmin');
    const results = await Promise.all([1, 2, 3].map(() => backend.http('POST', '/api/desktop-records/import-packets', { token, body: {} })));
    for (const r of results) assert.equal(r.status, 200);
    assert.equal(results.reduce((sum, r) => sum + r.data.created, 0), 1);
    assert.equal(await Records.countDocuments({ packetUniqueId: 'PRD-WHTLOTB-003' }), 1);
    assert.equal(await Records.countDocuments({ packetUniqueId: { $type: 'string' } }), 5);
  });

  it('on such a record the batch columns are fixed; the other columns can be edited', async () => {
    await core.syncNow();
    const id = 'PKT-PRD-SOYBLOTA-001';
    assert.equal(rowOf(core, id).linked, true);
    assert.equal(core.updateRecord(id, { crop: 'Changed', warehouse: 'Elsewhere' }), false, 'nothing to queue');

    // Even a hand-made request cannot change them.
    const token = await backend.login('Superadmin');
    const res = await backend.http('PUT', `/api/desktop-records/${id}`, { token, body: { baseVersion: 1, fields: { crop: 'Changed', year: 1999, warehouse: 'Elsewhere', rackShelf: 'Z', gene: 'Rps1' } } });
    assert.equal(res.status, 200);
    const doc = await dbRecord(id);
    assert.equal(doc.crop, 'Soybean');
    assert.equal(doc.year, 2025);
    assert.equal(doc.warehouse, 'Warehouse A');
    assert.equal(doc.rackShelf, 'R1-S2');
    assert.equal(doc.gene, 'Rps1');

    await core.syncNow();
    assert.equal(core.updateRecord(id, { weight: '1.25', varietyName: 'JS-335' }), true);
    await core.syncNow();
    const edited = await dbRecord(id);
    assert.equal(edited.weight, 1.25);
    assert.equal(edited.varietyName, 'JS-335');
    assert.equal(edited.version, 3);
  });

  it('a Superadmin\'s edits survive: later passes, a server restart and new logins never put the old values back', async () => {
    const id = 'PKT-PRD-SOYBLOTA-001';
    const before = JSON.parse(JSON.stringify(await dbRecord(id)));
    const total = await Records.countDocuments();

    // A restarted server has forgotten that it already checked the packets,
    // so the next listing walks all of them again.
    await backend.stopServer();
    await backend.startServer();
    const fresh = newCore('after-edit-restart');
    await signIn(fresh, 'Admin');
    await fresh.syncNow({ full: true });

    assert.deepEqual(JSON.parse(JSON.stringify(await dbRecord(id))), before, 'the edited record is byte-for-byte unchanged');
    assert.equal(await Records.countDocuments(), total, 'and nothing was added twice');
    const row = rowOf(fresh, id);
    assert.equal(row.gene, 'Rps1');
    assert.equal(row.weight, 1.25);
    assert.equal(row.varietyName, 'JS-335');
    assert.equal(row.version, 3);
    const ids = fresh.getRows().map((r) => r.recordId);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('offline: changes are kept and retried', () => {
  let core;
  let existingId;
  let offlineCreateId;

  before(async () => {
    core = newCore('offline');
    await signIn(core, 'Superadmin');
    existingId = core.createRecord({ crop: 'Offline crop', comments: 'before' });
    await core.syncNow();
  });

  it('with the server down, edits stay Pending and reach neither MongoDB nor Excel', async () => {
    await backend.stopServer();

    core.updateRecord(existingId, { comments: 'edited offline' });
    offlineCreateId = core.createRecord({ crop: 'Created offline' });
    const status = await core.syncNow();

    assert.equal(status.state, 'offline');
    assert.equal(status.pending, 2);
    assert.ok(status.nextRetryAt, 'a retry is scheduled');
    assert.equal(rowOf(core, existingId).syncState, 'pending');
    assert.equal(rowOf(core, existingId).comments, 'edited offline');
    assert.equal(rowOf(core, offlineCreateId).syncState, 'pending');

    assert.equal((await dbRecord(existingId)).comments, 'before');
    assert.equal(await dbRecord(offlineCreateId), null);

    const excel = await readWorkbook(core);
    assert.equal(excel.byId.get(existingId).Comments, 'before');
    assert.equal(excel.byId.has(offlineCreateId), false);
  });

  it('the pending changes survive closing and reopening the app', async () => {
    // A second core over the same app-data folder = the app restarted.
    const dataDir = path.dirname(path.dirname(core.workbookPath));
    const reopened = createCore({
      apiUrl: backend.baseUrl,
      dataDir: path.join(dataDir, 'appdata'),
      workbookDir: path.join(dataDir, 'documents'),
      tokenStore: createMemoryTokenStore(),
    });
    try {
      const rows = reopened.getRows();
      assert.equal(rows.find((r) => r.recordId === existingId).syncState, 'pending');
      assert.equal(rows.find((r) => r.recordId === existingId).comments, 'edited offline');
      assert.equal(rows.find((r) => r.recordId === offlineCreateId).syncState, 'pending');
    } finally {
      reopened.dispose();
    }
  });

  it('when the server returns, the app retries by itself and saves each change exactly once', async () => {
    await backend.startServer();
    // No syncNow() here: this waits for the engine's own scheduled retry.
    await waitFor(() => core.getStatus().state === 'synced', { timeoutMs: 20000, what: 'automatic retry to finish' });

    assert.equal(core.getStatus().pending, 0);
    assert.equal(rowOf(core, existingId).syncState, 'synced');
    assert.equal(rowOf(core, offlineCreateId).syncState, 'synced');

    const edited = await dbRecord(existingId);
    assert.equal(edited.comments, 'edited offline');
    assert.equal(edited.version, 2);
    assert.equal(await Records.countDocuments({ recordId: offlineCreateId }), 1);
    assert.equal((await dbRecord(offlineCreateId)).version, 1);

    const excel = await readWorkbook(core);
    assert.equal(excel.byId.get(existingId).Comments, 'edited offline');
    assert.equal(excel.byId.get(offlineCreateId).Crop, 'Created offline');
  });
});

describe('a role change reaches a running desktop app', () => {
  it('a demoted Superadmin\'s queued change is not sent and not lost; it goes through once the role is restored', async () => {
    const Admin = backend.model('Admin');
    const core = newCore('demoted');
    await signIn(core, 'SecondSuperadmin');
    const recordId = core.createRecord({ crop: 'Queued before demotion' });

    await Admin.updateOne({ _id: backend.accounts.SecondSuperadmin.id }, { role: 'admin' });
    try {
      await core.syncNow();
      assert.equal(await dbRecord(recordId), null);
      assert.equal(core.getSession().canManage, false, 'the app now knows it is view-only');
      assert.equal(rowOf(core, recordId).syncState, 'pending', 'the change is still queued');
      assert.throws(() => core.createRecord({ crop: 'Another' }), /Only a Superadmin/);
    } finally {
      await Admin.updateOne({ _id: backend.accounts.SecondSuperadmin.id }, { role: 'superadmin' });
    }

    // Promoted again: the queued change goes through.
    await core.syncNow();
    assert.equal((await dbRecord(recordId)).crop, 'Queued before demotion');
  });

  it('a deactivated account is signed out at the next sync', async () => {
    const Admin = backend.model('Admin');
    const core = newCore('deactivated');
    await signIn(core, 'AdminOperator');
    await Admin.updateOne({ _id: backend.accounts.AdminOperator.id }, { isActive: false });
    try {
      await core.syncNow();
      assert.equal(core.getSession(), null);
    } finally {
      await Admin.updateOne({ _id: backend.accounts.AdminOperator.id }, { isActive: true });
    }
  });
});

describe('Excel output', () => {
  let core;
  let excel;
  let docs;

  before(async () => {
    core = newCore('excel');
    await signIn(core, 'Admin'); // a view-only account gets the same output
    excel = await readWorkbook(core);
    docs = await Records.find().lean();
  });

  it('is named Seed_Management.xlsx', () => {
    assert.equal(path.basename(core.workbookPath), 'Seed_Management.xlsx');
    assert.equal(fs.existsSync(core.workbookPath), true);
  });

  it('has exactly the 24 approved columns in order, then Record_ID and Version', () => {
    assert.deepEqual(excel.headers.slice(0, 24), HEADERS);
    assert.deepEqual(excel.headers.slice(24), HIDDEN_COLUMNS.map((c) => c.header));
    assert.equal(excel.headers.length, 26);
    assert.equal(excel.sheet.columnCount, 26);
    assert.equal(excel.headers[excel.headers.indexOf('Before Weight') + 1], 'After Weight');
  });

  it('shows the 24 columns and hides Record_ID and Version', () => {
    for (let i = 1; i <= 24; i += 1) assert.notEqual(excel.sheet.getColumn(i).hidden, true, `column ${i} must be visible`);
    assert.equal(excel.sheet.getColumn(25).hidden, true);
    assert.equal(excel.sheet.getColumn(26).hidden, true);
  });

  it('is protected against editing', () => {
    assert.equal(excel.sheet.sheetProtection && excel.sheet.sheetProtection.sheet, true);
  });

  it('contains one row per MongoDB record — no more, no fewer, no duplicates', () => {
    assert.equal(excel.rows.length, docs.length);
    assert.ok(docs.length > 5, 'the earlier tests left real records to check against');
    assert.deepEqual([...excel.byId.keys()].sort(), docs.map((d) => d.recordId).sort());
  });

  it('every cell equals what MongoDB holds for that record', () => {
    for (const doc of docs) {
      const row = excel.byId.get(doc.recordId);
      assert.equal(row.Version, doc.version, `${doc.recordId} version`);
      for (const { header, field, type } of COLUMNS) {
        const expected = type === 'number' ? doc[field] : (doc[field] === '' ? null : doc[field]);
        assert.equal(row[header], expected, `${doc.recordId} / ${header}`);
      }
    }
  });

  it('typing into the workbook changes nothing: the edit is discarded and never reaches MongoDB', async () => {
    const target = docs.find((d) => d.crop === 'Maize');
    const before = await snapshot(Records);

    // Simulate someone editing and adding rows in Excel.
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(core.workbookPath);
    const sheet = book.worksheets[0];
    sheet.eachRow((row, index) => {
      if (index > 1 && row.getCell(25).value === target.recordId) row.getCell(1).value = 'TAMPERED IN EXCEL';
    });
    sheet.addRow(['Invented row', ...Array(23).fill(null), crypto.randomUUID(), 1]);
    await book.xlsx.writeFile(core.workbookPath);
    assert.equal((await readWorkbook(core)).byId.get(target.recordId).Crop, 'TAMPERED IN EXCEL');

    await core.syncNow();

    const after = await readWorkbook(core);
    assert.equal(after.byId.get(target.recordId).Crop, 'Maize');
    assert.equal(after.rows.length, docs.length);
    assert.equal(after.rows.some((r) => r.Crop === 'Invented row'), false);
    assert.deepEqual(await snapshot(Records), before);
    assert.equal(core.getRows().some((r) => r.crop === 'TAMPERED IN EXCEL' || r.crop === 'Invented row'), false);
  });

  it('keeps a backup of the previous workbook', () => {
    assert.equal(fs.existsSync(path.join(path.dirname(core.workbookPath), 'Seed_Management.backup.xlsx')), true);
  });

  it('the app has no code path that reads the workbook', () => {
    const electronDir = path.join(__dirname, '..', '..', 'electron');
    for (const file of fs.readdirSync(electronDir)) {
      const code = fs.readFileSync(path.join(electronDir, file), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      assert.ok(!/xlsx\.(readFile|read|load)\b/.test(code), `${file} must not read a workbook`);
    }
  });

  it('the desktop app contains no database driver or connection string', () => {
    const roots = ['electron', 'src', 'shared'].map((d) => path.join(__dirname, '..', '..', d));
    const files = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(dir, e.name)) : files.push(path.join(dir, e.name))); };
    roots.forEach(walk);
    for (const file of files) {
      const code = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      assert.ok(!/require\(['"](mongodb|mongoose)['"]\)|from ['"](mongodb|mongoose)['"]|mongodb(\+srv)?:\/\//.test(code), `${path.basename(file)} must not reference MongoDB`);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    assert.equal('mongodb' in pkg.dependencies || 'mongoose' in pkg.dependencies, false);
  });
});

describe('nothing else in the test database was disturbed', () => {
  it('only the new collection gained documents beyond the fixtures', async () => {
    assert.equal(await backend.model('SeedPacket').countDocuments(), 5);
    assert.equal(await backend.model('SeedPacket').countDocuments({ $expr: { $eq: ['$createdAt', '$updatedAt'] } }), 5, 'no packet was ever updated');
    assert.equal(await backend.model('SeedBatch').countDocuments(), 2);
    assert.equal(await backend.model('Admin').countDocuments(), 4);
    assert.equal(await backend.model('WeightSession').countDocuments(), 0);
    assert.equal(await backend.model('Product').countDocuments(), 0);
  });
});
