// B-3 — WeightSession ownership, active-session gating, linked-session
// mutation rejection, atomic cancel/link protection.
require('./setup');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockRes, freshRequireCache } = require('./helpers');

const WeightSession = require('../models/WeightSession');
const SeedPacket = require('../models/SeedPacket');

const OWNER = 'user-owner-1';
const OTHER = 'user-other-2';

function loadSessionRoutes() {
  freshRequireCache('../routes/sessionRoutes');
  return require('../routes/sessionRoutes');
}
function handlerFor(router, method, routePath) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('B-3 active session mutation succeeds when authorized', () => {
  it('before-weight succeeds on an active, owned session', async () => {
    WeightSession.findById = async () => ({ _id: 's1', status: 'active', operator: OWNER, beforeWeight: null });
    WeightSession.findOneAndUpdate = async (filter, update) => ({ _id: 's1', beforeWeight: update.$set.beforeWeight, beforeTime: update.$set.beforeTime });
    const router = loadSessionRoutes();
    const handler = handlerFor(router, 'post', '/:id/before-weight');
    const req = { params: { id: 's1' }, body: { weight: 5.5 }, user: { _id: OWNER } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.beforeWeight, 5.5);
  });
});

describe('B-3 linked-session mutation rejection (the core fix)', () => {
  it('before-weight on a linked session is rejected and leaves it unchanged', async () => {
    const doc = { _id: 's2', status: 'linked', operator: OWNER, beforeWeight: 1.23 };
    WeightSession.findById = async () => ({ ...doc });
    WeightSession.findOneAndUpdate = async () => null; // filter requires status:'active' -> no match
    const router = loadSessionRoutes();
    const handler = handlerFor(router, 'post', '/:id/before-weight');
    const req = { params: { id: 's2' }, body: { weight: 99 }, user: { _id: OWNER } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'SESSION_NOT_ACTIVE');
  });

  it('after-weight on a linked session is rejected', async () => {
    WeightSession.findById = async () => ({ _id: 's2b', status: 'linked', operator: OWNER, afterWeight: 9.9 });
    WeightSession.findOneAndUpdate = async () => null;
    const router = loadSessionRoutes();
    const handler = handlerFor(router, 'post', '/:id/after-weight');
    const req = { params: { id: 's2b' }, body: { weight: 1 }, user: { _id: OWNER } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'SESSION_NOT_ACTIVE');
  });
});

describe('B-3 cancel protection', () => {
  it('cancel on an already-cancelled session is an idempotent 200', async () => {
    WeightSession.findOneAndUpdate = async () => null; // not 'active' -> no atomic match
    WeightSession.findById = async () => ({ _id: 's4', status: 'cancelled', operator: OWNER });
    const router = loadSessionRoutes();
    const handler = handlerFor(router, 'post', '/:id/cancel');
    const req = { params: { id: 's4' }, body: {}, user: { _id: OWNER } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.code, 'SESSION_ALREADY_CANCELLED');
  });

  it('cancel on a linked session is rejected (cannot un-link via cancel)', async () => {
    WeightSession.findOneAndUpdate = async () => null;
    WeightSession.findById = async () => ({ _id: 's4b', status: 'linked', operator: OWNER });
    const router = loadSessionRoutes();
    const handler = handlerFor(router, 'post', '/:id/cancel');
    const req = { params: { id: 's4b' }, body: {}, user: { _id: OWNER } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'SESSION_ALREADY_LINKED');
  });

  it('cancel on an active session succeeds', async () => {
    WeightSession.findOneAndUpdate = async (filter, update) => ({ _id: 's4c', status: update.$set.status });
    const router = loadSessionRoutes();
    const handler = handlerFor(router, 'post', '/:id/cancel');
    const req = { params: { id: 's4c' }, body: {}, user: { _id: OWNER } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.session.status, 'cancelled');
  });
});

describe('B-3 ownership protection', () => {
  it('a different user cannot mutate another operator\'s active session', async () => {
    WeightSession.findById = async () => ({ _id: 's5', status: 'active', operator: OWNER, beforeWeight: null });
    const router = loadSessionRoutes();
    const handler = handlerFor(router, 'post', '/:id/before-weight');
    const req = { params: { id: 's5' }, body: { weight: 5 }, user: { _id: OTHER } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'SESSION_FORBIDDEN');
  });
});

describe('B-3 link protection (atomic claim)', () => {
  it('an active, unlinked session links successfully', async () => {
    WeightSession.findOneAndUpdate = async (filter, update) => ({ _id: 's6', operator: OWNER, ...update.$set });
    WeightSession.updateOne = async () => ({});
    SeedPacket.findOne = async () => ({ _id: 'pkt1', status: 'empty', save: async () => {} });
    SeedPacket.findById = () => ({ populate: () => ({ populate: async () => ({ uniqueId: 'PRD-1' }) }) });
    const router = loadSessionRoutes();
    const handler = handlerFor(router, 'post', '/:id/link/:uniqueId');
    const req = { params: { id: 's6', uniqueId: 'PRD-1' }, user: { _id: OWNER } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
  });

  it('an already-linked session cannot be linked again', async () => {
    WeightSession.findOneAndUpdate = async () => null;
    WeightSession.findById = async () => ({ _id: 's7', status: 'linked', operator: OWNER, packetUniqueId: 'PRD-1' });
    SeedPacket.findOne = async () => ({ _id: 'pkt1', status: 'empty' });
    const router = loadSessionRoutes();
    const handler = handlerFor(router, 'post', '/:id/link/:uniqueId');
    const req = { params: { id: 's7', uniqueId: 'PRD-1' }, user: { _id: OWNER } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Session already linked');
  });

  it('an active session already tied to a different packet is rejected (PACKET_MISMATCH)', async () => {
    WeightSession.findOneAndUpdate = async () => null;
    WeightSession.findById = async () => ({ _id: 's9', status: 'active', operator: OWNER, packetUniqueId: 'PRD-1' });
    SeedPacket.findOne = async () => ({ _id: 'pkt2', status: 'empty' });
    const router = loadSessionRoutes();
    const handler = handlerFor(router, 'post', '/:id/link/:uniqueId');
    const req = { params: { id: 's9', uniqueId: 'PRD-2' }, user: { _id: OWNER } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'PACKET_MISMATCH');
  });
});

describe('B-3 atomic filter — static verification', () => {
  it('all four mutation routes gate their write on status:\'active\'', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../routes/sessionRoutes'), 'utf8');
    for (const marker of ['/:id/photo', '/:id/before-weight', '/:id/after-weight', '/:id/cancel']) {
      const idx = src.indexOf(`router.post('${marker}'`);
      assert.ok(idx !== -1, `route ${marker} not found`);
      const nextIdx = src.indexOf("router.post('", idx + 1);
      const block = src.slice(idx, nextIdx === -1 ? src.length : nextIdx);
      assert.ok(block.includes("status: 'active'"), `route ${marker} missing status:'active' guard`);
    }
  });
});
