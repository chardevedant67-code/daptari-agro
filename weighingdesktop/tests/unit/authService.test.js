const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuthService } = require('../../electron/authService');
const { createMemoryTokenStore, createSafeTokenStore } = require('../../electron/tokenStore');
const { ApiError } = require('../../electron/apiClient');
const { loadConfig, DEFAULT_API_URL } = require('../../electron/config');

const admin = (role) => ({ id: 'a1', name: 'Asha', email: 'asha@x.io', role, avatar: '' });

function fakeApi(handlers) {
  const calls = [];
  const run = (method) => async (path, bodyOrOptions, maybeOptions) => {
    const options = method === 'GET' ? bodyOrOptions : maybeOptions;
    const body = method === 'GET' ? undefined : bodyOrOptions;
    calls.push({ method, path, body, auth: !(options && options.auth === false) });
    const handler = handlers[`${method} ${path}`];
    if (!handler) throw new ApiError({ kind: 'http', status: 404, message: 'not found' });
    return { status: 200, data: await handler(body) };
  };
  return { calls, get: run('GET'), post: run('POST'), put: run('PUT') };
}

describe('auth service — uses only the existing backend endpoints', () => {
  it('login posts the credentials to /api/auth/login and stores the returned token', async () => {
    const api = fakeApi({ 'POST /api/auth/login': () => ({ success: true, token: 'jwt-1', admin: admin('superadmin') }) });
    const tokenStore = createMemoryTokenStore();
    const auth = createAuthService({ api, tokenStore });
    const session = await auth.login('asha@x.io', 'secret-pass');

    assert.deepEqual(api.calls[0], { method: 'POST', path: '/api/auth/login', body: { email: 'asha@x.io', password: 'secret-pass' }, auth: false });
    assert.equal(auth.getToken(), 'jwt-1');
    assert.equal(session.canManage, true);
    assert.equal(tokenStore.load().token, 'jwt-1');
    assert.equal('password' in tokenStore.load(), false, 'the password is never stored');
    assert.ok(!JSON.stringify(tokenStore.load()).includes('secret-pass'));
  });

  it('a refused login stores nothing and passes the server message on', async () => {
    const api = fakeApi({ 'POST /api/auth/login': () => { throw new ApiError({ kind: 'http', status: 401, message: 'Invalid email or password' }); } });
    const tokenStore = createMemoryTokenStore();
    const auth = createAuthService({ api, tokenStore });
    await assert.rejects(auth.login('asha@x.io', 'wrong'), /Invalid email or password/);
    assert.equal(auth.getSession(), null);
    assert.equal(tokenStore.load(), null);
  });

  for (const [role, canManage] of [['superadmin', true], ['admin', false], ['operator', false], [undefined, false], ['SuperAdmin', false]]) {
    it(`role ${JSON.stringify(role)} -> canManage ${canManage}`, async () => {
      const api = fakeApi({ 'POST /api/auth/login': () => ({ success: true, token: 't', admin: admin(role) }) });
      const auth = createAuthService({ api, tokenStore: createMemoryTokenStore() });
      assert.equal((await auth.login('a@x.io', 'p')).canManage, canManage);
    });
  }

  it('refresh takes the role from /api/auth/me, so a demotion made elsewhere takes effect', async () => {
    let role = 'superadmin';
    const api = fakeApi({
      'POST /api/auth/login': () => ({ success: true, token: 't', admin: admin(role) }),
      'GET /api/auth/me': () => ({ success: true, admin: admin(role) }),
    });
    const changes = [];
    const auth = createAuthService({ api, tokenStore: createMemoryTokenStore(), onSessionChange: (s) => changes.push(s && s.canManage) });
    await auth.login('a@x.io', 'p');
    role = 'admin';
    const session = await auth.refresh();
    assert.equal(session.canManage, false);
    assert.equal(auth.getToken(), 't', 'the token is kept');
    assert.deepEqual(changes, [true, false]);
  });

  it('refresh signs out when the server no longer accepts the session (401)', async () => {
    const api = fakeApi({
      'POST /api/auth/login': () => ({ success: true, token: 't', admin: admin('admin') }),
      'GET /api/auth/me': () => { throw new ApiError({ kind: 'http', status: 401, message: 'Account not found or inactive' }); },
    });
    const tokenStore = createMemoryTokenStore();
    const auth = createAuthService({ api, tokenStore });
    await auth.login('a@x.io', 'p');
    assert.equal(await auth.refresh(), null);
    assert.equal(auth.getToken(), null);
    assert.equal(tokenStore.load(), null);
  });

  it('restore: no remembered session -> stays signed out, no request made', async () => {
    const api = fakeApi({});
    const auth = createAuthService({ api, tokenStore: createMemoryTokenStore() });
    assert.equal(await auth.restore(), null);
    assert.equal(api.calls.length, 0);
  });

  it('restore: remembered session is re-confirmed with the server', async () => {
    const tokenStore = createMemoryTokenStore();
    tokenStore.save({ token: 'old', admin: admin('superadmin') });
    const api = fakeApi({ 'GET /api/auth/me': () => ({ success: true, admin: admin('admin') }) });
    const auth = createAuthService({ api, tokenStore });
    const session = await auth.restore();
    assert.equal(session.verified, true);
    assert.equal(session.canManage, false, 'the server\'s current role wins over the remembered one');
  });

  it('restore offline: remembered profile is used but marked unverified', async () => {
    const tokenStore = createMemoryTokenStore();
    tokenStore.save({ token: 'old', admin: admin('admin') });
    const api = fakeApi({ 'GET /api/auth/me': () => { throw new ApiError({ kind: 'network', message: 'Cannot reach the server.' }); } });
    const auth = createAuthService({ api, tokenStore });
    const session = await auth.restore();
    assert.equal(session.verified, false);
    assert.equal(tokenStore.load().token, 'old');
  });

  it('restore with a rejected token signs out and forgets it', async () => {
    const tokenStore = createMemoryTokenStore();
    tokenStore.save({ token: 'old', admin: admin('superadmin') });
    const api = fakeApi({ 'GET /api/auth/me': () => { throw new ApiError({ kind: 'http', status: 401, message: 'Token invalid or expired' }); } });
    const auth = createAuthService({ api, tokenStore });
    assert.equal(await auth.restore(), null);
    assert.equal(tokenStore.load(), null);
  });

  it('register calls the public sign-up endpoint and never keeps its token or signs in', async () => {
    const api = fakeApi({ 'POST /api/user/register': () => ({ success: true, token: 'operator-jwt', user: { id: 'u1', role: 'operator' } }) });
    const tokenStore = createMemoryTokenStore();
    const auth = createAuthService({ api, tokenStore });
    const result = await auth.register('Ravi', 'ravi@x.io', 'pass-123');
    assert.deepEqual(api.calls[0], { method: 'POST', path: '/api/user/register', body: { name: 'Ravi', email: 'ravi@x.io', password: 'pass-123' }, auth: false });
    assert.equal(Object.keys(api.calls[0].body).includes('role'), false, 'no role is ever sent');
    assert.match(result.message, /cannot open desktop records/);
    assert.equal(auth.getSession(), null);
    assert.equal(auth.getToken(), null);
    assert.equal(tokenStore.load(), null);
  });

  it('forgotPassword relays the backend message', async () => {
    const api = fakeApi({ 'POST /api/auth/forgot-password': () => ({ success: true, message: 'If an account exists for this email, a password reset link has been sent.' }) });
    const auth = createAuthService({ api, tokenStore: createMemoryTokenStore() });
    assert.match((await auth.forgotPassword('a@x.io')).message, /If an account exists/);
    assert.deepEqual(api.calls[0].body, { email: 'a@x.io' });
  });

  it('logout clears the session even if the server cannot be reached', async () => {
    const api = fakeApi({ 'POST /api/auth/login': () => ({ success: true, token: 't', admin: admin('admin') }) });
    const tokenStore = createMemoryTokenStore();
    const auth = createAuthService({ api, tokenStore });
    await auth.login('a@x.io', 'p');
    await auth.logout();
    assert.equal(auth.getSession(), null);
    assert.equal(tokenStore.load(), null);
  });
});

