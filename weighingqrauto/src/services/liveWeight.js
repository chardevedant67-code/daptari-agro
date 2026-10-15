// Live scale-display reading: the camera stays open, frames are read one
// after another, and the value on screen follows the display - the user
// taps Capture once it shows the right weight (LiveWeightScanner.jsx).
//
// Two readers, same tracker:
//   native (LiveWeight module) - the frame the preview is showing goes
//     straight to the seven-segment decoder: several reads a second, and
//     digits are read segment by segment instead of being guessed at as text.
//     ML Kit is only asked for the unit label ("kg" / "g").
//   fallback (app build without that module) - a photo per frame, one
//     preprocessing mode, ML Kit, parseWeightFromText.
//
// Confidence comes from consecutive FRAMES agreeing, which also rides out a
// moment of glare or blur. Same principle as weightOcr.js: never guess -
// Capture is only offered for a value read the same way several times.
//
// Everything in this file except the two read* functions is pure, so it is
// unit-tested without a device.
import {NativeModules} from 'react-native';
import {
  parseWeightFromText, readingFromDigits, unitFromText, foreignUnitFromText, qualityHint, MESSAGES,
} from './weightOcr';

// Consecutive successful reads that must show the same kg value.
export const MIN_AGREEING_READS = 2;
// Frames in a row without a readable weight before the value is cleared
// (the display left the box, or the lighting changed).
export const MAX_MISSES = 3;
// A read older than this no longer counts towards agreement.
export const READ_TTL_MS = 6000;

// ScaleImage modes tried in turn (see ScaleImageModule.kt). A mode that just
// produced a reading is used again for the next frame; a miss moves on.
export const LIVE_MODES = ['original', 'gray', 'binary', 'binaryInv'];

export function nextMode(mode, lastReadOk) {
  if (lastReadOk) return mode;
  const i = LIVE_MODES.indexOf(mode);
  return LIVE_MODES[(i + 1) % LIVE_MODES.length];
}

export const MESSAGES_LIVE = {
  decimal: 'The decimal point is not clear. Move closer and hold steady.',
  zero: MESSAGES.zero,
};

// The native reader is ~10x faster, so neighbouring frames are nearly the
// same picture: it has to agree over more of them, and may miss more in a row
// before the value is dropped.
export const NATIVE_TRACKING = {minAgree: 3, maxMisses: 8};

// When the live scanner captures by itself. Capturing only freezes the
// reading for the user to confirm - nothing is put in the weight field, let
// alone saved, until they do. Change these to tune it.
export const AUTO_CAPTURE = {
  enabled: true,
  // Frames in a row, after the reading has become steady, that must still
  // show the same value with the display located. 1: capture on the frame
  // that made it steady (minAgree frames already agree; the frame kept for
  // review must then show the same digits and point once more).
  steadyFrames: 1,
};

// Counts towards an automatic capture. push(state, hasBox) -> true when the
// capture should happen now. Pure.
//   state   what the tracker returned for this frame
//   hasBox  the display window was located in this frame
export function createAutoCapture({enabled = AUTO_CAPTURE.enabled, steadyFrames = AUTO_CAPTURE.steadyFrames} = {}) {
  let run = 0;
  let value = null;
  return {
    push(state, hasBox) {
      const steady = !!state && state.status === 'steady' && !!state.reading && hasBox;
      if (!steady || state.reading.detectedValue !== value) {
        run = steady ? 1 : 0;
        value = steady ? state.reading.detectedValue : null;
      } else {
        run += 1;
      }
      return enabled && run >= steadyFrames;
    },
    reset() {
      run = 0;
      value = null;
    },
  };
}

// True when the frame kept at capture shows the same thing as the reading
// being captured: same digits, same decimal point. Pure.
export function sameReading(a, b) {
  return !!a && !!b && !!a.ok && !!b.ok && a.detectedValue === b.detectedValue && a.kg === b.kg;
}

