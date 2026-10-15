// How the photo flow decides between its two engines (combineEngines), and
// the parser against the kinds of OCR output the real device has produced.
import {
  combineEngines, combinePassResults, parseWeightFromText, readingFromDigits, unitFromText, MESSAGES,
} from '../src/services/weightOcr';

const pass = (name, text) => ({pass: name, parsed: parseWeightFromText(text)});
const NAMES = ['original', 'gray', 'binary', 'binary-inverted'];
// What readWeightFromPhoto hands over for four ML Kit raw texts.
const mlkit = texts => {
  const passes = texts.map((t, i) => pass(NAMES[i], t));
  return {passes, final: combinePassResults(passes), rawTexts: texts};
};
const decide = (segment, texts) => {
  const m = mlkit(texts);
  return combineEngines(segment, m.final, m.passes, m.rawTexts);
};
const seg = (text, kind = 'lcd') => ({ok: true, text, kind});
const noSeg = {ok: false, reason: 'no-panel'};

describe('combineEngines', () => {
  test('a text-only reading is never accepted by itself: it is offered for explicit confirmation', () => {
    const r = decide(noSeg, ['12.50 kg', '12.50 kg', '', '']);
    expect(r.ok).toBe(false);
    expect(r.kg).toBeUndefined();
    expect(r.reason).toBe('low-confidence-text-only');
    expect(r.message).toBe(MESSAGES.textOnly);
    expect(r.choices.map(c => [c.engine, c.kg])).toEqual([['text', 12.5]]);
    // one pass alone, or nothing at all, is still just a rejection
    expect(decide(noSeg, ['12.50 kg', '', '', '']).reason).toBe('low-confidence-single-pass');
    expect(decide(noSeg, ['12.50 kg', '', '', '']).choices).toBeUndefined();
    expect(decide(null, ['', '', '', '']).ok).toBe(false);
  });

  test('the device case: a reflection hid digits and the text reader agreed with itself on "51"', () => {
    const glare = {ok: false, reason: 'glare', detail: 'lcd=no-lcd light=glare size=0.079'};
    const r = decide(glare, ['51 E', '51 E', '', '']);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('image-quality-glare');
    expect(r.choices).toBeUndefined();      // not even offered
    expect(r.kg).toBeUndefined();
  });

  test('a reflection or blur reported by the LCD reader blocks the text reader too', () => {
    const lcdGlare = {ok: false, reason: 'no-panel', detail: 'lcd=glare light=glare size=0.248'};
    expect(decide(lcdGlare, ['345', '345', '345', '']).reason).toBe('image-quality-glare');
    const blurred = {ok: false, reason: 'blurred', detail: 'soft=0.06'};
    expect(decide(blurred, ['5000 kg', '5000 kg', '', '']).reason).toBe('image-quality-blurred');
    // a light-panel guess alone does not: that finder also fires on bright surroundings
    const lightOnly = {ok: false, reason: 'no-panel', detail: 'lcd=no-lcd light=glare size=0.2'};
    expect(decide(lightOnly, ['12.50 kg', '12.50 kg', '', '']).reason).toBe('low-confidence-text-only');
  });

  test('the device case: segment reader reads the digits, the text reader returns garbage', () => {
    const r = decide(seg('500.0'), ['B8QIS0oe0', 'B8QIS0oe0\nkg', '', 'kg']);
    expect(r.ok).toBe(true);
    expect(r.kg).toBe(500);
    expect(r.detectedValue).toBe('500.0');
    expect(r.engine).toBe('segment');
    expect(r.confirmedByText).toBe(false);
    expect(r.otherReadings).toEqual([]);
    expect(r.detectedUnit).toBe('kg');
    expect(r.unitAssumed).toBe(false); // "kg" seen by two passes
  });

  test('both engines agree: confirmed', () => {
    const r = decide(seg('12.50'), ['12.50 kg', '12.50 kg', '12.50', '']);
    expect(r.kg).toBe(12.5);
    expect(r.confirmedByText).toBe(true);
    expect(r.otherReadings).toEqual([]);
  });

  test('both engines read a weight and they differ: not accepted, both offered to the user', () => {
    const r = decide(seg('3190', 'led'), ['319 kg', '319 kg', '', '']);
    expect(r.ok).toBe(false);
    expect(r.kg).toBeUndefined();          // nothing was picked
    expect(r.reason).toBe('low-confidence-conflicting-engines');
    expect(r.message).toBe(MESSAGES.disagree);
    expect(r.choices.map(c => [c.engine, c.kg])).toEqual([['segment', 3190], ['text', 319]]);
  });

  test('agreement and single-engine results carry no choices', () => {
    expect(decide(seg('12.50'), ['12.50 kg', '12.50 kg', '', '']).choices).toBeUndefined();
    expect(decide(seg('12.50'), ['', '', '', '']).choices).toBeUndefined();
    expect(decide(noSeg, ['12.50 kg', '12.50 kg', '', '']).choices).toHaveLength(1);
  });

  test('a different value from a single text pass does not block, but is reported', () => {
    const r = decide(seg('3190', 'led'), ['8190 kg', '', '13190 kg', '']);
    expect(r.ok).toBe(true);
    expect(r.kg).toBe(3190);
    expect(r.confirmedByText).toBe(false);
    expect(r.otherReadings).toEqual([8190, 13190]);
  });

  test('the unit needs two sightings and no contradiction, otherwise kg is assumed and flagged', () => {
    expect(decide(seg('250'), ['250 g', 'g', '', '']).kg).toBe(0.25);
    expect(decide(seg('250'), ['250 g', 'g', '', '']).converted).toBe(true);
    const once = decide(seg('250'), ['g', '', '', '']);
    expect(once.kg).toBe(250);
    expect(once.unitAssumed).toBe(true);
    const mixed = decide(seg('250'), ['g', 'g', 'kg', '']);
    expect(mixed.kg).toBe(250);
    expect(mixed.unitAssumed).toBe(true);
  });

  test('whole numbers and decimals are kept exactly as the display shows them', () => {
    expect(decide(seg('3456'), ['', '', '', '']).detectedValue).toBe('3456');
    expect(decide(seg('7.25'), ['', '', '', '']).kg).toBe(7.25);
    expect(decide(seg('0.5'), ['', '', '', '']).kg).toBe(0.5);
    expect(decide(seg('47.86'), ['', '', '', '']).detectedValue).toBe('47.86');
  });

  test('a zero display is refused with its own message', () => {
    const r = decide(seg('0.000'), ['0.000 kg', 'kg', '', '']);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('zero');
    expect(r.message).toBe(MESSAGES.zero);
  });

  test('digits with a leading zero and no point are refused (missed point / upside-down display)', () => {
    for (const text of ['0005', '05', '0500', '00.5']) {
      const r = decide(seg(text), ['', '', '', '']);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('leading-zero');
      expect(r.category).toBe('invalid');
    }
    expect(readingFromDigits('0.5', 'kg').ok).toBe(true);
    expect(readingFromDigits('0.05', 'kg').ok).toBe(true);
    expect(readingFromDigits('10', 'kg').ok).toBe(true);
  });

  test('anything from the segment reader that is not plain digits is refused', () => {
    for (const text of ['', '12.', 'B8QIS0oe0', '1 2', '-5', null]) {
      expect(decide(seg(text), ['', '', '', '']).ok).toBe(false);
    }
  });
});

