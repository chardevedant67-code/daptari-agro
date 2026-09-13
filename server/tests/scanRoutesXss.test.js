require('./setup');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockRes, runStack, fullStackFor, freshRequireCache } = require('./helpers');

const SeedPacket = require('../models/SeedPacket');

// B-12 P1 fix: GET /p/:uniqueId (scanRoutes.js) previously interpolated
// batch/packet fields into its HTML response with no escaping, unlike its
// sibling GET /scan/:uniqueId (publicScanRoutes.js). Both routes are public
// and unauthenticated; batchName/seedType/batchNumber are free-text fields
// an authenticated Admin can set via POST /api/batches, so this proves an
// admin-controlled value can never reach the public HTML response
// unescaped, regardless of what characters it contains.
describe('B-12 scanRoutes.js stored-XSS protection (GET /p/:uniqueId)', () => {
  it('escapes <script>/HTML-attribute payloads in uniqueId, batchName, seedType, and batchNumber', async () => {
    const maliciousPacket = {
      uniqueId: '<script>alert(1)</script>',
      status: 'filled',
      beforeWeight: 10,
      afterWeight: 8,
      afterTime: new Date('2026-01-01T00:00:00Z'),
      linkedAt: new Date('2026-01-01T00:00:00Z'),
      batchId: {
        batchName: '<img src=x onerror=alert(2)>',
        seedType: '"><script>alert(3)</script>',
        batchNumber: "'; alert(4); //",
      },
    };
    SeedPacket.findOne = () => ({ populate: async () => maliciousPacket });

    freshRequireCache('../routes/scanRoutes');
    const router = require('../routes/scanRoutes');
    const stack = fullStackFor(router, 'get', '/:uniqueId');

    const req = { params: { uniqueId: 'anything' } };
    const res = mockRes();
    await runStack(stack, 0, req, res);

    assert.equal(res.statusCode, 200); // res.send() defaults to 200 when res.status() was never called
    const html = res.sent;
    assert.equal(typeof html, 'string');

    // No raw executable markup anywhere in the response.
    assert.ok(!html.includes('<script>'), 'raw <script> tag must not appear in the response');
    assert.ok(!html.includes('<img src=x onerror=alert(2)>'), 'raw onerror attribute payload must not appear');
    assert.ok(!html.includes("'; alert(4); //"), 'raw single-quote payload must not appear unescaped');
    assert.ok(!html.includes('"><script>'), 'raw attribute-breakout payload must not appear');

    // The escaped equivalents ARE present — proves the values were actually
    // rendered (not silently dropped), just safely.
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'uniqueId must be HTML-escaped');
    assert.ok(html.includes('&lt;img src=x onerror=alert(2)&gt;'), 'batchName must be HTML-escaped');
    assert.ok(html.includes('&quot;&gt;&lt;script&gt;alert(3)&lt;/script&gt;'), 'seedType must be HTML-escaped');
    assert.ok(html.includes('&#39;; alert(4); //'), 'batchNumber must be HTML-escaped');
  });

  it('escapes the packet id in the 404 page for an unknown/malicious packet id', async () => {
    SeedPacket.findOne = () => ({ populate: async () => null });
    freshRequireCache('../routes/scanRoutes');
    const router = require('../routes/scanRoutes');
    const stack = fullStackFor(router, 'get', '/:uniqueId');

    const req = { params: { uniqueId: '<script>alert(5)</script>' } };
    const res = mockRes();
    await runStack(stack, 0, req, res);

    assert.equal(res.statusCode, 404);
    const html = res.sent;
    assert.ok(!html.includes('<script>alert(5)</script>'), 'raw <script> must not appear in the 404 page');
    assert.ok(html.includes('&lt;script&gt;alert(5)&lt;/script&gt;'), 'uniqueId must be HTML-escaped in the 404 page');
  });

  it('still renders legitimate before/after/loss weight values correctly (no over-escaping)', async () => {
    const packet = {
      uniqueId: 'PRD-TEST-001',
      status: 'filled',
      beforeWeight: 12.5,
      afterWeight: 10.25,
      afterTime: new Date('2026-01-01T00:00:00Z'),
      linkedAt: new Date('2026-01-01T00:00:00Z'),
      batchId: { batchName: 'Tomato Seeds', seedType: 'Hybrid', batchNumber: 'B-001' },
    };
    SeedPacket.findOne = () => ({ populate: async () => packet });
    freshRequireCache('../routes/scanRoutes');
    const router = require('../routes/scanRoutes');
    const stack = fullStackFor(router, 'get', '/:uniqueId');

    const req = { params: { uniqueId: 'PRD-TEST-001' } };
    const res = mockRes();
    await runStack(stack, 0, req, res);

    const html = res.sent;
    assert.ok(html.includes('Tomato Seeds'));
    assert.ok(html.includes('12.5'));
    assert.ok(html.includes('10.25'));
    assert.ok(html.includes('2.250')); // loss = 12.5 - 10.25 = 2.25 -> toFixed(3)
  });
});
