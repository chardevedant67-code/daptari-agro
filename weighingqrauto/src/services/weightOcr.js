// Weight-display OCR: photo of a digital scale -> a single, validated weight
// in KG (the unit the whole app and backend already assume).
//
//   display found in the photo automatically (detectDisplay / assessDetection;
//   the user frames it by hand only when that is not certain)
//   -> crop -> seven-segment reader on the crop (digits read from
//   their lit segments - the engine built for this kind of display)
//                     -> 4 preprocessing passes -> ML Kit on each pass
//                        -> strict parser per pass -> consensus across passes
//   -> the two engines compared (combineEngines) -> one KG value
//
// ML Kit is a printed-text model: on segment digits it returns things like
// "B8QIS0oe0". It stays in as the reader for displays that are not
// seven-segment, as the source of the unit label, and as a cross-check.
//
// Parsing, consensus and the comparison are pure so they are unit-tested
// without a device.
// Principle throughout: never guess. A value is returned only when it has a
// clear numeric structure AND independent passes agree.
import {NativeModules} from 'react-native';

export const MIN_KG = 0.001; // 1 g
// No upper limit: the display is read as it is, whatever the scale's capacity.
// Passes that must independently produce the same KG value.
export const MIN_AGREEING_PASSES = 2;

// TEMPORARY diagnostics for real-device OCR debugging - set to false once the
// scale display is reading reliably.
export const WEIGHT_OCR_DEBUG = true;
const log = (label, value) => {
  if (WEIGHT_OCR_DEBUG) console.log(`[WeightOCR] ${label}`, value);
};

// User-facing messages (no technical detail; that stays in the logs).
export const MESSAGES = {
  camera: 'Unable to capture the scale display. Please try again.',
  unreadable: 'Could not read the scale display. Keep the display clear and try again.',
  ambiguous: 'Multiple readings detected. Capture only the main weight display.',
  invalid: 'The detected value is not a valid weight.',
  unverified: 'Weight could not be verified. Please retake the photo.',
  zero: 'The scale reads zero. Put the packet on it.',
  unit: 'This display is not showing kg or g. Switch the scale to kg and try again.',
  disagree: 'Two different readings were found. Check the display and choose the right one, retake the photo, or type the weight.',
  textOnly: 'This reading could not be double-checked. Compare it with the display before using it, or retake the photo.',
  cutOff: 'The display runs off the edge of the photo, so digits may be missing. Retake with the whole display in view, or adjust the crop.',
  tooSmall: 'The display is too small in the photo. Move closer and retake.',
  notFound: 'The display could not be found automatically. Frame it yourself.',
  differ: 'The display was read two different ways. Retake the photo, adjust the crop, or type the weight.',
  aiUnclear: 'The weight could not be read clearly. Retake the photo straight-on, without glare, with the whole display in view - or type the weight.',
  aiOnly: "The phone could not confirm the server's reading. Retake the photo straight-on and close, or type the weight. Use the server's reading only if it matches the display exactly.",
  aiFailedPhoneRead: 'The server could not read this photo; the phone read it. Check it against the display before confirming.',
};

// What automatic display detection must deliver before its crop is used
// without asking the user to frame the display. Change these to tune it.
export const AUTO_DETECT = {
  enabled: true,
  // The display window must be at least this share of the photo's width.
  minWidthFraction: 0.08,
};

// Unit labels this app does not record in. A number followed by one of these
// is a real reading in another unit - never to be taken as kg.
const FOREIGN_UNIT = '(lbs?|oz|mg|tons?|tonnes?|ct|st|kn)';

function categoryOf(reason) {
  if (/^ambiguous-multiple/.test(reason)) return 'ambiguous';
  if (/^(zero|negative|out-of-range|unreadable-decimal|ambiguous-comma-format|leading-zero|unsupported-unit)$/.test(reason)) {
    return 'invalid';
  }
  if (/^low-confidence/.test(reason)) return 'unverified';
  return 'unreadable';
}