describe('parser against device-style OCR output', () => {
  const kg = t => {
    const r = parseWeightFromText(t);
    return r.ok ? r.kg : null;
  };

  test('garbage is never turned into a weight', () => {
    for (const text of ['[B8QIS0oe0]', 'B8QIS0oe0', 'OIBS', 'l.O kg', 'S.OO', 'O.5O kg', 'I2.5O']) {
      expect(kg(text)).toBeNull();
    }
  });

  test('empty and unit-only results are rejected', () => {
    for (const text of ['', '   ', '\n', 'kg', null, undefined]) expect(kg(text)).toBeNull();
    expect(parseWeightFromText('').reason).toBe('empty-ocr-text');
    expect(parseWeightFromText('kg').reason).toBe('no-number-in-text');
  });

  test('unsupported or ambiguous formats are rejected', () => {
    expect(kg('12.5 lb')).toBeNull();            // unsupported unit glued to the number
    expect(kg('12.50 kg 3.20 kg')).toBeNull();   // two weights
    expect(kg('12.50 0.30')).toBeNull();         // two bare numbers (weight + tare?)
    expect(kg('52,350 kg')).toBeNull();          // thousands separator or decimal?
    expect(kg('52.')).toBeNull();                // decimal part lost
    expect(kg('-1.5 kg')).toBeNull();
  });

  test('clear readings keep their decimals and units', () => {
    expect(kg('12.50')).toBe(12.5);
    expect(kg('12.50 kg')).toBe(12.5);
    expect(kg('3190 kg')).toBe(3190);
    expect(kg('250 g')).toBe(0.25);
    expect(parseWeightFromText('12.50 kg').detectedValue).toBe('12.50');
  });

  test('unitFromText only accepts a label standing on its own', () => {
    expect(unitFromText('B8QIS0oe0\nkg')).toBe('kg');
    expect(unitFromText('Weighing')).toBe(null);
    expect(unitFromText('250g')).toBe('g');
  });
});

