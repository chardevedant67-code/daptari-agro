const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig } = require('./config');
const { createCore } = require('./core');
const { createSafeTokenStore } = require('./tokenStore');
const { checkWritableDir, appDataErrorMessage } = require('./appDataCheck');

let config;
try {
  config = loadConfig({ packaged: app.isPackaged });
} catch (err) {
  dialog.showErrorBox('Seed Management cannot start', err.message);
  process.exit(1);
}
// Must happen before the app is ready.
if (config.userDataDir) app.setPath('userData', config.userDataDir);

// Without a writable data folder nothing could be kept, and Electron could
// not even take its single-instance lock (kept in that folder), which would
// make the app quit without a word. So check first, before that lock, and
// stop with a message saying what to fix. showErrorBox works before ready.
const dataDir = app.getPath('userData');
function cannotStart(code) {
  dialog.showErrorBox('Seed Management cannot start', appDataErrorMessage(dataDir, code));
  app.exit(1);
}
const dataDirProblem = checkWritableDir(dataDir);

let mainWindow = null;
let core = null;

function send(event, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(`desktop:event:${event}`, payload);
  }
}

// Everything the renderer is allowed to ask for. Anything not listed here
// cannot be invoked from the UI.
function buildMethods() {
  return {
    'app.info': () => ({ ...core.getColumns(), version: app.getVersion(), apiUrl: core.apiUrl, workbookPath: core.workbookPath }),

    'auth.restore': () => core.restore(),
    'auth.login': (email, password) => core.login(email, password),
    'auth.register': (name, email, password) => core.register(name, email, password),
    'auth.forgotPassword': (email) => core.forgotPassword(email),
    'auth.logout': () => core.logout(),

    'data.get': () => ({ rows: core.getRows(), status: core.getStatus() }),
    'records.create': (fields) => core.createRecord(fields),
    'records.update': (recordId, fields) => core.updateRecord(recordId, fields),
    'records.resolveConflict': (recordId, choice) => core.resolveConflict(recordId, choice),
    'records.retry': (recordId) => core.retryRecord(recordId),
    'records.discard': (recordId) => core.discardChange(recordId),

    'sync.now': () => core.syncNow(),

    'workbook.showInFolder': () => {
      if (!fs.existsSync(core.workbookPath)) throw new Error('The workbook has not been written yet.');
      shell.showItemInFolder(core.workbookPath);
      return true;
    },
    // "Save a copy": a plain file copy of the workbook the app already
    // wrote from backend data — never a separate export of on-screen rows.
    'workbook.saveCopy': async () => {
      if (!fs.existsSync(core.workbookPath)) throw new Error('The workbook has not been written yet.');
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save a copy of Seed_Management.xlsx',
        defaultPath: path.join(app.getPath('documents'), 'Seed_Management - copy.xlsx'),
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      });
      if (canceled || !filePath) return null;
      if (path.resolve(filePath).toLowerCase() === path.resolve(core.workbookPath).toLowerCase()) {
        throw new Error('Choose a different name — that is the live workbook.');
      }
      fs.copyFileSync(core.workbookPath, filePath);
      return filePath;
    },
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    title: 'Seed Management',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The window only ever shows the bundled UI.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

if (dataDirProblem) {
  cannotStart(dataDirProblem.code);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    try {
      core = createCore({
        apiUrl: config.apiUrl,
        dataDir,
        workbookDir: config.workbookDir || app.getPath('documents'),
        tokenStore: createSafeTokenStore({ safeStorage, filePath: path.join(dataDir, 'session.bin') }),
        onEvent: send,
      });
    } catch (err) {
      return cannotStart(err && err.code);
    }

    const methods = buildMethods();
    ipcMain.handle('desktop:call', async (_event, method, args) => {
      const fn = Object.prototype.hasOwnProperty.call(methods, method) ? methods[method] : null;
      if (!fn) return { ok: false, error: 'Unknown request.' };
      try {
        return { ok: true, value: await fn(...(Array.isArray(args) ? args : [])) };
      } catch (err) {
        return { ok: false, error: core.friendly(err) };
      }
    });

    createWindow();
  });

  app.on('window-all-closed', () => {
    if (core) core.dispose();
    app.quit();
  });
}
