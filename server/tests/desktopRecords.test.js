// Desktop records (desktopRecordRoutes.js / DesktopSeedRecord.js) —
// authorization matrix, validation, idempotent create, version conflicts,
// packet import and the 23-column contract. Same approach as the rest of
// this suite: the real router/middleware run against mocked model methods,
// no database connection.
require('./setup');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mockRes, authHeaderFor, signToken, fullStackFor, runStack, freshRequireCache } = require('./helpers');

const Admin = require('../models/Admin');
const SeedPacket = require('../models/SeedPacket');
const DesktopSeedRecord = require('../models/DesktopSeedRecord');

const UUID = '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b';

function loadRoutes() {
  freshRequireCache('../routes/desktopRecordRoutes');
  return require('../routes/desktopRecordRoutes');
}

// express-rate-limit reads these off a real Express request.
function makeReq(extra = {}) {
  return { headers: {}, query: {}, params: {}, body: {}, ip: '127.0.0.1', app: { get: () => false }, ...extra };
}

async function call(method, routePath, req) {
  const router = loadRoutes();
  const res = mockRes();
  await runStack(fullStackFor(router, method, routePath), 0, makeReq(req), res);
  return res;
}

function storedDoc(overrides = {}) {
  return {
    _id: '64b000000000000000000001',
    recordId: UUID,
    packetUniqueId: null,
    version: 1,
    crop: 'Soybean',
    year: 2026,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function findChain(docs) {
  const calls = {};
  const chain = {
    calls,
    sort(arg) { calls.sort = arg; return chain; },
    limit(arg) { calls.limit = arg; return chain; },
    select(arg) { calls.select = arg; return chain; },
    populate(...args) { calls.populate = args; return chain; },
    lean: async () => docs,
  };
  return chain;
}
const leanOne = (doc) => ({ lean: async () => doc });

// In-memory stand-in for the two things the automatic packet step looks at:
// the SeedPacket collection and which packets already have a desktop record.
// `world.calls` logs every lookup so tests can see exactly what was read.
let world;
function usePackets(packets, linked = []) {
  world = {
    packets: packets.map((p, i) => ({ _id: `p${String(i + 1).padStart(6, '0')}`, ...p })),
    linked: new Set(linked),
    calls: [],
  };
  SeedPacket.estimatedDocumentCount = async () => { world.calls.push('packetCount'); return world.packets.length; };
  SeedPacket.findOne = () => ({
    sort: () => ({ select: () => ({ lean: async () => {
      world.calls.push('newestPacket');
      const last = world.packets[world.packets.length - 1];
      return last ? { _id: last._id } : null;
    } }) }),
  });
  SeedPacket.find = (filter = {}) => {
    const after = filter._id ? filter._id.$gt : null;
    const call = { kind: 'packetScan', filter, limit: null, select: null, populate: null, sort: null };
    world.calls.push(call);
    const chain = {
      sort(arg) { call.sort = arg; return chain; },
      limit(arg) { call.limit = arg; return chain; },
      select(arg) { call.select = arg; return chain; },
      populate(...args) { call.populate = args; return chain; },
      lean: async () => world.packets.filter((p) => !after || p._id > after).slice(0, call.limit || undefined),
    };
    return chain;
  };
  // Lookups by packetUniqueId go to the stand-in; any other find is the
  // record listing, which individual tests override as before.
  world.listRecords = () => findChain([]);
  DesktopSeedRecord.find = (filter = {}) => {
    if (filter.packetUniqueId && filter.packetUniqueId.$in) {
      const asked = filter.packetUniqueId.$in;
      world.calls.push({ kind: 'linkedLookup', size: asked.length });
      return { select: () => ({ lean: async () => asked.filter((id) => world.linked.has(id)).map((id) => ({ packetUniqueId: id })) }) };
    }
    return world.listRecords(filter);
  };
  DesktopSeedRecord.insertMany = async (docs) => {
    writes.push(['insertMany', docs]);
    for (const doc of docs) world.linked.add(doc.packetUniqueId);
    return docs;
  };
  return world;
}
const scans = () => world.calls.filter((c) => c.kind === 'packetScan');
const inserted = () => writes.filter(([kind]) => kind === 'insertMany').flatMap(([, docs]) => docs);

// Every model method a route could reach. Each test overrides what it needs;
// `writes` records any call that would have changed the database.
let writes;
beforeEach(() => {
  writes = [];
  Admin.findById = async () => null;
  DesktopSeedRecord.find = () => findChain([]);
  DesktopSeedRecord.findOne = () => leanOne(null);
  DesktopSeedRecord.distinct = async () => [];
  DesktopSeedRecord.countDocuments = async () => 0;
  SeedPacket.countDocuments = async () => 0;
  DesktopSeedRecord.create = async (doc) => { writes.push(['create', doc]); return { ...doc, createdAt: new Date(), updatedAt: new Date() }; };
  DesktopSeedRecord.insertMany = async (docs) => { writes.push(['insertMany', docs]); return docs; };
  DesktopSeedRecord.findOneAndUpdate = (filter, update) => { writes.push(['update', filter, update]); return leanOne(null); };
  usePackets([]);
});

const ROUTES = [
  { name: 'GET /',                method: 'get',  path: '/',               write: false, req: {} },
  { name: 'GET /summary',         method: 'get',  path: '/summary',        write: false, req: {} },
  { name: 'POST /',               method: 'post', path: '/',               write: true,  req: { body: { recordId: UUID, fields: { crop: 'Maize' } } } },
  { name: 'PUT /:recordId',       method: 'put',  path: '/:recordId',      write: true,  req: { params: { recordId: UUID }, body: { baseVersion: 1, fields: { crop: 'Maize' } } } },
  { name: 'POST /import-packets', method: 'post', path: '/import-packets', write: true,  req: {} },
];

describe('desktop records — unauthenticated and non-Admin callers are rejected on every route', () => {
  for (const route of ROUTES) {
    it(`${route.name}: no token -> 401, no DB write`, async () => {
      const res = await call(route.method, route.path, route.req);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(writes, []);
    });

    it(`${route.name}: garbage token -> 401, no DB write`, async () => {
      const res = await call(route.method, route.path, { ...route.req, headers: { authorization: 'Bearer not-a-jwt' } });
      assert.equal(res.statusCode, 401);
      assert.deepEqual(writes, []);
    });

    it(`${route.name}: mobile User (operator) token -> 401, no DB write`, async () => {
      // A signed-up operator's id exists only in the User collection, so
      // the Admin lookup `protect` performs finds nothing.
      let lookedUp = null;
      Admin.findById = async (id) => { lookedUp = id; return null; };
      const res = await call(route.method, route.path, { ...route.req, headers: authHeaderFor('user-1', { type: 'user' }) });
      assert.equal(res.statusCode, 401);
      assert.equal(lookedUp, 'user-1');
      assert.deepEqual(writes, []);
    });

    it(`${route.name}: deactivated superadmin -> 401, no DB write`, async () => {
      Admin.findById = async () => ({ _id: 'sa-off', role: 'superadmin', isActive: false });
      const res = await call(route.method, route.path, { ...route.req, headers: authHeaderFor('sa-off') });
      assert.equal(res.statusCode, 401);
      assert.deepEqual(writes, []);
    });

    it(`${route.name}: token issued before a password change -> 401, no DB write`, async () => {
      Admin.findById = async () => ({ _id: 'sa-old', role: 'superadmin', isActive: true, passwordChangedAt: new Date() });
      const oldToken = signToken({ id: 'sa-old', iat: Math.floor(Date.now() / 1000) - 3600 });
      const res = await call(route.method, route.path, { ...route.req, headers: { authorization: `Bearer ${oldToken}` } });
      assert.equal(res.statusCode, 401);
      assert.deepEqual(writes, []);
    });

    it(`${route.name}: token issued before "sign out all devices" -> 401, no DB write`, async () => {
      Admin.findById = async () => ({ _id: 'sa-out', role: 'superadmin', isActive: true, sessionsInvalidatedAt: new Date() });
      const oldToken = signToken({ id: 'sa-out', iat: Math.floor(Date.now() / 1000) - 3600 });
      const res = await call(route.method, route.path, { ...route.req, headers: { authorization: `Bearer ${oldToken}` } });
      assert.equal(res.statusCode, 401);
      assert.deepEqual(writes, []);
    });
  }
});

describe('desktop records — role matrix for Admin-collection accounts', () => {
  for (const role of ['operator', 'admin']) {
    it(`Admin role "${role}" can read (GET / -> 200)`, async () => {
      Admin.findById = async () => ({ _id: `${role}-1`, role, isActive: true });
      world.listRecords = () => findChain([storedDoc()]);
      const res = await call('get', '/', { headers: authHeaderFor(`${role}-1`) });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.records.length, 1);
    });

    for (const route of ROUTES.filter((r) => r.write)) {
      it(`Admin role "${role}" cannot ${route.name} (403, no DB write)`, async () => {
        Admin.findById = async () => ({ _id: `${role}-1`, role, isActive: true });
        DesktopSeedRecord.findOne = () => leanOne(storedDoc());
        const res = await call(route.method, route.path, { ...route.req, headers: authHeaderFor(`${role}-1`) });
        assert.equal(res.statusCode, 403);
        assert.deepEqual(writes, []);
      });
    }
  }

  it('an unknown/undefined role is not treated as superadmin (403)', async () => {
    Admin.findById = async () => ({ _id: 'x-1', isActive: true });
    const res = await call('post', '/', { body: { recordId: UUID, fields: { crop: 'Maize' } }, headers: authHeaderFor('x-1') });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(writes, []);
  });

  it('a role claim inside the token is ignored — the database role decides (403)', async () => {
    Admin.findById = async () => ({ _id: 'adm-claim', role: 'admin', isActive: true });
    const res = await call('post', '/', {
      body: { recordId: UUID, fields: { crop: 'Maize' } },
      headers: authHeaderFor('adm-claim', { role: 'superadmin' }),
    });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(writes, []);
  });

  it('superadmin can read', async () => {
    Admin.findById = async () => ({ _id: 'sa-1', role: 'superadmin', isActive: true });
    const res = await call('get', '/', { headers: authHeaderFor('sa-1') });
    assert.equal(res.statusCode, 200);
  });
});

describe('desktop records — POST / (create)', () => {
  const asSuperadmin = (req) => ({ ...req, headers: authHeaderFor('sa-1') });
  beforeEach(() => { Admin.findById = async () => ({ _id: 'sa-1', role: 'superadmin', isActive: true }); });

  it('superadmin creates a record (201) stamped with version 1 and the caller as author', async () => {
    const res = await call('post', '/', asSuperadmin({ body: { recordId: UUID.toUpperCase(), fields: { crop: '  Maize ', yield1: 12.5, gene: null } } }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.created, true);
    const [, doc] = writes[0];
    assert.equal(doc.recordId, UUID); // normalized to lowercase
    assert.equal(doc.version, 1);
    assert.equal(doc.crop, 'Maize'); // trimmed
    assert.equal(doc.yield1, 12.5);
    assert.equal(doc.gene, '');
    assert.equal(doc.createdBy, 'sa-1');
    assert.equal(doc.updatedBy, 'sa-1');
    assert.equal(res.body.record._id, undefined);
    assert.equal(res.body.record.createdBy, undefined);
  });

  it('a repeated create with the same recordId returns the stored record (200, created:false) and inserts nothing new', async () => {
    let createCalls = 0;
    DesktopSeedRecord.create = async () => { createCalls += 1; const e = new Error('dup'); e.code = 11000; throw e; };
    DesktopSeedRecord.findOne = (filter) => { assert.deepEqual(filter, { recordId: UUID }); return leanOne(storedDoc({ version: 4, crop: 'Stored' })); };
    const res = await call('post', '/', asSuperadmin({ body: { recordId: UUID, fields: { crop: 'Retry' } } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.created, false);
    assert.equal(res.body.record.crop, 'Stored');
    assert.equal(res.body.record.version, 4);
    assert.equal(createCalls, 1);
  });

  const invalidBodies = [
    ['missing recordId',                 { fields: { crop: 'x' } }],
    ['non-UUID recordId',                { recordId: 'abc', fields: { crop: 'x' } }],
    ['reserved PKT- recordId',           { recordId: 'PKT-PRD-ABCD-001', fields: { crop: 'x' } }],
    ['recordId given as an object',      { recordId: { $ne: null }, fields: { crop: 'x' } }],
    ['missing fields',                   { recordId: UUID }],
    ['fields given as an array',         { recordId: UUID, fields: ['crop'] }],
    ['unknown field',                    { recordId: UUID, fields: { crop: 'x', isAdmin: true } }],
    ['control field in fields',          { recordId: UUID, fields: { crop: 'x', version: 99 } }],
    ['operator object as a text value',  { recordId: UUID, fields: { crop: { $ne: null } } }],
    ['number given as a string',         { recordId: UUID, fields: { yield1: '12' } }],
    ['non-finite number',                { recordId: UUID, fields: { weight: Infinity } }],
    ['text given as a number',           { recordId: UUID, fields: { crop: 5 } }],
    ['text longer than the limit',       { recordId: UUID, fields: { comments: 'x'.repeat(2001) } }],
    ['completely empty record',          { recordId: UUID, fields: { crop: '  ', year: null } }],
  ];
  for (const [label, body] of invalidBodies) {
    it(`rejects ${label} (400, no DB write)`, async () => {
      const res = await call('post', '/', asSuperadmin({ body }));
      assert.equal(res.statusCode, 400);
      assert.deepEqual(writes, []);
    });
  }

  it('an unexpected database error is a generic 500, never the raw error', async () => {
    DesktopSeedRecord.create = async () => { throw new Error('E-SECRET-DRIVER-DETAIL'); };
    const res = await call('post', '/', asSuperadmin({ body: { recordId: UUID, fields: { crop: 'x' } } }));
    assert.equal(res.statusCode, 500);
    assert.ok(!JSON.stringify(res.body).includes('E-SECRET-DRIVER-DETAIL'));
  });
});

describe('desktop records — PUT /:recordId (update with version check)', () => {
  const put = (body, recordId = UUID) => call('put', '/:recordId', { params: { recordId }, body, headers: authHeaderFor('sa-1') });
  beforeEach(() => { Admin.findById = async () => ({ _id: 'sa-1', role: 'superadmin', isActive: true }); });

  it('updates only when the stored version equals baseVersion, and increments it', async () => {
    DesktopSeedRecord.findOne = () => leanOne(storedDoc({ version: 3 }));
    DesktopSeedRecord.findOneAndUpdate = (filter, update, options) => {
      writes.push(['update', filter, update, options]);
      return leanOne(storedDoc({ version: 4, gene: 'Rf1' }));
    };
    const res = await put({ baseVersion: 3, fields: { gene: 'Rf1' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.record.version, 4);
    const [, filter, update] = writes[0];
    assert.deepEqual(filter, { recordId: UUID, version: 3 });
    assert.deepEqual(update.$inc, { version: 1 });
    assert.equal(update.$set.gene, 'Rf1');
    assert.equal(update.$set.updatedBy, 'sa-1');
    assert.equal(update.$set.version, undefined);
  });

  it('stale baseVersion -> 409 VERSION_CONFLICT with the current record, nothing written', async () => {
    DesktopSeedRecord.findOne = () => leanOne(storedDoc({ version: 5, crop: 'Theirs' }));
    const res = await put({ baseVersion: 3, fields: { crop: 'Mine' } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'VERSION_CONFLICT');
    assert.equal(res.body.record.version, 5);
    assert.equal(res.body.record.crop, 'Theirs');
    assert.deepEqual(writes, []);
  });

  it('losing a race between the check and the write is also a 409, not a silent overwrite', async () => {
    let reads = 0;
    DesktopSeedRecord.findOne = () => { reads += 1; return leanOne(storedDoc({ version: reads === 1 ? 3 : 4, crop: reads === 1 ? 'Old' : 'Theirs' })); };
    DesktopSeedRecord.findOneAndUpdate = () => leanOne(null);
    const res = await put({ baseVersion: 3, fields: { crop: 'Mine' } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.record.version, 4);
    assert.equal(res.body.record.crop, 'Theirs');
  });

  it('unknown recordId -> 404, nothing written', async () => {
    const res = await put({ baseVersion: 1, fields: { crop: 'x' } });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(writes, []);
  });

  for (const [label, body] of [
    ['missing baseVersion',      { fields: { crop: 'x' } }],
    ['non-integer baseVersion',  { baseVersion: '3', fields: { crop: 'x' } }],
    ['unknown field',            { baseVersion: 1, fields: { recordId: 'other' } }],
    ['operator object as value', { baseVersion: 1, fields: { crop: { $gt: '' } } }],
  ]) {
    it(`rejects ${label} (400, nothing written)`, async () => {
      DesktopSeedRecord.findOne = () => leanOne(storedDoc());
      const res = await put(body);
      assert.equal(res.statusCode, 400);
      assert.deepEqual(writes, []);
    });
  }

  it('refuses to blank out every column of a record (400)', async () => {
    DesktopSeedRecord.findOne = () => leanOne(storedDoc({ crop: 'Only', year: null }));
    const res = await put({ baseVersion: 1, fields: { crop: '' } });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(writes, []);
  });

  it('packet-linked record: the columns copied from its batch cannot be changed, other columns can', async () => {
    DesktopSeedRecord.findOne = () => leanOne(storedDoc({ recordId: 'PKT-PRD-ABCD-001', packetUniqueId: 'PRD-ABCD-001', warehouse: 'Warehouse A', rackShelf: 'R1-S2' }));
    DesktopSeedRecord.findOneAndUpdate = (filter, update) => { writes.push(['update', filter, update]); return leanOne(storedDoc({ version: 2 })); };
    const res = await put({ baseVersion: 1, fields: { crop: 'Hacked', year: 1999, warehouse: 'X', rackShelf: 'Y', gene: 'Rf1', weight: 4.2 } }, 'PKT-PRD-ABCD-001');
    assert.equal(res.statusCode, 200);
    const $set = writes[0][2].$set;
    for (const fixed of ['crop', 'year', 'warehouse', 'rackShelf']) assert.equal(fixed in $set, false, `${fixed} must not be writable`);
    assert.equal($set.gene, 'Rf1');
    assert.equal($set.weight, 4.2);
  });
});

const batch = { seedType: ' Soybean ', year: 2025, warehouse: 'Warehouse B', rack: 'R3', shelf: 'S1', batchName: 'JS-335 Lot', seedCode: 'SOYB' };
const packetsFixture = [
  { uniqueId: 'PRD-SOYB01-001', batchId: batch, difference: 1.25, afterWeight: 2.5, beforeWeight: 1.25, status: 'filled' },
  { uniqueId: 'PRD-SOYB01-002', batchId: batch, status: 'empty' },
  { uniqueId: 'PRD-ORPH01-001', batchId: null, status: 'empty' },
];

describe('desktop records — existing packets are made available automatically when records are listed', () => {
  const asRole = (role) => { Admin.findById = async () => ({ _id: `${role}-1`, role, isActive: true }); return authHeaderFor(`${role}-1`); };

  for (const role of ['operator', 'admin', 'superadmin']) {
    it(`a listing by Admin role "${role}" creates the missing packet records — no import step`, async () => {
      usePackets(packetsFixture);
      const res = await call('get', '/', { headers: asRole(role) });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(inserted().map((d) => d.recordId), ['PKT-PRD-SOYB01-001', 'PKT-PRD-SOYB01-002', 'PKT-PRD-ORPH01-001']);
      assert.deepEqual(inserted().map((d) => d.packetUniqueId), ['PRD-SOYB01-001', 'PRD-SOYB01-002', 'PRD-ORPH01-001']);
    });
  }

  it('the records come from the server\'s own data: nothing from the request is used, and no user is recorded as author', async () => {
    usePackets(packetsFixture);
    await call('get', '/', { headers: asRole('admin'), query: { limit: '5' }, body: { crop: 'Injected', recordId: 'PKT-EVIL' } });
    for (const doc of inserted()) {
      assert.equal(doc.createdBy, null);
      assert.equal(doc.updatedBy, null);
      assert.equal(doc.version, 1);
      assert.notEqual(doc.crop, 'Injected');
    }
    assert.equal(inserted().length, 3);
  });

  it('copies only Crop, Year, Wearhouse and Rack_shelf', async () => {
    usePackets(packetsFixture);
    await call('get', '/', { headers: asRole('admin') });
    const doc = inserted()[0];
    assert.equal(doc.crop, 'Soybean');
    assert.equal(doc.year, 2025);
    assert.equal(doc.warehouse, 'Warehouse B');
    assert.equal(doc.rackShelf, 'R3-S1');
    const dataKeys = Object.keys(doc).filter((k) => DesktopSeedRecord.DATA_FIELDS.some((f) => f.field === k));
    assert.deepEqual(dataKeys.sort(), ['crop', 'rackShelf', 'warehouse', 'year']);
  });

  it('leaves Weight, Name Of Variety and Varity_Code blank even when the packet/batch has values', async () => {
    usePackets(packetsFixture);
    await call('get', '/', { headers: asRole('admin') });
    for (const doc of inserted()) {
      assert.equal('weight' in doc, false);
      assert.equal('varietyName' in doc, false);
      assert.equal('varietyCode' in doc, false);
    }
    // ...and what the schema then stores for those omitted paths is blank.
    const hydrated = new DesktopSeedRecord(inserted()[0]);
    assert.equal(hydrated.weight, null);
    assert.equal(hydrated.varietyName, '');
    assert.equal(hydrated.varietyCode, '');
  });

  it('a packet whose batch is missing still gets a record, with blank derived columns', async () => {
    usePackets(packetsFixture);
    await call('get', '/', { headers: asRole('admin') });
    const orphan = inserted()[2];
    assert.equal(orphan.crop, '');
    assert.equal(orphan.year, null);
    assert.equal(orphan.warehouse, '');
    assert.equal(orphan.rackShelf, '');
  });

  it('packets and batches are only read: selected fields, in _id order, a bounded batch at a time', async () => {
    usePackets(packetsFixture);
    await call('get', '/', { headers: asRole('admin') });
    assert.equal(scans().length, 1);
    const scan = scans()[0];
    assert.deepEqual(scan.filter, {});
    assert.deepEqual(scan.sort, { _id: 1 });
    assert.equal(scan.limit, 1000);
    assert.equal(scan.select, 'uniqueId batchId');
    assert.deepEqual(scan.populate, ['batchId', 'seedType year warehouse rack shelf']);
  });

  it('the existing-packet step runs before the listing, so a first listing already contains them', async () => {
    usePackets(packetsFixture);
    const order = [];
    const realInsert = DesktopSeedRecord.insertMany;
    DesktopSeedRecord.insertMany = async (docs) => { order.push('insert'); return realInsert(docs); };
    world.listRecords = () => { order.push('list'); return findChain([]); };
    await call('get', '/', { headers: asRole('admin') });
    assert.deepEqual(order, ['insert', 'list']);
  });

  it('records that already exist are never touched — only missing ones are inserted', async () => {
    usePackets(packetsFixture, ['PRD-SOYB01-001', 'PRD-ORPH01-001']);
    await call('get', '/', { headers: asRole('admin') });
    assert.deepEqual(inserted().map((d) => d.recordId), ['PKT-PRD-SOYB01-002']);
    assert.equal(writes.filter(([kind]) => kind !== 'insertMany').length, 0, 'no update, no create, nothing else');
  });

  it('when every packet already has a record nothing is written at all', async () => {
    usePackets(packetsFixture, packetsFixture.map((p) => p.uniqueId));
    await call('get', '/', { headers: asRole('admin') });
    assert.deepEqual(writes, []);
  });

  it('repeated listings do not repeat the work: the packet collection is not scanned again while it is unchanged', async () => {
    usePackets(packetsFixture);
    Admin.findById = async () => ({ _id: 'admin-1', role: 'admin', isActive: true });
    const router = loadRoutes();
    const stack = fullStackFor(router, 'get', '/');
    for (let i = 0; i < 5; i += 1) {
      await runStack(stack, 0, makeReq({ headers: authHeaderFor('admin-1') }), mockRes());
    }
    assert.equal(scans().length, 1);
    assert.equal(writes.length, 1);
    assert.equal(inserted().length, 3);
  });

  it('a packet added later is picked up by the next listing — and only that packet is inserted', async () => {
    usePackets(packetsFixture);
    Admin.findById = async () => ({ _id: 'admin-1', role: 'admin', isActive: true });
    const router = loadRoutes();
    const stack = fullStackFor(router, 'get', '/');
    await runStack(stack, 0, makeReq({ headers: authHeaderFor('admin-1') }), mockRes());
    assert.equal(inserted().length, 3);

    world.packets.push({ _id: 'p000004', uniqueId: 'PRD-NEW01-001', batchId: batch });
    await runStack(stack, 0, makeReq({ headers: authHeaderFor('admin-1') }), mockRes());
    assert.equal(inserted().length, 4);
    assert.equal(inserted()[3].recordId, 'PKT-PRD-NEW01-001');
  });

  it('a continuation page (since + afterId) also checks, cheaply, for new packets', async () => {
    usePackets(packetsFixture);
    await call('get', '/', { headers: asRole('admin'), query: { since: '2026-01-02T00:00:00.000Z', afterId: '64b000000000000000000001' } });
    assert.equal(inserted().length, 3);
  });

  it('simultaneous first listings share one pass', async () => {
    usePackets(packetsFixture);
    Admin.findById = async () => ({ _id: 'admin-1', role: 'admin', isActive: true });
    const router = loadRoutes();
    const stack = fullStackFor(router, 'get', '/');
    const responses = Array.from({ length: 5 }, () => mockRes());
    await Promise.all(responses.map((res) => runStack(stack, 0, makeReq({ headers: authHeaderFor('admin-1') }), res)));
    for (const res of responses) assert.equal(res.statusCode, 200);
    assert.equal(scans().length, 1);
    assert.equal(inserted().length, 3);
  });

  it('a large collection is walked in batches of 1,000 — never loaded in one go', async () => {
    usePackets(Array.from({ length: 2500 }, (_, i) => ({ uniqueId: `PRD-BIG-${String(i + 1).padStart(5, '0')}`, batchId: batch })));
    const res = await call('get', '/', { headers: asRole('admin') });
    assert.equal(res.statusCode, 200);
    assert.equal(scans().length, 3);
    assert.deepEqual(scans().map((c) => c.limit), [1000, 1000, 1000]);
    assert.deepEqual(scans()[0].filter, {});
    assert.deepEqual(scans()[1].filter, { _id: { $gt: 'p001000' } });
    assert.deepEqual(scans()[2].filter, { _id: { $gt: 'p002000' } });
    assert.deepEqual(world.calls.filter((c) => c.kind === 'linkedLookup').map((c) => c.size), [1000, 1000, 500]);
    assert.deepEqual(writes.map(([, docs]) => docs.length), [1000, 1000, 500]);
    assert.equal(new Set(inserted().map((d) => d.recordId)).size, 2500);
  });

  it('duplicates created by another server at the same moment are not an error', async () => {
    usePackets(packetsFixture);
    DesktopSeedRecord.insertMany = async (docs, options) => {
      assert.deepEqual(options, { ordered: false });
      const err = new Error('bulk write');
      err.writeErrors = [{ code: 11000 }, { err: { code: 11000 } }];
      err.insertedDocs = [docs[2]];
      throw err;
    };
    const res = await call('get', '/', { headers: asRole('admin') });
    assert.equal(res.statusCode, 200);
  });

  it('if the packet step fails, the listing fails — an incomplete listing is never returned as complete', async () => {
    usePackets(packetsFixture);
    Admin.findById = async () => ({ _id: 'admin-1', role: 'admin', isActive: true });
    let failing = true;
    const realInsert = DesktopSeedRecord.insertMany;
    DesktopSeedRecord.insertMany = async (docs) => {
      if (failing) { const err = new Error('E-SECRET-DRIVER-DETAIL'); err.writeErrors = [{ code: 121 }]; throw err; }
      return realInsert(docs);
    };
    let listed = 0;
    world.listRecords = () => { listed += 1; return findChain([storedDoc()]); };
    const router = loadRoutes();
    const stack = fullStackFor(router, 'get', '/');

    const first = mockRes();
    await runStack(stack, 0, makeReq({ headers: authHeaderFor('admin-1') }), first);
    assert.equal(first.statusCode, 500);
    assert.equal(first.body.records, undefined);
    assert.ok(!JSON.stringify(first.body).includes('E-SECRET-DRIVER-DETAIL'));
    assert.equal(listed, 0);

    // The next request simply tries again.
    failing = false;
    const second = mockRes();
    await runStack(stack, 0, makeReq({ headers: authHeaderFor('admin-1') }), second);
    assert.equal(second.statusCode, 200);
    assert.equal(inserted().length, 3);
  });

  it('callers who may not list records cannot trigger it', async () => {
    usePackets(packetsFixture);
    await call('get', '/', { headers: {} });
    await call('get', '/', { headers: { authorization: 'Bearer not-a-jwt' } });
    Admin.findById = async () => null; // a mobile User token resolves to no Admin
    await call('get', '/', { headers: authHeaderFor('user-1', { type: 'user' }) });
    Admin.findById = async () => ({ _id: 'off', role: 'superadmin', isActive: false });
    await call('get', '/', { headers: authHeaderFor('off') });
    assert.deepEqual(world.calls, []);
    assert.deepEqual(writes, []);
  });

  it('a rejected query (400) does not trigger it either', async () => {
    usePackets(packetsFixture);
    const res = await call('get', '/', { headers: asRole('admin'), query: { since: 'yesterday' } });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(world.calls, []);
  });

  it('GET /summary only counts — it never creates records', async () => {
    usePackets(packetsFixture);
    await call('get', '/summary', { headers: asRole('admin') });
    assert.deepEqual(writes, []);
    assert.equal(scans().length, 0);
  });
});

describe('desktop records — POST /import-packets (the same pass, on demand)', () => {
  const run = () => call('post', '/import-packets', { headers: authHeaderFor('sa-1') });
  beforeEach(() => { Admin.findById = async () => ({ _id: 'sa-1', role: 'superadmin', isActive: true }); });

  it('creates one record per packet and reports the counts', async () => {
    usePackets(packetsFixture);
    const res = await run();
    assert.equal(res.statusCode, 200);
    assert.deepEqual({ ...res.body }, { success: true, totalPackets: 3, created: 3, skipped: 0 });
    assert.deepEqual(inserted().map((d) => d.recordId), ['PKT-PRD-SOYB01-001', 'PKT-PRD-SOYB01-002', 'PKT-PRD-ORPH01-001']);
    for (const doc of inserted()) assert.equal(doc.createdBy, 'sa-1');
  });

  it('running it again skips packets that already have a record', async () => {
    usePackets(packetsFixture, packetsFixture.map((p) => p.uniqueId));
    const res = await run();
    assert.equal(res.statusCode, 200);
    assert.deepEqual({ ...res.body }, { success: true, totalPackets: 3, created: 0, skipped: 3 });
    assert.deepEqual(writes, []);
  });

  it('duplicates from a concurrent import are counted as skipped, not as a failure', async () => {
    usePackets(packetsFixture);
    DesktopSeedRecord.insertMany = async (docs, options) => {
      assert.deepEqual(options, { ordered: false });
      const err = new Error('bulk write');
      err.writeErrors = [{ code: 11000 }, { err: { code: 11000 } }];
      err.insertedDocs = [docs[2]];
      throw err;
    };
    const res = await run();
    assert.equal(res.statusCode, 200);
    assert.deepEqual({ ...res.body }, { success: true, totalPackets: 3, created: 1, skipped: 2 });
  });

  it('any other bulk-write failure is a 500', async () => {
    usePackets(packetsFixture);
    DesktopSeedRecord.insertMany = async () => {
      const err = new Error('bulk write');
      err.writeErrors = [{ code: 11000 }, { code: 121 }];
      throw err;
    };
    const res = await run();
    assert.equal(res.statusCode, 500);
  });
});

describe('desktop records — GET / (keyset listing)', () => {
  const get = (query) => call('get', '/', { query, headers: authHeaderFor('adm-1') });
  beforeEach(() => { Admin.findById = async () => ({ _id: 'adm-1', role: 'admin', isActive: true }); });

  it('lists oldest-change-first and never exposes internal fields', async () => {
    const chain = findChain([storedDoc({ __v: 0, createdBy: 'sa-1', updatedBy: 'sa-1' })]);
    let filterSeen;
    world.listRecords = (filter) => { filterSeen = filter; return chain; };
    const res = await get({});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(filterSeen, {});
    assert.deepEqual(chain.calls.sort, { updatedAt: 1, _id: 1 });
    const record = res.body.records[0];
    for (const hidden of ['_id', '__v', 'createdBy', 'updatedBy']) assert.equal(hidden in record, false);
    assert.equal(record.recordId, UUID);
    assert.equal(record.version, 1);
    assert.equal(res.body.hasMore, false);
    assert.deepEqual(res.body.nextCursor, { since: '2026-01-02T00:00:00.000Z', afterId: '64b000000000000000000001' });
  });

  it('every record carries all 23 columns, blank where nothing is stored', async () => {
    world.listRecords = () => findChain([storedDoc()]);
    const res = await get({});
    const record = res.body.records[0];
    for (const { field, type } of DesktopSeedRecord.DATA_FIELDS) {
      assert.ok(field in record, `${field} missing`);
      if (field !== 'crop' && field !== 'year') assert.equal(record[field], type === 'number' ? null : '');
    }
  });

  it('returns one page plus hasMore when more records exist', async () => {
    const docs = [1, 2, 3].map((n) => storedDoc({ _id: `64b00000000000000000000${n}`, recordId: `r${n}` }));
    const chain = findChain(docs);
    world.listRecords = () => chain;
    const res = await get({ limit: '2' });
    assert.equal(chain.calls.limit, 3);
    assert.equal(res.body.records.length, 2);
    assert.equal(res.body.hasMore, true);
    assert.equal(res.body.nextCursor.afterId, '64b000000000000000000002');
  });

  it('since + afterId continue strictly after the cursor', async () => {
    let filterSeen;
    world.listRecords = (filter) => { filterSeen = filter; return findChain([]); };
    const res = await get({ since: '2026-01-02T00:00:00.000Z', afterId: '64b000000000000000000001' });
    assert.equal(res.statusCode, 200);
    assert.equal(filterSeen.$or.length, 2);
    assert.deepEqual(filterSeen.$or[0], { updatedAt: { $gt: new Date('2026-01-02T00:00:00.000Z') } });
    assert.equal(String(filterSeen.$or[1]._id.$gt), '64b000000000000000000001');
    assert.equal(res.body.nextCursor, null);
  });

  it('caps limit at 500', async () => {
    const chain = findChain([]);
    world.listRecords = () => chain;
    await get({ limit: '100000' });
    assert.equal(chain.calls.limit, 501);
  });

  for (const [label, query] of [
    ['a non-date since',          { since: 'yesterday' }],
    ['since given as an object',  { since: { $gt: '' } }],
    ['a malformed afterId',       { since: '2026-01-02T00:00:00.000Z', afterId: 'abc' }],
    ['afterId as an object',      { since: '2026-01-02T00:00:00.000Z', afterId: { $ne: '' } }],
    ['afterId without since',     { afterId: '64b000000000000000000001' }],
  ]) {
    it(`rejects ${label} (400)`, async () => {
      let queried = false;
      world.listRecords = () => { queried = true; return findChain([]); };
      const res = await get(query);
      assert.equal(res.statusCode, 400);
      assert.equal(queried, false);
    });
  }
});

describe('desktop records — GET /summary (counts only)', () => {
  const get = (role) => {
    Admin.findById = async () => ({ _id: `${role}-1`, role, isActive: true });
    return call('get', '/summary', { headers: authHeaderFor(`${role}-1`) });
  };

  for (const role of ['operator', 'admin', 'superadmin']) {
    it(`Admin role "${role}" can read the counts`, async () => {
      const res = await get(role);
      assert.equal(res.statusCode, 200);
      assert.deepEqual({ ...res.body }, { success: true, records: 0, packets: 0, packetsNotImported: 0 });
    });
  }

  it('reports how many existing packets have no desktop record yet', async () => {
    const filters = [];
    DesktopSeedRecord.countDocuments = async (filter) => { filters.push(filter); return Object.keys(filter).length ? 40 : 55; };
    SeedPacket.countDocuments = async (filter) => { assert.deepEqual(filter, {}); return 100; };
    const res = await get('admin');
    assert.deepEqual({ ...res.body }, { success: true, records: 55, packets: 100, packetsNotImported: 60 });
    assert.deepEqual(filters, [{}, { packetUniqueId: { $type: 'string' } }]);
  });

  it('never reports a negative number', async () => {
    DesktopSeedRecord.countDocuments = async () => 12;
    SeedPacket.countDocuments = async () => 10;
    const res = await get('admin');
    assert.equal(res.body.packetsNotImported, 0);
  });

  it('exposes counts only — no record or packet contents', async () => {
    world.listRecords = () => { throw new Error('summary must not list records'); };
    SeedPacket.find = () => { throw new Error('summary must not list packets'); };
    const res = await get('admin');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['packets', 'packetsNotImported', 'records', 'success']);
  });

  it('writes nothing', async () => {
    await get('superadmin');
    assert.deepEqual(writes, []);
  });

  it('a database failure is a generic 500', async () => {
    SeedPacket.countDocuments = async () => { throw new Error('E-SECRET-DRIVER-DETAIL'); };
    const res = await get('admin');
    assert.equal(res.statusCode, 500);
    assert.ok(!JSON.stringify(res.body).includes('E-SECRET-DRIVER-DETAIL'));
  });
});

describe('desktop records — rate limiting', () => {
  it('is keyed per Admin account and answers 429 in the project error shape', async () => {
    Admin.findById = async (id) => ({ _id: id, role: 'admin', isActive: true });
    const router = loadRoutes(); // one limiter instance for this whole test
    const stack = fullStackFor(router, 'get', '/');
    let last;
    for (let i = 0; i < 301; i += 1) {
      last = mockRes();
      await runStack(stack, 0, makeReq({ headers: authHeaderFor('busy-admin') }), last);
    }
    assert.equal(last.statusCode, 429);
    assert.equal(last.body.code, 'RATE_LIMITED');

    const other = mockRes();
    await runStack(stack, 0, makeReq({ headers: authHeaderFor('quiet-admin') }), other);
    assert.equal(other.statusCode, 200);
  });
});

describe('desktop records — the 23-column contract', () => {
  const EXPECTED_HEADERS = [
    'Crop', 'Previous Year', 'Year', 'Year_code', 'PreviousYear_code', 'FarmLocation_code',
    'Female_code', 'Male_code', 'Spt Score', 'Disease score', 'Yield 1', 'Yield 2', 'Total',
    'Name Of Variety', 'Varity_Code', 'PreviousLocation_code', 'Wearhouse', 'Rack_shelf',
    'Location code', 'Gene', 'Weight', 'Comments', 'Final report',
  ];

  it('exactly the 23 approved headers, in the approved order', () => {
    assert.deepEqual(DesktopSeedRecord.DATA_FIELDS.map((f) => f.header), EXPECTED_HEADERS);
    assert.equal(DesktopSeedRecord.DATA_FIELDS.length, 23);
  });

  it('every column is a real schema path of the matching type, with no duplicates', () => {
    const fields = DesktopSeedRecord.DATA_FIELDS.map((f) => f.field);
    assert.deepEqual(fields, [...new Set(fields)]);
    for (const { field, type } of DesktopSeedRecord.DATA_FIELDS) {
      const schemaPath = DesktopSeedRecord.schema.path(field);
      assert.ok(schemaPath, `${field} is not in the schema`);
      assert.equal(schemaPath.instance, type === 'number' ? 'Number' : 'String');
    }
  });

  it('the unconfirmed mappings are not among the packet-derived columns', () => {
    assert.deepEqual(DesktopSeedRecord.PACKET_DERIVED_FIELDS, ['crop', 'year', 'warehouse', 'rackShelf']);
    for (const blank of ['weight', 'varietyName', 'varietyCode']) {
      assert.equal(DesktopSeedRecord.PACKET_DERIVED_FIELDS.includes(blank), false);
    }
  });
});

describe('desktop records — indexes', () => {
  const indexes = DesktopSeedRecord.schema.indexes();

  it('recordId is unique', () => {
    assert.equal(DesktopSeedRecord.schema.path('recordId').options.unique, true);
  });

  it('packetUniqueId is unique only where it is set', () => {
    const entry = indexes.find(([k]) => JSON.stringify(k) === JSON.stringify({ packetUniqueId: 1 }));
    assert.ok(entry, 'index missing');
    assert.equal(entry[1].unique, true);
    assert.deepEqual(entry[1].partialFilterExpression, { packetUniqueId: { $type: 'string' } });
  });

  it('the listing order is indexed', () => {
    assert.ok(indexes.some(([k]) => JSON.stringify(k) === JSON.stringify({ updatedAt: 1, _id: 1 })));
  });

  it('no duplicate index definitions', () => {
    const specs = indexes.map(([k]) => JSON.stringify(k));
    assert.deepEqual(specs, [...new Set(specs)]);
  });
});

describe('desktop records — additive wiring', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  // Code only — whole-line comments are dropped so prose that merely
  // mentions a name can't satisfy (or trip) a check below.
  const readCode = (rel) => read(rel).split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

  it('the router relies on the existing protect/allowRoles middleware, unmodified imports', () => {
    const src = readCode('routes/desktopRecordRoutes.js');
    assert.match(src, /require\('\.\.\/middleware\/authMiddleware'\)/);
    assert.match(src, /require\('\.\.\/middleware\/roleMiddleware'\)/);
    assert.match(src, /router\.use\(protect\);/);
    assert.ok(!src.includes('protectAdminOrUser'), 'User tokens must never be accepted here');
    assert.ok(!src.includes('protectUser'), 'User tokens must never be accepted here');
  });

  it('every write route is restricted to superadmin', () => {
    const router = loadRoutes();
    const writeLayers = router.stack.filter((l) => l.route && !l.route.methods.get);
    assert.equal(writeLayers.length, 3);
    const src = readCode('routes/desktopRecordRoutes.js');
    assert.equal((src.match(/allowRoles\('superadmin'\)/g) || []).length, 3);
    assert.equal((src.match(/allowRoles\(/g) || []).length, 3);
  });

  it('there is no delete route', () => {
    const router = loadRoutes();
    assert.equal(router.stack.some((l) => l.route && l.route.methods.delete), false);
  });

  it('the router never writes to an existing collection', () => {
    const src = readCode('routes/desktopRecordRoutes.js');
    assert.ok(!/SeedPacket\.(create|insertMany|update\w*|findOneAnd\w*|findByIdAnd\w*|delete\w*|bulkWrite|save)\b/.test(src));
    assert.ok(!/SeedBatch|WeightSession|Product\b|Machine\b|WeightRecord/.test(src));
  });

  it('server.js mounts the router at /api/desktop-records', () => {
    assert.ok(read('server.js').includes("app.use('/api/desktop-records', require('./routes/desktopRecordRoutes'));"));
  });
});