describe('readings in a unit the app does not record in', () => {
  const {foreignUnitFromText} = require('../src/services/weightOcr');
  const {createUnitVotes} = require('../src/services/liveWeight');

  test('pounds and ounces are never taken as kg', () => {
    for (const text of ['12.5 lb', '12.5lb', '27.6 LBS', '40 oz', '5 t', '12.5\nlb']) {
      const r = parseWeightFromText(text);
      if (text === '5 t') continue; // a lone "t" is too short to treat as a unit - see below
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('unsupported-unit');
      expect(r.message).toBe(MESSAGES.unit);
    }
  });

  test('the segment reading is refused when the text reader keeps seeing a foreign unit', () => {
    const r = decide(seg('12.5'), ['lb', '12.5 lb', '', '']);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsupported-unit');
    // one stray sighting is not enough to throw a reading away
    expect(decide(seg('12.5'), ['lb', '', '', '']).ok).toBe(true);
  });

  test('foreignUnitFromText only accepts a label standing on its own', () => {
    expect(foreignUnitFromText('12.5 lb')).toBe('lb');
    expect(foreignUnitFromText('OZ')).toBe('oz');
    expect(foreignUnitFromText('bulb')).toBe(null);
    expect(foreignUnitFromText('stable')).toBe(null);
    expect(foreignUnitFromText('kg')).toBe(null);
  });

  test('live reader: a foreign unit counts once it clearly outnumbers kg / g', () => {
    const v = createUnitVotes();
    v.add('foreign');
    expect(v.foreign()).toBe(false);
    v.add('foreign');
    expect(v.foreign()).toBe(true);
    v.add('kg'); v.add('kg');
    expect(v.foreign()).toBe(false);
  });
});

describe('qualityHint', () => {
  const {qualityHint} = require('../src/services/weightOcr');

  test('names the problem the reader reported, most specific first', () => {
    expect(qualityHint({ok: false, reason: 'blurred', detail: 'soft=0.061'})).toMatch(/not sharp/);
    expect(qualityHint({ok: false, reason: 'low-contrast', detail: 'p99=3.0'})).toMatch(/too faint/);
    expect(qualityHint({ok: false, reason: 'no-ink', detail: 'lcd=no-lcd light=merged-digits'})).toMatch(/too small/);
    // the reason of every display style tried counts, not only the first
    expect(qualityHint({ok: false, reason: 'merged-digits', detail: 'lcd=unknown-pattern light=blurred'})).toMatch(/not sharp/);
    expect(qualityHint({ok: false, reason: 'unassigned-ink', detail: 'at=990 size=10x96'})).toMatch(/only the digits/);
  });

  test('says nothing when there is no usable clue, or when the photo was read', () => {
    expect(qualityHint({ok: false, reason: 'no-panel', detail: 'lcd=no-lcd light=no-light-panel'})).toBe(null);
    expect(qualityHint({ok: false, reason: 'segment-reader-unavailable'})).toBe(null);
    expect(qualityHint({ok: true, text: '12.5'})).toBe(null);
    expect(qualityHint(null)).toBe(null);
  });
});

