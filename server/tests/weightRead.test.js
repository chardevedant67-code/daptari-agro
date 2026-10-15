// POST /api/weight-read and the Qwen reply validation. OpenRouter is never
// called: fetch is replaced in every test, and the key used is a fake one.
require('./setup');
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockRes, freshRequireCache } = require('./helpers');

const FAKE_KEY = 'sk-or-test-not-real';
const reply = (obj) => (typeof obj === 'string' ? obj : JSON.stringify(obj));
const okFetch = (content, capture = {}) => async (url, init) => {
  capture.url = url;
  capture.init = init;
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
};

function loadReader() {
  freshRequireCache('../utils/qwenWeightReader');
  return require('../utils/qwenWeightReader');
}

describe('parseModelReply: only a clean reading of the display is accepted', () => {
  const { parseModelReply } = loadReader();
  const ok = (value, unit = 'kg', display_text = `${value} ${unit}`) => reply({ status: 'ok', value, unit, display_text, reason: null });

  it('keeps the displayed string exactly, trailing zeros included', () => {
    const r = parseModelReply(ok('1.70'));
    assert.deepEqual(r, { status: 'ok', value: '1.70', unit: 'kg', display_text: '1.70 kg', reason: null });
    for (const v of ['0.125', '12.5', '500.0', '3190', '10.000']) assert.equal(parseModelReply(ok(v)).value, v);
  });

  it('normalises the unit and allows none', () => {
    assert.equal(parseModelReply(ok('250', 'G', '250 g')).unit, 'g');
    assert.equal(parseModelReply(ok('1.70', 'Kg.', '1.70 Kg.')).unit, 'kg');
    assert.equal(parseModelReply(reply({ status: 'ok', value: '1.70', unit: null, display_text: '1.70' })).unit, null);
  });

  it('accepts the JSON inside a code fence or a sentence', () => {
    assert.equal(parseModelReply('```json\n' + ok('1.70') + '\n```').value, '1.70');
    assert.equal(parseModelReply('Here is the reading: ' + ok('1.70')).value, '1.70');
  });

  it('an unclear reply is passed on, never a value', () => {
    const r = parseModelReply(reply({ status: 'unclear', value: '1.7', unit: 'kg', display_text: '1.?0', reason: 'glare over the decimal point' }));
    assert.equal(r.status, 'unclear');
    assert.equal(r.value, null);
    assert.equal(r.reason, 'glare over the decimal point');
  });

  it('refuses whatever could be a misreading', () => {
    const cases = [
      ['not json', 'unreadable-model-reply'],
      [reply({ status: 'ok', value: 1.7, unit: 'kg', display_text: '1.70 kg' }), 'value-not-a-string'], // precision lost
      [ok('1.7.0'), 'invalid-value'],
      [ok('1,70', 'kg', '1,70 kg'), 'invalid-value'],
      [ok('-1.70'), 'invalid-value'],
      [ok('1.70kg'), 'invalid-value'],
      [ok(''), 'invalid-value'],
      [ok('05'), 'leading-zero'],
      [ok('3.5', 'lb', '3.5 lb'), 'unsupported-unit'],
      [ok('1.70', 'kg', '150 kg'), 'inconsistent-reply'], // value is not what it says it saw
      [reply({ status: 'yes', value: '1.70', unit: 'kg' }), 'model-unclear'],
    ];
    for (const [text, why] of cases) {
      const r = parseModelReply(text);
      assert.equal(r.status, 'unclear', text);
      assert.equal(r.value, null, text);
      assert.equal(r.reason, why, text);
    }
  });
});