// `candidates` is diagnostic only (what the parser saw); it never changes
// the accept/reject decision.
const reject = (reason, candidates = []) => {
  log('rejection reason:', reason);
  const category = categoryOf(reason);
  const message = reason === 'unsupported-unit' ? MESSAGES.unit : MESSAGES[category];
  return {ok: false, reason, category, message, candidates};
};

// Finds every numeric token in the OCR text. Each candidate records the unit
// that directly follows it (same line, or the next line - displays often
// print "52.35" with "kg" underneath), or null when none is visible.
function findCandidates(text) {
  const candidates = [];
  const numberRe = /\d+(?:[.,]\d+)?/g;
  let m;
  while ((m = numberRe.exec(text)) !== null) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const before = start > 0 ? text[start - 1] : '';
    const after = end < text.length ? text[end] : '';
    const afterNext = end + 1 < text.length ? text[end + 1] : '';

    // Dangling or leading separator: "52." / ".35" / "52,"  - the decimal
    // part was lost or misread, so the magnitude is unknown.
    const brokenDecimal =
      before === '.' || before === ',' ||
      ((after === '.' || after === ',') && !/\d/.test(afterNext));
    // Number glued to letters ("A52", "52X", "B8QIS0oe0") is part of some
    // other label / a misread glyph string - never a weight.
    const glued = /[A-Za-z]/.test(before);

    const tail = text.slice(end, end + 8);
    const unitMatch = /^\s*(kg|g)(?![A-Za-z])/i.exec(tail);
    const unit = unitMatch ? unitMatch[1].toLowerCase() : null;
    // "12.5 lb", "40oz": a reading in a unit the app does not record in.
    const foreignUnit = !unit && new RegExp(`^\\s*${FOREIGN_UNIT}(?![A-Za-z])`, 'i').test(tail);
    // A letter directly after the number that isn't a unit ("52X") is glued.
    const gluedAfter = !unit && /[A-Za-z]/.test(after);
    const negative = before === '-' || before === '−';

    candidates.push({raw, unit, brokenDecimal, negative, foreignUnit, glued: glued || gluedAfter});
  }
  return candidates;
}

// Parses a numeric token to a Number, or null when its format is ambiguous.
// A comma is only trusted as a decimal separator when it isn't followed by
// exactly three digits ("52,350" could be a thousands separator).
function toNumber(raw) {
  if (raw.includes(',')) {
    const [, frac] = raw.split(',');
    if (frac.length === 3) return null;
    return parseFloat(raw.replace(',', '.'));
  }
  return parseFloat(raw);
}

export function parseWeightFromText(text) {
  if (!text || !String(text).trim()) return reject('empty-ocr-text');

  const all = findCandidates(String(text));
  log('numeric candidates:', JSON.stringify(all));
  if (!all.length) return reject('no-number-in-text', all);
  if (all.some(c => c.brokenDecimal)) return reject('unreadable-decimal', all);
  if (all.some(c => c.negative)) return reject('negative', all);
  if (all.some(c => c.foreignUnit)) return reject('unsupported-unit', all);

  const usable = all.filter(c => !c.glued);
  if (!usable.length) return reject('no-number-after-glued-filter', all);

  // Priority: (1) the one number explicitly tied to kg/g; (2) a single valid
  // numeric candidate on the display; (3) otherwise reject. Other bare
  // numbers (tare, count, ...) are tolerated only if exactly one candidate
  // carries a unit.
  const withUnit = usable.filter(c => c.unit);
  let chosen;
  let unitAssumed = false;
  if (withUnit.length === 1) {
    chosen = withUnit[0];
  } else if (withUnit.length > 1) {
    return reject('ambiguous-multiple-unit-values', all);
  } else if (usable.length === 1) {
    chosen = usable[0];
    unitAssumed = true; // no unit visible -> app's existing KG-only behaviour
  } else {
    return reject('ambiguous-multiple-bare-numbers', all);
  }

  const value = toNumber(chosen.raw);
  if (value === null || !isFinite(value)) return reject('ambiguous-comma-format', all);

  const unit = chosen.unit || 'kg';
  const kg = unit === 'g' ? value / 1000 : value;
  // Float noise from the division (52350/1000 etc.) is trimmed; 6 places
  // still keeps sub-gram precision for a "52.35 g" style reading.
  const kgRounded = Number(kg.toFixed(6));

  log('unit:', unit);
  log('converted KG:', kgRounded);
  if (!(kgRounded > 0)) return reject('zero', all);
  if (kgRounded < MIN_KG) return reject('out-of-range', all);

  log('selected:', chosen.raw);
  return {
    ok: true,
    kg: kgRounded,
    detectedValue: chosen.raw.replace(',', '.'),
    detectedUnit: unit,
    converted: unit === 'g',
    unitAssumed,
    candidates: all,
  };
}