describe('automatic display detection (assessDetection)', () => {
  const {assessDetection, AUTO_DETECT} = require('../src/services/weightOcr');
  const box = {x: 0.3, y: 0.4, w: 0.4, h: 0.2};
  const crop = {x: 0.25, y: 0.35, w: 0.5, h: 0.3};
  const good = {found: true, certain: true, ok: true, text: '500.0', kind: 'lcd', box, crop, cutOff: false, tooSmall: false};

  test('a display that was found whole, large enough and read is cropped without asking', () => {
    expect(assessDetection(good)).toEqual({mode: 'auto', crop});
  });

  test('nothing found, or no usable coordinates: the user frames the display', () => {
    expect(assessDetection(null).mode).toBe('manual');
    expect(assessDetection({found: false, reason: 'no-panel'})).toMatchObject({mode: 'manual', crop: null, reason: 'no-panel'});
    expect(assessDetection({...good, crop: undefined}).mode).toBe('manual');
    expect(assessDetection({...good, crop: {x: 0.9, y: 0.1, w: 0.4, h: 0.2}}).mode).toBe('manual');   // outside the photo
    expect(assessDetection({...good, crop: {x: 0.1, y: 0.1, w: NaN, h: 0.2}}).mode).toBe('manual');
    expect(assessDetection({found: false, reason: 'detector-error'}).message).toBe(MESSAGES.notFound);
  });

  test('a guess that is not a certain detection still becomes the starting box for manual framing', () => {
    const r = assessDetection({found: false, ok: false, reason: 'digit-count', box, crop});
    expect(r.mode).toBe('manual');
    expect(r.crop).toEqual(crop);
  });

  test('a display running off the photo is refused even though digits were read in it', () => {
    const r = assessDetection({...good, certain: false, cutOff: true});
    expect(r).toMatchObject({mode: 'retake', reason: 'display-cut-off', message: MESSAGES.cutOff, crop});
  });

  test('a display too small in the photo is refused', () => {
    expect(assessDetection({...good, certain: false, tooSmall: true})).toMatchObject({mode: 'retake', reason: 'display-too-small'});
    const narrow = {...box, w: AUTO_DETECT.minWidthFraction / 2};
    expect(assessDetection({...good, box: narrow}).reason).toBe('display-too-small');
  });

  test('a reflection or blur on the display asks for a retake and says what to fix', () => {
    const glare = assessDetection({found: true, certain: false, ok: false, reason: 'glare', detail: 'size=0.08', box, crop});
    expect(glare).toMatchObject({mode: 'retake', reason: 'image-quality-glare'});
    expect(glare.hint).toMatch(/reflection/i);
    const blur = assessDetection({found: true, certain: false, ok: false, reason: 'blurred', box, crop});
    expect(blur).toMatchObject({mode: 'retake', reason: 'image-quality-blurred'});
    expect(blur.hint).toMatch(/sharp/i);
  });

  test('a display that is there but could not be read for another reason goes to manual framing', () => {
    const r = assessDetection({found: true, certain: false, ok: false, reason: 'ambiguous-segment', box, crop});
    expect(r).toMatchObject({mode: 'manual', reason: 'ambiguous-segment', crop});
  });

  test('read but not flagged certain is never used automatically', () => {
    expect(assessDetection({...good, certain: false}).mode).toBe('manual');
  });
});

