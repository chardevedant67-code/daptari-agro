// "Skip Before Weight" / "Skip After Weight". The weighing screen, History
// and the packet detail are rendered for real and driven by their buttons;
// the backend is a small stand-in that follows sessionRoutes.js (a weight is
// stored only when one is sent, and the difference is computed only when a
// before weight exists), and native modules and navigation are stubbed.
import React from 'react';
import {Text, TextInput} from 'react-native';
import {act, create} from 'react-test-renderer';
import * as api from '../src/services/api';
import WeighScanScreen from '../src/screens/WeighScanScreen';
import HistoryScreen from '../src/screens/HistoryScreen';
import ProductDetailScreen from '../src/screens/ProductDetailScreen';
import {
  actualWeight, averageDifference, canSkipWeight, differenceLabel, measurementSummary,
  recordedWeight, skippedNote, weightDifference, weightLabel, WEIGHT_SAVED, WEIGHT_SKIPPED,
} from '../src/services/weightSkip';

jest.mock('react-native-vector-icons/MaterialIcons', () => () => null);
jest.mock('react-native-linear-gradient', () => ({children}) => children);
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('react-native-camera-kit', () => ({Camera: () => null}));
jest.mock('@react-native-ml-kit/barcode-scanning', () => ({default: {scan: jest.fn()}}));
jest.mock('@react-native-async-storage/async-storage', () => ({getItem: jest.fn(), setItem: jest.fn()}));
jest.mock('../src/dev/ocrFixtureHarness', () => ({}));
jest.mock('../src/ui/components/DisplayCropModal', () => () => null);
jest.mock('../src/services/aiWeightRead', () => ({readWeightWithAI: jest.fn()}));
jest.mock('../src/store/slices/notificationSlice', () => ({
  addNotification: n => ({type: 'notifications/add', payload: n}),
}));
jest.mock('../src/services/api', () => ({
  fetchProductByScan: jest.fn(),
  findActiveSessionForPacket: jest.fn(),
  createWeighSession: jest.fn(),
  uploadSessionPhoto: jest.fn(),
  saveBeforeWeight: jest.fn(),
  saveAfterWeight: jest.fn(),
  linkSessionToPacket: jest.fn(),
  fetchPacketHistory: jest.fn(),
}));

const mockDispatch = jest.fn();
jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: fn => fn({user: {token: 'tok'}}),
}));
const mockNavigation = {pop: jest.fn(), push: jest.fn(), navigate: jest.fn(), goBack: jest.fn()};
jest.mock('../src/navigation/StackNavigator', () => ({useNavigation: () => mockNavigation}));
let mockRouteParams = {};
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useFocusEffect: cb => R.useEffect(cb, [cb]),
    useNavigation: () => mockNavigation,
    useRoute: () => ({params: mockRouteParams}),
  };
});

// The first render of the screen loads every module it uses — slow on a cold run.
jest.setTimeout(30000);

// ── the backend stand-in ─────────────────────────
let server;
beforeEach(() => {
  jest.clearAllMocks();
  server = {sessions: 0, session: null};
  api.fetchProductByScan.mockResolvedValue({uniqueId: 'PKT-1', status: 'empty', batchId: {seedType: 'Wheat', batchNumber: 'B1'}});
  api.findActiveSessionForPacket.mockResolvedValue([]);
  api.createWeighSession.mockImplementation(async () => {
    server.sessions += 1;
    server.session = {beforeWeight: null, afterWeight: null, difference: null};
    return 'S1';
  });
  api.saveBeforeWeight.mockImplementation(async (token, sid, weight) => {
    server.session.beforeWeight = weight;
    return {success: true, beforeWeight: weight};
  });
  api.saveAfterWeight.mockImplementation(async (token, sid, weight) => {
    server.session.afterWeight = weight;
    if (server.session.beforeWeight != null) server.session.difference = weight - server.session.beforeWeight;
    return {success: true, afterWeight: weight, difference: server.session.difference};
  });
  api.linkSessionToPacket.mockImplementation(async (token, sid, uniqueId) => ({
    uniqueId, status: 'filled', ...server.session,
  }));
});

// ── driving the screen ───────────────────────────
const flat = c => {
  if (Array.isArray(c)) return c.map(flat).join('');
  if (c == null || typeof c === 'boolean') return '';
  if (typeof c === 'object') return flat(c.props?.children);
  return String(c);
};
const screenText = r => r.root.findAll(n => n.type === Text).map(n => flat(n.props.children)).join('\n');
const hasText = (r, s) => r.root.findAll(n => n.type === Text && flat(n.props.children) === s).length > 0;

