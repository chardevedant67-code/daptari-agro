// TEST MODE launcher — run the desktop app on this PC against a throwaway
// backend, for trying it out by hand.
//
//   npm run test-mode        start (opens the app window)
//   npm run test-mode:stop   stop it from another terminal
//
// What it starts, all on this machine only:
//   1. a temporary MongoDB on 127.0.0.1 (mongodb-memory-server)
//   2. the real server/server.js connected to that database
//   3. the Electron app, pointed at that server
//
// It reuses tests/e2e/testBackend.js, so the same guarantees hold: the
// database address must be 127.0.0.1, the server is started from an empty
// working directory with every setting passed explicitly, and server/.env
// is never read. The app's workbook and its own state go to a temp folder
// under .test-output/, never to the real Documents folder.
//
// Everything is created fresh on each start and the database is deleted on
// stop. The two login accounts get new random passwords every time, printed
// below — nothing here is a fixed or built-in credential.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createTestBackend, sleep, DESKTOP_DIR, OUTPUT_ROOT } = require('../tests/e2e/testBackend');

const STATE_FILE = path.join(OUTPUT_ROOT, 'test-mode.json');
const DB_ROOT = path.join(DESKTOP_DIR, '.testdb');

// ── small Windows helpers ────────────────────────────────────────────────

// Image name of a running process ('' if it is not running).
function imageOf(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  const out = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout || '';
  const match = out.match(/^"([^"]+)"/m);
  return match ? match[1].toLowerCase() : '';
}

// PID listening on a local TCP port (0 if none).
function listeningPid(port) {
  const out = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `(Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`],
  { encoding: 'utf8' }).stdout || '';
  return parseInt(out.trim(), 10) || 0;
}

// Ends a process only if it is the program we expect at that PID.
function killIf(pid, expectedImage) {
  if (imageOf(pid) !== expectedImage) return false;
  try { process.kill(pid); return true; } catch (_) { return false; }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return null; }
}

// ── start ────────────────────────────────────────────────────────────────

async function start() {
  const previous = readState();
  if (previous && imageOf(previous.launcherPid) === 'node.exe') {
    console.error('Test mode is already running. Stop it first:  npm run test-mode:stop');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(DESKTOP_DIR, 'dist', 'index.html'))) {
    console.error('UI bundle not found. Start with:  npm run test-mode');
    process.exit(1);
  }

  console.log('Starting the local test database and server…');
  const backend = await createTestBackend({ label: 'test-mode' });

  for (const address of [backend.baseUrl, backend.mongoUri]) {
    if (new URL(address).hostname !== '127.0.0.1') {
      await backend.dispose();
      throw new Error(`Refusing to continue: ${address} is not on this machine`);
    }
  }

  const superadmin = await backend.createAdmin('Superadmin', 'superadmin');
  const admin = await backend.createAdmin('Admin', 'admin');
  // Three sample packets in the test database, so "Import existing
  // packets" has something to import.
  await backend.seedPackets();

  const runDir = backend.tempDir('test-mode');
  const workbookDir = path.join(runDir, 'documents');

  const env = {
    ...process.env,
    // These three override anything in a weighingdesktop/.env file.
    DESKTOP_API_URL: backend.baseUrl,
    DESKTOP_USER_DATA_DIR: path.join(runDir, 'appdata'),
    DESKTOP_WORKBOOK_DIR: workbookDir,
  };
  // Set by Electron-based hosts such as VS Code; it would make electron.exe
  // run as plain Node instead of opening the app.
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(require('electron'), [DESKTOP_DIR], { cwd: DESKTOP_DIR, env, stdio: 'ignore' });

  fs.writeFileSync(STATE_FILE, JSON.stringify({
    launcherPid: process.pid,
    appPid: app.pid,
    apiPort: Number(new URL(backend.baseUrl).port),
    mongoPort: Number(new URL(backend.mongoUri).port),
    startedAt: new Date().toISOString(),
  }, null, 2));

  console.log(`
==================== TEST MODE ====================
Server     ${backend.baseUrl}   (this PC only)
Database   ${backend.mongoUri}   (temporary, deleted on stop)
Workbook   ${path.join(workbookDir, 'Seed_Management.xlsx')}

Log in with:
  Superadmin (can add / edit / import)
    email     ${superadmin.email}
    password  ${superadmin.password}
  Admin (view only)
    email     ${admin.email}
    password  ${admin.password}

To stop: close the app window, or press Ctrl+C here,
         or run  npm run test-mode:stop  in another terminal.
===================================================
`);

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    console.log('Stopping test mode…');
    try { app.kill(); } catch (_) {}
    await backend.dispose();
    fs.rmSync(STATE_FILE, { force: true });
    console.log(`Stopped. The test database has been deleted.\nThe test workbook is still at: ${workbookDir}`);
    process.exit(0);
  }

  app.once('exit', shutdown);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, shutdown);
}

// ── stop (from another terminal) ─────────────────────────────────────────

async function stop() {
  const state = readState();
  if (!state) {
    console.log('Test mode is not running.');
    return;
  }

  // Closing the app is the normal stop: the launcher notices and shuts the
  // server and database down itself.
  killIf(state.appPid, 'electron.exe');
  for (let i = 0; i < 40 && fs.existsSync(STATE_FILE); i += 1) await sleep(250);

  if (fs.existsSync(STATE_FILE)) {
    // The launcher is gone or stuck — clean up what it left behind.
    killIf(state.launcherPid, 'node.exe');
    killIf(listeningPid(state.apiPort), 'node.exe');
    killIf(listeningPid(state.mongoPort), 'mongod.exe');
    await sleep(1000);
    try {
      for (const entry of fs.readdirSync(DB_ROOT)) {
        if (entry.startsWith('test-mode-')) fs.rmSync(path.join(DB_ROOT, entry), { recursive: true, force: true });
      }
    } catch (_) {}
    fs.rmSync(STATE_FILE, { force: true });
  }
  console.log('Test mode stopped.');
}

const command = process.argv[2] === 'stop' ? stop : start;
command().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