describe('what a confirmed reading puts in the weight field (weightFieldValue)', () => {
  const {weightFieldValue} = require('../src/services/weightOcr');

  test('a kg display is kept character for character: no decimal place dropped or added', () => {
    expect(weightFieldValue(decide(seg('1.70', 'led'), ['', '', '', '']))).toBe('1.70');
    expect(weightFieldValue(decide(seg('1.10', 'led'), ['', '', '', '']))).toBe('1.10');
    expect(weightFieldValue(decide(seg('500.0'), ['', '', '', '']))).toBe('500.0');
    expect(weightFieldValue(decide(seg('3190', 'led'), ['', '', '', '']))).toBe('3190');
    expect(weightFieldValue(readingFromDigits('0.500', 'kg'))).toBe('0.500');
    expect(weightFieldValue(parseWeightFromText('12.50 kg'))).toBe('12.50');
  });

  test('a reading in grams is written as the converted kg number', () => {
    expect(weightFieldValue(readingFromDigits('250', 'g'))).toBe('0.25');
    expect(weightFieldValue(parseWeightFromText('1700 g'))).toBe('1.7');
  });

  test('nothing is written for a refusal', () => {
    expect(weightFieldValue(decide(noSeg, ['', '', '', '']))).toBe('');
    expect(weightFieldValue(decide(seg('0.000'), ['', '', '', '']))).toBe('');
    expect(weightFieldValue(null)).toBe('');
  });
});

describe('red LED display: 1 against 7, the decimal point, incomplete pictures', () => {
  const {assessDetection, qualityHint} = require('../src/services/weightOcr');
  const {liveRefusal} = require('../src/services/liveWeight');
  const box = {x: 0.29, y: 0.34, w: 0.4, h: 0.13};
  const crop = {x: 0.25, y: 0.31, w: 0.5, h: 0.19};

  test('segment reader says 1.70, text reader says 1.10: neither is accepted, both are offered as shown', () => {
    const r = decide(seg('1.70', 'led'), ['1.10 kg', '1.10 kg', '', '']);
    expect(r.ok).toBe(false);
    expect(r.kg).toBeUndefined();
    expect(r.reason).toBe('low-confidence-conflicting-engines');
    expect(r.choices.map(c => [c.engine, c.detectedValue, c.detectedUnit])).toEqual([
      ['segment', '1.70', 'kg'], ['text', '1.10', 'kg'],
    ]);
  });

  test('a point one reader saw and the other did not is a disagreement, not a rounding matter', () => {
    const r = decide(seg('1.70', 'led'), ['170 kg', '170 kg', '', '']);
    expect(r.ok).toBe(false);
    expect(r.choices.map(c => c.kg)).toEqual([1.7, 170]);
  });

  test('the printed kg label is the unit, never part of the number', () => {
    const r = decide(seg('1.70', 'led'), ['Kg.', 'WEIGHT\nKg.', '', '']);
    expect(r.ok).toBe(true);
    expect(r.detectedValue).toBe('1.70');
    expect(r.detectedUnit).toBe('kg');
    expect(r.unitAssumed).toBe(false);
  });

  test('digits running out of the picture: refused outright, the text reader is not asked', () => {
    const cut = {ok: false, reason: 'display-cut-off', detail: 'no room beside the digits'};
    const r = decide(cut, ['70 kg', '70 kg', '70', '']);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('display-cut-off');
    expect(r.message).toBe(MESSAGES.cutOff);
    expect(r.choices).toBeUndefined();
    expect(r.kg).toBeUndefined();
    expect(qualityHint(cut)).toMatch(/space around the digits/);
  });

  test('detection that found the digits cut off asks for a retake and never crops automatically', () => {
    const r = assessDetection({found: true, certain: false, ok: false, reason: 'display-cut-off', box, crop, cutOff: false, tooSmall: false});
    expect(r).toMatchObject({mode: 'retake', reason: 'display-cut-off', message: MESSAGES.cutOff, crop});
  });

  test('live scan: a cut-off display tells the user what to do', () => {
    const r = liveRefusal({ok: false, reason: 'display-cut-off'});
    expect(r.ok).toBe(false);
    expect(r.category).toBe('ambiguous');
    expect(r.message).toMatch(/whole display in view/);
  });

  test('a reflection or blur on the lit digits is refused, whatever the text reader agrees on', () => {
    expect(decide({ok: false, reason: 'glare', detail: 'unclear-ink at=97 size=49x28'}, ['1.70', '1.70', '', '']).reason).toBe('image-quality-glare');
    expect(decide({ok: false, reason: 'blurred', detail: 'soft=0.051'}, ['170', '170', '', '']).reason).toBe('image-quality-blurred');
  });
});

