import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
  ActivityIndicator, Image, PermissionsAndroid,
  Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

// Safely import Camera to avoid TCC crashes on Simulator
const Camera = (Platform.OS === 'ios' && __DEV__)
  ? (props) => (
      <View style={[props.style, {backgroundColor: '#000', justifyContent: 'center', alignItems: 'center'}]}>
        <Icon name="videocam-off" size={40} color="rgba(255,255,255,0.3)" />
        <Text style={{color: '#fff', opacity: 0.5, marginTop: 10}}>Camera disabled in Simulator</Text>
      </View>
    )
  : require('react-native-camera-kit').Camera;

const BarcodeScanning = (Platform.OS === 'ios' && __DEV__)
  ? { scan: () => Promise.resolve([]) }
  : require('@react-native-ml-kit/barcode-scanning').default;
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {BASE_URL} from '../config';
import {
  fetchProductByScan,
  findActiveSessionForPacket,
  createWeighSession,
  uploadSessionPhoto,
  saveBeforeWeight,
  saveAfterWeight,
  linkSessionToPacket,
} from '../services/api';
import {addNotification} from '../store/slices/notificationSlice';
import {weightFieldValue, MESSAGES, WEIGHT_OCR_DEBUG} from '../services/weightOcr';
import DisplayCropModal from '../ui/components/DisplayCropModal';
import {readWeightWithAI} from '../services/aiWeightRead';
import {
  WEIGHT_SAVED, WEIGHT_SKIPPED, canSkipWeight, differenceLabel,
  measurementSummary, weightDifference, weightLabel,
} from '../services/weightSkip';

function extractProductId(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (s.startsWith('http')) return s.split('/').pop();
  if (s.includes('|')) return s.split('|')[0].trim();
  return s;
}

const STEPS = ['Scan QR', 'Before Wt', 'Before Photo', 'After Wt', 'After Photo'];

// Same absolute-vs-relative rule ProductDetailScreen already uses: Cloudinary
// secure_urls are absolute and must be used as-is; only the legacy local-disk
// fallback path needs BASE_URL prepended.
function resolvePhotoUri(url) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `${BASE_URL}${url}`;
}

