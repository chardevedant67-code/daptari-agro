require('./setup');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { mockRes, authHeaderFor, fullStackFor, runStack, freshRequireCache } = require('./helpers');

const Admin = require('../models/Admin');
const User = require('../models/User');
const { protect, protectAdminOrUser } = require('../middleware/authMiddleware');
const { protectUser } = require('../middleware/userAuthMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

describe('Authentication — Admin (protect)', () => {
  it('rejects a request with no Authorization header (401)', async () => {
    const res = mockRes();
    let nextCalled = false;
    await protect({ headers: {} }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, 'Not authorized — no token');
  });

  it('rejects an invalid/garbage token (401)', async () => {
    const res = mockRes();
    await protect({ headers: { authorization: 'Bearer not-a-real-jwt' } }, res, () => {});
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, 'Token invalid or expired');
  });

  it('rejects an expired token (401)', async () => {
    const token = jwt.sign({ id: 'a1' }, process.env.JWT_SECRET, { expiresIn: -10 });
    const res = mockRes();
    await protect({ headers: { authorization: `Bearer ${token}` } }, res, () => {});
    assert.equal(res.statusCode, 401);
  });

  it('rejects a valid token for a deactivated/missing Admin account (401)', async () => {
    Admin.findById = async () => null;
    const res = mockRes();
    await protect({ headers: authHeaderFor('missing1') }, res, () => {});
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, 'Account not found or inactive');
  });

  it('accepts a valid token for an active Admin and attaches req.admin', async () => {
    Admin.findById = async () => ({ _id: 'a1', role: 'admin', isActive: true });
    const req = { headers: authHeaderFor('a1') };
    const res = mockRes();
    let nextCalled = false;
    await protect(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.admin._id, 'a1');
  });
});

describe('Authentication — User/mobile (protectUser)', () => {
  it('rejects a request with no Authorization header (401)', async () => {
    const res = mockRes();
    await protectUser({ headers: {} }, res, () => {});
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, 'Not authorized — no token');
  });

  it('rejects a valid token for a missing/inactive User (401)', async () => {
    User.findById = async () => ({ _id: 'u1', isActive: false });
    const res = mockRes();
    await protectUser({ headers: authHeaderFor('u1') }, res, () => {});
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, 'Account not found or inactive');
  });

  it('accepts a valid token for an active User and attaches req.user', async () => {
    User.findById = async () => ({ _id: 'u1', isActive: true, passwordChangedAt: undefined });
    const req = { headers: authHeaderFor('u1') };
    const res = mockRes();
    let nextCalled = false;
    await protectUser(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.user._id, 'u1');
  });
});

describe('Authentication — protectAdminOrUser (shared read routes)', () => {
  it('resolves an Admin token to req.admin', async () => {
    Admin.findById = async () => ({ _id: 'a1', role: 'admin', isActive: true });
    const req = { headers: authHeaderFor('a1') };
    const res = mockRes();
    let nextCalled = false;
    await protectAdminOrUser(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.admin._id, 'a1');
  });

  it('resolves a User token (type: user) to req.user', async () => {
    User.findById = async () => ({ _id: 'u1', isActive: true, passwordChangedAt: undefined });
    const req = { headers: authHeaderFor('u1', { type: 'user' }) };
    const res = mockRes();
    let nextCalled = false;
    await protectAdminOrUser(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.user._id, 'u1');
  });

  it('rejects with no token (401)', async () => {
    const res = mockRes();
    await protectAdminOrUser({ headers: {} }, res, () => {});
    assert.equal(res.statusCode, 401);
  });
});

describe('Role authorization (allowRoles)', () => {
  it('rejects a role not in the allowed list (403)', () => {
    const mw = allowRoles('superadmin', 'admin');
    const res = mockRes();
    let nextCalled = false;
    mw({ admin: { role: 'operator' } }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, 'Access denied — requires role: superadmin or admin');
  });

  it('allows a role in the allowed list', () => {
    const mw = allowRoles('superadmin', 'admin');
    const res = mockRes();
    let nextCalled = false;
    mw({ admin: { role: 'admin' } }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });
});

describe('B-12 PUT /api/admin/change-password rate limiting (new finding)', () => {
  it('the route stack includes a rate limiter ahead of the handler', () => {
    freshRequireCache('../routes/adminRoutes');
    const router = require('../routes/adminRoutes');
    const stack = fullStackFor(router, 'put', '/change-password');
    // [protect, adminChangePasswordLimiter, changePassword] = 3 layers.
    // Previously this route was only [protect, changePassword] = 2.
    assert.ok(stack.length >= 3, `expected >=3 layers (protect, limiter, handler), got ${stack.length}`);
  });

  it('an attacker with a valid token cannot use it as an unthrottled password-guessing oracle', async () => {
    // Must double as what `protect` awaits directly (Admin.findById(id), no
    // .select()) and what changePassword awaits via .select('+password') —
    // same object either way, so isActive is visible to `protect` too.
    const adminDoc = { _id: 'a1', isActive: true, matchPassword: async () => false, save: async () => {} };
    adminDoc.select = async () => adminDoc;
    Admin.findById = () => adminDoc;
    freshRequireCache('../routes/adminRoutes');
    const router = require('../routes/adminRoutes');
    const stack = fullStackFor(router, 'put', '/change-password');
    const header = authHeaderFor('a1');
    let sawA429 = false;
    for (let i = 0; i < 15; i++) {
      const req = { headers: header, ip: '127.0.0.1', body: { currentPassword: `guess${i}`, newPassword: 'newpass123' } };
      const res = mockRes();
      await runStack(stack, 0, req, res);
      if (res.statusCode === 429) { sawA429 = true; break; }
      assert.equal(res.statusCode, 401, `attempt ${i}: wrong-password guesses should 401, not succeed`);
    }
    assert.ok(sawA429, 'expected the limiter to eventually return 429 across repeated guesses');
  });

  it('a legitimate single password change (correct currentPassword) still works', async () => {
    const adminDoc = { _id: 'a2', isActive: true, matchPassword: async () => true, save: async function () { this._saved = true; } };
    adminDoc.select = async () => adminDoc;
    Admin.findById = () => adminDoc;
    freshRequireCache('../routes/adminRoutes');
    const router = require('../routes/adminRoutes');
    const stack = fullStackFor(router, 'put', '/change-password');
    const req = { headers: authHeaderFor('a2'), body: { currentPassword: 'correct', newPassword: 'newpass123' } };
    const res = mockRes();
    await runStack(stack, 0, req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(adminDoc.passwordChangedAt instanceof Date, 'B-2 passwordChangedAt behavior must still fire');
  });
});
