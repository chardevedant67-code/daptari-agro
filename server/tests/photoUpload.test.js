// B-5 — Session photo upload multer fileFilter security.
require('./setup');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { mockRes, makeMultipartReq, runStack, REAL_IMAGE_BYTES, freshRequireCache } = require('./helpers');

const WeightSession = require('../models/WeightSession');
const cloudinaryUpload = require('../utils/cloudinaryUpload');

// sessionRoutes.js destructures { uploadSeedPacketPhoto } at require time —
// same indirection-wrapper technique as batchAuthorization.test.js.
let currentUploadImpl = async () => { throw new Error('uploadSeedPacketPhoto not configured for this test'); };
cloudinaryUpload.uploadSeedPacketPhoto = (...args) => currentUploadImpl(...args);

function loadPhotoStack() {
  freshRequireCache('../routes/sessionRoutes');
  const router = require('../routes/sessionRoutes');
  const layer = router.stack.find((l) => l.route && l.route.path === '/:id/photo' && l.route.methods.post);
  return layer.route.stack; // [protectUser, sessionMutationLimiter, multer, handler]
}

const OWNER = 'owner1';
function freshSession(overrides = {}) {
  return { _id: 's1', status: 'active', operator: OWNER, packetUniqueId: null, ...overrides };
}

describe('B-5 rejected formats', () => {
  const rejectCases = [
    { label: 'PDF', filename: 'doc.pdf', contentType: 'application/pdf' },
    { label: 'TXT', filename: 'notes.txt', contentType: 'text/plain' },
    { label: 'HTML', filename: 'page.html', contentType: 'text/html' },
    { label: 'JavaScript', filename: 'evil.js', contentType: 'application/javascript' },
    { label: 'JSON', filename: 'data.json', contentType: 'application/json' },
    { label: 'ZIP/binary', filename: 'archive.zip', contentType: 'application/zip' },
  ];
  for (const c of rejectCases) {
    it(`rejects ${c.label}`, async () => {
      WeightSession.findById = async () => freshSession();
      const stack = loadPhotoStack();
      const req = makeMultipartReq(
        [{ name: 'photo', filename: c.filename, contentType: c.contentType, content: 'not a real image' }],
        { params: { id: 's1' }, user: { _id: OWNER }, body: {} }
      );
      const res = mockRes();
      await runStack(stack, 2, req, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.message, 'Only JPEG, PNG, or WEBP images are allowed');
    });
  }
});

describe('B-5 mismatched extension/MIME spoofing', () => {
  it('image-looking filename ("photo.jpg") + non-image MIME (text/plain) -> rejected', async () => {
    WeightSession.findById = async () => freshSession();
    const stack = loadPhotoStack();
    const req = makeMultipartReq(
      [{ name: 'photo', filename: 'photo.jpg', contentType: 'text/plain', content: 'just text' }],
      { params: { id: 's1' }, user: { _id: OWNER }, body: {} }
    );
    const res = mockRes();
    await runStack(stack, 2, req, res);
    assert.equal(res.statusCode, 400);
  });

  it('non-image filename ("malware.exe") + image MIME (image/jpeg) -> rejected', async () => {
    WeightSession.findById = async () => freshSession();
    const stack = loadPhotoStack();
    const req = makeMultipartReq(
      [{ name: 'photo', filename: 'malware.exe', contentType: 'image/jpeg', content: 'not really jpeg bytes' }],
      { params: { id: 's1' }, user: { _id: OWNER }, body: {} }
    );
    const res = mockRes();
    await runStack(stack, 2, req, res);
    assert.equal(res.statusCode, 400);
  });
});

describe('B-5 valid formats are accepted and reach Cloudinary', () => {
  for (const [format, ext, mime] of [['jpeg', 'jpg', 'image/jpeg'], ['png', 'png', 'image/png'], ['webp', 'webp', 'image/webp']]) {
    it(`valid ${format.toUpperCase()} (${mime}) is accepted for the before phase`, async () => {
      WeightSession.findById = async () => freshSession();
      WeightSession.findOneAndUpdate = async (filter, update) => ({ _id: 's1', ...update.$set });
      let cloudinaryArgs = null;
      currentUploadImpl = async (path_, opts) => { cloudinaryArgs = opts; return `https://res.cloudinary.com/${format}.${ext}`; };
      const origUnlink = fs.unlink;
      fs.unlink = (p, cb) => cb && cb();
      const stack = loadPhotoStack();
      const req = makeMultipartReq(
        [
          { name: 'uniqueId', content: 'PRD-1' },
          { name: 'phase', content: 'before' },
          { name: 'photo', filename: `photo.${ext}`, contentType: mime, content: REAL_IMAGE_BYTES[format] },
        ],
        { params: { id: 's1' }, user: { _id: OWNER }, body: {} }
      );
      const res = mockRes();
      await runStack(stack, 2, req, res);
      fs.unlink = origUnlink;
      assert.equal(res.statusCode, 200);
      assert.equal(cloudinaryArgs.phase, 'before');
    });
  }
});

describe('B-5 preserves B-3 linked-session protection for photo uploads', () => {
  it('a linked session rejects photo upload before Cloudinary is ever called', async () => {
    WeightSession.findById = async () => freshSession({ status: 'linked' });
    let cloudinaryCalled = false;
    currentUploadImpl = async () => { cloudinaryCalled = true; return 'x'; };
    const stack = loadPhotoStack();
    const req = makeMultipartReq(
      [
        { name: 'uniqueId', content: 'PRD-1' },
        { name: 'phase', content: 'before' },
        { name: 'photo', filename: 'photo.jpg', contentType: 'image/jpeg', content: REAL_IMAGE_BYTES.jpeg },
      ],
      { params: { id: 's1' }, user: { _id: OWNER }, body: {} }
    );
    const res = mockRes();
    await runStack(stack, 2, req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'SESSION_NOT_ACTIVE');
    assert.equal(cloudinaryCalled, false);
  });

  it('wrong owner is rejected with SESSION_FORBIDDEN', async () => {
    WeightSession.findById = async () => freshSession({ operator: 'someone-else' });
    const stack = loadPhotoStack();
    const req = makeMultipartReq(
      [{ name: 'photo', filename: 'photo.jpg', contentType: 'image/jpeg', content: REAL_IMAGE_BYTES.jpeg }],
      { params: { id: 's1' }, user: { _id: OWNER }, body: {} }
    );
    const res = mockRes();
    await runStack(stack, 2, req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'SESSION_FORBIDDEN');
  });
});

describe('B-5 rate limiting middleware still present', () => {
  it('the /:id/photo stack has at least 4 layers (protectUser, limiter, multer, handler)', () => {
    const stack = loadPhotoStack();
    assert.ok(stack.length >= 4, `expected >=4 layers, got ${stack.length}`);
  });
});
