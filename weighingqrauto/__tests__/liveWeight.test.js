import {parseWeightFromText} from '../src/services/weightOcr';
import {
  createLiveWeightTracker, describeReading, guideBoxToCrop, nextMode,
  LIVE_MODES, MAX_MISSES, READ_TTL_MS,
} from '../src/services/liveWeight';

const read = text => parseWeightFromText(text);
const miss = () => parseWeightFromText('');

describe('createLiveWeightTracker', () => {
  test('starts out searching', () => {
    const t = createLiveWeightTracker();
    expect(t.reset()).toEqual({status: 'searching', reading: null, agree: 0, message: null, zero: null});
  });

  test('one read is shown but not yet steady; a second matching frame makes it steady', () => {
    const t = createLiveWeightTracker();
    const first = t.push(read('52.35 kg'), 1000);
    expect(first.status).toBe('reading');
    expect(first.reading.kg).toBe(52.35);
    const second = t.push(read('52.35 kg'), 1800);
    expect(second.status).toBe('steady');
    expect(second.agree).toBe(2);
  });

  test('the same weight seen with and without its unit still agrees', () => {
    const t = createLiveWeightTracker();
    t.push(read('52.35 kg'), 1000);
    expect(t.push(read('52.35'), 1800).status).toBe('steady');
  });

  test('a different value follows the display and has to be confirmed again', () => {
    const t = createLiveWeightTracker();
    t.push(read('52.35 kg'), 1000);
    t.push(read('52.35 kg'), 1800);
    const changed = t.push(read('52.85 kg'), 2600);
    expect(changed.status).toBe('reading');
    expect(changed.reading.kg).toBe(52.85);
    expect(changed.agree).toBe(1);
    expect(t.push(read('52.85 kg'), 3400).status).toBe('steady');
  });

  test('a misread between two good frames breaks the agreement', () => {
    const t = createLiveWeightTracker();
    t.push(read('52.35 kg'), 1000);
    t.push(read('2.35 kg'), 1800);
    const back = t.push(read('52.35 kg'), 2600);
    expect(back.status).toBe('reading');
    expect(back.agree).toBe(1);
  });

  test('a frame or two of glare keeps the value; too many clears it', () => {
    const t = createLiveWeightTracker();
    t.push(read('52.35 kg'), 1000);
    t.push(read('52.35 kg'), 1800);
    let s;
    for (let i = 1; i < MAX_MISSES; i += 1) {
      s = t.push(miss(), 1800 + i * 800);
      expect(s.status).toBe('steady');
      expect(s.reading.kg).toBe(52.35);
    }
    s = t.push(miss(), 1800 + MAX_MISSES * 800);
    expect(s).toEqual({status: 'searching', reading: null, agree: 0, message: null, zero: null});
  });

  test('a good frame resets the miss count', () => {
    const t = createLiveWeightTracker();
    t.push(read('1.5 kg'), 0);
    for (let i = 0; i < 10; i += 1) {
      t.push(miss(), 100 + i * 300);
      t.push(miss(), 200 + i * 300);
      expect(t.push(read('1.5 kg'), 300 + i * 300).status).toBe('steady');
    }
  });

  test('an old read does not count towards agreement', () => {
    const t = createLiveWeightTracker();
    t.push(read('52.35 kg'), 1000);
    const late = t.push(read('52.35 kg'), 1000 + READ_TTL_MS + 1);
    expect(late.status).toBe('reading');
    expect(late.agree).toBe(1);
  });

  test('says why when the display shows several values, but not for a plain miss', () => {
    const t = createLiveWeightTracker();
    expect(t.push(read('12.5 kg 3.2 kg'), 0).message).toMatch(/Multiple readings/);
    expect(t.push(miss(), 100).message).toBe(null);
  });

  test('zero on the display is never offered as a weight', () => {
    const t = createLiveWeightTracker();
    t.push(read('0.00 kg'), 0);
    const s = t.push(read('0.00 kg'), 800);
    expect(s.status).toBe('searching');
    expect(s.reading).toBe(null);
  });

  test('reset forgets everything', () => {
    const t = createLiveWeightTracker();
    t.push(read('52.35 kg'), 1000);
    t.push(read('52.35 kg'), 1800);
    expect(t.reset().status).toBe('searching');
    expect(t.push(read('52.35 kg'), 2600).status).toBe('reading');
  });
});

