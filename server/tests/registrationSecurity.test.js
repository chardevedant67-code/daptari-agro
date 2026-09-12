// B-1 — Mobile registration input validation / NoSQL injection protection.
require('./setup');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockRes } = require('./helpers');

const User = require('../models/User');
const { register } = require('../controllers/userAuthController');

function withMockedDb(findOneResult, createImpl) {
  let dbCalled = false;
  User.findOne = async () => { dbCalled = true; return findOneResult; };
  User.create = createImpl || (async () => { dbCalled = true; });
  return () => dbCalled;
}

describe('B-1 registration security — NoSQL injection protection', () => {
  it('accepts valid registration input and reaches the DB layer', async () => {
    const getCalled = withMockedDb(null, async (doc) => ({ _id: 'u2', name: doc.name, email: doc.email, role: 'operator' }));
    const req = { body: { name: 'John', email: '  John@Example.com  ', password: 'secret123' } };
    const res = mockRes();
    await register(req, res);
    assert.equal(res.statusCode, 201);
    assert.equal(getCalled(), true);
  });

  it('rejects missing email (400, no DB call)', async () => {
    const getCalled = withMockedDb();
    const res = mockRes();
    await register({ body: { name: 'John', password: 'secret123' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), false);
  });

  it('rejects non-string email (number) (400, no DB call)', async () => {
    const getCalled = withMockedDb();
    const res = mockRes();
    await register({ body: { name: 'John', email: 12345, password: 'secret123' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), false);
  });

  it('rejects email as a $regex NoSQL operator object (400, no DB call)', async () => {
    const getCalled = withMockedDb();
    const res = mockRes();
    await register({ body: { name: 'John', email: { $regex: 'a' }, password: 'secret123' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), false);
  });

  it('rejects email as a $ne NoSQL operator object (400, no DB call)', async () => {
    const getCalled = withMockedDb();
    const res = mockRes();
    await register({ body: { name: 'John', email: { $ne: null }, password: 'secret123' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), false);
  });

  it('rejects email as an array (400, no DB call)', async () => {
    const getCalled = withMockedDb();
    const res = mockRes();
    await register({ body: { name: 'John', email: ['test@example.com'], password: 'secret123' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), false);
  });

  it('rejects email as a nested object (400, no DB call)', async () => {
    const getCalled = withMockedDb();
    const res = mockRes();
    await register({ body: { name: 'John', email: { nested: 'value' }, password: 'secret123' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), false);
  });

  it('rejects password as a $ne NoSQL operator object (400, no DB call)', async () => {
    const getCalled = withMockedDb();
    const res = mockRes();
    await register({ body: { name: 'John', email: 'john@example.com', password: { $ne: null } } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), false);
  });

  it('rejects password as an array (400, no DB call)', async () => {
    const getCalled = withMockedDb();
    const res = mockRes();
    await register({ body: { name: 'John', email: 'john@example.com', password: ['password'] } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), false);
  });

  it('rejects invalid email format (400, no DB call)', async () => {
    const getCalled = withMockedDb();
    const res = mockRes();
    await register({ body: { name: 'John', email: 'not-an-email', password: 'secret123' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), false);
  });

  it('rejects null email (400, no DB call)', async () => {
    const getCalled = withMockedDb();
    const res = mockRes();
    await register({ body: { name: 'John', email: null, password: 'secret123' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), false);
  });

  it('rejects a too-short password (400, no DB call)', async () => {
    const getCalled = withMockedDb();
    const res = mockRes();
    await register({ body: { name: 'John', email: 'john@example.com', password: 'abc' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), false);
  });

  it('rejects a duplicate email with the exact curated message (DB reached, no leak)', async () => {
    const getCalled = withMockedDb({ _id: 'existing' });
    const res = mockRes();
    await register({ body: { name: 'Jane', email: 'jane@example.com', password: 'secret123' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(getCalled(), true);
    assert.equal(res.body.message, 'Email already registered');
  });
});
