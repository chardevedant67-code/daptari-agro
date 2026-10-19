// Skipped Before / After Weight.
//
// A skipped weight is never sent to the server, so it stays null there — the
// same "no weight recorded" the backend already stores for a session or
// packet that has none. It is never 0 and never a copy of the other weight,
// and the server only computes `difference` when a real before weight
// exists. These helpers keep every place that shows or combines the two
// weights honest about a missing one.
import {shownWeight} from './weightOcr';

export const SKIPPED_LABEL = 'Skipped';

// The phone's state for one weight step: null until the user acts,
// WEIGHT_SAVED once the server has the weight, WEIGHT_SKIPPED when the user
// skipped it.
export const WEIGHT_SAVED = 'saved';
export const WEIGHT_SKIPPED = 'skipped';

// A real weight from a form value ('1.70') or a saved record (1.7); null for
// a skipped or missing one ('', null, undefined, not a number).
export function actualWeight(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// After minus before, only when both are real weights; null otherwise.
export function weightDifference(before, after) {
  const b = actualWeight(before);
  const a = actualWeight(after);
  return b == null || a == null ? null : a - b;
}

// "+1.20 kg" / "-0.05 kg", or "Not calculated" when there is no difference.
export function differenceLabel(difference) {
  const d = actualWeight(difference);
  return d == null ? 'Not calculated' : `${d >= 0 ? '+' : ''}${d.toFixed(2)} kg`;
}

// A weight on the weighing screen: "1.70 kg", or "Skipped".
export function weightLabel(value, state) {
  return state === WEIGHT_SKIPPED ? SKIPPED_LABEL : `${shownWeight(value)} kg`;
}

// Skip is refused once that weight is saved on the server for this session:
// the app has no way to remove it again, and the record must never say
// "skipped" while the server holds a number.
export function canSkipWeight(state) {
  return state !== WEIGHT_SAVED;
}

// The "Measurement Saved" notification text.
export function measurementSummary(before, after, difference) {
  const part = v => {
    const w = actualWeight(v);
    return w == null ? 'skipped' : `${w.toFixed(2)} kg`;
  };
  const d = actualWeight(difference);
  return `Before ${part(before)} · After ${part(after)} · Diff ${d == null ? 'not calculated' : differenceLabel(d)}`;
}

// A saved record's weight to two decimals, or "Skipped" when none was recorded.
export function recordedWeight(value) {
  const w = actualWeight(value);
  return w == null ? SKIPPED_LABEL : w.toFixed(2);
}

// For a history row without a difference: which weight(s) were skipped.
export function skippedNote(record) {
  const noBefore = actualWeight(record?.beforeWeight) == null;
  const noAfter = actualWeight(record?.afterWeight) == null;
  if (noBefore && noAfter) return 'Weights skipped';
  if (noBefore) return 'Before skipped';
  if (noAfter) return 'After skipped';
  return null;
}

// Mean of the records' real differences; null when none has one. Records
// with a skipped weight have no difference and are left out, not counted as 0.
export function averageDifference(records) {
  const diffs = (records || [])
    .map(r => r?.difference)
    .filter(d => typeof d === 'number' && Number.isFinite(d));
  return diffs.length ? diffs.reduce((s, d) => s + d, 0) / diffs.length : null;
}