describe('token store — encrypted at rest', () => {
  // Stand-in for Electron's safeStorage (DPAPI on Windows).
  const fakeSafeStorage = (available = true) => ({
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(text, 'utf8').map((b) => b ^ 0x5a),
    decryptString: (buffer) => Buffer.from(buffer).map((b) => b ^ 0x5a).toString('utf8'),
  });

  it('what is written to disk is not the plain token', () => {
    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wd-token-')), 'session.bin');
    const store = createSafeTokenStore({ safeStorage: fakeSafeStorage(), filePath });
    store.save({ token: 'very-secret-jwt', admin: admin('admin') });
    assert.equal(fs.readFileSync(filePath).includes('very-secret-jwt'), false);

    const reopened = createSafeTokenStore({ safeStorage: fakeSafeStorage(), filePath });
    assert.equal(reopened.load().token, 'very-secret-jwt');
    reopened.clear();
    assert.equal(fs.existsSync(filePath), false);
  });

  it('without OS encryption nothing is written to disk at all', () => {
    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wd-token-')), 'session.bin');
    const store = createSafeTokenStore({ safeStorage: fakeSafeStorage(false), filePath });
    store.save({ token: 'very-secret-jwt', admin: admin('admin') });
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(store.load().token, 'very-secret-jwt', 'still usable for this run');
  });

  it('a corrupt file is treated as signed out', () => {
    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wd-token-')), 'session.bin');
    fs.writeFileSync(filePath, 'garbage');
    assert.equal(createSafeTokenStore({ safeStorage: fakeSafeStorage(), filePath }).load(), null);
  });
});

