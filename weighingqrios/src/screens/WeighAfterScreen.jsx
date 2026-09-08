import React, {useState, useEffect, useRef, useCallback} from 'react';
import {View, Text, StyleSheet, Pressable, ActivityIndicator, Alert} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, SPACING, RADIUS, SHADOWS} from '../ui/theme';
import {BASE_URL} from '../config';

const POLL_INTERVAL = 2000;

export default function WeighAfterScreen({route}) {
  const navigation = useNavigation();
  const {sessionId, photoUrl, beforeWeight, beforeTime} = route?.params || {};
  const pollRef = useRef(null);

  const [liveWeight, setLiveWeight] = useState(null);
  const [iotStatus,  setIotStatus]  = useState('waiting');
  const [capturing,  setCapturing]  = useState(false);

  const pollWeight = useCallback(() => {
    fetch(`${BASE_URL}/p/api/weight/latest`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.weight != null) { setLiveWeight(d.weight); setIotStatus('live'); }
        else setIotStatus('waiting');
      })
      .catch(() => setIotStatus('stale'));
  }, []);

  useEffect(() => {
    pollWeight();
    pollRef.current = setInterval(pollWeight, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [pollWeight]);

  const captureWeight = async () => {
    if (liveWeight == null) { Alert.alert('No Weight', 'Place seed on scale.'); return; }
    setCapturing(true);
    try {
      const res  = await fetch(`${BASE_URL}/api/sessions/${sessionId}/after-weight`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({weight: liveWeight}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      navigation.push('QRBind', {
        sessionId, photoUrl,
        beforeWeight, beforeTime,
        afterWeight: data.afterWeight, afterTime: data.afterTime,
      });
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setCapturing(false);
    }
  };

  const statusClr = iotStatus === 'live' ? '#10b981' : iotStatus === 'waiting' ? '#f59e0b' : '#ef4444';
  const diff = liveWeight != null && beforeWeight != null
    ? (beforeWeight - liveWeight).toFixed(3)
    : null;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} style={s.backBtn}>
          <Icon name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <View>
          <Text style={s.headerTitle}>After Weight</Text>
          <Text style={s.headerSub}>Step 3 of 4</Text>
        </View>
      </View>

      <View style={s.body}>
        <View style={s.progress}>
          {[1,2,3,4].map(n => (
            <View key={n} style={[s.progressDot, n <= 3 && s.progressDotActive]} />
          ))}
        </View>

        {/* Before weight reference */}
        <View style={s.refRow}>
          <Icon name="arrow-upward" size={14} color={COLORS.textSecondary} />
          <Text style={s.refTxt}>Before weight: <Text style={s.refVal}>{beforeWeight?.toFixed(3)} kg</Text></Text>
        </View>

        <View style={s.iotRow}>
          <View style={[s.iotDot, {backgroundColor: statusClr}]} />
          <Text style={[s.iotTxt, {color: statusClr}]}>
            {iotStatus === 'live' ? 'IoT Live' : iotStatus === 'waiting' ? 'Waiting for IoT...' : 'IoT Disconnected'}
          </Text>
        </View>

        <View style={s.weightCard}>
          <Text style={s.weightLabel}>Place processed seed on scale</Text>
          <Text style={s.weightValue}>{liveWeight != null ? `${liveWeight.toFixed(3)} kg` : '— . —'}</Text>
          <Text style={s.weightUnit}>{liveWeight != null ? 'LIVE READING' : 'NO READING'}</Text>
          {diff != null && (
            <View style={s.diffBadge}>
              <Icon name="trending-down" size={14} color="#ef4444" />
              <Text style={s.diffTxt}>Loss: {diff} kg</Text>
            </View>
          )}
        </View>

        <Pressable style={[s.captureBtn, capturing && {opacity:0.7}]} onPress={captureWeight} disabled={capturing}>
          {capturing
            ? <ActivityIndicator color="#fff" />
            : <><Icon name="done" size={22} color="#fff" /><Text style={s.captureTxt}>Capture After Weight</Text></>
          }
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:            {flex:1, backgroundColor:COLORS.background},
  header:          {flexDirection:'row', alignItems:'center', gap:12, paddingHorizontal:SPACING.md,
                    paddingTop:SPACING.lg, paddingBottom:SPACING.sm},
  backBtn:         {width:36, height:36, borderRadius:18, backgroundColor:COLORS.surface,
                    alignItems:'center', justifyContent:'center', ...SHADOWS.sm},
  headerTitle:     {fontSize:18, fontWeight:'800', color:COLORS.text},
  headerSub:       {fontSize:12, color:COLORS.textSecondary, fontWeight:'500'},
  body:            {flex:1, padding:SPACING.md},
  progress:        {flexDirection:'row', gap:8, marginBottom:SPACING.md},
  progressDot:     {flex:1, height:4, borderRadius:2, backgroundColor:COLORS.divider},
  progressDotActive:{backgroundColor:COLORS.primary},
  refRow:          {flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'rgba(26,34,127,0.06)',
                    padding:10, borderRadius:RADIUS.sm, marginBottom:12},
  refTxt:          {fontSize:13, color:COLORS.textSecondary},
  refVal:          {fontWeight:'700', color:COLORS.primary},
  iotRow:          {flexDirection:'row', alignItems:'center', gap:8, marginBottom:SPACING.md},
  iotDot:          {width:10, height:10, borderRadius:5},
  iotTxt:          {fontSize:13, fontWeight:'600'},
  weightCard:      {backgroundColor:COLORS.surface, borderRadius:RADIUS.xl, padding:SPACING.xl,
                    alignItems:'center', marginBottom:SPACING.lg, ...SHADOWS.md},
  weightLabel:     {fontSize:13, color:COLORS.textSecondary, fontWeight:'600', marginBottom:16,
                    textAlign:'center'},
  weightValue:     {fontSize:52, fontWeight:'900', color:'#f59e0b', letterSpacing:-1},
  weightUnit:      {fontSize:11, color:COLORS.textSecondary, fontWeight:'700', marginTop:8, letterSpacing:1},
  diffBadge:       {flexDirection:'row', alignItems:'center', gap:4, marginTop:12,
                    backgroundColor:'#fef2f2', paddingHorizontal:12, paddingVertical:6, borderRadius:20},
  diffTxt:         {fontSize:13, fontWeight:'700', color:'#ef4444'},
  captureBtn:      {flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8,
                    backgroundColor:'#f59e0b', borderRadius:RADIUS.md, paddingVertical:16, ...SHADOWS.md},
  captureTxt:      {fontSize:16, fontWeight:'700', color:'#fff'},
});
