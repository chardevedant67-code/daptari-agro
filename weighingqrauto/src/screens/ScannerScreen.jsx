import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
  Animated, PermissionsAndroid, Platform,
  Pressable, StyleSheet, Text, View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
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
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, SPACING} from '../ui/theme';
import {launchImageLibrary} from 'react-native-image-picker';
import {fetchProductByScan} from '../services/api';

const FRAME_SIZE = 220;

const STEPS = [
  {icon: 'qr-code-scanner', label: 'Reading QR Code',      color: '#6366f1'},
  {icon: 'cloud-download',  label: 'Fetching from server', color: '#0ea5e9'},
  {icon: 'inventory-2',     label: 'Loading product info', color: '#10b981'},
];

function FetchingOverlay() {
  const fade   = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(30)).current;
  const pulse  = useRef(new Animated.Value(1)).current;
  const [step, setStep] = useState(0);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade,   {toValue: 1, duration: 300, useNativeDriver: true}),
      Animated.timing(slideY, {toValue: 0, duration: 300, useNativeDriver: true}),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {toValue: 1.12, duration: 600, useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 1,    duration: 600, useNativeDriver: true}),
      ]),
    ).start();

    const t = setInterval(() => setStep(s => (s + 1) % STEPS.length), 900);
    return () => clearInterval(t);
  }, []);

  const current = STEPS[step];

  return (
    <Animated.View style={[styles.overlay, {opacity: fade}]}>
      <Animated.View style={[styles.fetchCard, {transform: [{translateY: slideY}]}]}>

        <LinearGradient colors={['#0f172a', '#1e1b4b']} style={styles.fetchBanner}>
          <Animated.View style={[
            styles.fetchIconWrap,
            {transform: [{scale: pulse}], backgroundColor: current.color + '25', borderColor: current.color + '70'},
          ]}>
            <Icon name={current.icon} size={40} color={current.color} />
          </Animated.View>
          <View style={[styles.dot, {top: 16, left: 20, width: 7, height: 7, backgroundColor: current.color, opacity: 0.35}]} />
          <View style={[styles.dot, {bottom: 20, right: 28, width: 9, height: 9, backgroundColor: '#6366f1', opacity: 0.25}]} />
        </LinearGradient>

        <View style={styles.fetchBody}>
          <Text style={styles.fetchTitle}>Identifying Product</Text>
          <View style={styles.stepRow}>
            <View style={[styles.stepDot, {backgroundColor: current.color}]} />
            <Text style={[styles.fetchSub, {color: current.color}]}>{current.label}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressSegments]}>
              {STEPS.map((s, i) => (
                <View key={i} style={[
                  styles.progressSeg,
                  {backgroundColor: i <= step ? s.color : 'rgba(255,255,255,0.08)'},
                ]} />
              ))}
            </View>
          </View>
          <View style={styles.stepDots}>
            {STEPS.map((s, i) => (
              <View key={i} style={[styles.stepPip, {backgroundColor: i === step ? s.color : 'rgba(255,255,255,0.15)'}]} />
            ))}
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// Extract productId from any QR format:
// "PRD-2024-001|BATCH|Name"  →  PRD-2024-001
// "http://server/p/api/PRD-2024-001"  →  PRD-2024-001
// "PRD-2024-001"  →  PRD-2024-001
function extractProductId(raw) {
  if (!raw) return null;
  const s = raw.trim();
  // URL format
  if (s.startsWith('http')) {
    const parts = s.split('/');
    return parts[parts.length - 1];
  }
  // Pipe-separated
  if (s.includes('|')) {
    return s.split('|')[0].trim();
  }
  return s;
}

const CORNER_SIZE = 36;
const BORDER_W = 4;