// Combines the per-pass parse results. A weight is accepted only when at
// least MIN_AGREEING_PASSES independent passes produced the SAME kg value and
// no pass produced a different valid one. One lone reading - however clean -
// is "unverified", because ML Kit mis-reading a segment display usually shows
// up as passes disagreeing or only one of them seeing digits.
//   passes: [{pass: 'original', parsed: <parseWeightFromText result>}, ...]
export function combinePassResults(passes) {
  const valid = passes.filter(p => p.parsed && p.parsed.ok);

  if (!valid.length) {
    // Report the most informative reason: ambiguity first, then an invalid
    // value, then plain "could not read".
    const rank = r => ({ambiguous: 0, invalid: 1, unverified: 2, unreadable: 3}[r.category]);
    const rejections = passes.map(p => p.parsed).filter(Boolean).sort((a, b) => rank(a) - rank(b));
    return rejections[0] || reject('empty-ocr-text');
  }

  const distinct = [...new Set(valid.map(p => p.parsed.kg))];
  if (distinct.length > 1) {
    log('consensus:', `conflicting values ${JSON.stringify(distinct)}`);
    return reject('low-confidence-conflicting-passes');
  }

  if (valid.length < MIN_AGREEING_PASSES) {
    log('consensus:', `only ${valid.length} pass(es) read a weight`);
    return reject('low-confidence-single-pass');
  }

  // Prefer a pass that actually saw the unit over one that assumed kg.
  const best = valid.find(p => !p.parsed.unitAssumed) || valid[0];
  return {...best.parsed, agreeingPasses: valid.map(p => p.pass)};
}

// Image-quality problems the segment reader names when it refuses a photo,
// most specific first, with what the user can do about each. Shown under the
// general message so a retake is an informed one.
const QUALITY_HINTS = [
  ['display-cut-off', 'Part of the display is outside the picture or too close to its edge. Keep the whole display in view, with some space around the digits.'],
  ['blurred', 'The photo is not sharp. Hold the phone steady, tap the display to focus, then retake.'],
  ['glare', 'There is a reflection on the display, or the lit digits are not clean. Change the angle or shade it, hold steady, then retake.'],
  ['low-contrast', 'The digits are too faint. Avoid glare, or shade the display, then retake.'],
  ['digits-too-small', 'The digits are too small in the frame. Move closer or frame the display more tightly.'],
  ['no-ink', 'The digits are too small in the frame. Move closer or frame the display more tightly.'],
  ['merged-digits', 'The digits run into each other. Move closer, hold straight-on and retake.'],
  ['unassigned-ink', 'Something other than the digits is inside the frame. Frame only the digits.'],
  ['digit-count', 'Something other than the digits is inside the frame. Frame only the digits.'],
];

// What to tell the user about a photo the segment reader refused, or null
// when it gave no usable clue. `segment` is the reader's refusal:
// {ok: false, reason, detail} - the reason of each display style it tried is
// in there.
export function qualityHint(segment) {
  if (!segment || segment.ok) return null;
  const said = `${segment.reason || ''} ${segment.detail || ''}`;
  const hit = QUALITY_HINTS.find(([key]) => said.includes(key));
  return hit ? hit[1] : null;
}