function pressable(r, match) {
  const found = r.root.findAll(match);
  if (!found.length) throw new Error(`not on screen:\n${screenText(r)}`);
  let n = found[0];
  while (n && typeof n.props.onPress !== 'function') n = n.parent;
  return n;
}
const button = (r, label) => pressable(r, n => n.type === Text && flat(n.props.children) === label);

async function press(r, label) {
  const b = button(r, label);
  expect(b.props.disabled).toBeFalsy();
  await act(async () => { await b.props.onPress(); });
}
async function pressBack(r) {
  const b = pressable(r, n => n.props.name === 'arrow-back');
  await act(async () => { await b.props.onPress(); });
}
async function typeInto(r, placeholder, value) {
  const input = r.root.find(n => n.type === TextInput && n.props.placeholder === placeholder);
  await act(async () => { input.props.onChangeText(value); });
}
const typeBefore = (r, v) => typeInto(r, 'e.g. 0.50', v);
const typeAfter = (r, v) => typeInto(r, 'e.g. 5.24', v);

async function openAndScan() {
  let r;
  await act(async () => { r = create(<WeighScanScreen />); });
  const camera = r.root.findAll(n => typeof n.props.onReadCode === 'function')[0];
  await act(async () => { await camera.props.onReadCode({nativeEvent: {codeStringValue: 'PKT-1'}}); });
  expect(hasText(r, 'Step 2 — Before Weight')).toBe(true);
  return r;
}

function doneValue(r, label) {
  const lbl = r.root.findAll(n => n.type === Text && flat(n.props.children) === label)[0];
  return flat(lbl.parent.findAll(n => n.type === Text)[1].props.children);
}
const savedNotification = () =>
  mockDispatch.mock.calls.map(c => c[0].payload).find(p => p && p.type === 'PASS');

// Weighs one packet; `before`/`after` are typed values, or null to skip.
// Returns the renderer and the text of each step as it was shown.
async function weigh({before, after}) {
  const r = await openAndScan();
  const seen = {step2: screenText(r)};
  if (before == null) {
    await press(r, 'Skip Before Weight');
  } else {
    await typeBefore(r, before);
    await press(r, 'Next — Before Photo');
  }
  expect(hasText(r, 'Step 3 — Before Photo')).toBe(true);
  seen.step3 = screenText(r);
  await press(r, 'Skip before photo (optional)');
  expect(hasText(r, 'Step 4 — After Weight')).toBe(true);
  if (after == null) {
    seen.step4 = screenText(r);
    await press(r, 'Skip After Weight');
  } else {
    await typeAfter(r, after);
    seen.step4 = screenText(r);
    await press(r, 'Next — After Photo');
  }
  expect(hasText(r, 'Step 5 — After Photo')).toBe(true);
  seen.step5 = screenText(r);
  await press(r, 'Save Measurement');
  expect(hasText(r, 'Measurement Saved!')).toBe(true);
  seen.done = screenText(r);
  return {r, seen};
}

// No "0 kg" / "0.00 kg" / "+0.00 kg" anywhere it was shown.
const showsZeroWeight = seen => Object.values(seen).some(t => /(^|[\s:+])0(\.0+)? kg/m.test(t));
const sentWeights = () => [...api.saveBeforeWeight.mock.calls, ...api.saveAfterWeight.mock.calls].map(c => c[2]);

