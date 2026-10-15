// Test backend for the end-to-end suites: a throwaway MongoDB on 127.0.0.1
// plus the REAL, unmodified server (server/server.js) running against it.
//
// PRODUCTION SAFETY — how this can never reach the real database:
//   * The only MongoDB address used anywhere in here is the one
//     mongodb-memory-server hands back, and startServer() refuses any
//     address whose host is not 127.0.0.1.
//   * The server is started with its working directory in an empty temp
//     folder. server.js loads `.env` from the working directory, so the
//     real server/.env (which holds the production MONGO_URI) is never
//     read. Every variable that file defines is also passed explicitly
//     here — real test values or empty strings — so nothing could be
//     back-filled from a `.env` even if one were found.
//   * This file never opens, parses or copies server/.env.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

const DESKTOP_DIR = path.resolve(__dirname, '..', '..');
const SERVER_DIR = path.resolve(DESKTOP_DIR, '..', 'server');
const DB_NAME = 'weighing_desktop_test';
const BINARY_DIR = path.join(DESKTOP_DIR, '.cache', 'mongodb-binaries');
const DB_ROOT = path.join(DESKTOP_DIR, '.testdb');
const OUTPUT_ROOT = path.join(DESKTOP_DIR, '.test-output');

// The server's own mongoose + models, used only by the test harness to
// create fixture accounts and to look directly inside the test database.
const mongoose = require(path.join(SERVER_DIR, 'node_modules', 'mongoose'));
const serverModel = (name) => require(path.join(SERVER_DIR, 'models', name));