// The unit label in a piece of OCR text: 'kg', 'g' or null. Only a label
// standing on its own counts - a stray "g" inside other text does not.
export function unitFromText(text) {
  const m = /(?:^|[^A-Za-z])(kg|g)(?![A-Za-z])/i.exec(String(text || ''));
  return m ? m[1].toLowerCase() : null;
}

// A unit label the app does not record in ('lb', 'oz', ...) standing on its
// own in a piece of OCR text, or null.
export function foreignUnitFromText(text) {
  const m = new RegExp(`(?:^|[^A-Za-z])${FOREIGN_UNIT}(?![A-Za-z])`, 'i').exec(String(text || ''));
  return m ? m[1].toLowerCase() : null;
}

// Turns the digits the seven-segment reader returned ("3190", "500.0") into
// the same shape parseWeightFromText returns. `unit` is 'kg', 'g' or null
// when no unit label has been confirmed on the display (then kg, the app's
// unit, is assumed and said so). There is no upper limit.
export function readingFromDigits(text, unit) {
  const fail = (reason, category) => ({ok: false, reason, category, message: MESSAGES[category]});
  if (typeof text !== 'string' || !/^\d+(\.\d+)?$/.test(text)) return fail('unreadable-digits', 'unreadable');
  // "0005" / "05": a scale blanks its leading zeros or shows a decimal point
  // after one. Digits like these mean a point was missed or the display is
  // being read upside down.
  if (/^0\d/.test(text)) return fail('leading-zero', 'invalid');
  const value = parseFloat(text);
  const kg = Number((unit === 'g' ? value / 1000 : value).toFixed(6));
  // Zero is read fine but is not a weight to record: it is shown, never offered for capture.
  if (!(kg > 0)) {
    return {...fail('zero', 'invalid'), message: MESSAGES.zero, zeroDisplay: `${text} ${unit || 'kg'}`};
  }
  if (kg < MIN_KG) return fail('out-of-range', 'invalid');
  return {
    ok: true,
    kg,
    detectedValue: text,
    detectedUnit: unit || 'kg',
    converted: unit === 'g',
    unitAssumed: !unit,
  };
}

// What goes into the weight field (kg) for a reading the user confirmed. A
// display read in kg is kept character for character - "1.70" stays "1.70",
// no decimal place is dropped or added. Only a reading converted from grams
// is written as the converted number.
export function weightFieldValue(reading) {
  if (!reading || !reading.ok) return '';
  if (!reading.converted && typeof reading.detectedValue === 'string' && /^\d+(\.\d+)?$/.test(reading.detectedValue)) {
    return reading.detectedValue;
  }
  return String(reading.kg);
}

// How a weight-field value is shown back on later steps: exactly as entered
// or confirmed ("1.70", "0.125", "3190"), never re-rounded to a fixed number
// of decimals. Calculations use parseFloat of the same string.
export function shownWeight(value) {
  const s = String(value ?? '').trim();
  return /^\d+(\.\d+)?$/.test(s) ? s : '0';
}