export default function WeighScanScreen() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const token = useSelector(state => state.user.token);

  // step: 1=scan, 2=before weight, 3=before photo, 4=after weight, 5=after photo + save, 6=done
  const [step, setStep]               = useState(1);
  const [packet, setPacket]           = useState(null);
  const [sessionId, setSessionId]     = useState(null);
  const [beforePhotoUri, setBeforePhotoUri] = useState(null);
  const [afterPhotoUri, setAfterPhotoUri]   = useState(null);
  const [beforeWeightVal, setBeforeWeightVal] = useState('');
  const [afterWeightVal, setAfterWeightVal]   = useState('');
  // null | WEIGHT_SAVED (the server has it) | WEIGHT_SKIPPED (the user
  // skipped it — nothing is sent, so the server keeps null, never 0).
  const [beforeWeightState, setBeforeWeightState] = useState(null);
  const [afterWeightState, setAfterWeightState]   = useState(null);
  const [linkedPacket, setLinkedPacket] = useState(null);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [camPerm, setCamPerm]         = useState(null);
  // Remote photo URLs from a RESUMED session — display-only, never passed to
  // uploadSessionPhoto. A photo already on the server never needs re-upload;
  // reaching the step that would re-upload it (before-photo/after-photo) is
  // itself skipped whenever the corresponding URL below is already set.
  const [resumedBeforePhotoUrl, setResumedBeforePhotoUrl] = useState(null);
  const [resumedAfterPhotoUrl, setResumedAfterPhotoUrl]   = useState(null);
  // Scale-display OCR. null = idle; otherwise {phase: 'before'|'after',
  // status: 'reading'|'framing'|'result'|'error', result?, message?,
  // photo?: {uri, asset, source} the picture being read, crop?: the area of
  // it that was read}. A detected value only ever reaches
  // beforeWeightVal/afterWeightVal when the user taps "Confirm" — it is
  // never submitted automatically.
  const [ocr, setOcr] = useState(null);
  const beforeInputRef = useRef(null);
  const afterInputRef = useRef(null);

  const scannedRef = useRef(false);
  // Guards the actual session-creation request specifically — a rapid
  // double-tap on "Next" at Step 2 must never fire createWeighSession twice.
  const creatingSessionRef = useRef(false);

  // Camera permission — needed for step 1 (QR scan)
  useEffect(() => {
    (async () => {
      if (Platform.OS === 'android') {
        const ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
        if (ok) { setCamPerm(true); return; }
        const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
          title: 'Camera Permission',
          message: 'Camera needed to scan QR codes.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        });
        setCamPerm(r === PermissionsAndroid.RESULTS.GRANTED);
      } else {
        setCamPerm(true);
      }
    })();
  }, []);

  // Reset scan lock when returning to step 1
  useEffect(() => {
    if (step === 1) {
      scannedRef.current = false;
    }
    setOcr(null);
  }, [step]);

  // A filled packet's permanent QR is still perfectly valid to scan — it
  // just must never start a NEW weighing session. Show the existing
  // packet/measurement instead (same screen ScannerScreen already uses for
  // this), so the user can see it was already weighed without redesigning
  // this screen.
  const handleAlreadyFilled = useCallback((p) => {
    dispatch(addNotification({
      type: 'INFO',
      title: 'Already Weighed',
      body: 'This packet has already been weighed.',
    }));
    scannedRef.current = false;
    navigation.push('ProductDetail', {packet: p});
  }, [dispatch, navigation]);

  // Given a freshly-scanned EMPTY packet, checks for an already-unfinished
  // (active) session for it and either resumes it or starts fresh. Returns
  // false (and sets an error) only for the unsafe "multiple active sessions"
  // case, so the caller knows not to proceed.
  const resumeOrStartFresh = useCallback(async (uniqueId) => {
    let activeSessions = [];
    try {
      activeSessions = await findActiveSessionForPacket(uniqueId, token);
    } catch (_) {
      // Lookup failing isn't fatal — fall back to starting fresh. The
      // backend's own unique-active-session guard at creation time still
      // prevents a real duplicate if one turns out to exist.
      activeSessions = [];
    }

    if (activeSessions.length > 1) {
      setError('Multiple active sessions exist for this packet — contact admin.');
      return false;
    }

    setSessionId(null);
    setBeforeWeightVal(''); setAfterWeightVal('');
    setBeforeWeightState(null); setAfterWeightState(null);
    setBeforePhotoUri(null); setAfterPhotoUri(null);
    setResumedBeforePhotoUrl(null); setResumedAfterPhotoUrl(null);

    if (activeSessions.length === 1) {
      const m = activeSessions[0].measurement;
      setSessionId(m.sessionId);
      setBeforeWeightVal(m.beforeWeight != null ? String(m.beforeWeight) : '');
      setAfterWeightVal(m.afterWeight != null ? String(m.afterWeight) : '');
      setBeforeWeightState(m.beforeWeight != null ? WEIGHT_SAVED : null);
      setAfterWeightState(m.afterWeight != null ? WEIGHT_SAVED : null);
      setResumedBeforePhotoUrl(m.beforePhotoUrl || null);
      setResumedAfterPhotoUrl(m.afterPhotoUrl || null);

      let resumeStep;
      if (m.beforeWeight == null) resumeStep = 2;
      else if (!m.beforePhotoUrl) resumeStep = 3;
      else if (m.afterWeight == null) resumeStep = 4;
      else resumeStep = 5;
      setStep(resumeStep);

      dispatch(addNotification({
        type: 'INFO',
        title: 'Resuming Weighing',
        body: 'An unfinished session for this packet was found — continuing where you left off.',
      }));
    } else {
      setStep(2);
    }
    return true;
  }, [dispatch, token]);

  // Gallery QR pick
  const handleGalleryPick = useCallback(async () => {
    if (scannedRef.current) return;
    try {
      const result = await launchImageLibrary({mediaType: 'photo', selectionLimit: 1});
      if (result.didCancel || !result.assets?.length) return;
      const uri = result.assets[0].uri;
      const barcodes = await BarcodeScanning.scan(uri);
      if (!barcodes?.length) { setError('No QR code found in image'); return; }
      const uniqueId = extractProductId(barcodes[0].value);
      if (!uniqueId) return;
      scannedRef.current = true;
      setError('');
      const p = await fetchProductByScan(uniqueId, token);
      if (p.status === 'filled') {
        handleAlreadyFilled(p);
        return;
      }
      setPacket(p);
      const ok = await resumeOrStartFresh(uniqueId);
      if (!ok) { scannedRef.current = false; return; }
    } catch (err) {
      scannedRef.current = false;
      setError(err.message || 'Could not read QR from image');
    }
  }, [handleAlreadyFilled, resumeOrStartFresh, token]);

  // QR scanned
  const handleQRScanned = useCallback(async (event) => {
    const raw = event?.nativeEvent?.codeStringValue;
    if (!raw || scannedRef.current) return;
    const uniqueId = extractProductId(raw);
    if (!uniqueId) return;
    scannedRef.current = true;
    setError('');
    try {
      const p = await fetchProductByScan(uniqueId, token);
      if (p.status === 'filled') {
        handleAlreadyFilled(p);
        return;
      }
      setPacket(p);
      const ok = await resumeOrStartFresh(uniqueId);
      if (!ok) { setTimeout(() => { scannedRef.current = false; }, 2500); return; }
    } catch (err) {
      setError(err.message || 'Packet not found');
      setTimeout(() => { scannedRef.current = false; }, 2500);
    }
  }, [handleAlreadyFilled, resumeOrStartFresh, token]);

  // Take photo — reused for both the before and after capture steps, just
  // targeting whichever state setter is passed in.
  const handleTakePhoto = async (setter) => {
    setError('');
    try {
      const result = await launchCamera({mediaType: 'photo', saveToPhotos: true, quality: 0.8});
      if (result.didCancel || !result.assets?.length) return;
      setter(result.assets[0].uri);
    } catch (_) {
      setError('Camera not available — use gallery instead');
    }
  };

  // Pick photo from gallery — same reuse pattern as handleTakePhoto.
  const handlePickPhoto = async (setter) => {
    setError('');
    try {
      const result = await launchImageLibrary({mediaType: 'photo', selectionLimit: 1});
      if (result.didCancel || !result.assets?.length) return;
      setter(result.assets[0].uri);
    } catch (_) {
      setError('Could not open gallery');
    }
  };

  // Shows what was read from a photo (or why nothing was) for the user to
  // act on. `crop` is the area of the photo that was read.
  const showParsed = (phase, parsed, photo, crop) => {
    // TEMPORARY on-screen debug (what each pass saw) so a failure can be
    // diagnosed on the phone without logcat. Goes away with WEIGHT_OCR_DEBUG.
    const debug = WEIGHT_OCR_DEBUG && !parsed.ok
      ? `[debug] ${parsed.reason}\n${(parsed.passSummary || []).join('\n')}`
      : null;
    setOcr(parsed.ok
      ? {phase, status: 'result', result: parsed, source: photo.source, photo, crop, cropUri: parsed.cropUri}
      : {phase, status: 'error', message: parsed.message, hint: parsed.hint, choices: parsed.choices,
        debug, source: photo.source, photo, crop, cropUri: parsed.cropUri});
  };

  // Opens the manual framing of a photo, starting from `crop` when there is one.
  const frameByHand = (phase, photo, crop, notice) => {
    setOcr({phase, status: 'framing', uri: photo.uri, asset: photo.asset, source: photo.source, photo,
      initialCrop: crop || null, notice: notice || null});
  };

  // Scale-display reading: photograph the display; the backend's vision model
  // reads it and the phone's own reader cross-checks the same photo
  // (aiWeightRead.js). The reading and the picture of the display are shown
  // for confirmation; Adjust Crop lets the user frame the display and read
  // again. Nothing is saved or submitted here.
  const handleScanDisplay = async (phase) => {
    const source = 'camera';
    setError('');
    setOcr(null);
    try {
      // Long side capped at 2048 px: plenty for the digits, and a small upload.
      const size = {maxWidth: 2048, maxHeight: 2048, quality: 0.9};
      const result = await launchCamera({mediaType: 'photo', saveToPhotos: false, ...size});
      if (WEIGHT_OCR_DEBUG) {
        console.log('[WeightOCR] camera result:', JSON.stringify({
          didCancel: result.didCancel, errorCode: result.errorCode, errorMessage: result.errorMessage,
          assets: result.assets?.length,
        }));
      }
      if (result.didCancel) return;
      if (!result.assets?.length) {
        setOcr({phase, status: 'error', message: MESSAGES.camera,
          debug: WEIGHT_OCR_DEBUG ? `[debug] camera: ${result.errorCode || 'no asset'}` : null});
        return;
      }
      const photo = {uri: result.assets[0].uri, asset: result.assets[0], source};
      setOcr({phase, status: 'reading', photo, source});
      const r = await readWeightWithAI(photo.uri, token);
      showParsed(phase, r, photo, r.crop);
    } catch (e) {
      setOcr({phase, status: 'error', message: MESSAGES.camera, source,
        debug: WEIGHT_OCR_DEBUG ? `[debug] camera: ${e && e.message}` : null});
    }
  };

  const handleCropConfirm = async (crop) => {
    const {phase, uri, asset} = ocr;
    const photo = ocr.photo || {uri, asset, source: ocr.source};
    setOcr({phase, status: 'reading', photo, source: photo.source});
    try {
      const parsed = await readWeightWithAI(uri, token, crop);
      showParsed(phase, parsed, photo, crop);
    } catch (e) {
      console.log('[WeightOCR] unexpected error:', e && e.message);
      setOcr({phase, status: 'error', message: MESSAGES.unreadable, photo, source: photo.source, crop,
        debug: WEIGHT_OCR_DEBUG ? `[debug] unexpected: ${e && e.message}` : null});
    }
  };

  // Retake: a new photo with the camera.
  const handleRetake = (phase) => {
    handleScanDisplay(phase);
  };

  // `edit`: also put the cursor in the weight field, for a reading that is
  // nearly right and quicker to correct than to retake.
  const handleUseDetectedWeight = (edit = false) => {
    if (ocr?.status !== 'result') return;
    const {phase} = ocr;
    const value = weightFieldValue(ocr.result);
    if (phase === 'before') setBeforeWeightVal(value);
    else setAfterWeightVal(value);
    setOcr(null);
    if (edit) handleEditWeight(phase);
  };

  // The two readers disagreed; the user looked at the display and picked one.
  const handleUseChoice = (phase, choice) => {
    const value = weightFieldValue(choice);
    if (phase === 'before') setBeforeWeightVal(value);
    else setAfterWeightVal(value);
    setOcr(null);
  };

  // Recognition failed and the user would rather type the weight.
  const handleTypeInstead = (phase) => {
    setOcr(null);
    handleEditWeight(phase);
  };

  const handleEditWeight = (phase) => {
    const input = phase === 'before' ? beforeInputRef.current : afterInputRef.current;
    if (input) input.focus();
  };

  // Shared by the before/after weight steps. Rendered only for the step it
  // belongs to, so a stale result from the other step never shows.
  const renderScanDisplay = (phase) => {
    const cur = ocr && ocr.phase === phase ? ocr : null;
    return (
      <>
        <DisplayCropModal
          visible={cur?.status === 'framing'}
          uri={cur?.uri}
          initialCrop={cur?.initialCrop}
          notice={cur?.notice}
          onConfirm={handleCropConfirm}
          onCancel={() => setOcr(null)}
        />
        <Text style={styles.scanHintTxt}>
          Use the REAR camera. Tap the display to focus, hold steady, straight-on, no glare, with the whole display in the photo. Bright LED digits can wash out — lower the exposure if they look white. The display is found automatically; you frame it yourself only if it cannot be.
        </Text>
        <Pressable
          style={[styles.scanDisplayBtn, (saving || cur?.status === 'reading') && styles.nextBtnDisabled]}
          disabled={saving || cur?.status === 'reading'}
          onPress={() => handleScanDisplay(phase)}>
          {cur?.status === 'reading'
            ? <ActivityIndicator color={COLORS.primary} />
            : <>
                <Icon name="photo-camera" size={18} color={COLORS.primary} />
                <Text style={styles.scanDisplayTxt}>📷 Scan Scale Display</Text>
              </>}
        </Pressable>

        {cur?.status === 'result' && (
          <View style={styles.ocrCard}>
            {!!cur.cropUri && (
              <>
                <Text style={styles.ocrLbl}>Display found in the photo</Text>
                <Image source={{uri: cur.cropUri}} style={styles.ocrCrop} resizeMode="contain" />
                <Text style={styles.ocrNote}>Check that every digit and the decimal point are in this picture.</Text>
              </>
            )}
            <Text style={styles.ocrLbl}>Detected Weight</Text>
            <Text style={styles.ocrVal}>{cur.result.detectedValue} {cur.result.detectedUnit}</Text>
            {cur.result.converted && (
              <Text style={styles.ocrNote}>
                = {cur.result.kg} kg
              </Text>
            )}
            {cur.result.unitAssumed && (
              <Text style={styles.ocrNote}>
                No unit visible on the display — assuming kg
              </Text>
            )}
            {!!cur.result.note && (
              <Text style={styles.ocrNote}>{cur.result.note}</Text>
            )}
            {cur.result.otherReadings?.length > 0 && (
              <Text style={styles.ocrNote}>
                A second reader saw {cur.result.otherReadings.join(', ')} kg instead — check the display before using this.
              </Text>
            )}
            <View style={styles.ocrBtnRow}>
              <Pressable style={[styles.ocrBtn, styles.ocrBtnPrimary]} onPress={() => handleUseDetectedWeight(false)}>
                <Text style={styles.ocrBtnPrimaryTxt}>Confirm Weight</Text>
              </Pressable>
              <Pressable style={styles.ocrBtn} onPress={() => handleRetake(phase)}>
                <Text style={styles.ocrBtnTxt}>Retake Photo</Text>
              </Pressable>
            </View>
            <View style={[styles.ocrBtnRow, styles.ocrBtnRow2]}>
              {!!cur.photo && (
                <Pressable style={styles.ocrBtn} onPress={() => frameByHand(phase, cur.photo, cur.crop)}>
                  <Text style={styles.ocrBtnTxt}>Adjust Crop</Text>
                </Pressable>
              )}
              <Pressable style={styles.ocrBtn} onPress={() => handleTypeInstead(phase)}>
                <Text style={styles.ocrBtnTxt}>Enter Manually</Text>
              </Pressable>
            </View>
          </View>
        )}

        {cur?.status === 'error' && (
          <View style={styles.ocrCard}>
            {!!cur.cropUri && <Image source={{uri: cur.cropUri}} style={styles.ocrCrop} resizeMode="contain" />}
            <Text style={styles.errTxt}>{cur.message}</Text>
            {!!cur.hint && <Text style={styles.ocrNote}>{cur.hint}</Text>}
            {(cur.choices || []).map(choice => (
              <Pressable
                key={`${choice.engine}-${choice.kg}`}
                style={[styles.ocrBtn, styles.ocrChoiceBtn]}
                onPress={() => handleUseChoice(phase, choice)}>
                <Text style={styles.ocrBtnTxt}>
                  Use {choice.detectedValue} {choice.detectedUnit}{choice.converted ? ` (= ${choice.kg} kg)` : ''}{choice.unconfirmed ? ' (server only, unconfirmed)' : ''}
                </Text>
              </Pressable>
            ))}
            {!!cur.debug && <Text style={styles.ocrDebug}>{cur.debug}</Text>}
            <View style={styles.ocrBtnRow}>
              <Pressable style={[styles.ocrBtn, styles.ocrBtnPrimary]} onPress={() => handleRetake(phase)}>
                <Text style={styles.ocrBtnPrimaryTxt}>Retake Photo</Text>
              </Pressable>
              {!!cur.photo && (
                <Pressable style={styles.ocrBtn} onPress={() => frameByHand(phase, cur.photo, cur.crop)}>
                  <Text style={styles.ocrBtnTxt}>Adjust Crop</Text>
                </Pressable>
              )}
              <Pressable style={styles.ocrBtn} onPress={() => handleTypeInstead(phase)}>
                <Text style={styles.ocrBtnTxt}>Enter Manually</Text>
              </Pressable>
            </View>
          </View>
        )}
      </>
    );
  };

  // The session is created on leaving Step 2 (first time only), whether the
  // before weight is saved or skipped — the photo steps and the after weight
  // need it either way.
  const ensureSession = async () => {
    if (sessionId) return sessionId;
    creatingSessionRef.current = true;
    const sid = await createWeighSession(token, packet?.uniqueId);
    setSessionId(sid);
    return sid;
  };

  // Step 2 → 3: create the session (first time only) and save the before
  // weight. Any failure keeps the user on this step with a real error —
  // except a genuine "already filled" race, which safely exits the flow
  // instead of leaving the user stuck retrying a request that can never
  // succeed.
  const handleBeforeWeightNext = async () => {
    const before = parseFloat(beforeWeightVal);
    if (!before || before <= 0) { setError('Enter a valid before weight'); return; }
    if (creatingSessionRef.current) return;
    setSaving(true); setError('');
    try {
      const sid = await ensureSession();
      await saveBeforeWeight(token, sid, before);
      setBeforeWeightState(WEIGHT_SAVED);
      setStep(3);
    } catch (err) {
      if (err.code === 'PACKET_ALREADY_FILLED') {
        // The backend already re-looked-up the packet for this 409 — use
        // that fresh, server-confirmed copy rather than the stale one from
        // this screen's original (now out-of-date) scan.
        handleAlreadyFilled(err.packet || packet);
        return;
      }
      setError(err.message || 'Could not save before weight — please try again');
    } finally {
      setSaving(false);
      creatingSessionRef.current = false;
    }
  };

  // Step 2 → 3 without a before weight. Nothing is sent for it, so the
  // server keeps null (never 0, and never its latest IoT reading — that is
  // what an empty POST /before-weight would fall back to). Only the session
  // is created, if it does not exist yet.
  const handleSkipBeforeWeight = async () => {
    if (!canSkipWeight(beforeWeightState)) {
      setError('A before weight is already saved for this session, so it cannot be skipped now — enter the correct weight instead.');
      return;
    }
    if (creatingSessionRef.current) return;
    setSaving(true); setError('');
    try {
      await ensureSession();
      setBeforeWeightVal('');
      setBeforeWeightState(WEIGHT_SKIPPED);
      setStep(3);
    } catch (err) {
      if (err.code === 'PACKET_ALREADY_FILLED') {
        handleAlreadyFilled(err.packet || packet);
        return;
      }
      setError(err.message || 'Could not start the weighing — please try again');
    } finally {
      setSaving(false);
      creatingSessionRef.current = false;
    }
  };

  // Step 3 → 4: upload the before photo to Cloudinary via the backend.
  // A failed upload is a real error — nothing is saved locally to fake it.
  const handleBeforePhotoContinue = async () => {
    if (!beforePhotoUri) { setStep(4); return; }
    setSaving(true); setError('');
    try {
      await uploadSessionPhoto(token, sessionId, beforePhotoUri, {uniqueId: packet.uniqueId, phase: 'before'});
      setStep(4);
    } catch (err) {
      setError(err.message || 'Before photo upload failed — please try again');
    } finally {
      setSaving(false);
    }
  };

  // Step 4 → 5: save the after weight (difference is computed server-side).
  const handleAfterWeightNext = async () => {
    const after = parseFloat(afterWeightVal);
    if (!after || after <= 0) { setError('Enter a valid after weight'); return; }
    setSaving(true); setError('');
    try {
      await saveAfterWeight(token, sessionId, after);
      setAfterWeightState(WEIGHT_SAVED);
      setStep(5);
    } catch (err) {
      setError(err.message || 'Could not save after weight — please try again');
    } finally {
      setSaving(false);
    }
  };

  // Step 4 → 5 without an after weight. Nothing is sent, so the server keeps
  // null and computes no difference.
  const handleSkipAfterWeight = () => {
    if (!canSkipWeight(afterWeightState)) {
      setError('An after weight is already saved for this session, so it cannot be skipped now — enter the correct weight instead.');
      return;
    }
    setError('');
    setAfterWeightVal('');
    setAfterWeightState(WEIGHT_SKIPPED);
    setStep(5);
  };

  // Step 5 → 6: upload the after photo, then link the session onto the
  // scanned SeedPacket. Any failure is surfaced as a real error; nothing is
  // written locally to fake a successful save, and retrying just re-runs
  // whichever part(s) below haven't succeeded yet.
  const handleFinalSave = async () => {
    setSaving(true); setError('');
    try {
      if (afterPhotoUri) {
        await uploadSessionPhoto(token, sessionId, afterPhotoUri, {uniqueId: packet.uniqueId, phase: 'after'});
      }
      const saved = await linkSessionToPacket(token, sessionId, packet.uniqueId);
      setLinkedPacket(saved);

      const diff = saved.difference != null ? saved.difference : weightDifference(beforeWeightVal, afterWeightVal);
      dispatch(addNotification({
        type: 'PASS',
        title: `Measurement Saved — ${packet?.batchId?.seedType || packet?.uniqueId}`,
        body: measurementSummary(beforeWeightVal, afterWeightVal, diff),
      }));
      setStep(6);
    } catch (err) {
      if (err.code === 'PACKET_ALREADY_FILLED') {
        // Another session won the race and linked first. The link endpoint's
        // 409 doesn't carry a packet payload, so re-fetch the real current
        // state before showing it — this screen's local packet/weight state
        // belongs to the losing attempt and must not be shown as if saved.
        try {
          const fresh = await fetchProductByScan(packet.uniqueId, token);
          handleAlreadyFilled(fresh);
        } catch (_) {
          handleAlreadyFilled(packet);
        }
        return;
      }
      setError(err.message || 'Save failed — please try again');
    } finally {
      setSaving(false);
    }
  };

  // ── Step bar ─────────────────────────────────────
  const stepBar = (
    <View style={styles.stepBar}>
      {STEPS.map((label, i) => {
        const num   = i + 1;
        const done  = step > num;
        const active = step === num;
        return (
          <React.Fragment key={label}>
            <View style={styles.stepItem}>
              <View style={[styles.stepCircle, active && styles.stepActive, done && styles.stepDone]}>
                {done
                  ? <Icon name="check" size={12} color="#fff" />
                  : <Text style={[styles.stepNum, (active || done) && {color: '#fff'}]}>{num}</Text>}
              </View>
              <Text style={[styles.stepLabel, active && {color: COLORS.primary, fontWeight: '700'}]}>{label}</Text>
            </View>
            {i < STEPS.length - 1 && <View style={[styles.stepLine, done && styles.stepLineDone]} />}
          </React.Fragment>
        );
      })}
    </View>
  );

  // ── STEP 1: QR SCAN ──────────────────────────────
  if (step === 1) {
    if (camPerm === false) {
      return (
        <View style={styles.root}>
          <View style={styles.header}>
            <Pressable style={styles.backBtn} onPress={() => navigation.pop()}>
              <Icon name="arrow-back" size={20} color={COLORS.text} />
            </Pressable>
            <Text style={styles.headerTitle}>Weigh & Record</Text>
            <View style={{width: 40}} />
          </View>
          <View style={styles.permBox}>
            <Icon name="no-photography" size={48} color={COLORS.muted} />
            <Text style={styles.permTxt}>Camera permission denied. Allow it in Phone Settings.</Text>
          </View>
        </View>
      );
    }
    if (camPerm === null) {
      return (
        <View style={[styles.root, {alignItems: 'center', justifyContent: 'center'}]}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      );
    }
    return (
      <View style={{flex: 1, backgroundColor: '#0f172a'}}>
        <Camera
          style={StyleSheet.absoluteFill}
          scanBarcode
          onReadCode={handleQRScanned}
          showFrame={false}
        />
        <View style={styles.scanTopBar}>
          <Pressable style={styles.scanCircleBtn} onPress={() => navigation.pop()}>
            <Icon name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.scanTopTitle}>Step 1 — Scan Packet QR</Text>
          <View style={{width: 44}} />
        </View>
        <View style={styles.scanFrameWrap}>
          <View style={styles.scanFrame}>
            {[styles.cTL, styles.cTR, styles.cBL, styles.cBR].map((cs, i) => (
              <View key={i} style={[styles.corner, cs]} />
            ))}
          </View>
          <Text style={styles.scanHint}>Align packet QR within the frame</Text>
          {!!error && (
            <View style={styles.scanErr}>
              <Icon name="error-outline" size={14} color="#f43f5e" />
              <Text style={styles.scanErrTxt}>{error}</Text>
            </View>
          )}
          <Pressable style={styles.galleryBtn} onPress={handleGalleryPick}>
            <Icon name="photo-library" size={18} color="#fff" />
            <Text style={styles.galleryTxt}>Pick from Gallery</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── STEP 2: BEFORE WEIGHT ────────────────────────
  if (step === 2) {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => setStep(1)}>
            <Icon name="arrow-back" size={20} color={COLORS.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Weigh & Record</Text>
          <View style={{width: 40}} />
        </View>
        {stepBar}
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.productCard}>
            <View style={styles.productIconWrap}>
              <Icon name="check-circle" size={22} color={COLORS.success} />
            </View>
            <View style={{flex: 1}}>
              <Text style={styles.productName}>{packet?.batchId?.seedType || 'Seed Packet'}</Text>
              <Text style={styles.productMeta}>
                Batch: {packet?.batchId?.batchNumber || '—'}  ·  ID: {packet?.uniqueId}
              </Text>
            </View>
          </View>

          <Text style={styles.stepTitle}>Step 2 — Before Weight</Text>
          <Text style={styles.stepSub}>Weigh the packet before filling, then scan the display or type the weight</Text>

          <View style={styles.inputCard}>
            <Text style={styles.inputLbl}>Before Weight (kg)</Text>
            <TextInput
              style={styles.weightInput}
              placeholder="e.g. 0.50"
              placeholderTextColor={COLORS.muted}
              keyboardType="numeric"
              ref={beforeInputRef}
              value={beforeWeightVal}
              onChangeText={setBeforeWeightVal}
              autoFocus
            />
          </View>

          {renderScanDisplay('before')}

          {!!error && <Text style={styles.errTxt}>{error}</Text>}

          <Pressable
            style={[styles.nextBtn, (!beforeWeightVal || saving) && styles.nextBtnDisabled]}
            disabled={!beforeWeightVal || saving}
            onPress={handleBeforeWeightNext}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Text style={styles.nextBtnTxt}>Next — Before Photo</Text>
                  <Icon name="arrow-forward" size={18} color="#fff" />
                </>}
          </Pressable>

          <Pressable
            style={[styles.skipWeightBtn, saving && styles.nextBtnDisabled]}
            disabled={saving}
            onPress={handleSkipBeforeWeight}>
            <Icon name="skip-next" size={18} color={COLORS.text} />
            <Text style={styles.skipWeightTxt}>Skip Before Weight</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── STEP 3: BEFORE PHOTO ─────────────────────────
  if (step === 3) {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => setStep(2)}>
            <Icon name="arrow-back" size={20} color={COLORS.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Weigh & Record</Text>
          <View style={{width: 40}} />
        </View>
        {stepBar}
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.productCard}>
            <View style={styles.productIconWrap}>
              <Icon name="check-circle" size={22} color={COLORS.success} />
            </View>
            <View style={{flex: 1}}>
              <Text style={styles.productName}>{packet?.batchId?.seedType || 'Seed Packet'}</Text>
              <Text style={styles.productMeta}>Before: {weightLabel(beforeWeightVal, beforeWeightState)}</Text>
            </View>
          </View>

          <Text style={styles.stepTitle}>Step 3 — Before Photo</Text>
          <Text style={styles.stepSub}>Take a photo of the empty packet before filling</Text>

          {beforePhotoUri ? (
            <View>
              <Image source={{uri: beforePhotoUri}} style={styles.photoPreview} resizeMode="cover" />
              <View style={styles.retakeRow}>
                <Pressable style={styles.retakeBtn} onPress={() => handleTakePhoto(setBeforePhotoUri)}>
                  <Icon name="refresh" size={16} color={COLORS.primary} />
                  <Text style={styles.retakeTxt}>Retake</Text>
                </Pressable>
                <Pressable style={styles.retakeBtn} onPress={() => handlePickPhoto(setBeforePhotoUri)}>
                  <Icon name="photo-library" size={16} color={COLORS.primary} />
                  <Text style={styles.retakeTxt}>Gallery</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.photoBox}>
              <Pressable style={styles.photoActionBtn} onPress={() => handleTakePhoto(setBeforePhotoUri)}>
                <Icon name="add-a-photo" size={28} color={COLORS.primary} />
                <Text style={styles.photoBoxTxt}>Camera</Text>
              </Pressable>
              <View style={styles.photoDivider} />
              <Pressable style={styles.photoActionBtn} onPress={() => handlePickPhoto(setBeforePhotoUri)}>
                <Icon name="photo-library" size={28} color={COLORS.primary} />
                <Text style={styles.photoBoxTxt}>Gallery</Text>
              </Pressable>
            </View>
          )}

          {!!error && <Text style={styles.errTxt}>{error}</Text>}

          <Pressable
            style={[styles.nextBtn, (!beforePhotoUri || saving) && styles.nextBtnDisabled]}
            disabled={!beforePhotoUri || saving}
            onPress={handleBeforePhotoContinue}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Text style={styles.nextBtnTxt}>Continue — After Weight</Text>
                  <Icon name="arrow-forward" size={18} color="#fff" />
                </>}
          </Pressable>

          <Pressable style={styles.skipLink} onPress={() => setStep(4)} disabled={saving}>
            <Text style={styles.skipTxt}>Skip before photo (optional)</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── STEP 4: AFTER WEIGHT ─────────────────────────
  if (step === 4) {
    // Only when both are real weights — none after a skipped before weight.
    const diffPreview = weightDifference(beforeWeightVal, afterWeightVal);

    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => setStep(3)}>
            <Icon name="arrow-back" size={20} color={COLORS.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Weigh & Record</Text>
          <View style={{width: 40}} />
        </View>
        {stepBar}
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.productCard}>
            <View style={styles.productIconWrap}>
              <Icon name="inventory" size={20} color={COLORS.primary} />
            </View>
            <View style={{flex: 1}}>
              <Text style={styles.productName}>{packet?.batchId?.seedType || 'Seed Packet'}</Text>
              <Text style={styles.productMeta}>ID: {packet?.uniqueId} · Before: {weightLabel(beforeWeightVal, beforeWeightState)}</Text>
            </View>
            {(beforePhotoUri || resumedBeforePhotoUrl) && (
              <Image source={{uri: beforePhotoUri || resolvePhotoUri(resumedBeforePhotoUrl)}} style={styles.thumbSmall} resizeMode="cover" />
            )}
          </View>

          <Text style={styles.stepTitle}>Step 4 — After Weight</Text>
          <Text style={styles.stepSub}>Weigh the filled packet, then scan the display or type the weight</Text>

          <View style={styles.inputCard}>
            <Text style={styles.inputLbl}>After Weight (kg)</Text>
            <TextInput
              style={styles.weightInput}
              placeholder="e.g. 5.24"
              placeholderTextColor={COLORS.muted}
              keyboardType="numeric"
              ref={afterInputRef}
              value={afterWeightVal}
              onChangeText={setAfterWeightVal}
              autoFocus
            />
          </View>

          {renderScanDisplay('after')}

          {diffPreview !== null && (
            <View style={styles.autoWeightCard}>
              <Icon name="calculate" size={20} color={COLORS.success} />
              <Text style={styles.autoWeightTxt}>
                Difference: <Text style={{fontWeight: '800'}}>{diffPreview >= 0 ? '+' : ''}{diffPreview.toFixed(2)} kg</Text>
              </Text>
            </View>
          )}

          {!!error && <Text style={styles.errTxt}>{error}</Text>}

          <Pressable
            style={[styles.nextBtn, (!afterWeightVal || saving) && styles.nextBtnDisabled]}
            disabled={!afterWeightVal || saving}
            onPress={handleAfterWeightNext}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Text style={styles.nextBtnTxt}>Next — After Photo</Text>
                  <Icon name="arrow-forward" size={18} color="#fff" />
                </>}
          </Pressable>

          <Pressable
            style={[styles.skipWeightBtn, saving && styles.nextBtnDisabled]}
            disabled={saving}
            onPress={handleSkipAfterWeight}>
            <Icon name="skip-next" size={18} color={COLORS.text} />
            <Text style={styles.skipWeightTxt}>Skip After Weight</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── STEP 5: AFTER PHOTO + SAVE ───────────────────
  if (step === 5) {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => setStep(4)}>
            <Icon name="arrow-back" size={20} color={COLORS.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Weigh & Record</Text>
          <View style={{width: 40}} />
        </View>
        {stepBar}
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.productCard}>
            <View style={styles.productIconWrap}>
              <Icon name="check-circle" size={22} color={COLORS.success} />
            </View>
            <View style={{flex: 1}}>
              <Text style={styles.productName}>{packet?.batchId?.seedType || 'Seed Packet'}</Text>
              <Text style={styles.productMeta}>After: {weightLabel(afterWeightVal, afterWeightState)}</Text>
            </View>
          </View>

          <Text style={styles.stepTitle}>Step 5 — After Photo</Text>
          <Text style={styles.stepSub}>Take a photo of the filled product</Text>

          {(afterPhotoUri || resumedAfterPhotoUrl) ? (
            <View>
              <Image source={{uri: afterPhotoUri || resolvePhotoUri(resumedAfterPhotoUrl)}} style={styles.photoPreview} resizeMode="cover" />
              <View style={styles.retakeRow}>
                <Pressable style={styles.retakeBtn} onPress={() => handleTakePhoto(setAfterPhotoUri)}>
                  <Icon name="refresh" size={16} color={COLORS.primary} />
                  <Text style={styles.retakeTxt}>Retake</Text>
                </Pressable>
                <Pressable style={styles.retakeBtn} onPress={() => handlePickPhoto(setAfterPhotoUri)}>
                  <Icon name="photo-library" size={16} color={COLORS.primary} />
                  <Text style={styles.retakeTxt}>Gallery</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.photoBox}>
              <Pressable style={styles.photoActionBtn} onPress={() => handleTakePhoto(setAfterPhotoUri)}>
                <Icon name="add-a-photo" size={28} color={COLORS.primary} />
                <Text style={styles.photoBoxTxt}>Camera</Text>
              </Pressable>
              <View style={styles.photoDivider} />
              <Pressable style={styles.photoActionBtn} onPress={() => handlePickPhoto(setAfterPhotoUri)}>
                <Icon name="photo-library" size={28} color={COLORS.primary} />
                <Text style={styles.photoBoxTxt}>Gallery</Text>
              </Pressable>
            </View>
          )}

          {!!error && <Text style={styles.errTxt}>{error}</Text>}

          <Pressable
            style={[styles.nextBtn, saving && styles.nextBtnDisabled]}
            disabled={saving}
            onPress={handleFinalSave}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Text style={styles.nextBtnTxt}>Save Measurement</Text>
                  <Icon name="save" size={18} color="#fff" />
                </>}
          </Pressable>

          {!afterPhotoUri && !resumedAfterPhotoUrl && (
            <Pressable style={styles.skipLink} onPress={handleFinalSave} disabled={saving}>
              <Text style={styles.skipTxt}>Skip after photo (optional)</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── STEP 6: DONE ─────────────────────────────────
  // Never a skipped weight counted as 0: no difference unless both are real.
  const finalDiff = linkedPacket?.difference != null
    ? linkedPacket.difference
    : weightDifference(beforeWeightVal, afterWeightVal);
  // linkedPacket mirrors the session's photo URLs, so it covers the resumed
  // case too (where the photo was uploaded in an earlier app visit and no
  // local file URI exists any more).
  const doneBeforePhotoUri = beforePhotoUri || resolvePhotoUri(linkedPacket?.beforePhotoUrl);
  const doneAfterPhotoUri  = afterPhotoUri  || resolvePhotoUri(linkedPacket?.afterPhotoUrl);
  const donePhotoUri = doneAfterPhotoUri || doneBeforePhotoUri;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.scroll, {alignItems: 'center'}]}>
        <View style={styles.doneCircle}>
          <Icon name="check-circle" size={52} color={COLORS.success} />
        </View>
        <Text style={styles.doneTxt}>Measurement Saved!</Text>
        <Text style={styles.doneSub}>Saved to the server and linked to this packet</Text>

        {donePhotoUri && (
          <Image source={{uri: donePhotoUri}} style={styles.donePhoto} resizeMode="cover" />
        )}

        <View style={styles.doneCard}>
          <DoneRow label="Packet ID" value={linkedPacket?.uniqueId || packet?.uniqueId} mono />
          <DoneRow label="Batch"     value={packet?.batchId?.batchNumber} mono />
          <DoneRow label="Before"    value={weightLabel(beforeWeightVal, beforeWeightState)} />
          <DoneRow label="After"     value={weightLabel(afterWeightVal, afterWeightState)} />
          <DoneRow label="Difference" value={differenceLabel(finalDiff)} bold color={COLORS.primary} />
          <DoneRow label="Before Photo" value={doneBeforePhotoUri ? 'Saved & linked ✓' : 'Skipped'} />
          <DoneRow label="After Photo"  value={doneAfterPhotoUri ? 'Saved & linked ✓' : 'Skipped'} />
          <DoneRow label="Time"      value={new Date().toLocaleTimeString()} />
        </View>

        <Pressable style={[styles.nextBtn, {width: '100%'}]}
          onPress={() => navigation.navigate('MainTabs')}>
          <Text style={styles.nextBtnTxt}>Back to Dashboard</Text>
          <Icon name="home" size={18} color="#fff" />
        </Pressable>
      </ScrollView>
    </View>
  );
}