describe('nextMode', () => {
  test('keeps the mode that just produced a reading', () => {
    expect(nextMode('gray', true)).toBe('gray');
  });

  test('moves through every mode on misses and wraps around', () => {
    const seen = [];
    let mode = LIVE_MODES[0];
    for (let i = 0; i < LIVE_MODES.length; i += 1) {
      seen.push(mode);
      mode = nextMode(mode, false);
    }
    expect(seen).toEqual(LIVE_MODES);
    expect(mode).toBe(LIVE_MODES[0]);
  });
});

describe('guideBoxToCrop', () => {
  const noPad = {x: 0, y: 0};

  test('photo and preview of the same shape: the box maps straight across', () => {
    const crop = guideBoxToCrop({w: 300, h: 400}, {w: 3000, h: 4000}, {x: 30, y: 100, w: 240, h: 80}, noPad);
    expect(crop.x).toBeCloseTo(0.1);
    expect(crop.y).toBeCloseTo(0.25);
    expect(crop.w).toBeCloseTo(0.8);
    expect(crop.h).toBeCloseTo(0.2);
  });

  test('a taller preview hides the sides of the photo, so the box is narrower within it', () => {
    // 3:4 photo filling a 1:2 preview: shown 300 wide, 100 hidden on each side.
    const crop = guideBoxToCrop({w: 200, h: 400}, {w: 3000, h: 4000}, {x: 0, y: 0, w: 200, h: 400}, noPad);
    expect(crop.x).toBeCloseTo(1 / 6);
    expect(crop.w).toBeCloseTo(2 / 3);
    expect(crop.y).toBeCloseTo(0);
    expect(crop.h).toBeCloseTo(1);
  });

  test('a wider preview hides the top and bottom of the photo', () => {
    const crop = guideBoxToCrop({w: 400, h: 200}, {w: 4000, h: 3000}, {x: 0, y: 0, w: 400, h: 200}, noPad);
    expect(crop.y).toBeCloseTo(1 / 6);
    expect(crop.h).toBeCloseTo(2 / 3);
    expect(crop.w).toBeCloseTo(1);
  });

  test('the default margin widens the crop and never leaves the photo', () => {
    const tight = guideBoxToCrop({w: 300, h: 400}, {w: 3000, h: 4000}, {x: 30, y: 100, w: 240, h: 80}, noPad);
    const padded = guideBoxToCrop({w: 300, h: 400}, {w: 3000, h: 4000}, {x: 30, y: 100, w: 240, h: 80});
    expect(padded.x).toBeLessThan(tight.x);
    expect(padded.y).toBeLessThan(tight.y);
    expect(padded.w).toBeGreaterThan(tight.w);
    expect(padded.h).toBeGreaterThan(tight.h);

    const edge = guideBoxToCrop({w: 300, h: 400}, {w: 3000, h: 4000}, {x: 0, y: 0, w: 300, h: 400});
    expect(edge).toEqual({x: 0, y: 0, w: 1, h: 1});
  });

  test('returns null until both sizes are known', () => {
    const box = {x: 0, y: 0, w: 10, h: 10};
    expect(guideBoxToCrop(null, {w: 1, h: 1}, box)).toBe(null);
    expect(guideBoxToCrop({w: 0, h: 0}, {w: 1, h: 1}, box)).toBe(null);
    expect(guideBoxToCrop({w: 10, h: 10}, {w: 0, h: 0}, box)).toBe(null);
    expect(guideBoxToCrop({w: 10, h: 10}, {w: 10, h: 10}, null)).toBe(null);
  });
});

