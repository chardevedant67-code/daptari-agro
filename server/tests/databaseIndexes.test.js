// B-7 — Required schema indexes remain declared. Pure schema inspection,
// no database connection involved (schema.indexes() reflects exactly what
// would be sent to MongoDB's createIndexes at connection time).
require('./setup');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const SeedPacket = require('../models/SeedPacket');
const WeightSession = require('../models/WeightSession');
const User = require('../models/User');
const Admin = require('../models/Admin');
const Product = require('../models/Product');
const Machine = require('../models/Machine');

function hasIndex(Model, keys) {
  return Model.schema.indexes().some(([k]) => JSON.stringify(k) === JSON.stringify(keys));
}

describe('B-7 required indexes present', () => {
  it('SeedPacket has index({batchId: 1})', () => {
    assert.ok(hasIndex(SeedPacket, { batchId: 1 }));
  });

  it('WeightSession has index({status: 1, createdAt: -1})', () => {
    assert.ok(hasIndex(WeightSession, { status: 1, createdAt: -1 }));
  });
});

describe('B-7 no duplicate index definitions', () => {
  it('SeedPacket', () => {
    const specs = SeedPacket.schema.indexes().map(([k]) => JSON.stringify(k));
    assert.deepEqual(specs, [...new Set(specs)]);
  });
  it('WeightSession', () => {
    const specs = WeightSession.schema.indexes().map(([k]) => JSON.stringify(k));
    assert.deepEqual(specs, [...new Set(specs)]);
  });
});

describe('B-7 existing unique indexes preserved', () => {
  it('WeightSession partial unique index on packetUniqueId is intact', () => {
    const entry = WeightSession.schema.indexes().find(([k]) => JSON.stringify(k) === JSON.stringify({ packetUniqueId: 1 }));
    assert.ok(entry, 'index missing entirely');
    const [, opts] = entry;
    assert.equal(opts.unique, true);
    assert.deepEqual(opts.partialFilterExpression, { status: 'active', packetUniqueId: { $type: 'string' } });
  });

  it('SeedPacket.uniqueId is unique:true', () => {
    assert.equal(SeedPacket.schema.path('uniqueId').options.unique, true);
  });
  it('User.email is unique:true', () => {
    assert.equal(User.schema.path('email').options.unique, true);
  });
  it('Admin.email is unique:true', () => {
    assert.equal(Admin.schema.path('email').options.unique, true);
  });
  it('Product.productId is unique:true (unrelated model, confirmed untouched)', () => {
    assert.equal(Product.schema.path('productId').options.unique, true);
  });
  it('Machine.machineId is unique:true (unrelated model, confirmed untouched)', () => {
    assert.equal(Machine.schema.path('machineId').options.unique, true);
  });
});