function DoneRow({label, value, bold, mono, color}) {
  return (
    <View style={doneRowStyle.row}>
      <Text style={doneRowStyle.label}>{label}</Text>
      <Text style={[
        doneRowStyle.value,
        bold && {fontWeight: '800'},
        mono && {fontFamily: 'monospace'},
        color && {color},
      ]}>{value || '—'}</Text>
    </View>
  );
}
const doneRowStyle = StyleSheet.create({
  row:   {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9'},
  label: {fontSize: 12, color: COLORS.muted, fontWeight: '600'},
  value: {fontSize: 13, color: COLORS.text, fontWeight: '600'},
});

const FRAME = 240;
const CORNER_SZ = 32;
const BW = 4;

const styles = StyleSheet.create({
  root:        {flex: 1, backgroundColor: COLORS.bg},
  header:      {flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.border},
  backBtn:     {width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.track, alignItems: 'center', justifyContent: 'center'},
  headerTitle: {flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: COLORS.text},
  scroll:      {padding: SPACING.lg, gap: SPACING.md},

  stepBar:      {flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.border},
  stepItem:     {alignItems: 'center', gap: 4},
  stepCircle:   {width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white},
  stepActive:   {borderColor: COLORS.primary, backgroundColor: COLORS.primary},
  stepDone:     {borderColor: COLORS.success, backgroundColor: COLORS.success},
  stepNum:      {fontSize: 11, fontWeight: '700', color: COLORS.muted},
  stepLabel:    {fontSize: 9, color: COLORS.muted, fontWeight: '600'},
  stepLine:     {flex: 1, height: 2, backgroundColor: COLORS.border, marginBottom: 14},
  stepLineDone: {backgroundColor: COLORS.success},

  stepTitle:   {fontSize: 17, fontWeight: '700', color: COLORS.text, textAlign: 'center'},
  stepSub:     {fontSize: 13, color: COLORS.muted, textAlign: 'center'},

  productCard:     {flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.white, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card},
  productIconWrap: {width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.track, alignItems: 'center', justifyContent: 'center'},
  productName:     {fontSize: 14, fontWeight: '700', color: COLORS.text},
  productMeta:     {fontSize: 11, color: COLORS.muted, marginTop: 1},
  thumbSmall:      {width: 44, height: 44, borderRadius: RADIUS.sm},

  photoBox:        {height: 160, borderWidth: 2, borderStyle: 'dashed', borderColor: COLORS.border, borderRadius: RADIUS.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafafa'},
  photoActionBtn:  {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, height: '100%'},
  photoDivider:    {width: 1, height: '60%', backgroundColor: COLORS.border},
  photoBoxTxt:     {fontSize: 13, color: COLORS.muted, fontWeight: '600'},
  retakeRow:       {flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.md, marginTop: 6},
  photoPreview:    {width: '100%', height: 200, borderRadius: RADIUS.lg},
  retakeBtn:       {flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: 6},
  retakeTxt:       {fontSize: 12, color: COLORS.primary, fontWeight: '600'},

  autoWeightCard:  {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#dcfce7', borderRadius: RADIUS.md, padding: SPACING.md},
  autoWeightTxt:   {fontSize: 13, color: '#16a34a'},
  inputCard:       {backgroundColor: COLORS.white, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border},
  inputLbl:        {fontSize: 12, color: COLORS.muted, fontWeight: '600', marginBottom: 6},
  weightInput:     {borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 10, fontSize: 22, fontWeight: '700', color: COLORS.text, textAlign: 'center'},

  scanDisplayBtn:  {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: RADIUS.md, height: 48, backgroundColor: COLORS.white},
  scanDisplayTxt:  {fontSize: 14, fontWeight: '700', color: COLORS.primary},
  ocrChoiceBtn:    {flex: 0, alignSelf: 'stretch', marginTop: SPACING.xs},
  ocrCard:         {backgroundColor: COLORS.white, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', gap: 6},
  ocrLbl:          {fontSize: 12, color: COLORS.muted, fontWeight: '600'},
  ocrVal:          {fontSize: 32, fontWeight: '800', color: COLORS.text},
  ocrNote:         {fontSize: 12, color: COLORS.muted, textAlign: 'center'},
  ocrCrop:         {alignSelf: 'stretch', height: 110, backgroundColor: '#000', borderRadius: RADIUS.sm},
  ocrBtnRow2:      {marginTop: 0},
  ocrDebug:        {fontSize: 10, color: COLORS.muted, textAlign: 'left', alignSelf: 'stretch'},
  scanHintTxt:     {fontSize: 12, color: COLORS.muted, textAlign: 'center'},
  ocrBtnRow:       {flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm, alignSelf: 'stretch'},
  ocrBtn:          {flex: 1, height: 44, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center'},
  ocrBtnTxt:       {fontSize: 14, fontWeight: '700', color: COLORS.text},
  ocrBtnPrimary:   {backgroundColor: COLORS.primary, borderColor: COLORS.primary},
  ocrBtnPrimaryTxt:{fontSize: 14, fontWeight: '700', color: '#fff'},

  nextBtn:         {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, height: 52, ...SHADOWS.primary},
  nextBtnDisabled: {opacity: 0.4},
  nextBtnTxt:      {color: '#fff', fontSize: 15, fontWeight: '700'},
  skipWeightBtn:   {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, height: 48, backgroundColor: COLORS.white},
  skipWeightTxt:   {fontSize: 14, fontWeight: '700', color: COLORS.text},
  skipLink:        {alignItems: 'center', paddingVertical: 4},
  skipTxt:         {fontSize: 13, color: COLORS.muted},
  errTxt:          {fontSize: 13, color: COLORS.danger, textAlign: 'center'},

  doneCircle:      {width: 96, height: 96, borderRadius: 48, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginTop: SPACING.xl, marginBottom: SPACING.sm},
  doneTxt:         {fontSize: 22, fontWeight: '800', color: COLORS.text},
  doneSub:         {fontSize: 13, color: COLORS.muted, marginBottom: SPACING.md},
  donePhoto:       {width: '100%', height: 180, borderRadius: RADIUS.lg, marginBottom: SPACING.md},
  doneCard:        {width: '100%', backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.lg, ...SHADOWS.card},

  // QR scanner
  scanTopBar:    {position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md},
  scanCircleBtn: {width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center'},
  scanTopTitle:  {fontSize: 14, fontWeight: '700', color: '#fff', flex: 1, textAlign: 'center'},
  scanFrameWrap: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  scanFrame:     {width: FRAME, height: FRAME, position: 'relative'},
  corner:        {position: 'absolute', width: CORNER_SZ, height: CORNER_SZ, borderColor: COLORS.primary, borderWidth: BW},
  cTL: {top: 0, left: 0,  borderBottomWidth: 0, borderRightWidth: 0, borderTopLeftRadius: 6},
  cTR: {top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0,  borderTopRightRadius: 6},
  cBL: {bottom: 0, left: 0,  borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 6},
  cBR: {bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0,  borderBottomRightRadius: 6},
  scanHint:    {marginTop: SPACING.lg, color: '#fff', fontSize: 14, fontWeight: '500'},
  scanErr:     {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.md, backgroundColor: 'rgba(244,63,94,0.15)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8},
  scanErrTxt:  {color: '#f43f5e', fontSize: 12, fontWeight: '600'},

  permBox:  {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: SPACING.md},
  permTxt:  {fontSize: 14, color: COLORS.muted, textAlign: 'center'},
  galleryBtn: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: SPACING.lg, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: RADIUS.md, paddingHorizontal: 20, paddingVertical: 10},
  galleryTxt: {color: '#fff', fontSize: 13, fontWeight: '600'},
});
