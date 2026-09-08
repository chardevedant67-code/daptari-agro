import React, {useState, useRef, useEffect, useCallback} from 'react';
import {
  ActivityIndicator, Animated, Image, PermissionsAndroid,
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
import {useDispatch} from 'react-redux';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {fetchProductByScan, fetchLatestWeight, saveWeighRecord} from '../services/api';
import {addRecord} from '../services/localStore';
import {addNotification} from '../store/slices/notificationSlice';

function extractProductId(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (s.startsWith('http')) return s.split('/').pop();
  if (s.includes('|')) return s.split('|')[0].trim();
  return s;
}

const STEPS = ['Scan QR', 'Photo', 'Weight', 'Done'];

const getStatus = (actual, nominal) => {
  const diff = Math.abs(actual - nominal);
  const pct = (diff / nominal) * 100;
  if (pct <= 2) return 'PASS';
  if (pct <= 5) return 'WARN';
  return 'FAIL';
};

export default function WeighScanScreen() {
  const navigation = useNavigation();
  const dispatch = useDispatch();

  // step: 1=scan, 2=photo, 3=weight, 4=done
  const [step, setStep]           = useState(1);
  const [product, setProduct]     = useState(null);
  const [photoUri, setPhotoUri]   = useState(null);
  const [weightVal, setWeightVal] = useState('');
  const [nominalVal, setNominalVal] = useState('');
  const [autoWeight, setAutoWeight] = useState(null);
  const [polling, setPolling]     = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [camPerm, setCamPerm]     = useState(null);

  const scannedRef = useRef(false);
  const pollRef    = useRef(null);
  const pollCount  = useRef(0);
  const pulse      = useRef(new Animated.Value(1)).current;

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

  // Weight polling — step 3
  useEffect(() => {
    if (step !== 3) return;
    setPolling(true);
    setManualMode(false);
    setAutoWeight(null);
    pollCount.current = 0;

    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {toValue: 0.3, duration: 800, useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 1,   duration: 800, useNativeDriver: true}),
      ]),
    );
    anim.start();

    const poll = async () => {
      pollCount.current += 1;
      try {
        const data = await fetchLatestWeight();
        if (data?.weight != null) {
          setAutoWeight(data.weight);
          setWeightVal(String(data.weight));
          setPolling(false);
          clearInterval(pollRef.current);
          anim.stop();
          return;
        }
      } catch (_) {}
      if (pollCount.current >= 10) {
        setPolling(false);
        setManualMode(true);
        clearInterval(pollRef.current);
        anim.stop();
      }
    };

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { clearInterval(pollRef.current); anim.stop(); };
  }, [step, pulse]);

  // Gallery QR pick
  const handleGalleryPick = useCallback(async () => {
    if (scannedRef.current) return;
    try {
      const result = await launchImageLibrary({mediaType: 'photo', selectionLimit: 1});
      if (result.didCancel || !result.assets?.length) return;
      const uri = result.assets[0].uri;
      const barcodes = await BarcodeScanning.scan(uri);
      if (!barcodes?.length) { setError('No QR code found in image'); return; }
      const productId = extractProductId(barcodes[0].value);
      if (!productId) return;
      scannedRef.current = true;
      setError('');
      const p = await fetchProductByScan(productId);
      setProduct(p);
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
    const productId = extractProductId(raw);
    if (!productId) return;
    scannedRef.current = true;
    setError('');
    try {
      const p = await fetchProductByScan(productId);
      setProduct(p);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Product not found');
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

  // Save record
  const handleSave = async () => {
    const w = parseFloat(weightVal);
    if (!w || w <= 0) { setError('Enter a valid weight'); return; }
    setSaving(true); setError('');
    const n = parseFloat(nominalVal) || w;
    try {
      await saveWeighRecord({productId: product._id, actualWeight: w, nominalWeight: n, photoUri});
    } catch (_) {
      addRecord({actualWeight: w, product});
    }
    const status = getStatus(w, n);
    const statusLabels = {PASS: 'Within tolerance', WARN: 'Slight deviation', FAIL: 'Out of tolerance'};
    const productName = product?.productName || 'Unknown Product';
    dispatch(addNotification({
      type: status,
      title: `Weighing ${status} — ${productName}`,
      body: `${w.toFixed(2)} kg  •  Nominal: ${n.toFixed(2)} kg  •  ${statusLabels[status]}`,
    }));
    setSaving(false);
    setStep(4);
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
        {/* Top bar */}
        <View style={styles.scanTopBar}>
          <Pressable style={styles.scanCircleBtn} onPress={() => navigation.pop()}>
            <Icon name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.scanTopTitle}>Step 1 — Scan Product QR</Text>
          <View style={{width: 44}} />
        </View>
        {/* Frame */}
        <View style={styles.scanFrameWrap}>
          <View style={styles.scanFrame}>
            {[styles.cTL, styles.cTR, styles.cBL, styles.cBR].map((cs, i) => (
              <View key={i} style={[styles.corner, cs]} />
            ))}
          </View>
          <Text style={styles.scanHint}>Align product QR within the frame</Text>
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

  // ── STEP 2: PHOTO ────────────────────────────────
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
          {/* Product found */}
          <View style={styles.productCard}>
            <View style={styles.productIconWrap}>
              <Icon name="check-circle" size={22} color={COLORS.success} />
            </View>
            <View style={{flex: 1}}>
              <Text style={styles.productName}>{product?.productName}</Text>
              <Text style={styles.productMeta}>
                Batch: {product?.batchNumber}  ·  {product?.seedType}
              </Text>
              <Text style={styles.productMeta}>{product?.storageLocation}</Text>
            </View>
          </View>

          <Text style={styles.stepTitle}>Step 2 — Take Product Photo</Text>
          <Text style={styles.stepSub}>Take a photo of the product before weighing</Text>

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
            onPress={() => setStep(3)}>
            <Text style={styles.nextBtnTxt}>Next — Capture Weight</Text>
            <Icon name="arrow-forward" size={18} color="#fff" />
          </Pressable>

          <Pressable style={styles.skipLink} onPress={() => setStep(3)}>
            <Text style={styles.skipTxt}>Skip photo (optional)</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── STEP 3: WEIGHT ───────────────────────────────
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
          {/* Product summary */}
          <View style={styles.productCard}>
            <View style={styles.productIconWrap}>
              <Icon name="inventory" size={20} color={COLORS.primary} />
            </View>
            <View style={{flex: 1}}>
              <Text style={styles.productName}>{product?.productName}</Text>
              <Text style={styles.productMeta}>ID: {product?.productId}</Text>
            </View>
            {photoUri && (
              <Image source={{uri: photoUri}} style={styles.thumbSmall} resizeMode="cover" />
            )}
          </View>

          <Text style={styles.stepTitle}>Step 3 — Capture Weight</Text>

          {/* Auto polling status */}
          {polling && (
            <View style={styles.pollingCard}>
              <Animated.View style={[styles.pollingDot, {opacity: pulse}]} />
              <View style={{flex: 1}}>
                <Text style={styles.pollingTitle}>Waiting for scale reading...</Text>
                <Text style={styles.pollingSub}>Fetching weight from server automatically</Text>
              </View>
              <ActivityIndicator size="small" color={COLORS.primary} />
            </View>
          )}

          {autoWeight != null && !polling && (
            <View style={styles.autoWeightCard}>
              <Icon name="check-circle" size={20} color={COLORS.success} />
              <Text style={styles.autoWeightTxt}>
                Auto captured: <Text style={{fontWeight: '800'}}>{autoWeight} kg</Text>
              </Text>
            </View>
          )}

          {/* Weight input — shown after auto or timeout */}
          {(manualMode || autoWeight != null) && (
            <View style={styles.inputCard}>
              <Text style={styles.inputLbl}>
                {manualMode ? 'Enter weight manually (kg)' : 'Actual Weight (edit if needed)'}
              </Text>
              <TextInput
                style={styles.weightInput}
                placeholder="e.g. 5.24"
                placeholderTextColor={COLORS.muted}
                keyboardType="numeric"
                value={weightVal}
                onChangeText={setWeightVal}
              />
              <Text style={[styles.inputLbl, {marginTop: 10}]}>Nominal / Expected Weight (kg)</Text>
              <TextInput
                style={styles.weightInput}
                placeholder="e.g. 5.00"
                placeholderTextColor={COLORS.muted}
                keyboardType="numeric"
                value={nominalVal}
                onChangeText={setNominalVal}
              />
            </View>
          )}

          {polling && (
            <Text style={styles.pollNote}>
              If no reading in 20 sec, manual input will appear
            </Text>
          )}

          {!!error && <Text style={styles.errTxt}>{error}</Text>}

          <Pressable
            style={[styles.nextBtn, (!weightVal || polling) && styles.nextBtnDisabled]}
            disabled={!weightVal || polling}
            onPress={handleSave}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Text style={styles.nextBtnTxt}>Save Record</Text>
                  <Icon name="save" size={18} color="#fff" />
                </>}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── STEP 4: DONE ─────────────────────────────────
  const finalW = parseFloat(weightVal) || 0;
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.scroll, {alignItems: 'center'}]}>
        <View style={styles.doneCircle}>
          <Icon name="check-circle" size={52} color={COLORS.success} />
        </View>
        <Text style={styles.doneTxt}>Record Saved!</Text>
        <Text style={styles.doneSub}>Photo and weight linked to product</Text>

        {photoUri && (
          <Image source={{uri: photoUri}} style={styles.donePhoto} resizeMode="cover" />
        )}

        <View style={styles.doneCard}>
          <DoneRow label="Product"  value={product?.productName} />
          <DoneRow label="ID"       value={product?.productId} mono />
          <DoneRow label="Batch"    value={product?.batchNumber} mono />
          <DoneRow label="Weight"   value={`${finalW.toFixed(2)} kg`} bold color={COLORS.primary} />
          <DoneRow label="Photo"    value={photoUri ? 'Saved & linked ✓' : 'Skipped'} />
          <DoneRow label="Time"     value={new Date().toLocaleTimeString()} />
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

  pollingCard:     {flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.white, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border},
  pollingDot:      {width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.primary},
  pollingTitle:    {fontSize: 13, fontWeight: '700', color: COLORS.text},
  pollingSub:      {fontSize: 11, color: COLORS.muted, marginTop: 2},
  autoWeightCard:  {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#dcfce7', borderRadius: RADIUS.md, padding: SPACING.md},
  autoWeightTxt:   {fontSize: 13, color: '#16a34a'},
  inputCard:       {backgroundColor: COLORS.white, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border},
  inputLbl:        {fontSize: 12, color: COLORS.muted, fontWeight: '600', marginBottom: 6},
  weightInput:     {borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 10, fontSize: 22, fontWeight: '700', color: COLORS.text, textAlign: 'center'},
  pollNote:        {fontSize: 11, color: COLORS.muted, textAlign: 'center'},

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