describe('describeReading', () => {
  test('kg shown as read', () => {
    expect(describeReading(read('52.35 kg'))).toEqual({display: '52.35 kg', kg: 52.35, note: null});
  });

  test('grams shown as read, with the kg value the app stores', () => {
    expect(describeReading(read('250 g'))).toEqual({display: '250 g', kg: 0.25, note: '= 0.25 kg'});
  });

  test('no unit on the display is called out', () => {
    const d = describeReading(read('5.24'));
    expect(d.display).toBe('5.24 kg');
    expect(d.note).toMatch(/assuming kg/);
  });

  test('nothing for a failed read', () => {
    expect(describeReading(miss())).toBe(null);
    expect(describeReading(null)).toBe(null);
  });
});

describe('native reader helpers', () => {
  const {
    readingFromDigits, unitFromText, createUnitVotes, NATIVE_TRACKING,
  } = require('../src/services/liveWeight');

  test('digits become a kg reading, with no upper limit', () => {
    expect(readingFromDigits('3190', 'kg')).toEqual({
      ok: true, kg: 3190, detectedValue: '3190', detectedUnit: 'kg', converted: false, unitAssumed: false,
    });
    expect(readingFromDigits('500.0', 'kg').kg).toBe(500);
    expect(readingFromDigits('99999', 'kg').kg).toBe(99999);
    expect(describeReading(readingFromDigits('3190', 'kg')).display).toBe('3190 kg');
  });

  test('the value keeps the digits exactly as the display shows them', () => {
    expect(readingFromDigits('500.0', 'kg').detectedValue).toBe('500.0');
    expect(readingFromDigits('0.50', 'kg').kg).toBe(0.5);
  });

  test('grams are converted; an unconfirmed unit is assumed kg and says so', () => {
    const g = readingFromDigits('250', 'g');
    expect(g.kg).toBe(0.25);
    expect(g.converted).toBe(true);
    expect(describeReading(g)).toEqual({display: '250 g', kg: 0.25, note: '= 0.25 kg'});
    const none = readingFromDigits('12.5', null);
    expect(none.kg).toBe(12.5);
    expect(none.unitAssumed).toBe(true);
  });

  test('zero and anything that is not plain digits is refused', () => {
    expect(readingFromDigits('0.0', 'kg').ok).toBe(false);
    expect(readingFromDigits('0.0', 'kg').category).toBe('invalid');
    for (const bad of ['', '12.', '.5', '1.2.3', '-5', '12kg', null, undefined, 12]) {
      expect(readingFromDigits(bad, 'kg').ok).toBe(false);
    }
  });

  test('unitFromText finds a unit label standing on its own', () => {
    expect(unitFromText('kg')).toBe('kg');
    expect(unitFromText('3190 KG')).toBe('kg');
    expect(unitFromText('8190kg')).toBe('kg');
    expect(unitFromText('250\ng')).toBe('g');
    expect(unitFromText('Weighing')).toBe(null);
    expect(unitFromText('kgs')).toBe(null);
    expect(unitFromText('ZERO TARE')).toBe(null);
    expect(unitFromText('')).toBe(null);
    expect(unitFromText(null)).toBe(null);
  });

  test('a unit counts only after two sightings and a clear majority', () => {
    const v = createUnitVotes();
    expect(v.unit()).toBe(null);
    v.add('g');
    expect(v.unit()).toBe(null);          // one stray "g" changes nothing
    v.add('kg'); v.add('kg');
    expect(v.unit()).toBe('kg');
    v.add('g');
    expect(v.unit()).toBe(null);          // 2 : 2 - undecided again
    v.add(null); v.add('lb');
    expect(v.unit()).toBe(null);
    v.add('kg');
    expect(v.unit()).toBe('kg');
  });

  test('the fast reader must agree over three frames and tolerates more misses', () => {
    const t = createLiveWeightTracker(NATIVE_TRACKING);
    const r = () => readingFromDigits('3190', 'kg');
    expect(t.push(r(), 0).status).toBe('reading');
    expect(t.push(r(), 100).status).toBe('reading');
    expect(t.push(r(), 200).status).toBe('steady');
    for (let i = 1; i < NATIVE_TRACKING.maxMisses; i += 1) {
      expect(t.push({ok: false, category: 'unreadable'}, 200 + i * 100).status).toBe('steady');
    }
    expect(t.push({ok: false, category: 'unreadable'}, 2000).status).toBe('searching');
  });

  test('a unit confirmed as grams restarts agreement, because the stored value changed', () => {
    const t = createLiveWeightTracker(NATIVE_TRACKING);
    t.push(readingFromDigits('250', null), 0);
    t.push(readingFromDigits('250', null), 100);
    expect(t.push(readingFromDigits('250', null), 200).status).toBe('steady');
    const s = t.push(readingFromDigits('250', 'g'), 300);
    expect(s.status).toBe('reading');
    expect(s.reading.kg).toBe(0.25);
  });
});