describe('reconcileSegment', () => {
  const {reconcileSegment} = require('../src/services/weightOcr');
  const detected = {ok: true, text: '500.0', kind: 'lcd'};

  test('no detection reading: the crop reading stands as it is', () => {
    const cropRead = {ok: false, reason: 'no-panel'};
    expect(reconcileSegment(cropRead, undefined)).toBe(cropRead);
    expect(reconcileSegment(cropRead, {ok: false, reason: 'glare'})).toBe(cropRead);
  });

  test('both read the same digits', () => {
    const cropRead = {ok: true, text: '500.0', kind: 'lcd'};
    expect(reconcileSegment(cropRead, detected)).toBe(cropRead);
  });

  test('a decimal point seen one way and not the other is a refusal, never a pick', () => {
    const r = reconcileSegment({ok: true, text: '5000', kind: 'lcd'}, detected);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('segment-reads-differ');
    // and combineEngines does not let the text reader settle it by itself
    const m = mlkit(['5000 kg', '5000 kg', '', '']);
    const final = combineEngines(r, m.final, m.passes, m.rawTexts);
    expect(final.ok).toBe(false);
    expect(final.kg).toBeUndefined();
  });

  test('only the detection read digits: its reading is used and marked', () => {
    const r = reconcileSegment({ok: false, reason: 'panel-shape'}, detected);
    expect(r).toEqual({ok: true, text: '500.0', kind: 'lcd', fromDetection: true});
    expect(decide(r, ['', '', '', '']).detectedValue).toBe('500.0');   // formatting kept
  });
});

// The displayed string ("1.70") and the number used for calculations (1.7)
// are kept apart from the segment reader through to the weight field.
describe('displayed precision is preserved', () => {
  const {weightFieldValue, shownWeight} = require('../src/services/weightOcr');
  const {describeReading} = require('../src/services/liveWeight');

  test('physical red LED photo: 1.70 stays 1.70 through confirmation and the form', () => {
    const r = decide(seg('1.70', 'led'), ['', '', '', '']);
    expect(r.ok).toBe(true);
    expect(r.detectedValue).toBe('1.70');
    expect(r.kg).toBe(1.7);
    expect(describeReading(r).display).toBe('1.70 kg');   // confirmation card
    expect(weightFieldValue(r)).toBe('1.70');             // weight field
    expect(shownWeight(weightFieldValue(r))).toBe('1.70'); // later summary rows
  });

  test('ML Kit reading "1.7" for the same display agrees with it; the segment string is kept', () => {
    const r = decide(seg('1.70', 'led'), ['1.7 kg', '1.7 kg', '', '']);
    expect(r.ok).toBe(true);
    expect(weightFieldValue(r)).toBe('1.70');
  });

  test('other decimal positions are kept as shown, not padded or rounded', () => {
    for (const s of ['0.125', '12.5', '500.0', '3190', '0.50', '10.000']) {
      const r = decide(seg(s), ['', '', '', '']);
      expect(weightFieldValue(r)).toBe(s);
      expect(shownWeight(weightFieldValue(r))).toBe(s);
    }
  });

  test('grams are converted for the field; manual text is shown as typed', () => {
    expect(weightFieldValue(readingFromDigits('250', 'g'))).toBe('0.25');
    expect(shownWeight('2')).toBe('2');
    expect(shownWeight(' 1.250 ')).toBe('1.250');
    expect(shownWeight('')).toBe('0');
    expect(shownWeight('abc')).toBe('0');
  });
});

