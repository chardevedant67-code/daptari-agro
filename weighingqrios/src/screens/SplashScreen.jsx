import React, {useEffect, useRef, useState} from 'react';
import {Animated, StyleSheet, Text, View} from 'react-native';
import {ProgressBar} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useDispatch} from 'react-redux';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {loadSessionThunk} from '../store/slices/userSlice';

export default function SplashScreen() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const logoScale   = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textY       = useRef(new Animated.Value(24)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const barOpacity  = useRef(new Animated.Value(0)).current;

  const [progress, setProgress]   = useState(0);
  const [pctLabel, setPctLabel]   = useState(0);

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logoScale, {toValue: 1, friction: 5, tension: 100, useNativeDriver: true}),
        Animated.timing(logoOpacity, {toValue: 1, duration: 400, useNativeDriver: true}),
      ]),
      Animated.parallel([
        Animated.timing(textY, {toValue: 0, duration: 400, useNativeDriver: true}),
        Animated.timing(textOpacity, {toValue: 1, duration: 400, useNativeDriver: true}),
      ]),
      Animated.timing(barOpacity, {toValue: 1, duration: 200, useNativeDriver: true}),
    ]).start();

    const startTime = Date.now();
    const DURATION = 3000;
    const id = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(eased);
      setPctLabel(Math.round(eased * 100));
      if (t >= 1) {
        clearInterval(id);
        setTimeout(async () => {
          const result = await dispatch(loadSessionThunk());
          const saved = result.payload;
          navigation.replace(saved ? 'MainTabs' : 'Login');
        }, 400);
      }
    }, 16);

    return () => clearInterval(id);
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Animated.View style={{transform: [{scale: logoScale}], opacity: logoOpacity}}>
          <View style={styles.logoBox}>
            <Icon name="qr-code-scanner" size={64} color={COLORS.white} />
          </View>
          <View style={styles.scaleBadge}>
            <Icon name="balance" size={16} color={COLORS.primary} />
          </View>
        </Animated.View>

        <Animated.View style={[styles.titleWrap, {transform: [{translateY: textY}], opacity: textOpacity}]}>
          <Text style={styles.title}>Automated Weighing & QR Tracking</Text>
          <Text style={styles.subtitle}>Industrial Management Systems</Text>
        </Animated.View>
      </View>

      <Animated.View style={[styles.bottom, {opacity: barOpacity}]}>
        <View style={styles.progressRow}>
          <Text style={styles.initLabel}>Initializing systems...</Text>
          <Text style={styles.pctLabel}>{pctLabel}%</Text>
        </View>
        <ProgressBar progress={progress} color={COLORS.primary} style={styles.bar} />
        <Text style={styles.footer}>POWERED BY INDUSTRIAL SYSTEMS V4.0</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:       {flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: SPACING.lg},
  center:     {flex: 1, alignItems: 'center', justifyContent: 'center'},
  logoBox:    {width: 120, height: 120, borderRadius: 24, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', ...SHADOWS.primary},
  scaleBadge: {position: 'absolute', bottom: -6, right: -6, width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', ...SHADOWS.card},
  titleWrap:  {alignItems: 'center', marginTop: SPACING.xl},
  title:      {fontSize: 26, fontWeight: '700', color: COLORS.text, textAlign: 'center', marginBottom: 6},
  subtitle:   {fontSize: 14, color: COLORS.muted, textAlign: 'center'},
  bottom:     {paddingBottom: 36},
  progressRow:{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6},
  initLabel:  {fontSize: 12, fontWeight: '700', color: COLORS.primary},
  pctLabel:   {fontSize: 12, fontWeight: '700', color: COLORS.primary},
  bar:        {height: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.track},
  footer:     {marginTop: SPACING.lg, textAlign: 'center', fontSize: 10, fontWeight: '700', color: COLORS.labelMuted, letterSpacing: 1.5},
});