// Decides between the two engines for one photo.
//   segment  what the seven-segment reader returned: {ok, text, kind} or a refusal
//   mlkit    the ML Kit consensus (combinePassResults)
//   passes   the individual ML Kit passes, rawTexts their raw text
// Rules:
//   * the segment reader found the digits but they run out of the picture, or
//     there is no room beside them to be sure none is hidden -> rejected
//     outright: an incomplete display is never completed by a guess
//   * the segment reader found the display but refused it for a reflection
//     or blur -> rejected outright. ML Kit is not asked for a second opinion
//     on a picture known to be hiding digits (it read "51" off a glared
//     "3190", twice)
//   * no segment reading for any other reason -> ML Kit's consensus is not
//     accepted by itself either: it is handed back as a single `choices`
//     entry, to be used only after the user has compared it with the display
//   * both engines read a weight and they differ -> not accepted and never
//     picked between: both are handed back as `choices` for the user to
//     decide after looking at the display
//   * segment reading, ML Kit consensus agrees or has none -> the segment
//     reading; any different value a single ML Kit pass produced is reported
//     in `otherReadings` so the user is told to check
//   * the unit label comes from the text ML Kit saw (two passes, no
//     contradiction); otherwise kg is assumed and flagged
export function combineEngines(segment, mlkit, passes = [], rawTexts = []) {
  if (!segment || !segment.ok) {
    // What the LED reader said, and what the cyan-LCD reader said (carried in `detail`).
    const said = segment ? `${segment.reason || ''} ${(/lcd=(\S+)/.exec(segment.detail || '') || [])[1] || ''}` : '';
    if (/display-cut-off/.test(said)) {
      log('segment reader:', 'the display is cut off; the text reader is not consulted');
      return {...reject('display-cut-off'), message: MESSAGES.cutOff};
    }
    const quality = /glare/.test(said) ? 'glare' : /blurred/.test(said) ? 'blurred' : null;
    if (quality) {
      log('segment reader:', `refused for ${quality}; the text reader is not consulted`);
      return reject(`image-quality-${quality}`);
    }
    if (mlkit && mlkit.ok) {
      return {
        ...reject('low-confidence-text-only'),
        message: MESSAGES.textOnly,
        choices: [{...mlkit, engine: 'text'}],
      };
    }
    return mlkit;
  }

  const units = rawTexts.map(unitFromText).filter(Boolean);
  const kgSeen = units.filter(u => u === 'kg').length;
  const gSeen = units.filter(u => u === 'g').length;
  const unit = kgSeen >= 2 && gSeen === 0 ? 'kg' : gSeen >= 2 && kgSeen === 0 ? 'g' : null;
  // The digits may be right, but in pounds or ounces they are not this weight in kg.
  if (rawTexts.filter(foreignUnitFromText).length >= 2) return reject('unsupported-unit');

  const reading = readingFromDigits(segment.text, unit);
  if (!reading.ok) {
    log('segment reading refused:', reading.reason);
    return {...reject(reading.reason), message: reading.message};
  }
  if (mlkit && mlkit.ok && mlkit.kg !== reading.kg) {
    log('engines:', `segment ${reading.kg} kg vs text ${mlkit.kg} kg`);
    return {
      ...reject('low-confidence-conflicting-engines'),
      message: MESSAGES.disagree,
      choices: [{...reading, engine: 'segment'}, {...mlkit, engine: 'text'}],
    };
  }
  const otherReadings = [...new Set(
    passes.filter(p => p.parsed && p.parsed.ok && p.parsed.kg !== reading.kg).map(p => p.parsed.kg),
  )];
  return {
    ...reading,
    engine: 'segment',
    displayKind: segment.kind,
    confirmedByText: !!(mlkit && mlkit.ok),
    otherReadings,
  };
}

// ---- server (vision AI) reading, cross-checked by the phone's reader ------

// The backend's answer (POST /api/weight-read) -> a reading in the shape
// readingFromDigits returns, or a refusal. `value` is the displayed string
// ("1.70") and stays exactly that; the unit is the display's (kg / g), or
// assumed kg when none was visible. Pure.
export function readingFromAi(ai) {
  if (!ai || ai.status !== 'ok' || typeof ai.value !== 'string') {
    return {ok: false, reason: 'ai-unclear', category: 'unreadable', message: MESSAGES.aiUnclear,
      detail: ai && ai.reason ? String(ai.reason) : null};
  }
  const unit = ai.unit === 'kg' || ai.unit === 'g' ? ai.unit : null;
  const reading = readingFromDigits(ai.value, unit);
  return reading.ok ? {...reading, engine: 'ai'} : {...reading, detail: `ai=${ai.value}`};
}

