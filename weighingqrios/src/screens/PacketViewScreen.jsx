import React, {useState, useEffect} from 'react';
import {View, Text, StyleSheet, Pressable, Image, ScrollView, ActivityIndicator} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, SPACING, RADIUS, SHADOWS} from '../ui/theme';
import {BASE_URL} from '../config';

export default function PacketViewScreen({route}) {
  const navigation = useNavigation();
  const {packet: initialPacket, uniqueId, fromSession} = route?.params || {};
  const [packet,  setPacket]  = useState(initialPacket || null);
  const [loading, setLoading] = useState(!initialPacket);

  useEffect(() => {
    if (!initialPacket && uniqueId) {
      fetch(`${BASE_URL}/api/packets/${encodeURIComponent(uniqueId)}`)
        .then(r => r.json())
        .then(d => { if (d.success) setPacket(d.packet); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [uniqueId, initialPacket]);

  const fmt     = (d) => d ? new Date(d).toLocaleString() : '—';
  const fmtW    = (w) => w != null ? `${w.toFixed(3)} kg` : '—';
  const batch   = packet?.batchId;
  const loss    = packet?.beforeWeight != null && packet?.afterWeight != null
    ? (packet.beforeWeight - packet.afterWeight).toFixed(3)
    : null;

  if (loading) return (
    <View style={[s.root, {alignItems:'center', justifyContent:'center'}]}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  );

  if (!packet) return (
    <View style={[s.root, {alignItems:'center', justifyContent:'center', padding:SPACING.xl}]}>
      <Icon name="error-outline" size={48} color={COLORS.textSecondary} />
      <Text style={{color:COLORS.textSecondary, marginTop:12, textAlign:'center'}}>Packet not found</Text>
      <Pressable style={s.backChip} onPress={() => navigation.goBack()}>
        <Text style={s.backChipTxt}>Go Back</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} style={s.backBtn}>
          <Icon name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <View style={{flex:1}}>
          <Text style={s.headerTitle}>{packet.uniqueId}</Text>
          <Text style={s.headerSub}>{batch?.seedType} · {batch?.batchNumber}</Text>
        </View>
        <View style={[s.statusBadge, packet.status === 'filled' ? s.badgeFilled : s.badgeEmpty]}>
          <Text style={[s.statusTxt, {color: packet.status === 'filled' ? '#16a34a' : '#94a3b8'}]}>
            {packet.status === 'filled' ? 'Filled' : 'Empty'}
          </Text>
        </View>
      </View>

      <ScrollView style={s.body} contentContainerStyle={{paddingBottom:40}}>

        {fromSession && (
          <View style={s.successBanner}>
            <Icon name="check-circle" size={20} color="#16a34a" />
            <Text style={s.successTxt}>Data saved successfully to database!</Text>
          </View>
        )}

        {/* Photo */}
        {packet.photoUrl ? (
          <View style={s.photoCard}>
            <Image source={{uri: `${BASE_URL}${packet.photoUrl}`}} style={s.photo} resizeMode="cover" />
            <View style={s.photoLabel}><Text style={s.photoLabelTxt}>Seed Photo</Text></View>
          </View>
        ) : (
          <View style={[s.photoCard, s.noPhoto]}>
            <Icon name="camera-alt" size={32} color={COLORS.textSecondary} />
            <Text style={{color:COLORS.textSecondary, fontSize:13}}>No photo</Text>
          </View>
        )}

        {/* Batch Info */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Batch Info</Text>
          <InfoRow icon="inventory" label="Batch Name"   value={batch?.batchName || '—'} />
          <InfoRow icon="grain"     label="Seed Type"    value={batch?.seedType || '—'} />
          <InfoRow icon="tag"       label="Batch Number" value={batch?.batchNumber || '—'} />
          <InfoRow icon="numbers"   label="Unique ID"    value={packet.uniqueId} mono />
        </View>

        {/* Weight Data */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>IoT Weight Data</Text>
          <View style={s.weightRow}>
            <View style={[s.weightBox, {borderColor:'#bfdbfe'}]}>
              <Text style={s.weightBoxLabel}>Before</Text>
              <Text style={[s.weightBoxVal, {color:COLORS.primary}]}>{fmtW(packet.beforeWeight)}</Text>
              <Text style={s.weightBoxTime}>{fmt(packet.beforeTime)}</Text>
            </View>
            <Icon name="arrow-forward" size={20} color={COLORS.textSecondary} />
            <View style={[s.weightBox, {borderColor:'#fde68a'}]}>
              <Text style={s.weightBoxLabel}>After</Text>
              <Text style={[s.weightBoxVal, {color:'#f59e0b'}]}>{fmtW(packet.afterWeight)}</Text>
              <Text style={s.weightBoxTime}>{fmt(packet.afterTime)}</Text>
            </View>
          </View>
          {loss != null && (
            <View style={s.lossBadge}>
              <Icon name="trending-down" size={16} color="#ef4444" />
              <Text style={s.lossTxt}>Total Loss: {loss} kg</Text>
            </View>
          )}
        </View>

        {/* Linked at */}
        {packet.linkedAt && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Tracking</Text>
            <InfoRow icon="link"          label="Linked At"   value={fmt(packet.linkedAt)} />
            <InfoRow icon="qr-code"       label="QR ID"       value={packet.uniqueId} mono />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function InfoRow({icon, label, value, mono}) {
  return (
    <View style={s.infoRow}>
      <Icon name={icon} size={16} color={COLORS.textSecondary} style={{width:20}} />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, mono && {fontFamily:'monospace', fontSize:12}]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:          {flex:1, backgroundColor:COLORS.background},
  header:        {flexDirection:'row', alignItems:'center', gap:12, paddingHorizontal:SPACING.md,
                  paddingTop:SPACING.lg, paddingBottom:SPACING.sm},
  backBtn:       {width:36, height:36, borderRadius:18, backgroundColor:COLORS.surface,
                  alignItems:'center', justifyContent:'center', ...SHADOWS.sm},
  headerTitle:   {fontSize:16, fontWeight:'800', color:COLORS.text, fontFamily:'monospace'},
  headerSub:     {fontSize:12, color:COLORS.textSecondary},
  statusBadge:   {paddingHorizontal:10, paddingVertical:4, borderRadius:20, borderWidth:1},
  badgeFilled:   {backgroundColor:'#dcfce7', borderColor:'#86efac'},
  badgeEmpty:    {backgroundColor:'#f1f5f9', borderColor:'#cbd5e1'},
  statusTxt:     {fontSize:11, fontWeight:'700'},

  body:          {flex:1, padding:SPACING.md},

  successBanner: {flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'#f0fdf4',
                  borderRadius:RADIUS.md, padding:12, marginBottom:SPACING.md,
                  borderWidth:1, borderColor:'#bbf7d0'},
  successTxt:    {fontSize:13, fontWeight:'600', color:'#15803d'},

  photoCard:     {height:200, borderRadius:RADIUS.lg, overflow:'hidden', marginBottom:SPACING.md,
                  backgroundColor:COLORS.surface, ...SHADOWS.sm},
  photo:         {width:'100%', height:'100%'},
  noPhoto:       {alignItems:'center', justifyContent:'center', gap:8},
  photoLabel:    {position:'absolute', bottom:0, left:0, right:0, backgroundColor:'rgba(0,0,0,0.4)',
                  padding:8},
  photoLabelTxt: {color:'#fff', fontSize:12, fontWeight:'600', textAlign:'center'},

  section:       {backgroundColor:COLORS.surface, borderRadius:RADIUS.lg, padding:SPACING.md,
                  marginBottom:SPACING.md, ...SHADOWS.sm},
  sectionTitle:  {fontSize:11, fontWeight:'700', color:COLORS.textSecondary, letterSpacing:0.8,
                  textTransform:'uppercase', marginBottom:10},
  infoRow:       {flexDirection:'row', alignItems:'center', gap:10, paddingVertical:9,
                  borderBottomWidth:1, borderBottomColor:COLORS.divider},
  infoLabel:     {flex:1, fontSize:13, color:COLORS.textSecondary},
  infoValue:     {fontSize:13, fontWeight:'600', color:COLORS.text, textAlign:'right', maxWidth:'55%'},

  weightRow:     {flexDirection:'row', alignItems:'center', gap:12, marginBottom:12},
  weightBox:     {flex:1, borderWidth:1.5, borderRadius:RADIUS.md, padding:12, alignItems:'center'},
  weightBoxLabel:{fontSize:11, color:COLORS.textSecondary, fontWeight:'700', marginBottom:4},
  weightBoxVal:  {fontSize:20, fontWeight:'900'},
  weightBoxTime: {fontSize:10, color:COLORS.textSecondary, marginTop:4, textAlign:'center'},
  lossBadge:     {flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'#fef2f2',
                  padding:10, borderRadius:RADIUS.sm},
  lossTxt:       {fontSize:13, fontWeight:'700', color:'#ef4444'},

  backChip:      {marginTop:16, paddingHorizontal:20, paddingVertical:10, backgroundColor:COLORS.primary,
                  borderRadius:20},
  backChipTxt:   {color:'#fff', fontWeight:'700'},
});
