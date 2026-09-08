import React, {useState, useEffect, useCallback} from 'react';
import {View, Text, StyleSheet, Pressable, ActivityIndicator} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, SPACING, RADIUS, SHADOWS} from '../ui/theme';
import {BASE_URL} from '../config';

export default function SessionStartScreen() {
  const navigation = useNavigation();
  const [iotStatus, setIotStatus]   = useState('checking'); // checking | connected | disconnected
  const [checking, setChecking]     = useState(false);

  const checkIoT = useCallback(async () => {
    setChecking(true);
    try {
      const res  = await fetch(`${BASE_URL}/p/api/weight/latest`);
      const data = await res.json();
      const ageOk = data.weight !== null && data.weight !== undefined;
      setIotStatus(ageOk ? 'connected' : 'disconnected');
    } catch {
      setIotStatus('disconnected');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { checkIoT(); }, [checkIoT]);

  const startSession = async () => {
    try {
      const res  = await fetch(`${BASE_URL}/api/sessions`, { method: 'POST',
        headers: {'Content-Type':'application/json'}, body: JSON.stringify({}) });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      navigation.push('PhotoCapture', { sessionId: data.sessionId });
    } catch (e) {
      alert('Could not start session: ' + e.message);
    }
  };

  const statusConfig = {
    checking:     { color: '#f59e0b', icon: 'wifi',         label: 'Checking IoT...' },
    connected:    { color: '#10b981', icon: 'wifi',         label: 'IoT Device Connected' },
    disconnected: { color: '#ef4444', icon: 'wifi-off',     label: 'IoT Device Not Connected' },
  };
  const cfg = statusConfig[iotStatus];

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} style={s.backBtn}>
          <Icon name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={s.headerTitle}>New Session</Text>
      </View>

      <View style={s.body}>
        {/* IoT Status Card */}
        <View style={[s.statusCard, {borderColor: cfg.color + '40'}]}>
          <View style={[s.statusDot, {backgroundColor: cfg.color + '18'}]}>
            <Icon name={cfg.icon} size={32} color={cfg.color} />
          </View>
          <Text style={[s.statusLabel, {color: cfg.color}]}>{cfg.label}</Text>
          {iotStatus === 'disconnected' && (
            <Text style={s.statusHint}>Make sure ESP32 is powered on and on the same WiFi.</Text>
          )}
          <Pressable style={s.refreshBtn} onPress={checkIoT} disabled={checking}>
            {checking
              ? <ActivityIndicator size="small" color={COLORS.primary} />
              : <><Icon name="refresh" size={16} color={COLORS.primary} /><Text style={s.refreshTxt}> Refresh</Text></>
            }
          </Pressable>
        </View>

        {/* Flow steps */}
        <View style={s.stepsCard}>
          <Text style={s.stepsTitle}>Session Steps</Text>
          {[
            {icon:'camera-alt',    label:'1. Capture seed photo'},
            {icon:'monitor-weight',label:'2. Before weight (IoT)'},
            {icon:'monitor-weight',label:'3. After weight (IoT)'},
            {icon:'qr-code-scanner',label:'4. Scan QR sticker'},
            {icon:'check-circle',  label:'5. Data saved to cloud'},
          ].map((step, i) => (
            <View key={i} style={s.stepRow}>
              <View style={s.stepIcon}><Icon name={step.icon} size={18} color={COLORS.primary} /></View>
              <Text style={s.stepLabel}>{step.label}</Text>
            </View>
          ))}
        </View>

        <Pressable
          style={[s.startBtn, iotStatus === 'disconnected' && s.startBtnWarn]}
          onPress={startSession}>
          <Icon name="play-arrow" size={22} color="#fff" />
          <Text style={s.startBtnTxt}>
            {iotStatus === 'disconnected' ? 'Start Anyway (Manual Weight)' : 'Start Session'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:       {flex:1, backgroundColor: COLORS.background},
  header:     {flexDirection:'row', alignItems:'center', gap:12, paddingHorizontal:SPACING.md,
                paddingTop:SPACING.lg, paddingBottom:SPACING.sm},
  backBtn:    {width:36, height:36, borderRadius:18, backgroundColor:COLORS.surface,
                alignItems:'center', justifyContent:'center', ...SHADOWS.sm},
  headerTitle:{fontSize:18, fontWeight:'800', color:COLORS.text},

  body:       {flex:1, padding:SPACING.md, gap:SPACING.md},

  statusCard: {backgroundColor:COLORS.surface, borderRadius:RADIUS.lg, padding:SPACING.lg,
                alignItems:'center', borderWidth:1.5, ...SHADOWS.sm},
  statusDot:  {width:70, height:70, borderRadius:35, alignItems:'center', justifyContent:'center', marginBottom:10},
  statusLabel:{fontSize:16, fontWeight:'700', color:COLORS.text, textAlign:'center'},
  statusHint: {fontSize:12, color:COLORS.textSecondary, textAlign:'center', marginTop:6, lineHeight:18},
  refreshBtn: {flexDirection:'row', alignItems:'center', marginTop:14, paddingVertical:6,
                paddingHorizontal:14, borderRadius:20, backgroundColor:'rgba(26,34,127,0.07)'},
  refreshTxt: {fontSize:13, fontWeight:'600', color:COLORS.primary},

  stepsCard:  {backgroundColor:COLORS.surface, borderRadius:RADIUS.lg, padding:SPACING.md, ...SHADOWS.sm},
  stepsTitle: {fontSize:13, fontWeight:'700', color:COLORS.textSecondary, marginBottom:12,
                letterSpacing:0.5, textTransform:'uppercase'},
  stepRow:    {flexDirection:'row', alignItems:'center', gap:10, paddingVertical:8,
                borderBottomWidth:1, borderBottomColor:COLORS.divider},
  stepIcon:   {width:32, height:32, borderRadius:16, backgroundColor:'rgba(26,34,127,0.08)',
                alignItems:'center', justifyContent:'center'},
  stepLabel:  {fontSize:14, fontWeight:'500', color:COLORS.text},

  startBtn:   {flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8,
                backgroundColor:COLORS.primary, borderRadius:RADIUS.md, paddingVertical:16,
                ...SHADOWS.md},
  startBtnWarn:{backgroundColor:'#f59e0b'},
  startBtnTxt:{fontSize:16, fontWeight:'700', color:'#fff'},
});