// Combines the server's reading with the phone's seven-segment reader on the
// same photo. Never picks between two different values, never invents one. Pure.
//   ai       readingFromAi(...) result, or {ok: false, reason: 'ai-error', message} when
//            the server could not be reached / failed
//   segment  the phone reader's raw answer {ok, text, reason, detail} or null
//   -> both read the same weight        -> that reading (the phone's string, which
//                                          keeps the display's exact precision)
//   -> they read different weights      -> refused, both offered as `choices`
//   -> only the server read it          -> refused: the server's value is offered only as
//                                          an explicit, unconfirmed `choices` entry (the
//                                          vision model misread 8 of 11 photos of the
//                                          physical LED display in testing)
//   -> only the phone read it           -> the phone's reading, flagged `note`
//   -> neither                          -> refused with the server's message
export function combineAiAndSegment(ai, segment) {
  const seg = segment && segment.ok && typeof segment.text === 'string'
    ? readingFromDigits(segment.text, ai && ai.ok ? (ai.converted ? 'g' : ai.unitAssumed ? null : 'kg') : null)
    : null;
  const segOk = !!seg && seg.ok;
  if (ai && ai.ok && segOk) {
    if (seg.kg === ai.kg) return {...seg, engine: 'ai+segment', note: null};
    log('engines:', `server ${ai.detectedValue} vs phone ${seg.detectedValue}`);
    return {
      ok: false, reason: 'low-confidence-conflicting-engines', category: 'unverified', message: MESSAGES.disagree,
      choices: [{...ai, engine: 'ai'}, {...seg, engine: 'segment'}],
    };
  }
  if (ai && ai.ok) {
    return {
      ok: false, reason: 'low-confidence-ai-only', category: 'unverified', message: MESSAGES.aiOnly,
      hint: segment && !segment.ok ? qualityHint(segment) : null,
      choices: [{...ai, engine: 'ai', unconfirmed: true}],
    };
  }
  if (segOk) {
    return {...seg, engine: 'segment', note: MESSAGES.aiFailedPhoneRead};
  }
  // A zero display or a value out of range is said as such, not as "unclear".
  if (seg && !seg.ok && seg.reason === 'zero') return seg;
  if (ai && ai.reason === 'zero') return ai;
  return {
    ok: false,
    reason: (ai && ai.reason) || 'ai-unclear',
    category: (ai && ai.category) || 'unreadable',
    message: (ai && ai.message) || MESSAGES.aiUnclear,
    hint: segment && !segment.ok ? qualityHint(segment) : null,
  };
}

// Asks the native detector where the display is in a whole photo. Never
// throws: a failure is {found: false, reason}. See LiveWeightModule.detect.
export async function detectDisplay(uri) {
  const LiveWeight = NativeModules.LiveWeight;
  if (!AUTO_DETECT.enabled) return {found: false, certain: false, reason: 'auto-detect-off'};
  if (!LiveWeight || !LiveWeight.detect) return {found: false, certain: false, reason: 'detector-unavailable'};
  try {
    const d = await LiveWeight.detect(uri);
    log('display detection:', JSON.stringify(d));
    return d;
  } catch (e) {
    log('display detection FAILED:', e && e.message);
    return {found: false, certain: false, reason: 'detector-error', detail: e && e.message};
  }
}

const validBox = b => !!b && [b.x, b.y, b.w, b.h].every(v => typeof v === 'number' && isFinite(v))
  && b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001;

// Decides what to do with a detection result:
//   {mode: 'auto', crop}             the display was found, is whole and large
//                                    enough, and digits were read in it: read
//                                    this crop without asking
//   {mode: 'retake', crop?, reason, message, hint?}
//                                    a display is there but the picture of it
//                                    is not good enough (cut off, too small,
//                                    reflection, blur): ask for a retake; the
//                                    user may still adjust the crop instead
//   {mode: 'manual', crop?, reason, message}
//                                    not sure there is a display, or where:
//                                    the user frames it (starting from `crop`
//                                    when there is a guess)
// Pure. Detection being wrong must never cost more than a manual crop, so
// anything short of certain goes to the user.
export function assessDetection(d) {
  const crop = d && validBox(d.crop) ? d.crop : null;
  const manual = reason => ({mode: 'manual', crop, reason, message: MESSAGES.notFound});
  if (!d || !d.found || !crop || !validBox(d.box)) return manual((d && d.reason) || 'no-display');
  if (d.cutOff || d.reason === 'display-cut-off') {
    return {mode: 'retake', crop, reason: 'display-cut-off', message: MESSAGES.cutOff};
  }
  if (d.tooSmall || d.box.w < AUTO_DETECT.minWidthFraction) {
    return {mode: 'retake', crop, reason: 'display-too-small', message: MESSAGES.tooSmall};
  }
  if (!d.ok) {
    const said = `${d.reason || ''} ${d.detail || ''}`;
    if (/glare|blurred/.test(said)) {
      return {
        mode: 'retake',
        crop,
        reason: `image-quality-${/glare/.test(said) ? 'glare' : 'blurred'}`,
        message: MESSAGES.unreadable,
        hint: qualityHint(d),
      };
    }
    return manual(d.reason || 'unreadable');
  }
  if (!d.certain) return manual('uncertain');
  return {mode: 'auto', crop};
}

