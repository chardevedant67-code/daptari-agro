// B-8 — Legacy WeightRecord (recordRoutes.js) authorization.
require('./setup');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockRes, authHeaderFor, fullStackFor, runStack, freshRequireCache } = require('./helpers');

const Admin = require('../models/Admin');
const WeightRecord = require('../models/WeightRecord');

function loadRecordRoutes() {
  freshRequireCache('../routes/recordRoutes');
  return require('../routes/recordRoutes');
}

describe('B-8 unauthenticated', () => {
  it('POST / with no token -> 401, no DB write', async () => {
    let dbCalled = false;
    WeightRecord.create = async () => { dbCalled = true; };
    const router = loadRecordRoutes();
    const stack = fullStackFor(router, 'post', '/');
    const res = mockRes();
    await runStack(stack, 0, { headers: {}, body: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(dbCalled, false);
  });
});

describe('B-8 POST role restriction (superadmin/admin)', () => {
  it('rejects Admin role "operator" (403), no DB write', async () => {
    Admin.findById = async () => ({ _id: 'op1', role: 'operator', isActive: true });
    let dbCalled = false;
    WeightRecord.create = async () => { dbCalled = true; };
    const router = loadRecordRoutes();
    const stack = fullStackFor(router, 'post', '/');
    const res = mockRes();
    await runStack(stack, 0, { headers: authHeaderFor('op1'), body: {} }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(dbCalled, false);
  });

  it('allows Admin role "admin" — succeeds, DB reached', async () => {
    Admin.findById = async () => ({ _id: 'adm2', role: 'admin', isActive: true });
    let dbCalled = false;
    WeightRecord.create = async (doc) => { dbCalled = true; return { ...doc, _id: 'rec1', populate: async function () { return this; } }; };
    const router = loadRecordRoutes();
    const stack = fullStackFor(router, 'post', '/');
    const res = mockRes();
    await runStack(stack, 0, { headers: authHeaderFor('adm2'), body: { productId: 'p1', machineId: 'm1', actualWeight: 5, nominalWeight: 5 } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(dbCalled, true);
  });
});

describe('B-8 DELETE superadmin restriction', () => {
  it('rejects Admin role "admin" (not superadmin) (403), no DB delete', async () => {
    Admin.findById = async () => ({ _id: 'adm1', role: 'admin', isActive: true });
    let dbCalled = false;
    WeightRecord.findByIdAndDelete = async () => { dbCalled = true; };
    const router = loadRecordRoutes();
    const stack = fullStackFor(router, 'delete', '/:id');
    const res = mockRes();
    await runStack(stack, 0, { headers: authHeaderFor('adm1'), params: { id: 'rec1' } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(dbCalled, false);
  });

  it('allows Admin role "superadmin" — succeeds', async () => {
    Admin.findById = async () => ({ _id: 'sa1', role: 'superadmin', isActive: true });
    let dbCalled = false;
    WeightRecord.findByIdAndDelete = async () => { dbCalled = true; };
    const router = loadRecordRoutes();
    const stack = fullStackFor(router, 'delete', '/:id');
    const res = mockRes();
    await runStack(stack, 0, { headers: authHeaderFor('sa1'), params: { id: 'rec1' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(dbCalled, true);
  });
});

describe('B-8 GET remains open to any authenticated Admin (design decision)', () => {
  it('Admin role "operator" can still read', async () => {
    Admin.findById = async () => ({ _id: 'op2', role: 'operator', isActive: true });
    WeightRecord.find = () => ({ populate: () => ({ populate: () => ({ populate: () => ({ sort: () => ({ skip: () => ({ limit: async () => [] }) }) }) }) }) });
    WeightRecord.countDocuments = async () => 0;
    const router = loadRecordRoutes();
    const stack = fullStackFor(router, 'get', '/');
    const res = mockRes();
    await runStack(stack, 0, { headers: authHeaderFor('op2'), query: {} }, res);
    assert.equal(res.statusCode, 200);
  });
});
