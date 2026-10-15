// "Scan Scale Display" is the only scale-display reader left on the Before
// and After Weight steps. Two parts:
//   1. the manual photo flow itself (readWeightWithAI): the photo goes
//      through the phone's display detection, is cropped on the phone, read by
//      the backend and cross-checked by the phone's seven-segment reader -
//      native modules and the backend are stubbed, the decision code is real;
//   2. the screen and the native registration, checked in their source: this
//      project's Jest preset does not transform .jsx, so the screen itself
//      cannot be rendered here.
import fs from 'fs';
import path from 'path';
import {NativeModules} from 'react-native';
import {readWeightByAI} from '../src/services/api';
import {readWeightWithAI} from '../src/services/aiWeightRead';
import {weightFieldValue} from '../src/services/weightOcr';

jest.mock('../src/services/api', () => ({readWeightByAI: jest.fn()}));
// The dev-only device fixture harness schedules itself on import; not wanted here.
jest.mock('../src/dev/ocrFixtureHarness', () => ({}));

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

const box = {x: 0.3, y: 0.35, w: 0.4, h: 0.12};
const crop = {x: 0.25, y: 0.3, w: 0.5, h: 0.2};

beforeEach(() => {
  NativeModules.ScaleImage = {process: jest.fn(async () => ({uri: 'file:///cache/prepared.jpg'}))};
  NativeModules.LiveWeight = {
    detect: jest.fn(async () => ({found: true, certain: true, ok: true, box, crop, text: '2.45', kind: 'lcd'})),
    readImage: jest.fn(async () => ({ok: true, text: '2.45', kind: 'lcd'})),
  };
  readWeightByAI.mockReset();
});

describe('manual "Scan Scale Display" photo flow (readWeightWithAI)', () => {
  test('display found on the phone: cropped there, read by the server, both agree -> a reading for the weight field', async () => {
    readWeightByAI.mockResolvedValue({status: 'ok', value: '2.45', unit: 'kg'});
    const r = await readWeightWithAI('file:///photo.jpg', 'token-1');

    expect(NativeModules.LiveWeight.detect).toHaveBeenCalledWith('file:///photo.jpg');
    expect(NativeModules.ScaleImage.process).toHaveBeenCalledWith('file:///photo.jpg', crop.x, crop.y, crop.w, crop.h, 'original');
    expect(readWeightByAI).toHaveBeenCalledWith('token-1', 'file:///cache/prepared.jpg');
    expect(r.ok).toBe(true);
    expect(r.engine).toBe('ai+segment');
    expect(weightFieldValue(r)).toBe('2.45');
    expect(r.cropUri).toBe('file:///cache/prepared.jpg');
  });

  test('a crop framed by hand (Adjust Crop): exactly that area is prepared and read by both readers', async () => {
    readWeightByAI.mockResolvedValue({status: 'ok', value: '2.45', unit: 'kg'});
    const framed = {x: 0.1, y: 0.2, w: 0.6, h: 0.3};
    const r = await readWeightWithAI('file:///photo.jpg', 'token-1', framed);

    expect(NativeModules.LiveWeight.detect).not.toHaveBeenCalled();
    expect(NativeModules.ScaleImage.process).toHaveBeenCalledWith('file:///photo.jpg', 0.1, 0.2, 0.6, 0.3, 'original');
    expect(NativeModules.LiveWeight.readImage).toHaveBeenCalledWith('file:///cache/prepared.jpg');
    expect(r.ok).toBe(true);
    expect(r.crop).toEqual(framed);
  });

  test('server and phone disagree: nothing is accepted, both are offered as choices', async () => {
    readWeightByAI.mockResolvedValue({status: 'ok', value: '2.15', unit: 'kg'});
    const r = await readWeightWithAI('file:///photo.jpg', 'token-1');
    expect(r.ok).toBe(false);
    expect(r.choices.map(c => c.detectedValue)).toEqual(['2.15', '2.45']);
  });

  test('server unreachable: the phone reading is used and flagged; nothing throws', async () => {
    readWeightByAI.mockRejectedValue(Object.assign(new Error('Network request failed'), {code: 'NETWORK'}));
    const r = await readWeightWithAI('file:///photo.jpg', 'token-1');
    expect(r.ok).toBe(true);
    expect(r.engine).toBe('segment');
    expect(r.note).toBeTruthy();
  });

  test('a display running off the photo: asks for a retake without calling the server', async () => {
    NativeModules.LiveWeight.detect.mockResolvedValue({found: true, certain: true, ok: true, box, crop, cutOff: true});
    const r = await readWeightWithAI('file:///photo.jpg', 'token-1');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('display-cut-off');
    expect(readWeightByAI).not.toHaveBeenCalled();
  });

  test('no photo: a camera message, nothing called', async () => {
    const r = await readWeightWithAI(null, 'token-1');
    expect(r.ok).toBe(false);
    expect(NativeModules.ScaleImage.process).not.toHaveBeenCalled();
  });
});

