// Shared test utilities used across the suite. Pure helpers only — no
// framework-specific code, no production-file changes required to support
// any of this (every technique here works against the real, unmodified
// route/model/middleware modules).
require('./setup');
const jwt = require('jsonwebtoken');
const { Readable } = require('stream');

// A real (small) EventEmitter, not a plain object — express-rate-limit
// (and other real middleware) listens for res.on('finish', ...) to
// finalize its per-request accounting once the response completes. A
// plain object with no working .on()/.emit() causes that middleware to
// hang forever waiting for an event that can never fire.
const { EventEmitter } = require('events');

function mockRes() {
  const res = new EventEmitter();
  const headers = {};
  res.statusCode = null;
  res.body = null;
  res.sent = null;
  res.headersSent = false;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.statusCode = res.statusCode || 200; finish(); return res; };
  res.send = (s) => { res.sent = s; res.statusCode = res.statusCode || 200; finish(); return res; };
  // No-op header methods — real middleware (e.g. express-rate-limit, which
  // sets RateLimit-* headers when standardHeaders:true) calls these; without
  // them present the call throws and the middleware's own logic (including
  // its request counter) never completes correctly.
  res.setHeader = (name, value) => { headers[name] = value; return res; };
  res.getHeader = (name) => headers[name];
  res.removeHeader = (name) => { delete headers[name]; };
  res.end = (body) => { if (body !== undefined) res.sent = body; finish(); return res; };
  function finish() {
    if (res.headersSent) return; // only ever emit 'finish' once per response
    res.headersSent = true;
    process.nextTick(() => res.emit('finish'));
  }
  return res;
}

function authHeaderFor(id, extra = {}) {
  const token = jwt.sign({ id, ...extra }, process.env.JWT_SECRET);
  return { authorization: `Bearer ${token}` };
}

function signToken(payload, opts) {
  return jwt.sign(payload, process.env.JWT_SECRET, opts);
}

// Runs an Express middleware/handler stack in order, exactly like Express's
// real dispatch (next() is fire-and-forget, not awaited by its caller) —
// waits for res.json()/res.send() to actually fire rather than for the
// dispatch call chain to "return", which does not track completion of an
// async downstream handler under Express's real model.
function runStack(stack, startIndex, req, res) {
  return new Promise((resolveDone) => {
    const origJson = res.json.bind(res);
    res.json = (body) => { const r = origJson(body); resolveDone(); return r; };
    const origSend = res.send.bind(res);
    res.send = (body) => { const r = origSend(body); resolveDone(); return r; };
    let i = startIndex;
    function next(err) {
      if (err) { resolveDone(); return; }
      if (i >= stack.length) { resolveDone(); return; }
      const fn = stack[i++].handle;
      try {
        const ret = fn(req, res, next);
        if (ret && typeof ret.catch === 'function') ret.catch(() => resolveDone());
      } catch (e) { resolveDone(); }
    }
    next();
  });
}

function findRoute(router, method, routePath) {
  return router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
}

// Builds the real, complete effective middleware stack for one route,
// including any router.use(...) middleware registered ahead of it (which
// has no `.route` property and would otherwise be silently skipped if only
// that route's own `.route.stack` were used) — needed for files like
// recordRoutes.js which apply `protect` via router.use() rather than inline.
function fullStackFor(router, method, routePath) {
  const useLayers = router.stack.filter((l) => !l.route).map((l) => ({ handle: l.handle }));
  const routeLayer = findRoute(router, method, routePath);
  if (!routeLayer) throw new Error(`route not found: ${method.toUpperCase()} ${routePath}`);
  return [...useLayers, ...routeLayer.route.stack];
}

// Hand-built multipart/form-data body — no external dependency needed to
// exercise the real multer middleware (including its real fileFilter).
function buildMultipart(boundary, fields) {
  const parts = [];
  for (const f of fields) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) header += `; filename="${f.filename}"`;
    header += '\r\n';
    if (f.contentType) header += `Content-Type: ${f.contentType}\r\n`;
    header += '\r\n';
    parts.push(Buffer.from(header, 'utf8'));
    parts.push(Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8'));
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(parts);
}

function makeMultipartReq(fields, extra = {}) {
  const boundary = '----testboundary' + Math.random().toString(16).slice(2);
  const body = buildMultipart(boundary, fields);
  const req = new Readable();
  req._read = () => {};
  req.push(body);
  req.push(null);
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };
  req.method = 'POST';
  Object.assign(req, extra);
  return req;
}

// Real magic bytes for each supported format, for genuine "valid image"
// test cases (not just a correctly-labeled empty buffer).
const REAL_IMAGE_BYTES = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
};

function freshRequireCache(...modulePaths) {
  for (const p of modulePaths) {
    delete require.cache[require.resolve(p)];
  }
}

module.exports = {
  mockRes,
  authHeaderFor,
  signToken,
  runStack,
  findRoute,
  fullStackFor,
  makeMultipartReq,
  REAL_IMAGE_BYTES,
  freshRequireCache,
};
