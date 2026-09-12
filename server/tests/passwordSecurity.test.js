// B-2 — passwordChangedAt / JWT invalidation.
require('./setup');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { mockRes } = require('./helpers');

const User = require('../models/User');
const Admin = require('../models/Admin');
const { protectUser } = require('../middleware/userAuthMiddleware');
const { protectAdminOrUser } = require('../middleware/authMiddleware');
const { changePassword } = require('../controllers/adminController');
const { setUserPassword } = require('../controllers/userAdminController');

function sign(payload, opts) { return jwt.sign(payload, process.env.JWT_SECRET, opts); }

describe('B-2 passwordChangedAt — schema', () => {
  it('User schema declares passwordChangedAt as a Date field', () => {
    const path = User.schema.path('passwordChangedAt');
    assert.ok(path, 'field must exist');
    assert.equal(path.instance, 'Date');
  });
});

describe('B-2 JWT invalidation — protectUser', () => {
  it('accepts a fresh token when passwordChangedAt is unset', async () => {
    User.findById = async () => ({ _id: 'u1', isActive: true, passwordChangedAt: undefined });
    const req = { headers: { authorization: `Bearer ${sign({ id: 'u1' })}` } };
    const res = mockRes();
    let nextCalled = false;
    await protectUser(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  it('rejects a token issued before passwordChangedAt', async () => {
    const changedAt = new Date();
    const oldIat = Math.floor(changedAt.getTime() / 1000) - 3600;
    User.findById = async () => ({ _id: 'u1', isActive: true, passwordChangedAt: changedAt });
    const req = { headers: { authorization: `Bearer ${sign({ id: 'u1', iat: oldIat })}` } };
    const res = mockRes();
    let nextCalled = false;
    await protectUser(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, 'Session expired — please log in again');
  });

  it('accepts a token issued after passwordChangedAt', async () => {
    const changedAt = new Date(Date.now() - 3600 * 1000);
    const freshIat = Math.floor(Date.now() / 1000);
    User.findById = async () => ({ _id: 'u1', isActive: true, passwordChangedAt: changedAt });
    const req = { headers: { authorization: `Bearer ${sign({ id: 'u1', iat: freshIat })}` } };
    const res = mockRes();
    let nextCalled = false;
    await protectUser(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });
});

describe('B-2 JWT invalidation — protectAdminOrUser (User branch, second verification path)', () => {
  it('rejects an old token', async () => {
    const changedAt = new Date();
    const oldIat = Math.floor(changedAt.getTime() / 1000) - 3600;
    User.findById = async () => ({ _id: 'u1', isActive: true, passwordChangedAt: changedAt });
    const req = { headers: { authorization: `Bearer ${sign({ id: 'u1', type: 'user', iat: oldIat })}` } };
    const res = mockRes();
    let nextCalled = false;
    await protectAdminOrUser(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  it('accepts a fresh token', async () => {
    const changedAt = new Date(Date.now() - 3600 * 1000);
    const freshIat = Math.floor(Date.now() / 1000);
    User.findById = async () => ({ _id: 'u1', isActive: true, passwordChangedAt: changedAt });
    const req = { headers: { authorization: `Bearer ${sign({ id: 'u1', type: 'user', iat: freshIat })}` } };
    const res = mockRes();
    let nextCalled = false;
    await protectAdminOrUser(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });
});

describe('B-2 password mutation sets passwordChangedAt', () => {
  it('Admin self-service changePassword sets passwordChangedAt', async () => {
    const adminDoc = {
      _id: 'a1', password: 'oldHash',
      matchPassword: async () => true,
      save: async function () { this._saved = true; },
    };
    Admin.findById = () => ({ select: async () => adminDoc });
    const req = { admin: { _id: 'a1' }, body: { currentPassword: 'old', newPassword: 'newpass123' } };
    const res = mockRes();
    await changePassword(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(adminDoc.passwordChangedAt instanceof Date);
    assert.ok(Date.now() - adminDoc.passwordChangedAt.getTime() < 5000);
  });

  it('superadmin-driven setUserPassword sets passwordChangedAt', async () => {
    const userDoc = { _id: 'u1', save: async function () { this._saved = true; } };
    User.findById = async () => userDoc;
    const req = { params: { id: 'u1' }, body: { password: 'newpass123' } };
    const res = mockRes();
    await setUserPassword(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(userDoc.passwordChangedAt instanceof Date);
    assert.equal(userDoc.password, 'newpass123');
  });

  it('pre-existing Admin forgot/reset-password flow still sets passwordChangedAt (untouched by B-2)', async () => {
    const { resetPassword } = require('../controllers/passwordResetController');
    const adminDoc = { save: async function () { this._saved = true; } };
    Admin.findOne = async () => adminDoc;
    const req = { body: { token: 'sometoken', password: 'newpass123' } };
    const res = mockRes();
    await resetPassword(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(adminDoc.passwordChangedAt instanceof Date);
  });
});

describe('B-2 regression — existing auth behaviors preserved', () => {
  it('expired token still rejected with the original message', async () => {
    const token = sign({ id: 'u1' }, { expiresIn: -10 });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    let nextCalled = false;
    await protectUser(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, 'Token invalid or expired');
  });

  it('login() still works unchanged', async () => {
    const { login } = require('../controllers/userAuthController');
    const userDoc = {
      _id: 'u1', name: 'Jane', email: 'jane@example.com', role: 'operator', isActive: true,
      matchPassword: async () => true,
      save: async function () { this._saved = true; },
    };
    User.findOne = () => ({ select: async () => userDoc });
    const req = { body: { email: 'jane@example.com', password: 'whatever' } };
    const res = mockRes();
    await login(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token);
  });
});