function assertLoopback(uri) {
  const host = new URL(uri).hostname;
  if (host !== '127.0.0.1') {
    throw new Error(`Refusing to use a non-local database host: ${host}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, { timeoutMs = 15000, intervalMs = 100, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(intervalMs);
  }
}

function tempDir(label) {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(OUTPUT_ROOT, `${label}-`));
}

async function createTestBackend({ label = 'e2e' } = {}) {
  const dbPath = path.join(DB_ROOT, `${label}-${Date.now()}`);
  fs.mkdirSync(dbPath, { recursive: true });
  fs.mkdirSync(BINARY_DIR, { recursive: true });

  const mongoOptions = (port) => ({
    instance: { ip: '127.0.0.1', dbName: DB_NAME, dbPath, storageEngine: 'wiredTiger', ...(port ? { port } : {}) },
    binary: { downloadDir: BINARY_DIR },
  });

  let mongod = await MongoMemoryServer.create(mongoOptions());
  let mongoUri = mongod.getUri(DB_NAME);
  assertLoopback(mongoUri);

  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  // Empty on purpose — the server finds no `.env` to load from here.
  const serverCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-test-server-'));

  let child = null;
  let serverLog = '';

  async function isReady() {
    try {
      const res = await fetch(`${baseUrl}/api/ready`);
      return res.status === 200;
    } catch (_) {
      return false;
    }
  }

  async function startServer() {
    assertLoopback(mongoUri);
    if (fs.existsSync(path.join(serverCwd, '.env'))) throw new Error('Unexpected .env in the test server working directory');
    serverLog = '';
    child = spawn(process.execPath, [path.join(SERVER_DIR, 'server.js')], {
      cwd: serverCwd,
      // Built from scratch (not inherited): only what Node needs to run on
      // Windows, plus every setting the server reads.
      env: {
        SystemRoot: process.env.SystemRoot || '',
        PATH: process.env.PATH || '',
        TEMP: process.env.TEMP || os.tmpdir(),
        TMP: process.env.TMP || os.tmpdir(),
        NODE_ENV: 'development',
        PORT: String(port),
        MONGO_URI: mongoUri,
        JWT_SECRET: jwtSecret,
        JWT_EXPIRE: '2h',
        JWT_EXPIRE_LONG: '2h',
        SERVER_IP: '',
        ALLOWED_ORIGINS: '',
        PUBLIC_BASE_URL: '',
        CLOUDINARY_CLOUD_NAME: '',
        CLOUDINARY_API_KEY: '',
        CLOUDINARY_API_SECRET: '',
        APP_PUBLIC_URL: '',
        RESEND_API_KEY: '',
        EMAIL_FROM: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const mine = child;
    child.stdout.on('data', (d) => { serverLog += d.toString(); });
    child.stderr.on('data', (d) => { serverLog += d.toString(); });
    child.once('exit', () => { if (child === mine) child = null; });
    try {
      await waitFor(isReady, { timeoutMs: 30000, what: 'the test server to become ready' });
    } catch (err) {
      throw new Error(`${err.message}\n--- server output ---\n${serverLog}`);
    }
  }

  async function stopServer() {
    if (!child) return;
    const exiting = child;
    await new Promise((resolve) => {
      exiting.once('exit', resolve);
      exiting.kill('SIGKILL');
    });
    child = null;
    await waitFor(async () => !(await isReady()), { timeoutMs: 10000, what: 'the test server to stop' });
  }

  // Restarts mongod itself on the same data files and port — proves the
  // data is really on disk in MongoDB, not held in some process's memory.
  async function restartDatabase() {
    const mongoPort = Number(new URL(mongoUri).port);
    // A clean shutdown, as a real database restart is. (Simply killing the
    // process — all mongodb-memory-server can do on Windows — discards
    // writes from the last ~100 ms that a standalone mongod has
    // acknowledged but not yet journaled, which says nothing about the app.)
    try {
      await mongoose.connection.db.admin().command({ shutdown: 1 });
    } catch (_) {
      // Expected: the connection drops as mongod exits.
    }
    await mongoose.disconnect().catch(() => {});
    await mongod.stop({ doCleanup: false });
    mongod = await MongoMemoryServer.create(mongoOptions(mongoPort));
    mongoUri = mongod.getUri(DB_NAME);
    assertLoopback(mongoUri);
    await mongoose.connect(mongoUri);
  }

  await startServer();
  await mongoose.connect(mongoUri);

  // ── direct HTTP helper (no desktop code involved) ──
  async function http(method, urlPath, { token, body } = {}) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    return { status: res.status, data };
  }

  // ── fixtures: test accounts with random, per-run passwords ──
  const password = () => crypto.randomBytes(12).toString('base64url');
  const accounts = {};

  async function createAdmin(key, role) {
    const Admin = serverModel('Admin');
    const account = { name: `Test ${key}`, email: `${key.toLowerCase()}@desktop-test.local`, password: password(), role };
    const doc = await Admin.create({ ...account, isActive: true });
    accounts[key] = { ...account, id: String(doc._id) };
    return accounts[key];
  }

  async function seedPackets() {
    const SeedBatch = serverModel('SeedBatch');
    const SeedPacket = serverModel('SeedPacket');
    const batchA = await SeedBatch.create({
      batchName: 'JS-335 Lot A', seedType: 'Soybean', seedCategory: 'Hybrid', seedCode: 'SOYB',
      batchNumber: 'B001', batchCode: 'LOTA', count: 2, month: 6, year: 2025,
      warehouse: 'Warehouse A', rack: 'R1', shelf: 'S2',
    });
    const batchB = await SeedBatch.create({
      batchName: 'HD-2967 Lot B', seedType: 'Wheat', seedCode: 'WHT', batchNumber: 'B002', batchCode: 'LOTB', count: 1,
    });
    await SeedPacket.create([
      { uniqueId: 'PRD-SOYBLOTA-001', batchId: batchA._id, status: 'filled', beforeWeight: 0.5, afterWeight: 1.75, difference: 1.25 },
      { uniqueId: 'PRD-SOYBLOTA-002', batchId: batchA._id, status: 'empty' },
      { uniqueId: 'PRD-WHTLOTB-001', batchId: batchB._id, status: 'empty' },
    ]);
  }

  async function addPacket(uniqueId) {
    const SeedBatch = serverModel('SeedBatch');
    const SeedPacket = serverModel('SeedPacket');
    const batch = await SeedBatch.findOne({ batchCode: 'LOTB' });
    await SeedPacket.create({ uniqueId, batchId: batch._id, status: 'empty' });
  }

  return {
    baseUrl,
    dbName: DB_NAME,
    get mongoUri() { return mongoUri; },
    get serverLog() { return serverLog; },
    serverCwd,
    accounts,
    http,
    startServer,
    stopServer,
    restartDatabase,
    createAdmin,
    seedPackets,
    addPacket,
    model: serverModel,
    tempDir,

    // One real login per account per run, then reused — the backend limits
    // Admin logins to 10 per 15 minutes per address.
    async login(key) {
      if (accounts[key].token) return accounts[key].token;
      const { status, data } = await http('POST', '/api/auth/login', { body: { email: accounts[key].email, password: accounts[key].password } });
      if (status !== 200) throw new Error(`login failed for ${key}: ${status}`);
      accounts[key].token = data.token;
      return data.token;
    },

    async dispose() {
      try { await stopServer(); } catch (_) {}
      try { await mongoose.disconnect(); } catch (_) {}
      try { await mongod.stop({ doCleanup: false }); } catch (_) {}
      try { fs.rmSync(dbPath, { recursive: true, force: true }); } catch (_) {}
      try { fs.rmSync(serverCwd, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

module.exports = { createTestBackend, waitFor, sleep, tempDir, SERVER_DIR, DESKTOP_DIR, OUTPUT_ROOT };