describe('the four before/after combinations', () => {
  test('1. both recorded — the existing flow, unchanged', async () => {
    const {r, seen} = await weigh({before: '1.20', after: '5.00'});

    expect(api.createWeighSession).toHaveBeenCalledTimes(1);
    expect(api.saveBeforeWeight).toHaveBeenCalledWith('tok', 'S1', 1.2);
    expect(api.saveAfterWeight).toHaveBeenCalledWith('tok', 'S1', 5);
    expect(api.linkSessionToPacket).toHaveBeenCalledWith('tok', 'S1', 'PKT-1');
    expect(seen.step3).toContain('Before: 1.20 kg');
    expect(seen.step4).toContain('Difference: +3.80 kg');
    expect(seen.step5).toContain('After: 5.00 kg');
    expect(doneValue(r, 'Before')).toBe('1.20 kg');
    expect(doneValue(r, 'After')).toBe('5.00 kg');
    expect(doneValue(r, 'Difference')).toBe('+3.80 kg');
    expect(savedNotification().body).toBe('Before 1.20 kg · After 5.00 kg · Diff +3.80 kg');
  });

  test('2. before recorded, after skipped — the before weight kept, no difference', async () => {
    const {r, seen} = await weigh({before: '1.20', after: null});

    expect(api.saveBeforeWeight).toHaveBeenCalledWith('tok', 'S1', 1.2);
    expect(api.saveAfterWeight).not.toHaveBeenCalled();
    expect(server.session).toEqual({beforeWeight: 1.2, afterWeight: null, difference: null});
    expect(seen.step4).not.toContain('Difference:');
    expect(seen.step5).toContain('After: Skipped');
    expect(doneValue(r, 'Before')).toBe('1.20 kg');
    expect(doneValue(r, 'After')).toBe('Skipped');
    expect(doneValue(r, 'Difference')).toBe('Not calculated');
    expect(savedNotification().body).toBe('Before 1.20 kg · After skipped · Diff not calculated');
    expect(showsZeroWeight(seen)).toBe(false);
  });

  test('3. before skipped, after recorded — the after weight kept, no difference', async () => {
    const {r, seen} = await weigh({before: null, after: '5.00'});

    expect(api.createWeighSession).toHaveBeenCalledTimes(1);
    expect(api.saveBeforeWeight).not.toHaveBeenCalled();
    expect(api.saveAfterWeight).toHaveBeenCalledWith('tok', 'S1', 5);
    expect(server.session).toEqual({beforeWeight: null, afterWeight: 5, difference: null});
    expect(seen.step3).toContain('Before: Skipped');
    expect(seen.step4).toContain('Before: Skipped');
    expect(seen.step4).not.toContain('Difference:');
    expect(doneValue(r, 'Before')).toBe('Skipped');
    expect(doneValue(r, 'After')).toBe('5.00 kg');
    expect(doneValue(r, 'Difference')).toBe('Not calculated');
    expect(savedNotification().body).toBe('Before skipped · After 5.00 kg · Diff not calculated');
    expect(showsZeroWeight(seen)).toBe(false);
  });

  test('4. both skipped — the record is still saved, with no weights and no difference', async () => {
    const {r, seen} = await weigh({before: null, after: null});

    expect(api.createWeighSession).toHaveBeenCalledTimes(1);
    expect(api.saveBeforeWeight).not.toHaveBeenCalled();
    expect(api.saveAfterWeight).not.toHaveBeenCalled();
    expect(api.linkSessionToPacket).toHaveBeenCalledWith('tok', 'S1', 'PKT-1');
    expect(server.session).toEqual({beforeWeight: null, afterWeight: null, difference: null});
    expect(doneValue(r, 'Before')).toBe('Skipped');
    expect(doneValue(r, 'After')).toBe('Skipped');
    expect(doneValue(r, 'Difference')).toBe('Not calculated');
    expect(savedNotification().body).toBe('Before skipped · After skipped · Diff not calculated');
    expect(showsZeroWeight(seen)).toBe(false);
  });

  test('a skipped weight is never sent, so nothing 0 (or copied) reaches the server', async () => {
    for (const combo of [{before: '1.20', after: null}, {before: null, after: '5.00'}, {before: null, after: null}]) {
      jest.clearAllMocks();
      await weigh(combo);
      for (const w of sentWeights()) expect(w).toBeGreaterThan(0);
      for (const v of Object.values(server.session)) expect(v).not.toBe(0);
    }
    // After a skipped before weight, the after weight is not copied into it.
    expect(server.session.beforeWeight).toBeNull();
  });
});