// The segment reader's answer for the crop, checked against what it read when
// the display was detected (same photo, same reader, different framing).
//   both read the same digits      -> that reading
//   they read different digits     -> refused: one of them is wrong
//   only the detection read digits -> the detection's reading (a refusal on
//                                     the re-crop is not a different value)
// Pure.
export function reconcileSegment(cropRead, detected) {
  if (!detected || !detected.ok || typeof detected.text !== 'string') return cropRead;
  const fromDetection = {ok: true, text: detected.text, kind: detected.kind, fromDetection: true};
  if (!cropRead || !cropRead.ok) return fromDetection;
  if (cropRead.text !== detected.text) {
    return {ok: false, reason: 'segment-reads-differ', detail: `crop=${cropRead.text} detection=${detected.text}`};
  }
  return cropRead;
}

// Where an image URI points, for diagnostics only.
function uriScheme(uri) {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(uri || '');
  return m ? `${m[1].toLowerCase()}://` : 'none';
}

// ScaleImage modes (see ScaleImageModule.kt). Four controlled passes:
//   original         - cropped, rotated, upscaled colour image
//   gray             - grayscale + contrast stretch
//   binary           - Otsu threshold, digits (minority class) black on white
//   binary-inverted  - opposite polarity, in case the guess above is wrong
const PASSES = [
  {name: 'original', mode: 'original'},
  {name: 'gray', mode: 'gray'},
  {name: 'binary', mode: 'binary'},
  {name: 'binary-inverted', mode: 'binaryInv'},
];