// Follows the readings frame by frame.
//   push(parsed, now) -> {status, reading, agree, message}
//     status  'searching' - nothing readable in view
//             'reading'   - a weight was read, not yet confirmed by later frames
//             'steady'    - the last `minAgree` reads agree
//     reading the reading on screen (null when searching)
//     message why nothing can be read, when there is something useful to say
export function createLiveWeightTracker({minAgree = MIN_AGREEING_READS, maxMisses = MAX_MISSES} = {}) {
  let reads = [];   // {kg, parsed, at} - successful reads, oldest first
  let misses = 0;
  let message = null;
  let zero = null;  // what the display shows when it reads zero (e.g. "0.000 kg")
  // Every way each run of digits has been seen punctuated, for the whole
  // session: "500.0" and "5000" are the same digits with and without a
  // decimal point. A point that comes and goes means it is not being read
  // reliably, and it is worth a factor of ten - so those digits are refused.
  const punctuation = new Map();

  const state = () => {
    const latest = reads[reads.length - 1];
    if (!latest) return {status: 'searching', reading: null, agree: 0, message, zero};
    let agree = 0;
    for (let i = reads.length - 1; i >= 0 && reads[i].kg === latest.kg; i -= 1) agree += 1;
    return {
      status: agree >= minAgree ? 'steady' : 'reading',
      reading: latest.parsed,
      agree,
      message: null,
      zero: null,
    };
  };

  return {
    push(read, now = Date.now()) {
      let parsed = read;
      reads = reads.filter(r => now - r.at <= READ_TTL_MS);
      if (parsed && parsed.ok && typeof parsed.detectedValue === 'string') {
        const digits = parsed.detectedValue.replace('.', '');
        if (!punctuation.has(digits)) punctuation.set(digits, new Set());
        punctuation.get(digits).add(parsed.detectedValue);
        if (punctuation.get(digits).size > 1) {
          parsed = {ok: false, reason: 'decimal-unclear', category: 'ambiguous', message: MESSAGES_LIVE.decimal};
          reads = [];
        }
      }
      zero = parsed && !parsed.ok && parsed.reason === 'zero' ? parsed.zeroDisplay || null : null;
      if (parsed && parsed.ok) {
        misses = 0;
        message = null;
        reads.push({kg: parsed.kg, parsed, at: now});
        if (reads.length > minAgree + 2) reads.shift();
      } else {
        misses += 1;
        // Only these two tell the user something they can act on.
        message = parsed && (parsed.category === 'ambiguous' || parsed.category === 'invalid')
          ? parsed.message
          : null;
        if (misses >= maxMisses) reads = [];
      }
      return state();
    },
    reset() {
      reads = [];
      misses = 0;
      message = null;
      zero = null;
      punctuation.clear();
      return state();
    },
  };
}

// Maps the guide box drawn over the camera preview to the same area of the
// captured photo, as fractions (0..1) for ScaleImage.process.
//   view  {w, h}        the preview, in screen px (photo shown aspect-fill)
//   photo {w, h}        the captured photo, upright
//   box   {x, y, w, h}  the guide box inside the preview, screen px
//   pad                 extra margin, as a fraction of the box size - the
//                       preview and the photo never line up to the pixel,
//                       and cutting a digit in half is worse than a little
//                       background
export function guideBoxToCrop(view, photo, box, pad = {x: 0.08, y: 0.2}) {
  if (!view || !photo || !box || !(view.w > 0) || !(view.h > 0) || !(photo.w > 0) || !(photo.h > 0)) {
    return null;
  }
  const scale = Math.max(view.w / photo.w, view.h / photo.h);
  const shownW = photo.w * scale;
  const shownH = photo.h * scale;
  const offX = (shownW - view.w) / 2;
  const offY = (shownH - view.h) / 2;

  const clamp = v => Math.min(1, Math.max(0, v));
  const x0 = clamp((box.x - box.w * pad.x + offX) / shownW);
  const y0 = clamp((box.y - box.h * pad.y + offY) / shownH);
  const x1 = clamp((box.x + box.w * (1 + pad.x) + offX) / shownW);
  const y1 = clamp((box.y + box.h * (1 + pad.y) + offY) / shownH);
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
}

// What to show for a reading: the value and unit as they are on the display,
// plus the kg value the app stores when that differs.
export function describeReading(parsed) {
  if (!parsed || !parsed.ok) return null;
  return {
    display: `${parsed.detectedValue} ${parsed.detectedUnit}`,
    kg: parsed.kg,
    note: parsed.converted
      ? `= ${parsed.kg} kg`
      : parsed.unitAssumed ? 'No unit visible on the display — assuming kg' : null,
  };
}

// Digits -> reading and the unit label finder live in weightOcr.js (the photo
// flow uses them too).
export {readingFromDigits, unitFromText};

