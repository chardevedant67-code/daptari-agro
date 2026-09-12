// B-4 — Batch route role authorization.
require('./setup');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockRes, authHeaderFor, fullStackFor, runStack, freshRequireCache } = require('./helpers');

const Admin = require('../models/Admin');
const SeedBatch = require('../models/SeedBatch');
const SeedPacket = require('../models/SeedPacket');
const qrStorage = require('../utils/qrStorage');

// batchRoutes.js destructures { uploadQrPng } from qrStorage at require
// time — the mock must be installed before the FIRST require of
// batchRoutes.js in this process (an indirection wrapper sidesteps needing
// to track that precisely for every test in this file).
let currentUploadImpl = async () => 'fake-file-id';
qrStorage.uploadQrPng = (...args) => currentUploadImpl(...args);

function loadBatchRoutes() {
  freshRequireCache('../routes/batchRoutes');
  return require('../routes/batchRoutes');
}

describe('B-4 batch creation — unauthenticated', () => {
  it('rejects with no token (401), no DB write', async () => {
    let dbCalled = false;
    SeedBatch.create = async () => { dbCalled = true; };
    const router = loadBatchRoutes();
    const stack = fullStackFor(router, 'post', '/');
    const res = mockRes();
    await runStack(stack, 0, { body: { seedCode: 'AB', batchCode: 'CD', count: 1 }, headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(dbCalled, false);
  });
});

describe('B-4 batch creation — role authorization', () => {
  it('rejects Admin role "operator" (403), no DB write', async () => {
    Admin.findById = async () => ({ _id: 'op1', role: 'operator', isActive: true });
    let dbCalled = false;
    SeedBatch.create = async () => { dbCalled = true; };
    const router = loadBatchRoutes();
    const stack = fullStackFor(router, 'post', '/');
    const res = mockRes();
    await runStack(stack, 0, { body: { seedCode: 'AB', batchCode: 'CD', count: 1 }, headers: authHeaderFor('op1') }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(dbCalled, false);
  });

  it('allows Admin role "admin" — succeeds, DB reached', async () => {
    Admin.findById = async () => ({ _id: 'adm1', role: 'admin', isActive: true });
    SeedBatch.create = async (doc) => ({ ...doc, _id: 'batch1', save: async () => {} });
    SeedPacket.insertMany = async (packets) => packets.map((p, i) => ({ ...p, _id: `pkt${i}` }));
    currentUploadImpl = async () => 'fileId1';
    const router = loadBatchRoutes();
    const stack = fullStackFor(router, 'post', '/');
    const res = mockRes();
    await runStack(stack, 0, { body: { seedCode: 'AB', batchCode: 'CD', count: 1 }, headers: authHeaderFor('adm1') }, res);
    assert.equal(res.statusCode, 201);
  });

  it('allows Admin role "superadmin" — succeeds', async () => {
    Admin.findById = async () => ({ _id: 'sa1', role: 'superadmin', isActive: true });
    SeedBatch.create = async (doc) => ({ ...doc, _id: 'batch2', save: async () => {} });
    SeedPacket.insertMany = async (packets) => packets.map((p, i) => ({ ...p, _id: `pkt${i}` }));
    currentUploadImpl = async () => 'fileId2';
    const router = loadBatchRoutes();
    const stack = fullStackFor(router, 'post', '/');
    const res = mockRes();
    await runStack(stack, 0, { body: { seedCode: 'AB', batchCode: 'CD', count: 1 }, headers: authHeaderFor('sa1') }, res);
    assert.equal(res.statusCode, 201);
  });
});

describe('B-4 read routes remain unrestricted by role (design decision, confirmed with user)', () => {
  it('GET / and sibling GET routes have no allowRoles layer (stack length stayed 2: protect+handler)', () => {
    const router = loadBatchRoutes();
    for (const p of ['/', '/inventory', '/:id/qr-list', '/:id']) {
      const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods.get);
      assert.equal(layer.route.stack.length, 2, `GET ${p} should be exactly [protect, handler]`);
    }
  });
});