// Runs the multi-pass OCR on a captured photo. `crop` is the area the user
// framed, as fractions of the (EXIF-rotated) image: {x, y, w, h} (0..1);
// omit it to use the whole photo.
//
// `detected` is the detector's own reading of this photo, when the crop came
// from it (see reconcileSegment).
//
// Never throws for an OCR failure: every failure is returned as a rejection
// whose `reason` names the stage, and `passSummary` lists what each pass saw
// (diagnostics for the on-screen debug line / logs only). `cropUri` is the
// cropped display image that was read, for showing to the user.
export async function readWeightFromPhoto(uri, crop, asset, detected) {
  log('capture URI:', `${uri} (${uriScheme(uri)})`);
  if (asset) {
    log('original dimensions:',
      `${asset.width}x${asset.height} ${asset.type} ${asset.fileSize} bytes`);
  }
  if (!uri) return reject('no-image-uri');
  log('crop:', JSON.stringify(crop || 'none (full photo)'));

  const ScaleImage = NativeModules.ScaleImage;
  let TextRecognition;
  try {
    TextRecognition = require('@react-native-ml-kit/text-recognition').default;
  } catch (e) {
    log('mlkit: module load FAILED', e && e.message);
    return reject('mlkit-error: module-unavailable');
  }

  const c = crop || {x: 0, y: 0, w: 0, h: 0};
  const results = [];
  const passSummary = [];
  const rawTexts = [];
  let segment = null;   // seven-segment reader's answer for the cropped colour image
  let cropUri = null;   // that cropped colour image
  for (const {name, mode} of PASSES) {
    log('OCR pass:', name);
    let imageUri = uri;
    try {
      if (!ScaleImage) throw new Error('ScaleImage native module not linked');
      const p = await ScaleImage.process(uri, c.x, c.y, c.w, c.h, mode);
      imageUri = p.uri;
      log('original dimensions:', `${p.originalWidth}x${p.originalHeight} (EXIF-rotated)`);
      log('processed dimensions:', `${p.width}x${p.height} -> ${p.uri}`);
    } catch (e) {
      log('processing FAILED:', `${e && e.code} ${e && e.message}`);
      results.push({pass: name, parsed: reject('image-processing-error')});
      passSummary.push(`${name}: image-processing-error`);
      continue;
    }

    if (mode === 'original' && !segment) {
      cropUri = imageUri;
      try {
        const LiveWeight = NativeModules.LiveWeight;
        segment = LiveWeight && LiveWeight.readImage
          ? await LiveWeight.readImage(imageUri)
          : {ok: false, reason: 'segment-reader-unavailable'};
      } catch (e) {
        segment = {ok: false, reason: 'segment-reader-error', detail: e && e.message};
      }
      log('segment reader:', JSON.stringify(segment));
      segment = reconcileSegment(segment, detected);
      passSummary.push(`segment: ${segment.ok ? `${segment.text} (${segment.kind})` : `${segment.reason} ${segment.detail || ''}`.trim()}`);
    }

    let result;
    try {
      result = await TextRecognition.recognize(imageUri);
    } catch (e) {
      log('mlkit: FAILED', `${e && e.code} ${e && e.message}`);
      results.push({pass: name, parsed: reject('mlkit-error')});
      passSummary.push(`${name}: mlkit-error`);
      continue;
    }
    const blocks = result?.blocks || [];
    log('raw text:', JSON.stringify(result?.text ?? null));
    log('OCR blocks:', JSON.stringify(blocks.map(b => b.text)));
    log('OCR frames:', JSON.stringify(blocks.map(b => b.frame)));
    rawTexts.push(result?.text || '');
    const parsed = parseWeightFromText(result?.text);
    results.push({pass: name, parsed});
    passSummary.push(
      `${name}: ${parsed.ok ? `${parsed.kg}kg` : parsed.reason} [${
        blocks.map(b => String(b.text).replace(/\n/g, '/')).join('|')
      }]`,
    );
  }

  const textFinal = combinePassResults(results);
  log('text reader:', textFinal.ok ? `${textFinal.kg} kg (passes: ${textFinal.agreeingPasses.join(', ')})` : textFinal.reason);
  const final = combineEngines(segment, textFinal, results, rawTexts);
  log('final:', final.ok ? `${final.kg} kg (${final.engine || 'text'})` : final.reason);
  if (segment && segment.reason === 'segment-reads-differ') {
    final.reason = 'low-confidence-segment-reads-differ';
    final.message = MESSAGES.differ;
    delete final.choices;
  }
  final.passSummary = passSummary;
  final.rawTexts = rawTexts;
  final.cropUri = cropUri;
  final.crop = crop || null;
  if (!final.ok) final.hint = qualityHint(segment);
  return final;
}

// A captured photo, start to finish, with no framing by the user: find the
// display, and when that is certain read it. Never throws.
//   -> {auto: true, ...readWeightFromPhoto result}   the display was found and read (or refused)
//   -> {auto: false, ok: false, plan, detection}     not certain: see plan.mode
//      ('retake' or 'manual', assessDetection)
export async function readWeightAuto(uri, asset) {
  if (!uri) return {...reject('no-image-uri'), auto: false, plan: assessDetection(null)};
  const detection = await detectDisplay(uri);
  const plan = assessDetection(detection);
  log('detection plan:', JSON.stringify(plan));
  if (plan.mode !== 'auto') return {ok: false, auto: false, plan, detection};
  const parsed = await readWeightFromPhoto(uri, plan.crop, asset, detection);
  return {...parsed, auto: true, detection};
}

// TEMPORARY (development builds only): on-device check of every OCR engine
// against fixture images. Does nothing unless a test run put images in place.
if (__DEV__) require('../dev/ocrFixtureHarness');
