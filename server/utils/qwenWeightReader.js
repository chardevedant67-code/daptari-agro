// Reads the weight on a weighing-machine display from a photo with a vision
// model (Qwen2.5-VL through OpenRouter's OpenAI-compatible API).
//
// The API key lives only in the server environment (OPENROUTER_API_KEY) and
// never leaves this process: the mobile app sends the photo to our backend,
// never to OpenRouter. The photo is passed through in memory and not stored.
//
// Never guess: anything but a clean reading of the display - an unclear
// digit or decimal point, glare, a cut-off display, a unit other than kg/g,
// or a reply that is not exactly the expected JSON - comes back as
// status "unclear", and the app asks for a retake.

const DEFAULT_MODEL = 'qwen/qwen2.5-vl-72b-instruct';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = [
  'You read the weight shown on the digital display of a weighing machine in a photo.',
  'Report ONLY the number currently shown on the display (LED or LCD digits), exactly as shown:',
  'every digit, the decimal point in its exact position, and trailing zeros ("1.70" stays "1.70", "0.500" stays "0.500").',
  'Ignore everything else: printed labels and capacity text (e.g. "Max 150 kg", "Min 400 g"), brand names, model and serial numbers, buttons, stickers, prices, and any text that is not the live reading.',
  'Seven-segment displays normally show unlit segments as faint grey "8" shapes around the lit ones: that is normal, read only the lit (bright) segments, and it is NOT a reason to answer unclear. Blank or unlit digit positions are not part of the number - never add a digit (such as a leading 0) that is not lit. A separate indicator light away from the digits is not a decimal point.',
  'The unit is "kg" or "g" when one is shown on or right next to the display; otherwise null.',
  'Answer "unclear" (value null) only when a lit digit or the decimal point cannot be seen with certainty: covered by glare or a reflection, blurred, cut off at the edge of the photo, or no display visible. Never guess or complete a reading.',
  'Reply with ONLY this JSON object and nothing else:',
  '{"status": "ok" | "unclear", "value": "<digits exactly as displayed, as a string>" | null, "unit": "kg" | "g" | null, "display_text": "<the reading as it appears, e.g. 1.70 kg>", "reason": "<short reason when unclear, else null>"}',
].join('\n');

const USER_TEXT = 'What weight does this weighing machine display show?';

class WeightReadError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function config() {
  return {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    baseUrl: (process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  };
}

const unclear = (reason, displayText = null) => ({
  status: 'unclear', value: null, unit: null, display_text: displayText, reason,
});

// The model's reply text -> the JSON object in it, or null. Tolerates a
// ```json fence or a sentence around the object; nothing else is repaired.
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const stripped = text.replace(/```(?:json)?/gi, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(stripped.slice(start, end + 1));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch (e) {
    return null;
  }
}

function normaliseUnit(u) {
  if (u === null || u === undefined) return {ok: true, unit: null};
  const s = String(u).trim().toLowerCase().replace(/\.$/, '');
  if (s === '' || s === 'null' || s === 'none') return {ok: true, unit: null};
  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(s)) return {ok: true, unit: 'kg'};
  if (['g', 'gm', 'gms', 'gram', 'grams'].includes(s)) return {ok: true, unit: 'g'};
  return {ok: false};
}

/**
 * The model's reply -> {status, value, unit, display_text, reason}. Pure.
 * value is a string of digits with at most one decimal point, exactly as the
 * display shows it; anything that does not validate is "unclear".
 */
function parseModelReply(text) {
  const obj = extractJson(text);
  if (!obj) return unclear('unreadable-model-reply');
  const displayText = typeof obj.display_text === 'string' ? obj.display_text.trim().slice(0, 40) || null : null;
  if (obj.status !== 'ok') {
    const why = typeof obj.reason === 'string' && obj.reason.trim() ? obj.reason.trim().slice(0, 120) : 'model-unclear';
    return unclear(why, displayText);
  }
  // A number loses trailing zeros ("1.70" -> 1.7): only a string keeps the
  // displayed precision, so a numeric value is not accepted.
  if (typeof obj.value !== 'string') return unclear('value-not-a-string', displayText);
  const value = obj.value.trim();
  if (!/^\d{1,7}(\.\d{1,4})?$/.test(value)) return unclear('invalid-value', displayText);
  // "05", "007.5": a scale blanks leading zeros - digits like these are misread.
  if (/^0\d/.test(value)) return unclear('leading-zero', displayText);
  const unit = normaliseUnit(obj.unit);
  if (!unit.ok) return unclear('unsupported-unit', displayText);
  // The reading as described must be the same number as the value given.
  if (displayText) {
    const shown = (displayText.match(/\d+(?:[.,]\d+)?/g) || []).map(t => t.replace(',', '.'));
    if (shown.length && !shown.includes(value)) return unclear('inconsistent-reply', displayText);
  }
  return {status: 'ok', value, unit: unit.unit, display_text: displayText || `${value}${unit.unit ? ` ${unit.unit}` : ''}`, reason: null};
}

/**
 * Sends one photo to the model and returns the validated reading.
 * Throws WeightReadError: NOT_CONFIGURED (503), AI_TIMEOUT (504),
 * AI_UNAVAILABLE (502) - never a guessed value.
 */
async function readWeightImage(buffer, mimetype, {fetchImpl = fetch, timeoutMs = TIMEOUT_MS} = {}) {
  const {apiKey, model, baseUrl} = config();
  if (!apiKey) throw new WeightReadError('NOT_CONFIGURED', 'Weight reading is not configured on the server.', 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'WeighingQR weight reader',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 200,
        messages: [
          {role: 'system', content: SYSTEM_PROMPT},
          {
            role: 'user',
            content: [
              {type: 'text', text: USER_TEXT},
              {type: 'image_url', image_url: {url: `data:${mimetype};base64,${buffer.toString('base64')}`}},
            ],
          },
        ],
      }),
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new WeightReadError('AI_TIMEOUT', 'The weight reader took too long. Please try again.', 504);
    throw new WeightReadError('AI_UNAVAILABLE', 'The weight reader could not be reached. Please try again.', 502);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // The upstream body can echo request details; only the status is logged.
    console.warn(`[weight-read] OpenRouter HTTP ${res.status}`);
    throw new WeightReadError('AI_UNAVAILABLE', 'The weight reader is unavailable right now. Please try again.', 502);
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new WeightReadError('AI_UNAVAILABLE', 'The weight reader returned an invalid response.', 502);
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : null;
  const text = Array.isArray(content) ? content.map(p => (p && p.text) || '').join('') : content;
  return {...parseModelReply(text), model};
}

module.exports = {readWeightImage, parseModelReply, WeightReadError, SYSTEM_PROMPT};