describe('zero and unclear decimal points', () => {
  const {readingFromDigits, NATIVE_TRACKING, MESSAGES_LIVE} = require('../src/services/liveWeight');

  test('a zero display is shown but never becomes a reading', () => {
    const t = createLiveWeightTracker(NATIVE_TRACKING);
    let s;
    for (let i = 0; i < 6; i += 1) s = t.push(readingFromDigits('0.000', 'kg'), i * 100);
    expect(s.status).toBe('searching');
    expect(s.reading).toBe(null);
    expect(s.zero).toBe('0.000 kg');
    expect(s.message).toBe(MESSAGES_LIVE.zero);
    // once a real weight is on, the zero note is gone
    s = t.push(readingFromDigits('12.5', 'kg'), 700);
    expect(s.zero).toBe(null);
    expect(s.reading.kg).toBe(12.5);
  });

  test('the same digits seen with and without a decimal point are refused for the session', () => {
    const t = createLiveWeightTracker(NATIVE_TRACKING);
    t.push(readingFromDigits('500.0', 'kg'), 0);
    t.push(readingFromDigits('500.0', 'kg'), 100);
    expect(t.push(readingFromDigits('500.0', 'kg'), 200).status).toBe('steady');
    let s = t.push(readingFromDigits('5000', 'kg'), 300);
    expect(s.status).toBe('searching');
    expect(s.message).toBe(MESSAGES_LIVE.decimal);
    // it does not recover by itself - not even for the punctuation seen first
    for (let i = 0; i < 5; i += 1) s = t.push(readingFromDigits('500.0', 'kg'), 400 + i * 100);
    expect(s.status).toBe('searching');
    // a different weight is unaffected
    t.push(readingFromDigits('3190', 'kg'), 1000);
    t.push(readingFromDigits('3190', 'kg'), 1100);
    expect(t.push(readingFromDigits('3190', 'kg'), 1200).status).toBe('steady');
    // reopening the scanner starts afresh
    t.reset();
    t.push(readingFromDigits('500.0', 'kg'), 2000);
    t.push(readingFromDigits('500.0', 'kg'), 2100);
    expect(t.push(readingFromDigits('500.0', 'kg'), 2200).status).toBe('steady');
  });

  test('a point in a different place is also a conflict', () => {
    const t = createLiveWeightTracker();
    t.push(readingFromDigits('12.50', 'kg'), 0);
    expect(t.push(readingFromDigits('125.0', 'kg'), 100).message).toBe(MESSAGES_LIVE.decimal);
  });
});