// The unit decides the stored value by a factor of 1000, so one sighting is
// not enough: a unit counts once it has been seen at least twice and more
// often than the other one.
export function createUnitVotes() {
  const votes = {kg: 0, g: 0, foreign: 0};
  return {
    add(unit) {
      if (unit === 'kg' || unit === 'g' || unit === 'foreign') votes[unit] += 1;
    },
    // The display has shown lb / oz / ... at least twice, and more often
    // than kg or g: its digits are not a weight in kg.
    foreign() {
      return votes.foreign >= 2 && votes.foreign > votes.kg + votes.g;
    },
    unit() {
      if (votes.kg >= 2 && votes.kg > votes.g) return 'kg';
      if (votes.g >= 2 && votes.g > votes.kg) return 'g';
      return null;
    },
  };
}

// What the live scanner makes of a frame the native reader refused. Most
// refusals just mean "nothing readable yet" and say nothing - the scanner is
// looking at whatever the camera sweeps past. A reflection or a blurred
// frame is different: the display IS in view and the user can fix it, so
// those carry the instruction. So does a display that does not fit in the
// frame with room to spare.
export function liveRefusal(r) {
  const said = `${(r && r.reason) || ''} ${(r && r.detail) || ''}`;
  // digits found, but too small to read safely: "move closer"
  const small = !!r && r.reason === 'digits-too-small';
  const fixable = small || /glare|blurred|display-cut-off/.test(said);
  return {
    ok: false,
    reason: (r && r.reason) || 'unreadable',
    category: fixable ? 'ambiguous' : 'unreadable',
    message: fixable
      ? qualityHint({ok: false, reason: small ? 'digits-too-small' : /display-cut-off/.test(said) ? 'display-cut-off' : /glare/.test(said) ? 'glare' : 'blurred'})
      : null,
  };
}

// True when this app build contains the native live reader.
export const hasNativeLiveReader = () => !!NativeModules.LiveWeight;

// Reads the frame the camera preview is showing. Never throws.
//   viewTag  native tag of the view that contains the camera preview
//   box      the guide box as fractions (0..1) of that view: {x, y, w, h}
//   wantUnit also look for the unit label in this frame (slower - not every frame)
//   keep     also keep this frame for the user to review (frameUri: the whole
//            frame, displayUri: just the display found in it)
// -> {ok, text, kind, ms, unit, box} or {ok: false, reason, detail, box}
//    box: where the display was found, as fractions of the view (when it was)
//   unitLater  do not wait for the unit label: it comes back as the promise
//              `unitPending` (ML Kit is the slow part of a frame)
export async function readDisplayFrame(viewTag, box, wantUnit, keep = false, unitLater = false) {
  let r;
  try {
    r = await NativeModules.LiveWeight.read(viewTag, box.x, box.y, box.w, box.h, !!wantUnit, !!keep);
  } catch (e) {
    return {ok: false, reason: 'native-error', detail: e && e.message};
  }
  const readUnit = async () => {
    try {
      const TextRecognition = require('@react-native-ml-kit/text-recognition').default;
      const result = await TextRecognition.recognize(r.cropUri);
      return unitFromText(result && result.text)
        || (foreignUnitFromText(result && result.text) ? 'foreign' : null);
    } catch (e) {
      return null;
    }
  };
  if (!wantUnit || !r.cropUri) return {...r, unit: null};
  if (unitLater) return {...r, unit: null, unitPending: readUnit()};
  return {...r, unit: await readUnit()};
}

// Fallback reader: one captured photo. Never throws: a failure is returned as
// a rejection ({ok: false, reason, category, message}) like parseWeightFromText's own.
//   crop  {x, y, w, h} fractions of the upright photo, or null for all of it
// Also returns `photo` ({w, h} of the upright frame) and `outputUri` (the
// processed image, whose folder is the app cache) when processing got that far.
export async function readWeightFromFrame(uri, crop, mode) {
  const fail = reason => ({ok: false, reason, category: 'unreadable', message: MESSAGES.unreadable});
  const ScaleImage = NativeModules.ScaleImage;
  if (!uri || !ScaleImage) return fail('image-processing-error');

  let processed;
  try {
    const c = crop || {x: 0, y: 0, w: 0, h: 0};
    processed = await ScaleImage.process(uri, c.x, c.y, c.w, c.h, mode);
  } catch (e) {
    return fail('image-processing-error');
  }
  const extra = {
    photo: {w: processed.originalWidth, h: processed.originalHeight},
    outputUri: processed.uri,
  };

  try {
    const TextRecognition = require('@react-native-ml-kit/text-recognition').default;
    const result = await TextRecognition.recognize(processed.uri);
    return {...parseWeightFromText(result && result.text), ...extra, rawText: (result && result.text) || ''};
  } catch (e) {
    return {...fail('mlkit-error'), ...extra};
  }
}