describe('Skip buttons on the two weight steps', () => {
  test('both are shown, next to the existing "📷 Scan Scale Display" and Next; the removed readers stay gone', async () => {
    const r = await openAndScan();
    const step2 = screenText(r);
    expect(step2).toContain('Skip Before Weight');
    expect(step2).toContain('📷 Scan Scale Display');
    expect(step2).toContain('Next — Before Photo');
    expect(button(r, 'Next — Before Photo').props.disabled).toBe(true); // still needs a weight

    await press(r, 'Skip Before Weight');
    await press(r, 'Skip before photo (optional)');
    const step4 = screenText(r);
    expect(step4).toContain('Skip After Weight');
    expect(step4).toContain('📷 Scan Scale Display');
    expect(step4).toContain('Next — After Photo');

    for (const gone of ['Scan Scale Display (Live)', 'Choose a Photo of the Display', 'Test PaddleOCR']) {
      expect(step2).not.toContain(gone);
      expect(step4).not.toContain(gone);
    }
  });

  test('a weight typed but not saved is dropped by Skip, not kept or sent', async () => {
    const r = await openAndScan();
    await typeBefore(r, '1.50');
    await press(r, 'Skip Before Weight');
    expect(api.saveBeforeWeight).not.toHaveBeenCalled();
    expect(screenText(r)).toContain('Before: Skipped');
    expect(screenText(r)).not.toContain('1.50');
  });

  test('normal entry still validates: Next with a zero weight is refused and nothing is saved', async () => {
    const r = await openAndScan();
    await typeBefore(r, '0');
    await press(r, 'Next — Before Photo');
    expect(api.saveBeforeWeight).not.toHaveBeenCalled();
    expect(screenText(r)).toContain('Enter a valid before weight');
    expect(hasText(r, 'Step 2 — Before Weight')).toBe(true);
  });

  test('skipped, then back to record it after all: saved normally, in the same session', async () => {
    const r = await openAndScan();
    await press(r, 'Skip Before Weight');
    await pressBack(r);
    expect(hasText(r, 'Step 2 — Before Weight')).toBe(true);
    await typeBefore(r, '1.20');
    await press(r, 'Next — Before Photo');
    expect(api.createWeighSession).toHaveBeenCalledTimes(1);
    expect(api.saveBeforeWeight).toHaveBeenCalledWith('tok', 'S1', 1.2);
    expect(screenText(r)).toContain('Before: 1.20 kg');
  });

  test('Skip Before Weight is refused once that weight is saved on the server', async () => {
    const r = await openAndScan();
    await typeBefore(r, '1.20');
    await press(r, 'Next — Before Photo');
    await pressBack(r);
    await press(r, 'Skip Before Weight');
    expect(hasText(r, 'Step 2 — Before Weight')).toBe(true);
    expect(screenText(r)).toContain('A before weight is already saved for this session');
    expect(server.session.beforeWeight).toBe(1.2);
  });

  test('Skip After Weight is refused once that weight is saved on the server', async () => {
    const r = await openAndScan();
    await typeBefore(r, '1.20');
    await press(r, 'Next — Before Photo');
    await press(r, 'Skip before photo (optional)');
    await typeAfter(r, '5.00');
    await press(r, 'Next — After Photo');
    await pressBack(r);
    await press(r, 'Skip After Weight');
    expect(hasText(r, 'Step 4 — After Weight')).toBe(true);
    expect(screenText(r)).toContain('An after weight is already saved for this session');
    expect(server.session).toEqual({beforeWeight: 1.2, afterWeight: 5, difference: 5 - 1.2});
  });

  test('a resumed session whose before weight is already saved cannot skip it either', async () => {
    api.findActiveSessionForPacket.mockResolvedValue([{measurement: {
      sessionId: 'S9', beforeWeight: 1.2, afterWeight: null, beforePhotoUrl: 'https://x/b.jpg', afterPhotoUrl: '',
    }}]);
    let r;
    await act(async () => { r = create(<WeighScanScreen />); });
    const camera = r.root.findAll(n => typeof n.props.onReadCode === 'function')[0];
    await act(async () => { await camera.props.onReadCode({nativeEvent: {codeStringValue: 'PKT-1'}}); });
    // Resumes at the after weight, exactly as before.
    expect(hasText(r, 'Step 4 — After Weight')).toBe(true);
    expect(screenText(r)).toContain('Before: 1.2 kg');
    await pressBack(r);
    await pressBack(r);
    await press(r, 'Skip Before Weight');
    expect(hasText(r, 'Step 2 — Before Weight')).toBe(true);
    expect(screenText(r)).toContain('A before weight is already saved for this session');
    expect(api.createWeighSession).not.toHaveBeenCalled();
  });

  test('Skip Before Weight on a packet filled meanwhile goes to the existing "already weighed" path', async () => {
    const filled = {uniqueId: 'PKT-1', status: 'filled'};
    api.createWeighSession.mockRejectedValue(Object.assign(new Error('filled'), {code: 'PACKET_ALREADY_FILLED', packet: filled}));
    const r = await openAndScan();
    await press(r, 'Skip Before Weight');
    expect(mockNavigation.push).toHaveBeenCalledWith('ProductDetail', {packet: filled});
  });
});

