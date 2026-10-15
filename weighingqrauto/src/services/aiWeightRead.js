// Capture Photo -> weight, read by the backend's vision model and
// cross-checked by the phone's own seven-segment reader on the same photo.
//
//   1. the phone looks for the display in the photo (LiveWeight.detect)
//   2. the photo is prepared on the phone (ScaleImage.process): upright,
//      cropped to the display when it was found with certainty (or to the
//      area the user framed), and sized 1200-2400 px - so the model sees the
//      display, not the printed "Max 150 kg" beside it, and the upload stays small
//   3. that image goes to OUR backend (readWeightByAI); the backend holds the
//      model's API key and calls the model
//   4. combineAiAndSegment decides: same value from both, one of them, or a
//      conflict for the user to resolve. Nothing is saved here - the result
//      card asks the user to Confirm before anything reaches the weight field.
import {NativeModules} from 'react-native';
import {readWeightByAI} from './api';
import {
  assessDetection, combineAiAndSegment, detectDisplay, readingFromAi, MESSAGES,
} from './weightOcr';

const log = (...a) => console.log('[WeightAI]', ...a);

async function prepare(uri, crop) {
  const c = crop || {x: 0, y: 0, w: 0, h: 0};
  return NativeModules.ScaleImage.process(uri, c.x, c.y, c.w, c.h, 'original');
}

async function readOnServer(token, imageUri) {
  try {
    const ai = await readWeightByAI(token, imageUri);
    log('server:', JSON.stringify({status: ai.status, value: ai.value, unit: ai.unit, reason: ai.reason, ms: ai.ms}));
    return readingFromAi(ai);
  } catch (e) {
    log('server FAILED:', e && (e.code || e.status), e && e.message);
    return {ok: false, reason: 'ai-error', category: 'unreadable', message: (e && e.message) || MESSAGES.aiUnclear};
  }
}

/**
 * Reads the weight in a captured photo. Never throws.
 *   uri    the photo
 *   token  the operator's login token
 *   crop   optional {x, y, w, h} (fractions) the user framed with Adjust Crop
 * -> {ok, ...reading, note?}             a reading for the user to confirm
 *    {ok: false, message, hint?, choices?}  why not (choices: two readings to pick from)
 *    always with crop / cropUri (the image that was read) when there is one
 */
export async function readWeightWithAI(uri, token, crop = null) {
  if (!uri) return {ok: false, reason: 'no-image-uri', message: MESSAGES.camera};
  let segment = null;
  let readCrop = crop;
  if (!crop) {
    const detection = await detectDisplay(uri);
    const plan = assessDetection(detection);
    log('detection plan:', JSON.stringify({mode: plan.mode, reason: plan.reason}));
    // A display running off the photo may be missing digits: no reader is asked.
    if (plan.mode === 'retake' && plan.reason === 'display-cut-off') {
      return {ok: false, reason: plan.reason, message: plan.message, crop: plan.crop, plan};
    }
    if (plan.mode === 'auto') {
      readCrop = plan.crop;
      segment = detection && detection.ok ? {ok: true, text: detection.text, kind: detection.kind} : null;
    } else {
      segment = detection ? {ok: false, reason: detection.reason, detail: detection.detail} : null;
    }
  }

  let prepared;
  try {
    prepared = await prepare(uri, readCrop);
  } catch (e) {
    log('prepare FAILED:', e && e.message);
    return {ok: false, reason: 'image-processing-error', message: MESSAGES.unreadable, crop: readCrop};
  }

  // A framed area: the phone reads exactly what the server is sent.
  if (crop) {
    try {
      const LiveWeight = NativeModules.LiveWeight;
      segment = LiveWeight && LiveWeight.readImage ? await LiveWeight.readImage(prepared.uri) : null;
    } catch (e) {
      segment = null;
    }
  }

  const ai = await readOnServer(token, prepared.uri);
  const result = combineAiAndSegment(ai, segment);
  log('result:', JSON.stringify({ok: result.ok, value: result.detectedValue, engine: result.engine, reason: result.reason}));
  return {...result, crop: readCrop, cropUri: readCrop ? prepared.uri : null};
}
