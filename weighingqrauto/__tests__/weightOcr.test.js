import {parseWeightFromText, combinePassResults, MESSAGES} from '../src/services/weightOcr';

const kg = t => {
  const r = parseWeightFromText(t);
  return r.ok ? r.kg : null;
};

describe('parseWeightFromText', () => {
  test('kg with decimals', () => {
    expect(kg('52.35 kg')).toBe(52.35);
    expect(kg('52.350 kg')).toBe(52.35);
    expect(kg('52.35kg')).toBe(52.35);
    expect(kg('52.35\nkg')).toBe(52.35);
    expect(kg('5,24 KG')).toBe(5.24);
  });

  test('grams are converted to kg', () => {
    expect(kg('52350 g')).toBe(52.35);
    expect(kg('52350\ng')).toBe(52.35);
    expect(kg('500 G')).toBe(0.5);
    const r = parseWeightFromText('52350 g');
    expect(r.converted).toBe(true);
    expect(r.unitAssumed).toBe(false);
  });

  test('no unit → kg assumed and flagged', () => {
    const r = parseWeightFromText('52.35');
    expect(r.ok).toBe(true);
    expect(r.kg).toBe(52.35);
    expect(r.unitAssumed).toBe(true);
  });

  test('one unit-bearing number wins over other bare numbers', () => {
    expect(kg('NET\n52.35 kg\nST 3')).toBe(52.35);
  });

  test('rejects empty / non-numeric', () => {
    expect(kg('')).toBeNull();
    expect(kg(null)).toBeNull();
    expect(kg('NET ST')).toBeNull();
  });

  test('rejects ambiguous candidates', () => {
    expect(kg('52.35 kg 10.00 kg')).toBeNull();
    expect(kg('52.35 10.00')).toBeNull();
    expect(kg('5 2.35')).toBeNull();
  });

  test('rejects zero and unreasonable values', () => {
    expect(kg('0.00 kg')).toBeNull();
    expect(kg('0 g')).toBeNull();
    expect(kg('0.1 g')).toBeNull();
  });

  test('has no upper limit: a large scale is read as shown', () => {
    expect(kg('3190 kg')).toBe(3190);
    expect(kg('99999 kg')).toBe(99999);
  });

  test('rejects unreadable decimals', () => {
    expect(kg('52. kg')).toBeNull();
    expect(kg('.35 kg')).toBeNull();
    expect(kg('52,350')).toBeNull();
  });

  test('real phone result: search-UI text with no digits is rejected, not guessed', () => {
    // Actual ML Kit output seen on the test phone when the photo did not
    // contain the scale display (blocks=6, no numbers anywhere).
    const r = parseWeightFromText('Q\nSearch\n...\n...');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-number-in-text');
  });

  test('display text laid out over several lines', () => {
    expect(kg('NET\n52.35\nkg')).toBe(52.35);
    expect(kg('52350\ng')).toBe(52.35);
  });

  test('negative sign is never read as a positive weight value', () => {
    // "-52.35" has the digits only; the sign is not part of the candidate,
    // so make sure a leading minus is rejected explicitly.
    expect(kg('-52.35 kg')).toBeNull();
  });
});

describe('real weighing-machine formats', () => {
  test.each([
    ['52.35 kg', 52.35],
    ['52.350 kg', 52.35],
    ['52.35KG', 52.35],
    ['52.35', 52.35],
    ['52350 g', 52.35],
    ['52350G', 52.35],
    ['500 g', 0.5],
    ['0.523 kg', 0.523],
    ['0.500 kg', 0.5],
  ])('%s -> %s kg', (text, expected) => {
    expect(kg(text)).toBe(expected);
  });
});

describe('corrupted / non-weight OCR output is rejected, never guessed', () => {
  test.each([
    'B8QIS0oe0',   // actual ML Kit output seen on the phone for the digital display
    'abc',
    'hello',
    'B8QIS0oe0' + String.fromCharCode(10) + 'kg',
    '52.35 10.00',
    '-52.35 kg',
    '0.00 kg',
    '52. kg',
    '52,350',
  ])('%s', text => {
    expect(parseWeightFromText(text).ok).toBe(false);
  });

  test('B8QIS0oe0 is not turned into digits', () => {
    const r = parseWeightFromText('B8QIS0oe0');
    expect(r.reason).toBe('no-number-after-glued-filter');
    expect(r.message).toBe(MESSAGES.unreadable);
  });

  test('error messages are specific', () => {
    expect(parseWeightFromText('52.35 10.00').message).toBe(MESSAGES.ambiguous);
    expect(parseWeightFromText('0.00 kg').message).toBe(MESSAGES.invalid);
    expect(parseWeightFromText('hello').message).toBe(MESSAGES.unreadable);
  });
});

describe('combinePassResults (multi-pass consensus)', () => {
  const pass = (name, text) => ({pass: name, parsed: parseWeightFromText(text)});

  test('accepts when two passes agree', () => {
    const r = combinePassResults([
      pass('original', '52.35 kg'), pass('gray', '52.35'), pass('binary', 'B8QIS0oe0'),
      pass('binary-inverted', ''),
    ]);
    expect(r.ok).toBe(true);
    expect(r.kg).toBe(52.35);
    expect(r.unitAssumed).toBe(false); // prefers the pass that saw the unit
  });

  test('g and kg readings of the same weight agree', () => {
    const r = combinePassResults([pass('original', '52350 g'), pass('gray', '52.35 kg')]);
    expect(r.ok).toBe(true);
    expect(r.kg).toBe(52.35);
  });

  test('a single lone reading is not trusted', () => {
    const r = combinePassResults([
      pass('original', '52.35 kg'), pass('gray', 'B8QIS0oe0'), pass('binary', ''),
    ]);
    expect(r.ok).toBe(false);
    expect(r.message).toBe(MESSAGES.unverified);
  });

  test('conflicting readings are rejected', () => {
    const r = combinePassResults([pass('original', '52.35 kg'), pass('gray', '55.35 kg')]);
    expect(r.ok).toBe(false);
    expect(r.message).toBe(MESSAGES.unverified);
  });

  test('all passes unreadable', () => {
    const r = combinePassResults([pass('original', 'B8QIS0oe0'), pass('gray', 'hello')]);
    expect(r.ok).toBe(false);
    expect(r.message).toBe(MESSAGES.unreadable);
  });

  test('ambiguity is reported over plain unreadable', () => {
    const r = combinePassResults([pass('original', 'hello'), pass('gray', '52.35 10.00')]);
    expect(r.message).toBe(MESSAGES.ambiguous);
  });
});