describe('Before / After Weight steps keep only "Scan Scale Display"', () => {
  const screen = read('src/screens/WeighScanScreen.jsx');

  test('the manual button is there and opens the camera reader', () => {
    expect(screen).toContain('📷 Scan Scale Display');
    expect(screen).toMatch(/onPress=\{\(\) => handleScanDisplay\(phase\)\}/);
    expect(screen).toMatch(/const result = await launchCamera\(\{mediaType: 'photo', saveToPhotos: false, \.\.\.size\}\);/);
    expect(screen).toMatch(/const r = await readWeightWithAI\(photo\.uri, token\);/);
    expect(screen).toMatch(/const parsed = await readWeightWithAI\(uri, token, crop\);/);
    expect(screen).toContain('<DisplayCropModal');
  });

  test('the three removed buttons and their code are gone', () => {
    for (const gone of [
      'Scan Scale Display (Live)', 'Choose a Photo of the Display', 'Test PaddleOCR',
      'LiveWeightScanner', 'setLiveScan', 'liveDetected', 'describeReading',
      'recognizeWeightImage', 'paddleOcr', 'handleTestPaddle', 'runPaddleTest', 'paddleTest',
      "'gallery'", 'scanGalleryBtn', 'liveScanBtn',
    ]) {
      expect(screen).not.toContain(gone);
    }
  });

  test('both weight steps still use it, and the weight fields, Next buttons and photo steps are untouched', () => {
    expect(screen).toContain("{renderScanDisplay('before')}");
    expect(screen).toContain("{renderScanDisplay('after')}");
    expect(screen).toContain('onPress={handleBeforeWeightNext}');
    expect(screen).toMatch(/value=\{afterWeightVal\}/);
    expect(screen).toMatch(/onChangeText=\{setAfterWeightVal\}/);
    expect(screen).toContain('handleAfterWeightNext');
    // The Before / After PHOTO steps keep their own camera + gallery choice.
    expect(screen).toMatch(/const handlePickPhoto = async \(setter\) => \{[\s\S]*?launchImageLibrary\(\{mediaType: 'photo', selectionLimit: 1\}\)/);
    expect(screen).toContain('const handleTakePhoto = async (setter) =>');
  });

  test('the removed modules are no longer in the app, and nothing imports them', () => {
    expect(exists('src/services/paddleOcr.js')).toBe(false);
    expect(exists('src/ui/components/LiveWeightScanner.jsx')).toBe(false);
    const harness = read('src/dev/ocrFixtureHarness.js');
    expect(harness).not.toMatch(/require\('\.\.\/services\/paddleOcr'\)/);
    expect(harness).not.toContain('recognizeWeightImage');
  });
});

describe('native side', () => {
  const pkg = read('android/app/src/main/java/com/weighingqrauto/PaddleOcrPackage.kt');

  test('the seven-segment reader the manual flow uses is still registered; the PaddleOCR module is not', () => {
    expect(pkg).toMatch(/listOf\(LiveWeightModule\(reactContext\)\)/);
    expect(pkg).not.toMatch(/PaddleOcrModule\(/);
    expect(exists('android/app/src/main/java/com/weighingqrauto/PaddleOcrModule.kt')).toBe(false);
    expect(exists('android/app/src/main/java/com/weighingqrauto/LiveWeightModule.kt')).toBe(true);
    expect(exists('android/app/src/main/java/com/weighingqrauto/ScaleImageModule.kt')).toBe(true);
    const app = read('android/app/src/main/java/com/weighingqrauto/MainApplication.kt');
    expect(app).toContain('add(ScaleImagePackage())');
    expect(app).toContain('add(PaddleOcrPackage())');
  });

  test('the PaddleOCR model files are no longer bundled', () => {
    for (const f of ['models/det/inference.onnx', 'models/rec/inference.onnx', 'models/rec/inference.yml']) {
      expect(exists(`android/app/src/main/assets/${f}`)).toBe(false);
    }
  });
});
