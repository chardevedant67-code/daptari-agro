import React, {useState} from 'react';
import {View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Image} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {Camera} from 'react-native-camera-kit';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, SPACING, RADIUS, SHADOWS} from '../ui/theme';
import {BASE_URL} from '../config';

export default function QRBindScreen({route}) {
  const navigation = useNavigation();
  const {sessionId, photoUrl, beforeWeight, beforeTime, afterWeight, afterTime} = route?.params || {};

  const [scanning,  setScanning]  = useState(false);
  const [scannedId, setScannedId] = useState(null);
  const [linking,   setLinking]   = useState(false);

  const handleQRScan = ({nativeEvent}) => {
    if (linking || scannedId) return;
    const value = nativeEvent?.codeStringValue;
    if (!value) return;
    setScanning(false);
    setScannedId(value);
  };

  const linkData = async () => {
    if (!scannedId) return;
    setLinking(true);
    try {
      const res  = await fetch(`${BASE_URL}/api/sessions/${sessionId}/link/${encodeURIComponent(scannedId)}`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      navigation.replace('PacketView', {packet: data.packet, fromSession: true});
    } catch (e) {
      Alert.alert('Link Failed', e.message);
      setLinking(false);
    }
  };

  const formatTime = (t) => t ? new Date(t).toLocaleTimeString() : '—';

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} style={s.backBtn}>
          <Icon name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <View>
          <Text style={s.headerTitle}>Scan QR Sticker</Text>
          <Text style={s.headerSub}>Step 4 of 4</Text>
        </View>
      </View>

      <View style={s.body}>
        <View style={s.progress}>
          {[1,2,3,4].map(n => (
            <View key={n} style={[s.progressDot, n <= 4 && s.progressDotActive]} />
          ))}
        </View>

        {/* Session summary */}
        <View style={s.summaryCard}>
          <Text style={s.summaryTitle}>Session Data (ready to link)</Text>
          <View style={s.summaryRow}>
            <Icon name="camera-alt" size={14} color={COLORS.textSecondary} />
            <Text style={s.summaryTxt}>Photo: {photoUrl ? 'Captured ✓' : 'Skipped'}</Text>
          </View>
          <View style={s.summaryRow}>
            <Icon name="scale" size={14} color={COLORS.textSecondary} />
            <Text style={s.summaryTxt}>Before: <Text style={s.summaryVal}>{beforeWeight?.toFixed(3)} kg</Text> at {formatTime(beforeTime)}</Text>
          </View>
          <View style={s.summaryRow}>
            <Icon name="scale" size={14} color={COLORS.textSecondary} />
            <Text style={s.summaryTxt}>After: <Text style={s.summaryVal}>{afterWeight?.toFixed(3)} kg</Text> at {formatTime(afterTime)}</Text>
          </View>
          <View style={[s.summaryRow, {borderBottomWidth:0}]}>
            <Icon name="trending-down" size={14} color="#ef4444" />
            <Text style={s.summaryTxt}>Loss: <Text style={{color:'#ef4444', fontWeight:'700'}}>
              {(beforeWeight - afterWeight)?.toFixed(3)} kg
            </Text></Text>
          </View>
        </View>

        {!scannedId ? (
          <>
            <Text style={s.scanInstruction}>Pick a QR sticker, attach to packet, then scan it below:</Text>
            {scanning ? (
              <View style={s.cameraBox}>
                <Camera
                  style={StyleSheet.absoluteFill}
                  scanBarcode
                  onReadCode={handleQRScan}
                  showFrame
                />
                <Pressable style={s.cancelScanBtn} onPress={() => setScanning(false)}>
                  <Text style={s.cancelScanTxt}>Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={s.scanBtn} onPress={() => setScanning(true)}>
                <Icon name="qr-code-scanner" size={28} color="#fff" />
                <Text style={s.scanBtnTxt}>Tap to Scan QR Sticker</Text>
              </Pressable>
            )}
          </>
        ) : (
          <View style={s.scannedCard}>
            <View style={s.scannedIcon}><Icon name="check-circle" size={36} color="#10b981" /></View>
            <Text style={s.scannedLabel}>QR Scanned!</Text>
            <Text style={s.scannedId}>{scannedId}</Text>
            <Pressable style={s.retryBtn} onPress={() => setScannedId(null)}>
              <Text style={s.retryTxt}>Scan Different QR</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          style={[s.linkBtn, (!scannedId || linking) && s.linkBtnDisabled]}
          onPress={linkData}
          disabled={!scannedId || linking}>
          {linking
            ? <ActivityIndicator color="#fff" />
            : <><Icon name="link" size={20} color="#fff" /><Text style={s.linkBtnTxt}>Link & Save to Database</Text></>
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

  summaryCard:     {backgroundColor:COLORS.surface, borderRadius:RADIUS.lg, padding:SPACING.md,
                    marginBottom:SPACING.md, ...SHADOWS.sm},
  summaryTitle:    {fontSize:12, fontWeight:'700', color:COLORS.textSecondary, letterSpacing:0.5,
                    textTransform:'uppercase', marginBottom:10},
  summaryRow:      {flexDirection:'row', alignItems:'center', gap:8, paddingVertical:7,
                    borderBottomWidth:1, borderBottomColor:COLORS.divider},
  summaryTxt:      {fontSize:13, color:COLORS.text},
  summaryVal:      {fontWeight:'700', color:COLORS.primary},

  scanInstruction: {fontSize:13, color:COLORS.textSecondary, textAlign:'center', marginBottom:12},
  cameraBox:       {height:220, borderRadius:RADIUS.lg, overflow:'hidden', marginBottom:SPACING.md,
                    position:'relative'},
  cancelScanBtn:   {position:'absolute', bottom:12, alignSelf:'center',
                    backgroundColor:'rgba(0,0,0,0.6)', paddingHorizontal:20, paddingVertical:8,
                    borderRadius:20},
  cancelScanTxt:   {color:'#fff', fontWeight:'600'},
  scanBtn:         {flexDirection:'row', alignItems:'center', justifyContent:'center', gap:10,
                    backgroundColor:COLORS.primary, borderRadius:RADIUS.md, paddingVertical:18,
                    marginBottom:SPACING.md, ...SHADOWS.md},
  scanBtnTxt:      {fontSize:15, fontWeight:'700', color:'#fff'},

  scannedCard:     {backgroundColor:'#f0fdf4', borderRadius:RADIUS.lg, padding:SPACING.lg,
                    alignItems:'center', marginBottom:SPACING.md, borderWidth:1, borderColor:'#bbf7d0'},
  scannedIcon:     {marginBottom:8},
  scannedLabel:    {fontSize:16, fontWeight:'700', color:'#15803d', marginBottom:4},
  scannedId:       {fontFamily:'monospace', fontSize:14, color:'#166534', fontWeight:'600'},
  retryBtn:        {marginTop:10, paddingVertical:6, paddingHorizontal:16,
                    borderRadius:20, borderWidth:1, borderColor:'#16a34a'},
  retryTxt:        {fontSize:12, color:'#16a34a', fontWeight:'600'},

  linkBtn:         {flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8,
                    backgroundColor:'#10b981', borderRadius:RADIUS.md, paddingVertical:16,
                    marginTop:'auto', ...SHADOWS.md},
  linkBtnDisabled: {opacity:0.4},
  linkBtnTxt:      {fontSize:16, fontWeight:'700', color:'#fff'},
});