export default function ScannerScreen() {
  const navigation = useNavigation();
  const lineY = useRef(new Animated.Value(0)).current;
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [camPermission, setCamPermission] = useState(null);
  const [torchOn, setTorchOn]           = useState(false);
  const scannedRef = useRef(false);

  // Reset scan lock every time screen comes into focus (back navigation)
  useFocusEffect(useCallback(() => {
    scannedRef.current = false;
    setError('');
    setLoading(false);
  }, []));

  // Animated scan line
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(lineY, {toValue: 1, duration: 2000, useNativeDriver: true}),
        Animated.timing(lineY, {toValue: 0, duration: 0,    useNativeDriver: true}),
      ]),
    ).start();
  }, [lineY]);

  // Request camera permission on mount
  useEffect(() => {
    (async () => {
      if (Platform.OS === 'android') {
        const already = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.CAMERA,
        );
        if (already) {
          setCamPermission(true);
          return;
        }
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'This app needs camera access to scan QR codes.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          },
        );
        setCamPermission(result === PermissionsAndroid.RESULTS.GRANTED);
      } else {
        setCamPermission(true); // iOS handled by camera-kit
      }
    })();
  }, []);

  const translateY = lineY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, FRAME_SIZE - 3],
  });

  const handleGalleryPick = useCallback(async () => {
    if (loading || scannedRef.current) return;
    try {
      const result = await launchImageLibrary({mediaType: 'photo', selectionLimit: 1});
      if (result.didCancel || !result.assets?.length) return;
      const uri = result.assets[0].uri;
      const barcodes = await BarcodeScanning.scan(uri);
      if (!barcodes?.length) {
        setError('No QR code found in image');
        return;
      }
      const productId = extractProductId(barcodes[0].value);
      if (!productId) return;
      scannedRef.current = true;
      setLoading(true);
      setError('');
      const product = await fetchProductByScan(productId);
      setLoading(false);
      navigation.push('ProductDetail', {product});
    } catch (err) {
      setLoading(false);
      scannedRef.current = false;
      setError(err.message || 'Could not read QR from image');
    }
  }, [loading, navigation]);

  const handleScannedCode = useCallback(async (event) => {
    const rawValue = event?.nativeEvent?.codeStringValue;
    if (!rawValue || scannedRef.current || loading) return;

    const productId = extractProductId(rawValue);
    if (!productId) return;

    scannedRef.current = true;
    setLoading(true);
    setError('');

    try {
      const product = await fetchProductByScan(productId);
      setLoading(false);
      navigation.push('ProductDetail', {product});
    } catch (err) {
      setLoading(false);
      setError(err.message || 'Product not found');
      setTimeout(() => { scannedRef.current = false; }, 2500);
    }
  }, [loading, navigation]);

  // ── Permission denied screen ──────────────────────
  if (camPermission === false) {
    return (
      <View style={styles.root}>
        <View style={styles.topBar}>
          <Pressable style={styles.circleBtn} onPress={() => navigation.pop()}>
            <Icon name="arrow-back" size={20} color={COLORS.white} />
          </Pressable>
          <Text style={styles.topTitle}>Scan QR Code</Text>
          <View style={{width: 44}} />
        </View>
        <View style={styles.permBox}>
          <Icon name="no-photography" size={56} color="#475569" />
          <Text style={styles.permTitle}>Camera Permission Denied</Text>
          <Text style={styles.permSub}>
            Go to Phone Settings → Apps → weighingqrauto → Permissions → Allow Camera
          </Text>
        </View>
      </View>
    );
  }

  // ── Waiting for permission check ─────────────────
  if (camPermission === null) {
    return (
      <View style={[styles.root, {alignItems: 'center', justifyContent: 'center'}]}>
        <Icon name="qr-code-scanner" size={40} color={COLORS.primary} />
        <Text style={{color: '#94a3b8', marginTop: 12}}>Requesting camera...</Text>
      </View>
    );
  }

  // ── Main scanner ──────────────────────────────────
  return (
    <View style={styles.root}>
      {loading && <FetchingOverlay />}

      {/* Full-screen camera feed */}
      <Camera
        style={StyleSheet.absoluteFill}
        scanBarcode
        onReadCode={handleScannedCode}
        showFrame={false}
        torchMode={torchOn ? 'on' : 'off'}
      />

      {/* Dark mask — 4 pieces around frame */}
      <View style={styles.maskTop} />
      <View style={styles.maskRow}>
        <View style={styles.maskSide} />
        <View style={styles.frameHole} />
        <View style={styles.maskSide} />
      </View>
      <View style={styles.maskBottom} />

      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.circleBtn} onPress={() => navigation.pop()}>
          <Icon name="arrow-back" size={20} color={COLORS.white} />
        </Pressable>
        <Text style={styles.topTitle}>Scan QR Code</Text>
        <View style={{width: 44}} />
      </View>

      {/* QR Frame corners + animated scan line */}
      <View style={styles.frameWrap}>
        <View style={styles.frame}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
          <Animated.View style={[styles.scanLine, {transform: [{translateY}]}]} />
        </View>
        <Text style={styles.alignTxt}>Align QR Code within the frame</Text>
        <Text style={styles.helperTxt}>Hold steady — scans automatically</Text>
        {!!error && (
          <View style={styles.errorBox}>
            <Icon name="error-outline" size={16} color="#f43f5e" />
            <Text style={styles.errorTxt}>{error}</Text>
          </View>
        )}
      </View>

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <View style={styles.controls}>
          <Pressable style={styles.sideBtn} onPress={handleGalleryPick}>
            <Icon name="photo-library" size={24} color={COLORS.white} />
          </Pressable>
          <View style={styles.mainBtnWrap}>
            <Icon name="qr-code-scanner" size={32} color={COLORS.white} />
          </View>
          <Pressable
            style={[styles.sideBtn, torchOn && styles.sideBtnActive]}
            onPress={() => setTorchOn(t => !t)}>
            <Icon name={torchOn ? 'flash-on' : 'flash-off'} size={24} color={torchOn ? '#fbbf24' : COLORS.white} />
          </Pressable>
        </View>
        <Text style={styles.scanHint}>
          {loading ? 'Fetching product from server...' : 'Point camera at a product QR code'}
        </Text>
        <Pressable style={styles.cancelBtn} onPress={() => navigation.pop()}>
          <Text style={styles.cancelTxt}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0f172a'},

  // Permission screen
  permBox: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32},
  permTitle: {color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 16, textAlign: 'center'},
  permSub: {color: '#64748b', fontSize: 13, marginTop: 10, textAlign: 'center', lineHeight: 20},

  // Dark mask overlay
  maskTop:   {position: 'absolute', top: 0, left: 0, right: 0, height: '30%', backgroundColor: 'rgba(0,0,0,0.6)'},
  maskRow:   {position: 'absolute', left: 0, right: 0, top: '30%', height: FRAME_SIZE, flexDirection: 'row'},
  maskSide:  {flex: 1, backgroundColor: 'rgba(0,0,0,0.6)'},
  frameHole: {width: FRAME_SIZE, height: FRAME_SIZE},
  maskBottom:{position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%', backgroundColor: 'rgba(0,0,0,0.6)'},

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md,
  },
  circleBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  topTitle: {fontSize: 16, fontWeight: '700', color: COLORS.white},
  frameWrap: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  frame: {width: FRAME_SIZE, height: FRAME_SIZE, position: 'relative', overflow: 'hidden'},
  corner: {position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE, borderColor: COLORS.primary, borderWidth: BORDER_W},
  topLeft:    {top: 0,    left: 0,  borderBottomWidth: 0, borderRightWidth: 0, borderTopLeftRadius: 6},
  topRight:   {top: 0,    right: 0, borderBottomWidth: 0, borderLeftWidth:  0, borderTopRightRadius: 6},
  bottomLeft: {bottom: 0, left: 0,  borderTopWidth: 0,    borderRightWidth: 0, borderBottomLeftRadius: 6},
  bottomRight:{bottom: 0, right: 0, borderTopWidth: 0,    borderLeftWidth:  0, borderBottomRightRadius: 6},
  scanLine: {position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: COLORS.primary, opacity: 0.85},
  alignTxt:  {marginTop: SPACING.lg, color: COLORS.white, fontSize: 15, fontWeight: '500'},
  helperTxt: {marginTop: 6, color: '#94a3b8', fontSize: 12, textAlign: 'center', maxWidth: 200},
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: SPACING.md, backgroundColor: 'rgba(244,63,94,0.15)',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
  },
  errorTxt: {color: '#f43f5e', fontSize: 12, fontWeight: '600', flex: 1},
  bottomBar: {paddingTop: SPACING.md, paddingBottom: 32, paddingHorizontal: SPACING.lg, backgroundColor: 'rgba(15,23,42,0.95)', alignItems: 'center'},
  controls:  {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xl, marginBottom: SPACING.sm},
  sideBtn:   {width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center'},
  sideBtnActive: {backgroundColor: 'rgba(251,191,36,0.20)'},
  mainBtnWrap: {width: 68, height: 68, borderRadius: 34, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center'},
  scanHint:  {color: '#64748b', fontSize: 12, textAlign: 'center', marginBottom: SPACING.sm},
  cancelBtn: {marginTop: SPACING.sm, alignItems: 'center'},
  cancelTxt: {color: COLORS.white, fontWeight: '700', fontSize: 15},

  // Fetching Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2,6,23,0.88)',
    alignItems: 'center', justifyContent: 'center', zIndex: 99,
  },
  fetchCard: {
    width: 310, backgroundColor: '#0f172a',
    borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  fetchBanner: {height: 150, alignItems: 'center', justifyContent: 'center'},
  fetchIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  dot: {position: 'absolute', borderRadius: 99},
  fetchBody: {padding: 20},
  fetchTitle: {fontSize: 17, fontWeight: '800', color: '#fff', marginBottom: 10},
  stepRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14},
  stepDot: {width: 7, height: 7, borderRadius: 4},
  fetchSub: {fontSize: 12, fontWeight: '600'},
  progressTrack: {marginBottom: 14},
  progressSegments: {flexDirection: 'row', gap: 4},
  progressSeg: {flex: 1, height: 4, borderRadius: 4},
  stepDots: {flexDirection: 'row', gap: 8, justifyContent: 'center'},
  stepPip: {width: 8, height: 8, borderRadius: 4},
});
