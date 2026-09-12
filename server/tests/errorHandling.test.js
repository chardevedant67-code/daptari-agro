// B-6 — Production-safe error handling / no raw error leakage.
require('./setup');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockRes } = require('./helpers');

const { sendServerError, logServerError } = require('../utils/errorResponse');

function withSilencedConsoleError(fn) {
  const orig = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);
  try { return { result: fn(), calls }; }
  finally { console.error = orig; }
}

describe('B-6 sendServerError — generic client response, real error logged server-side', () => {
  it('never leaks the raw error message to the client', () => {
    const res = mockRes();
    const { calls } = withSilencedConsoleError(() => sendServerError(res, new Error('some internal detail'), 'testCtx'));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'Internal server error');
    assert.ok(!JSON.stringify(res.body).includes('some internal detail'));
    assert.ok(calls.length > 0, 'error must still be logged server-side');
  });

  it('never leaks a stack-trace-shaped string to the client', () => {
    const res = mockRes();
    withSilencedConsoleError(() => sendServerError(res, new Error('boom'), 'testCtx'));
    const bodyStr = JSON.stringify(res.body);
    assert.ok(!bodyStr.includes('at '));
  });

  it('never leaks MongoDB-internal error text (collection/index/driver details)', () => {
    const res = mockRes();
    const mongoLike = 'E11000 duplicate key error collection: proddb.admins index: email_1 dup key: { email: "leak@test.com" } at node_modules/mongoose/lib/query.js:123';
    const { calls } = withSilencedConsoleError(() => sendServerError(res, new Error(mongoLike), 'adminController'));
    const bodyStr = JSON.stringify(res.body);
    assert.ok(!bodyStr.includes('E11000'));
    assert.ok(!bodyStr.includes('proddb'));
    const logged = calls.some((args) => args.some((a) => String(a && a.message).includes('E11000')));
    assert.ok(logged, 'the real Mongo error must still reach the server log');
  });

  it('never leaks a filesystem path', () => {
    const res = mockRes();
    withSilencedConsoleError(() => sendServerError(res, new Error("ENOENT: no such file or directory, open '/srv/app/uploads/x.jpg'"), 'sessionRoutes'));
    assert.ok(!JSON.stringify(res.body).includes('/srv/app'));
  });

  it('never leaks Cloudinary-style internal error text', () => {
    const res = mockRes();
    withSilencedConsoleError(() => sendServerError(res, new Error('Invalid Signature abc — api_key=915...'), 'sessionRoutes'));
    assert.ok(!JSON.stringify(res.body).includes('api_key'));
  });
});

describe('B-6 errorResponse.js never references secrets directly', () => {
  it('source contains no JWT_SECRET/MONGO_URI/process.env reference', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../utils/errorResponse'), 'utf8');
    assert.ok(!/JWT_SECRET|MONGO_URI|process\.env/.test(src));
  });
});

describe('B-6 intentional user-facing messages remain unchanged', () => {
  it('"Email already registered" is untouched (not routed through sendServerError)', async () => {
    const User = require('../models/User');
    const { register } = require('../controllers/userAuthController');
    User.findOne = async () => ({ _id: 'existing' });
    const req = { body: { name: 'John', email: 'john@example.com', password: 'secret123' } };
    const res = mockRes();
    await register(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Email already registered');
  });

  it('allowRoles 403 message format is unchanged', () => {
    const { allowRoles } = require('../middleware/roleMiddleware');
    const mw = allowRoles('superadmin', 'admin');
    const res = mockRes();
    mw({ admin: { role: 'operator' } }, res, () => {});
    assert.equal(res.body.message, 'Access denied — requires role: superadmin or admin');
  });
});