describe('history shows skipped weights as skipped', () => {
  const records = [
    {_id: '1', uniqueId: 'A', beforeWeight: 1, afterWeight: 5, difference: 4},
    {_id: '2', uniqueId: 'B', beforeWeight: null, afterWeight: 5, difference: null},
    {_id: '3', uniqueId: 'C', beforeWeight: 1, afterWeight: null, difference: null},
    {_id: '4', uniqueId: 'D', beforeWeight: null, afterWeight: null, difference: null},
    {_id: '5', uniqueId: 'E', beforeWeight: 2, afterWeight: 1, difference: -1},
  ];

  test('History: rows say which weight was skipped; the average and Gain/Loss use real differences only', async () => {
    api.fetchPacketHistory.mockResolvedValue(records);
    let r;
    await act(async () => { r = create(<HistoryScreen />); });
    const text = screenText(r);
    expect(text).toContain('+4.00 kg');
    expect(text).toContain('Before skipped');
    expect(text).toContain('After skipped');
    expect(text).toContain('Weights skipped');
    expect(text).toContain('-1.00 kg');
    expect(text).toContain('+1.50 kg'); // (4 + -1) / 2 — not (4 + 0 + 0 + 0 - 1) / 5
    expect(text).toContain('5 entries');

    await press(r, 'Gain');
    expect(screenText(r)).toContain('1 entries');
    await press(r, 'Loss');
    expect(screenText(r)).toContain('1 entries');
  });

  test('History: no record with a difference -> the average is "—", not +0.00', async () => {
    api.fetchPacketHistory.mockResolvedValue([records[3]]);
    let r;
    await act(async () => { r = create(<HistoryScreen />); });
    expect(screenText(r)).not.toContain('+0.00 kg');
    expect(screenText(r)).toContain('Weights skipped');
  });

  test('packet detail: a skipped weight reads "Skipped", the recorded one its value, no difference', async () => {
    mockRouteParams = {packet: {
      uniqueId: 'B', status: 'filled', beforeWeight: null, afterWeight: 5, difference: null,
      batchId: {seedType: 'Wheat'},
    }};
    let r;
    await act(async () => { r = create(<ProductDetailScreen />); });
    const text = screenText(r);
    expect(text).toContain('Skipped');
    expect(text).toContain('5.00');
    expect(text).not.toMatch(/(^|\s)0\.00/m);
  });
});

describe('weightSkip helpers', () => {
  test('a difference only when both weights are real', () => {
    expect(weightDifference('1.20', '5.00')).toBeCloseTo(3.8);
    expect(weightDifference(1.2, 5)).toBeCloseTo(3.8);
    expect(weightDifference('', '5.00')).toBeNull();
    expect(weightDifference('1.20', '')).toBeNull();
    expect(weightDifference(null, null)).toBeNull();
    expect(weightDifference(undefined, 5)).toBeNull();
    expect(weightDifference('abc', 5)).toBeNull();
  });

  test('a missing weight is null, never 0', () => {
    for (const v of ['', '  ', null, undefined, NaN, 'kg']) expect(actualWeight(v)).toBeNull();
    expect(actualWeight('1.70')).toBe(1.7);
    expect(recordedWeight(null)).toBe('Skipped');
    expect(recordedWeight(undefined)).toBe('Skipped');
    expect(recordedWeight(1.7)).toBe('1.70');
    expect(differenceLabel(null)).toBe('Not calculated');
    expect(differenceLabel(-0.05)).toBe('-0.05 kg');
    expect(differenceLabel(0)).toBe('+0.00 kg'); // a real zero difference is still shown
  });

  test('labels, skip permission, notes, averages', () => {
    expect(weightLabel('', WEIGHT_SKIPPED)).toBe('Skipped');
    expect(weightLabel('1.70', WEIGHT_SAVED)).toBe('1.70 kg');
    expect(canSkipWeight(null)).toBe(true);
    expect(canSkipWeight(WEIGHT_SKIPPED)).toBe(true);
    expect(canSkipWeight(WEIGHT_SAVED)).toBe(false);
    expect(skippedNote({beforeWeight: 1, afterWeight: 2})).toBeNull();
    expect(skippedNote({beforeWeight: null, afterWeight: 2})).toBe('Before skipped');
    expect(skippedNote({beforeWeight: 1, afterWeight: null})).toBe('After skipped');
    expect(skippedNote({})).toBe('Weights skipped');
    expect(averageDifference([])).toBeNull();
    expect(averageDifference([{difference: null}, {difference: 2}, {difference: 4}])).toBe(3);
    expect(measurementSummary('', '', null)).toBe('Before skipped · After skipped · Diff not calculated');
  });
});