describe('liveRefusal', () => {
  const {liveRefusal, NATIVE_TRACKING} = require('../src/services/liveWeight');

  test('a reflection or a blurred frame tells the user what to do', () => {
    const glare = liveRefusal({ok: false, reason: 'glare', detail: 'size=0.306'});
    expect(glare.ok).toBe(false);
    expect(glare.message).toMatch(/reflection/);
    expect(liveRefusal({ok: false, reason: 'no-panel', detail: 'lcd=glare light=no-light-panel'}).message).toMatch(/reflection/);
    expect(liveRefusal({ok: false, reason: 'blurred', detail: 'soft=0.06'}).message).toMatch(/not sharp/);
    // the glow reader's spot on an unlit segment inside the reading is treated as a reflection
    expect(liveRefusal({ok: false, reason: 'glare', detail: 'unlit-spot-in-reading at=170'}).message).toMatch(/reflection/);
  });

  test('digits found but too small asks the user to move closer; a sub-reader saying so does not', () => {
    expect(liveRefusal({ok: false, reason: 'digits-too-small', detail: 'px=22'}).message).toMatch(/Move closer/);
    expect(liveRefusal({ok: false, reason: 'no-panel', detail: 'lcd=no-lcd light=digits-too-small'}).message).toBe(null);
  });

  test('any other refusal just means nothing readable yet, and says nothing', () => {
    for (const reason of ['no-panel', 'merged-digits', 'no-ink', 'unknown-pattern', 'no-frame']) {
      const r = liveRefusal({ok: false, reason});
      expect(r.ok).toBe(false);
      expect(r.message).toBe(null);
    }
    expect(liveRefusal(null).ok).toBe(false);
  });

  test('a reflection never yields a reading, however many frames show it', () => {
    const t = createLiveWeightTracker(NATIVE_TRACKING);
    let s;
    for (let i = 0; i < 10; i += 1) s = t.push(liveRefusal({ok: false, reason: 'glare'}), i * 100);
    expect(s.status).toBe('searching');
    expect(s.reading).toBe(null);
    expect(s.message).toMatch(/reflection/);
  });
});

describe('automatic capture', () => {
  const {createAutoCapture, sameReading, AUTO_CAPTURE} = require('../src/services/liveWeight');
  const reading = (detectedValue, kg) => ({ok: true, detectedValue, kg, detectedUnit: 'kg'});
  const steady = r => ({status: 'steady', reading: r});

  test('fires only after the configured run of steady frames with the display located', () => {
    const auto = createAutoCapture({steadyFrames: 3});
    const r = reading('500.0', 500);
    expect(auto.push(steady(r), true)).toBe(false);
    expect(auto.push(steady(r), true)).toBe(false);
    expect(auto.push(steady(r), true)).toBe(true);
  });

  test('a frame that is not steady, or has no display box, starts the count again', () => {
    const auto = createAutoCapture({steadyFrames: 2});
    const r = reading('500.0', 500);
    expect(auto.push(steady(r), true)).toBe(false);
    expect(auto.push({status: 'reading', reading: r}, true)).toBe(false);
    expect(auto.push(steady(r), true)).toBe(false);
    expect(auto.push(steady(r), false)).toBe(false);
    expect(auto.push(steady(r), true)).toBe(false);
    expect(auto.push(steady(r), true)).toBe(true);
    expect(auto.push({status: 'searching', reading: null}, false)).toBe(false);
  });

  test('a change of value - or only of its decimal point - starts the count again', () => {
    const auto = createAutoCapture({steadyFrames: 2});
    expect(auto.push(steady(reading('500.0', 500)), true)).toBe(false);
    expect(auto.push(steady(reading('500', 500)), true)).toBe(false);
    expect(auto.push(steady(reading('500', 500)), true)).toBe(true);
  });

  test('switched off, it never fires: the Capture button is the only way', () => {
    const auto = createAutoCapture({enabled: false, steadyFrames: 1});
    expect(auto.push(steady(reading('12.5', 12.5)), true)).toBe(false);
    expect(auto.push(steady(reading('12.5', 12.5)), true)).toBe(false);
  });

  test('defaults come from AUTO_CAPTURE', () => {
    const auto = createAutoCapture();
    const r = reading('3190', 3190);
    let fired = 0;
    for (let i = 0; i < AUTO_CAPTURE.steadyFrames; i += 1) fired += auto.push(steady(r), true) ? 1 : 0;
    expect(fired).toBe(AUTO_CAPTURE.enabled ? 1 : 0);
  });

  test('sameReading: the kept frame must show the same digits and point', () => {
    expect(sameReading(reading('500.0', 500), reading('500.0', 500))).toBe(true);
    expect(sameReading(reading('500.0', 500), reading('500', 500))).toBe(false);
    expect(sameReading(reading('500.0', 500), reading('500.0', 0.5))).toBe(false);   // unit changed
    expect(sameReading(reading('500.0', 500), null)).toBe(false);
    expect(sameReading({ok: false}, {ok: false})).toBe(false);
  });
});