describe('readWeightImage: the OpenRouter request', () => {
  let saved;
  beforeEach(() => { saved = { ...process.env }; });
  afterEach(() => { process.env = saved; });

  it('sends the photo to the configured model with the key in the header only', async () => {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    delete process.env.OPENROUTER_MODEL;
    const { readWeightImage } = loadReader();
    const cap = {};
    const r = await readWeightImage(Buffer.from([1, 2, 3]), 'image/jpeg', { fetchImpl: okFetch(reply({ status: 'ok', value: '1.70', unit: 'kg', display_text: '1.70 kg' }), cap) });
    assert.equal(cap.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(cap.init.headers.Authorization, `Bearer ${FAKE_KEY}`);
    const body = JSON.parse(cap.init.body);
    assert.equal(body.model, 'qwen/qwen2.5-vl-72b-instruct');
    assert.equal(body.temperature, 0);
    assert.equal(body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,AQID');
    assert.equal(r.value, '1.70');
    assert.equal(r.model, 'qwen/qwen2.5-vl-72b-instruct');
    assert.ok(!JSON.stringify(r).includes(FAKE_KEY));
  });

  it('without a key it refuses before any request', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { readWeightImage } = loadReader();
    let called = false;
    await assert.rejects(
      readWeightImage(Buffer.from([1]), 'image/jpeg', { fetchImpl: async () => { called = true; } }),
      (e) => e.code === 'NOT_CONFIGURED' && e.status === 503,
    );
    assert.equal(called, false);
  });

  it('upstream failures and timeouts are errors, never a value', async () => {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    const { readWeightImage } = loadReader();
    await assert.rejects(readWeightImage(Buffer.from([1]), 'image/jpeg', { fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) }),
      (e) => e.code === 'AI_UNAVAILABLE' && e.status === 502);
    await assert.rejects(readWeightImage(Buffer.from([1]), 'image/jpeg', { fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
      (e) => e.code === 'AI_UNAVAILABLE');
    const slow = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    await assert.rejects(readWeightImage(Buffer.from([1]), 'image/jpeg', { fetchImpl: slow, timeoutMs: 20 }),
      (e) => e.code === 'AI_TIMEOUT' && e.status === 504);
  });
});

describe('POST /api/weight-read handler', () => {
  let saved;
  let savedFetch;
  beforeEach(() => { saved = { ...process.env }; savedFetch = global.fetch; process.env.OPENROUTER_API_KEY = FAKE_KEY; });
  afterEach(() => { process.env = saved; global.fetch = savedFetch; });

  function handler() {
    freshRequireCache('../utils/qwenWeightReader', '../routes/weightReadRoutes');
    const router = require('../routes/weightReadRoutes');
    const layer = router.stack.find((l) => l.route && l.route.path === '/' && l.route.methods.post);
    return layer.route.stack.map((s) => s.handle);
  }

  it('is behind operator login, a rate limit and the photo upload', () => {
    const stack = handler();
    assert.equal(stack.length, 4);
    assert.equal(stack[0].name, 'protectUser');
  });

  it('no photo -> 400, and the model is not called', async () => {
    let called = false;
    global.fetch = async () => { called = true; };
    const h = handler().at(-1);
    const res = mockRes();
    await h({ user: { _id: 'u1' }, file: undefined }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'NO_PHOTO');
    assert.equal(called, false);
  });

  it('a reading comes back with the displayed string intact', async () => {
    global.fetch = okFetch(reply({ status: 'ok', value: '1.70', unit: 'kg', display_text: '1.70 kg' }));
    const h = handler().at(-1);
    const res = mockRes();
    await h({ user: { _id: 'u1' }, file: { buffer: Buffer.from([1, 2]), mimetype: 'image/jpeg' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.value, '1.70');
    assert.equal(res.body.unit, 'kg');
  });

  it('an unclear photo is a normal answer telling the app to ask for a retake', async () => {
    global.fetch = okFetch(reply({ status: 'unclear', value: null, unit: null, display_text: null, reason: 'display cut off' }));
    const h = handler().at(-1);
    const res = mockRes();
    await h({ user: { _id: 'u1' }, file: { buffer: Buffer.from([1]), mimetype: 'image/png' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'unclear');
    assert.equal(res.body.value, null);
  });

  it('the model being down is a 502 with a message, not a value', async () => {
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const h = handler().at(-1);
    const res = mockRes();
    await h({ user: { _id: 'u1' }, file: { buffer: Buffer.from([1]), mimetype: 'image/jpeg' } }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_UNAVAILABLE');
    assert.equal(res.body.value, undefined);
  });
});
