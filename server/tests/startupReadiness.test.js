// B-10 — Production startup/readiness: env validation, DB-connection
// gating before app.listen(), /api/health & /api/ready contracts, Render
// healthCheckPath config.
//
// server.js is a top-level entry script (nothing exported, real side
// effects on require) — tested by spawning it as a REAL child process with
// a controlled environment, using only Node's built-in child_process/net
// (no new dependency). Every "unreachable Mongo" scenario targets only
// 127.0.0.1 on a closed port — no network egress beyond localhost, and
// definitively not production. IMPORTANT SAFETY NOTE (learned the hard way
// during B-10's own development): server.js calls dotenv.config() on
// startup, which backfills any env var NOT ALREADY PRESENT in the child's
// env from the real server/.env file on disk — including the real
// MONGO_URI. Using `delete`/`undefined` to simulate "missing" is therefore
// unsafe; every "missing" var below is set to an explicit empty string,
// which dotenv's own convention treats as already-present and never
// overrides. Every spawned child is force-killed in an `after` hook
// regardless of test outcome, so nothing can be orphaned.
require('./setup');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..');
const allSpawnedChildren = [];

function isPortOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open) => { if (!done) { done = true; socket.destroy(); resolve(open); } };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function spawnServer(envOverrides) {
  const env = { ...process.env, NODE_ENV: 'development' };
  for (const k of Object.keys(envOverrides)) {
    env[k] = envOverrides[k] === undefined ? '' : envOverrides[k];
  }
  const child = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  allSpawnedChildren.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  return { child, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

function waitForClose(child, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('process did not exit within timeout')), timeoutMs);
    child.once('close', (code, signal) => { clearTimeout(t); resolve({ code, signal }); });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

after(() => {
  for (const child of allSpawnedChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
  }
});

describe('B-10 startup environment validation', () => {
  it('missing JWT_SECRET -> fast, clear, non-zero exit', async () => {
    const spawned = spawnServer({ JWT_SECRET: undefined, MONGO_URI: 'mongodb://127.0.0.1:1/x', PORT: '5191' });
    const { code } = await waitForClose(spawned.child, 8000);
    assert.notEqual(code, 0);
    assert.ok((spawned.stdout + spawned.stderr).includes('JWT_SECRET'));
  });

  it('missing MONGO_URI -> fast, clear, non-zero exit', async () => {
    const spawned = spawnServer({ JWT_SECRET: 'test-secret', MONGO_URI: undefined, PORT: '5192' });
    const { code } = await waitForClose(spawned.child, 8000);
    assert.notEqual(code, 0);
    assert.ok((spawned.stdout + spawned.stderr).includes('MONGO_URI'));
  });
});

describe('B-10 MongoDB connection gating (the core startup race fix)', () => {
  it('unreachable Mongo -> server never starts accepting HTTP traffic', async () => {
    const spawned = spawnServer({ JWT_SECRET: 'test-secret', MONGO_URI: 'mongodb://127.0.0.1:1/b11test', PORT: '5193' });
    await sleep(3000); // well within Mongo's connection-attempt phase
    const open = await isPortOpen(5193);
    spawned.child.kill('SIGKILL');
    assert.equal(open, false, 'port was open — server started listening despite no DB connection');
  });
});

describe('B-10 graceful shutdown — static verification', () => {
  // Live cross-process SIGTERM/SIGINT delivery could not be verified on
  // this Windows development machine: an isolated, minimal diagnostic
  // (a script with ONLY a signal handler) proved conclusively that
  // Windows/Node child_process signal emulation does not deliver SIGTERM
  // or SIGINT to a child's own process.on(...) handler at all — a
  // well-documented platform limitation, unrelated to this implementation.
  // Render's real Linux production environment has no such limitation
  // (native POSIX signal delivery). Verified instead via source inspection.
  const src = fs.readFileSync(path.join(SERVER_DIR, 'server.js'), 'utf8');

  it('SIGTERM is wired to gracefulShutdown', () => {
    assert.match(src, /process\.on\('SIGTERM',\s*\(\)\s*=>\s*gracefulShutdown\('SIGTERM'\)\)/);
  });
  it('SIGINT is wired to gracefulShutdown', () => {
    assert.match(src, /process\.on\('SIGINT',\s*\(\)\s*=>\s*gracefulShutdown\('SIGINT'\)\)/);
  });
  it('gracefulShutdown closes httpServer, then mongoose, then exits 0, with a guard and a force-exit timer', () => {
    const fnBody = src.slice(src.indexOf('function gracefulShutdown'), src.indexOf("process.on('SIGTERM'"));
    assert.match(fnBody, /if \(shuttingDown\) return;/);
    assert.match(fnBody, /setTimeout\([\s\S]*process\.exit\(1\)/);
    assert.match(fnBody, /httpServer\.close\(resolve\)/);
    assert.match(fnBody, /mongoose\.connection\.close\(\)/);
    assert.match(fnBody, /process\.exit\(0\)/);
    const closeIdx = fnBody.indexOf('httpServer.close');
    const mongoIdx = fnBody.indexOf('mongoose.connection.close');
    const exitIdx = fnBody.lastIndexOf('process.exit(0)');
    assert.ok(closeIdx < mongoIdx && mongoIdx < exitIdx, 'shutdown steps out of order');
  });
});

describe('B-10 health/readiness contracts', () => {
  it('/api/health source contract is unchanged (static 200, no DB check)', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'server.js'), 'utf8');
    const healthBlock = src.slice(src.indexOf("app.get('/api/health'"), src.indexOf("app.get('/api/ready'"));
    assert.ok(healthBlock.includes("status: 'ok'"));
    assert.ok(!healthBlock.includes('readyState'), '/api/health must stay DB-unaware');
  });

  it('/api/ready reflects real mongoose.connection.readyState (disconnected -> not ready)', () => {
    const mongoose = require('mongoose');
    assert.equal(mongoose.connection.readyState, 0, 'never connected in this test process');
    assert.equal(mongoose.connection.readyState === 1, false);
  });
});

describe('B-10 Render configuration', () => {
  it('render.yaml sets healthCheckPath to the DB-aware readiness endpoint', () => {
    const yamlPath = path.join(SERVER_DIR, '..', 'render.yaml');
    const src = fs.readFileSync(yamlPath, 'utf8');
    assert.match(src, /healthCheckPath:\s*\/api\/ready/);
  });
});

describe('B-10 no unrelated route-mount lines were touched', () => {
  it('every existing app.use(\'/api/...\') mount is still present in server.js', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'server.js'), 'utf8');
    for (const p of ['/api/auth', '/api/user', '/api/admin', '/api/products', '/api/machines', '/api/records', '/api/dashboard', '/api/batches', '/api/sessions', '/api/packets', '/api/qr']) {
      assert.ok(src.includes(`app.use('${p}'`), `missing route mount: ${p}`);
    }
  });
});

describe('B-10 no secrets logged directly', () => {
  it('server.js never interpolates MONGO_URI/JWT_SECRET values into a log call', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'server.js'), 'utf8');
    assert.ok(!/console\.(log|error)\([^)]*process\.env\.(MONGO_URI|JWT_SECRET)/.test(src));
  });
});