describe('config', () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-config-'));

  it('defaults to a local backend — never a deployed one', () => {
    const config = loadConfig({ env: {}, appRoot: emptyRoot });
    assert.equal(config.apiUrl, DEFAULT_API_URL);
    assert.equal(new URL(config.apiUrl).hostname, 'localhost');
    assert.equal(config.workbookDir, null);
  });

  it('environment variables win over the .env file; trailing slashes are dropped', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-config-'));
    fs.writeFileSync(path.join(root, '.env'), '# comment\nDESKTOP_API_URL="http://file-host:5001/"\nDESKTOP_WORKBOOK_DIR=C:\\Out\nMONGO_URI=should-be-ignored\n');
    assert.equal(loadConfig({ env: {}, appRoot: root }).apiUrl, 'http://file-host:5001');
    assert.equal(loadConfig({ env: {}, appRoot: root }).workbookDir, 'C:\\Out');
    assert.equal(loadConfig({ env: { DESKTOP_API_URL: 'http://env-host:7000//' }, appRoot: root }).apiUrl, 'http://env-host:7000');
  });

  it('rejects a malformed or non-http backend address', () => {
    assert.throws(() => loadConfig({ env: { DESKTOP_API_URL: 'not a url' }, appRoot: emptyRoot }), /not a valid URL/);
    assert.throws(() => loadConfig({ env: { DESKTOP_API_URL: 'mongodb://host/db' }, appRoot: emptyRoot }), /http/);
  });

  describe('installed (packaged) app', () => {
    const rootWith = (content) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-config-'));
      if (content !== undefined) fs.writeFileSync(path.join(root, 'production.config.json'), content);
      return root;
    };
    const PRODUCTION = 'https://weighingqrauto-backend.onrender.com';

    it('uses only the address built into the installer', () => {
      const root = rootWith(JSON.stringify({ apiUrl: `${PRODUCTION}/` }));
      const config = loadConfig({ packaged: true, env: {}, appRoot: root });
      assert.deepEqual(config, { apiUrl: PRODUCTION, workbookDir: null, userDataDir: null });
    });

    it('ignores environment variables and .env files completely', () => {
      const root = rootWith(JSON.stringify({ apiUrl: PRODUCTION }));
      fs.writeFileSync(path.join(root, '.env'), 'DESKTOP_API_URL=http://localhost:5001\nDESKTOP_WORKBOOK_DIR=C:\\Elsewhere\n');
      const config = loadConfig({
        packaged: true,
        env: { DESKTOP_API_URL: 'http://127.0.0.1:62046', DESKTOP_WORKBOOK_DIR: 'C:\\Temp', DESKTOP_USER_DATA_DIR: 'C:\\Temp2' },
        appRoot: root,
      });
      assert.equal(config.apiUrl, PRODUCTION);
      assert.equal(config.workbookDir, null);
      assert.equal(config.userDataDir, null);
    });

    it('never falls back to localhost: a missing address stops the app', () => {
      assert.throws(() => loadConfig({ packaged: true, env: {}, appRoot: rootWith() }), /no valid server address/);
      assert.throws(() => loadConfig({ packaged: true, env: { DESKTOP_API_URL: PRODUCTION }, appRoot: rootWith() }), /no valid server address/);
    });

    for (const [label, content] of [
      ['an empty address', JSON.stringify({ apiUrl: '' })],
      ['a file without an address', JSON.stringify({})],
      ['a corrupt file', '{ not json'],
      ['plain http', JSON.stringify({ apiUrl: 'http://weighingqrauto-backend.onrender.com' })],
      ['https localhost', JSON.stringify({ apiUrl: 'https://localhost:5001' })],
      ['https 127.0.0.1', JSON.stringify({ apiUrl: 'https://127.0.0.1:5001' })],
      ['https ::1', JSON.stringify({ apiUrl: 'https://[::1]:5001' })],
      ['a database address', JSON.stringify({ apiUrl: 'mongodb+srv://cluster.example.net/db' })],
    ]) {
      it(`rejects ${label}`, () => {
        assert.throws(() => loadConfig({ packaged: true, env: {}, appRoot: rootWith(content) }), /no valid server address/);
      });
    }

    it('the address shipped in this repo is the approved production server, over https', () => {
      const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'production.config.json'), 'utf8'));
      assert.deepEqual(shipped, { apiUrl: PRODUCTION });
      assert.equal(loadConfig({ packaged: true, env: {} }).apiUrl, PRODUCTION);
    });

    it('development mode is unchanged: still local by default', () => {
      assert.equal(loadConfig({ env: {}, appRoot: rootWith(JSON.stringify({ apiUrl: PRODUCTION })) }).apiUrl, DEFAULT_API_URL);
    });
  });

  it('has no setting for a database at all', () => {
    const config = loadConfig({ env: { MONGO_URI: 'mongodb://x', DESKTOP_API_URL: 'http://h:1' }, appRoot: emptyRoot });
    assert.deepEqual(Object.keys(config).sort(), ['apiUrl', 'userDataDir', 'workbookDir']);
  });
});