// Capture Photo read by the backend's vision model, cross-checked by the
// phone's seven-segment reader (aiWeightRead.js). Pure decision logic.
describe('server (vision AI) reading', () => {
  const {readingFromAi, combineAiAndSegment, weightFieldValue: field} = require('../src/services/weightOcr');
  const ai = (value, unit = 'kg') => readingFromAi({status: 'ok', value, unit, display_text: `${value} ${unit}`});
  const phone = text => ({ok: true, text, kind: 'led'});

  test('the displayed string is kept exactly: 1.70 is not 1.7', () => {
    const r = ai('1.70');
    expect(r.ok).toBe(true);
    expect(r.detectedValue).toBe('1.70');
    expect(r.kg).toBe(1.7);
    expect(field(r)).toBe('1.70');
  });

  test('grams are converted, no unit means kg assumed and flagged', () => {
    expect(ai('250', 'g').kg).toBe(0.25);
    const none = readingFromAi({status: 'ok', value: '12.5', unit: null});
    expect(none.kg).toBe(12.5);
    expect(none.unitAssumed).toBe(true);
  });

  test('unclear, missing or odd answers are never a reading', () => {
    for (const a of [null, {status: 'unclear', value: null, reason: 'glare'}, {status: 'ok', value: null}, {status: 'ok', value: 1.7}]) {
      const r = readingFromAi(a);
      expect(r.ok).toBe(false);
      expect(r.message).toBe(MESSAGES.aiUnclear);
    }
    expect(readingFromAi({status: 'ok', value: '0.00', unit: 'kg'}).reason).toBe('zero');
    expect(readingFromAi({status: 'ok', value: '05', unit: 'kg'}).ok).toBe(false);
  });

  test('both agree -> accepted, with the phone string keeping the precision', () => {
    const r = combineAiAndSegment(ai('1.7'), phone('1.70'));
    expect(r.ok).toBe(true);
    expect(r.engine).toBe('ai+segment');
    expect(r.detectedValue).toBe('1.70');
    expect(r.note).toBe(null);
  });

  test('they disagree -> never picked between: both offered', () => {
    for (const other of ['1.10', '170', '17.0', '7.0']) {
      const r = combineAiAndSegment(ai('1.70'), phone(other));
      expect(r.ok).toBe(false);
      expect(r.message).toBe(MESSAGES.disagree);
      expect(r.choices.map(c => c.detectedValue)).toEqual(['1.70', other]);
    }
  });

  test('only the server read it -> never a result to confirm: retake, its value only as an unconfirmed choice', () => {
    // the real case: a reflection over the point, the model said "0.70" for 1.70
    const r = combineAiAndSegment(ai('0.70'), {ok: false, reason: 'glare', detail: 'size=0.1'});
    expect(r.ok).toBe(false);
    expect(r.kg).toBeUndefined();
    expect(r.message).toBe(MESSAGES.aiOnly);
    expect(r.hint).toMatch(/reflection/);
    expect(r.choices).toHaveLength(1);
    expect(r.choices[0].detectedValue).toBe('0.70');
    expect(r.choices[0].unconfirmed).toBe(true);
    expect(combineAiAndSegment(ai('1.70'), null).ok).toBe(false);
  });

  test('only the phone read it (server unclear or unreachable) -> offered with a note', () => {
    const down = {ok: false, reason: 'ai-error', message: 'Unable to connect to server'};
    const r = combineAiAndSegment(down, phone('1.70'));
    expect(r.ok).toBe(true);
    expect(r.engine).toBe('segment');
    expect(r.note).toBe(MESSAGES.aiFailedPhoneRead);
    expect(combineAiAndSegment(readingFromAi({status: 'unclear'}), phone('3190')).detectedValue).toBe('3190');
  });

  test('neither -> refused with the reason, plus a fix-it hint from the phone', () => {
    const r = combineAiAndSegment(readingFromAi({status: 'unclear', reason: 'blurred'}), {ok: false, reason: 'blurred', detail: 'soft=0.06'});
    expect(r.ok).toBe(false);
    expect(r.message).toBe(MESSAGES.aiUnclear);
    expect(r.hint).toMatch(/not sharp/);
    const down = combineAiAndSegment({ok: false, reason: 'ai-error', message: 'Reading the weight took too long.'}, null);
    expect(down.ok).toBe(false);
    expect(down.message).toBe('Reading the weight took too long.');
    expect(combineAiAndSegment(ai('0.000'), phone('0.000')).message).toBe(MESSAGES.zero);
  });
});
