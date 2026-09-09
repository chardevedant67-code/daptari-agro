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
import {
  fetchProductByScan,
  createWeighSession,
  uploadSessionPhoto,
  saveBeforeWeight,
  saveAfterWeight,
  linkSessionToPacket,
} from '../services/api';
import {addNotification} from '../store/slices/notificationSlice';

function extractProductId(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (s.startsWith('http')) return s.split('/').pop();
  if (s.includes('|')) return s.split('|')[0].trim();
  return s;
}

const STEPS = ['Scan QR', 'Before', 'Photo', 'After'];

export default function WeighScanScreen() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const token = useSelector(state => state.user.token);

  // step: 1=scan, 2=before weight, 3=photo, 4=after weight + save, 5=done
  const [step, setStep]               = useState(1);
  const [packet, setPacket]           = useState(null);
  const [photoUri, setPhotoUri]       = useState(null);
  const [beforeWeightVal, setBeforeWeightVal] = useState('');
  const [afterWeightVal, setAfterWeightVal]   = useState('');
  const [linkedPacket, setLinkedPacket] = useState(null);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [camPerm, setCamPerm]         = useState(null);

  const scannedRef = useRef(false);

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
    if (step === 1) scannedRef.current = false;
  }, [step]);

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
      const p = await fetchProductByScan(uniqueId);
      setPacket(p);
      setStep(2);
    } catch (err) {
      scannedRef.current = false;
      setError(err.message || 'Could not read QR from image');
    }
  }, []);

  // QR scanned
  const handleQRScanned = useCallback(async (event) => {
    const raw = event?.nativeEvent?.codeStringValue;
    if (!raw || scannedRef.current) return;
    const uniqueId = extractProductId(raw);
    if (!uniqueId) return;
    scannedRef.current = true;
    setError('');
    try {
      const p = await fetchProductByScan(uniqueId);
      setPacket(p);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Packet not found');
      setTimeout(() => { scannedRef.current = false; }, 2500);
    }
  }, []);

  // Take photo
  const handleTakePhoto = async () => {
    setError('');
    try {
      const result = await launchCamera({mediaType: 'photo', saveToPhotos: true, quality: 0.8});
      if (result.didCancel || !result.assets?.length) return;
      setPhotoUri(result.assets[0].uri);
    } catch (_) {
      setError('Camera not available — use gallery instead');
    }
  };

  // Pick photo from gallery
  const handlePickPhoto = async () => {
    setError('');
    try {
      const result = await launchImageLibrary({mediaType: 'photo', selectionLimit: 1});
      if (result.didCancel || !result.assets?.length) return;
      setPhotoUri(result.assets[0].uri);
    } catch (_) {
      setError('Could not open gallery');
    }
  };

  // Save measurement — creates a real session, saves before/photo/after,
  // then links it onto the scanned SeedPacket. Any failure is surfaced as a
  // real error; nothing is written locally to fake a successful save.
  const handleSave = async () => {
    const before = parseFloat(beforeWeightVal);
    const after  = parseFloat(afterWeightVal);
    if (!after || after <= 0) { setError('Enter a valid after weight'); return; }
    setSaving(true); setError('');
    try {
      const sessionId = await createWeighSession(token);
      if (photoUri) await uploadSessionPhoto(sessionId, photoUri);
      await saveBeforeWeight(sessionId, before);
      await saveAfterWeight(sessionId, after);
      const saved = await linkSessionToPacket(sessionId, packet.uniqueId);
      setLinkedPacket(saved);

      const diff = saved.difference != null ? saved.difference : (after - before);
      dispatch(addNotification({
        type: 'PASS',
        title: `Measurement Saved — ${packet?.batchId?.seedType || packet?.uniqueId}`,
        body: `Before ${before.toFixed(2)} kg · After ${after.toFixed(2)} kg · Diff ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} kg`,
      }));
      setStep(5);
    } catch (err) {
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
          <Text style={styles.stepSub}>Weigh the packet before filling and enter it manually</Text>

          <View style={styles.inputCard}>
            <Text style={styles.inputLbl}>Before Weight (kg)</Text>
            <TextInput
              style={styles.weightInput}
              placeholder="e.g. 0.50"
              placeholderTextColor={COLORS.muted}
              keyboardType="numeric"
              value={beforeWeightVal}
              onChangeText={setBeforeWeightVal}
              autoFocus
            />
          </View>

          {!!error && <Text style={styles.errTxt}>{error}</Text>}

          <Pressable
            style={[styles.nextBtn, !beforeWeightVal && styles.nextBtnDisabled]}
            disabled={!beforeWeightVal}
            onPress={() => { setError(''); setStep(3); }}>
            <Text style={styles.nextBtnTxt}>Next — Take Photo</Text>
            <Icon name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── STEP 3: PHOTO ────────────────────────────────
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
              <Text style={styles.productMeta}>Before: {parseFloat(beforeWeightVal || 0).toFixed(2)} kg</Text>
            </View>
          </View>

          <Text style={styles.stepTitle}>Step 3 — Take Product Photo</Text>
          <Text style={styles.stepSub}>Take a photo of the filled product</Text>

          {photoUri ? (
            <View>
              <Image source={{uri: photoUri}} style={styles.photoPreview} resizeMode="cover" />
              <View style={styles.retakeRow}>
                <Pressable style={styles.retakeBtn} onPress={handleTakePhoto}>
                  <Icon name="refresh" size={16} color={COLORS.primary} />
                  <Text style={styles.retakeTxt}>Retake</Text>
                </Pressable>
                <Pressable style={styles.retakeBtn} onPress={handlePickPhoto}>
                  <Icon name="photo-library" size={16} color={COLORS.primary} />
                  <Text style={styles.retakeTxt}>Gallery</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.photoBox}>
              <Pressable style={styles.photoActionBtn} onPress={handleTakePhoto}>
                <Icon name="add-a-photo" size={28} color={COLORS.primary} />
                <Text style={styles.photoBoxTxt}>Camera</Text>
              </Pressable>
              <View style={styles.photoDivider} />
              <Pressable style={styles.photoActionBtn} onPress={handlePickPhoto}>
                <Icon name="photo-library" size={28} color={COLORS.primary} />
                <Text style={styles.photoBoxTxt}>Gallery</Text>
              </Pressable>
            </View>
          )}

          {!!error && <Text style={styles.errTxt}>{error}</Text>}

          <Pressable
            style={[styles.nextBtn, !photoUri && styles.nextBtnDisabled]}
            disabled={!photoUri}
            onPress={() => setStep(4)}>
            <Text style={styles.nextBtnTxt}>Next — After Weight</Text>
            <Icon name="arrow-forward" size={18} color="#fff" />
          </Pressable>

          <Pressable style={styles.skipLink} onPress={() => setStep(4)}>
            <Text style={styles.skipTxt}>Skip photo (optional)</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── STEP 4: AFTER WEIGHT + DIFFERENCE + SAVE ─────
  if (step === 4) {
    const b = parseFloat(beforeWeightVal);
    const a = parseFloat(afterWeightVal);
    const diffPreview = (beforeWeightVal !== '' && afterWeightVal !== '' && !isNaN(b) && !isNaN(a)) ? (a - b) : null;

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
              <Text style={styles.productMeta}>ID: {packet?.uniqueId} · Before: {(b || 0).toFixed(2)} kg</Text>
            </View>
            {photoUri && (
              <Image source={{uri: photoUri}} style={styles.thumbSmall} resizeMode="cover" />
            )}
          </View>

          <Text style={styles.stepTitle}>Step 4 — After Weight</Text>
          <Text style={styles.stepSub}>Weigh the filled packet and enter it manually</Text>

          <View style={styles.inputCard}>
            <Text style={styles.inputLbl}>After Weight (kg)</Text>
            <TextInput
              style={styles.weightInput}
              placeholder="e.g. 5.24"
              placeholderTextColor={COLORS.muted}
              keyboardType="numeric"
              value={afterWeightVal}
              onChangeText={setAfterWeightVal}
              autoFocus
            />
          </View>

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
            onPress={handleSave}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Text style={styles.nextBtnTxt}>Save Measurement</Text>
                  <Icon name="save" size={18} color="#fff" />
                </>}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── STEP 5: DONE ─────────────────────────────────
  const finalDiff = linkedPacket?.difference != null
    ? linkedPacket.difference
    : (parseFloat(afterWeightVal || 0) - parseFloat(beforeWeightVal || 0));

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.scroll, {alignItems: 'center'}]}>
        <View style={styles.doneCircle}>
          <Icon name="check-circle" size={52} color={COLORS.success} />
        </View>
        <Text style={styles.doneTxt}>Measurement Saved!</Text>
        <Text style={styles.doneSub}>Saved to the server and linked to this packet</Text>

        {photoUri && (
          <Image source={{uri: photoUri}} style={styles.donePhoto} resizeMode="cover" />
        )}

        <View style={styles.doneCard}>
          <DoneRow label="Packet ID" value={linkedPacket?.uniqueId || packet?.uniqueId} mono />
          <DoneRow label="Batch"     value={packet?.batchId?.batchNumber} mono />
          <DoneRow label="Before"    value={`${parseFloat(beforeWeightVal || 0).toFixed(2)} kg`} />
          <DoneRow label="After"     value={`${parseFloat(afterWeightVal || 0).toFixed(2)} kg`} />
          <DoneRow label="Difference" value={`${finalDiff >= 0 ? '+' : ''}${finalDiff.toFixed(2)} kg`} bold color={COLORS.primary} />
          <DoneRow label="Photo"     value={photoUri ? 'Saved & linked ✓' : 'Skipped'} />
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

  nextBtn:         {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, height: 52, ...SHADOWS.primary},
  nextBtnDisabled: {opacity: 0.4},
  nextBtnTxt:      {color: '#fff', fontSize: 15, fontWeight: '700'},
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
