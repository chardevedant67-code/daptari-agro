import React from 'react';
import {
  Image,
  Pressable, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useNavigation, useRoute} from '@react-navigation/native';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {BASE_URL} from '../config';

// Maps seedType keywords → gradient colors + icon + accent
const SEED_THEMES = {
  'Organic':     {colors: ['#14532d','#166534','#15803d'], icon: 'local-florist',         accent: '#4ade80', label: 'Organic Seed'},
  'Hybrid':      {colors: ['#1e3a5f','#1d4ed8','#2563eb'], icon: 'science',               accent: '#60a5fa', label: 'Hybrid Variety'},
  'Heirloom':    {colors: ['#713f12','#92400e','#b45309'], icon: 'grass',                 accent: '#fcd34d', label: 'Heirloom Seed'},
  'Modified':    {colors: ['#4c1d95','#6d28d9','#7c3aed'], icon: 'biotech',               accent: '#c4b5fd', label: 'Modified Seed'},
  'wheat':       {colors: ['#78350f','#92400e','#d97706'], icon: 'grain',                 accent: '#fde68a', label: 'Wheat'},
  'rice':        {colors: ['#064e3b','#065f46','#047857'], icon: 'spa',                   accent: '#6ee7b7', label: 'Rice'},
  'corn':        {colors: ['#713f12','#a16207','#ca8a04'], icon: 'agriculture',           accent: '#fef08a', label: 'Corn / Maize'},
  'maize':       {colors: ['#713f12','#a16207','#ca8a04'], icon: 'agriculture',           accent: '#fef08a', label: 'Corn / Maize'},
  'soybean':     {colors: ['#3f6212','#4d7c0f','#65a30d'], icon: 'eco',                  accent: '#bef264', label: 'Soybean'},
  'soy':         {colors: ['#3f6212','#4d7c0f','#65a30d'], icon: 'eco',                  accent: '#bef264', label: 'Soybean'},
  'mustard':     {colors: ['#713f12','#854d0e','#a16207'], icon: 'local-florist',         accent: '#fde047', label: 'Mustard'},
  'bean':        {colors: ['#14532d','#15803d','#16a34a'], icon: 'spa',                   accent: '#86efac', label: 'Beans'},
  'sunflower':   {colors: ['#713f12','#a16207','#eab308'], icon: 'wb-sunny',              accent: '#fef08a', label: 'Sunflower'},
  'cotton':      {colors: ['#1e3a5f','#1e40af','#3b82f6'], icon: 'cloud',                accent: '#bfdbfe', label: 'Cotton'},
  'barley':      {colors: ['#78350f','#a16207','#d97706'], icon: 'grain',                 accent: '#fde68a', label: 'Barley'},
  'default':     {colors: ['#1e3a5f','#1a227f','#3730a3'], icon: 'local-florist',         accent: '#a5b4fc', label: 'Seed Packet'},
};

function getTheme(seedType) {
  const type = seedType || '';
  const name = type.toLowerCase();
  if (SEED_THEMES[type]) return SEED_THEMES[type];
  for (const key of Object.keys(SEED_THEMES)) {
    if (key !== 'default' && name.includes(key)) return SEED_THEMES[key];
  }
  return SEED_THEMES.default;
}

// Unique decorative circles per packet (based on uniqueId char codes)
function getBubbles(uniqueId = '') {
  const seed = uniqueId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return [
    {size: 140, top: -40, right: -30, op: 0.12, offset: seed % 20},
    {size: 90,  top: 60,  right: 80,  op: 0.09, offset: (seed * 3) % 30},
    {size: 60,  top: 10,  left: 40,   op: 0.07, offset: (seed * 7) % 25},
    {size: 110, bottom: -20, left: -20, op: 0.10, offset: (seed * 11) % 35},
  ];
}

function PacketBanner({packet, batch, onBack}) {
  const theme    = getTheme(batch?.seedType);
  const bubbles  = getBubbles(packet.uniqueId);
  const photoUri = packet.photoUrl ? `${BASE_URL}${packet.photoUrl}` : null;

  return (
    <View style={styles.imageBanner}>
      {photoUri ? (
        <>
          <Image source={{uri: photoUri}} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.70)']} style={styles.bannerOverlay} />
        </>
      ) : (
        <LinearGradient colors={theme.colors} style={StyleSheet.absoluteFill}>
          {bubbles.map((b, i) => (
            <View key={i} style={[styles.bubble, {
              width: b.size, height: b.size, borderRadius: b.size / 2,
              opacity: b.op, top: b.top, right: b.right, left: b.left, bottom: b.bottom,
            }]} />
          ))}
          <View style={styles.bannerIconWrap}>
            <View style={[styles.bannerIconBg, {borderColor: theme.accent + '55'}]}>
              <Icon name={theme.icon} size={52} color={theme.accent} />
            </View>
            <View style={[styles.accentDot, {backgroundColor: theme.accent}]} />
          </View>
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.60)']} style={styles.bannerOverlay} />
        </LinearGradient>
      )}
      <Pressable style={styles.backBtn} onPress={onBack}>
        <Icon name="arrow-back" size={20} color="#fff" />
      </Pressable>
      <View style={styles.bannerBadge}>
        <Icon name={theme.icon} size={13} color="#fff" />
        <Text style={styles.bannerBadgeTxt}>{batch?.seedType || 'Seed Packet'}</Text>
      </View>
      <View style={[styles.bannerTag, {backgroundColor: theme.accent + 'cc'}]}>
        <Text style={[styles.bannerTagTxt, {color: theme.colors[0]}]}>
          {packet.status === 'filled' ? 'Weighed' : 'Not Yet Weighed'}
        </Text>
      </View>
    </View>
  );
}

export default function ProductDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const packet = route.params?.packet;

  if (!packet) {
    return (
      <View style={styles.centerWrap}>
        <Icon name="error-outline" size={40} color={COLORS.muted} />
        <Text style={styles.loadingTxt}>No packet data</Text>
      </View>
    );
  }

  const batch = packet.batchId; // populated by GET /api/packets/:uniqueId
  const filled = packet.status === 'filled';

  const batchCreated = batch?.createdAt
    ? new Date(batch.createdAt).toLocaleDateString('en-US', {year: 'numeric', month: 'short', day: 'numeric'})
    : '—';

  // Only fields that actually exist on SeedBatch/SeedPacket are shown here —
  // there is no Warehouse/Rack/Shelf/Year/Month field in the current schema,
  // so those are intentionally not displayed rather than shown as fake data.
  const infoCards = [
    {icon: 'qr-code',        label: 'Packet ID',     value: packet.uniqueId},
    {icon: 'inventory-2',    label: 'Batch Number',  value: batch?.batchNumber || '—'},
    {icon: 'local-florist',  label: 'Seed Type',     value: batch?.seedType || '—'},
    {icon: 'calendar-today', label: 'Batch Created', value: batchCreated},
  ];

  const photoUri = packet.photoUrl ? `${BASE_URL}${packet.photoUrl}` : null;
  const diff = packet.difference;

  return (
    <View style={styles.root}>
      <PacketBanner packet={packet} batch={batch} onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <Text style={styles.productName}>{batch?.seedType || 'Seed Packet'}</Text>
          <Text style={styles.productSub}>{batch?.batchName || packet.uniqueId}</Text>
        </View>

        <View style={styles.grid}>
          {infoCards.map(card => (
            <View key={card.label} style={styles.infoCard}>
              <Icon name={card.icon} size={18} color={COLORS.primary} style={{marginBottom: 6}} />
              <Text style={styles.infoLabel}>{card.label}</Text>
              <Text style={styles.infoValue} numberOfLines={2}>{card.value}</Text>
            </View>
          ))}
        </View>

        {filled ? (
          <View style={styles.recordSection}>
            <Pressable style={styles.recordTitleRow} onPress={() => navigation.navigate('MainTabs', {initialTab: 'history'})}>
              <Text style={styles.recordTitle}>Measurement</Text>
              <View style={styles.viewHistoryBtn}>
                <Text style={styles.viewHistoryTxt}>View History</Text>
                <Icon name="chevron-right" size={16} color={COLORS.primary} />
              </View>
            </Pressable>
            <View style={styles.weightRow}>
              <View style={styles.weightBox}>
                <Icon name="scale" size={18} color={COLORS.primary} />
                <Text style={styles.weightVal}>{packet.beforeWeight?.toFixed(2) ?? '—'}</Text>
                <Text style={styles.weightLbl}>Before (kg)</Text>
              </View>
              <View style={styles.weightBox}>
                <Icon name="scale" size={18} color={COLORS.primary} />
                <Text style={styles.weightVal}>{packet.afterWeight?.toFixed(2) ?? '—'}</Text>
                <Text style={styles.weightLbl}>After (kg)</Text>
              </View>
              <View style={[styles.weightBox, {borderRightWidth: 0}]}>
                <Icon name="calculate" size={18} color={COLORS.success} />
                <Text style={[styles.weightVal, {color: COLORS.success}]}>
                  {diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}` : '—'}
                </Text>
                <Text style={styles.weightLbl}>Diff (kg)</Text>
              </View>
            </View>
            {photoUri && (
              <Image source={{uri: photoUri}} style={styles.recordPhoto} resizeMode="cover" />
            )}
            <View style={{paddingHorizontal: SPACING.md, paddingBottom: SPACING.md, paddingTop: photoUri ? SPACING.sm : 0}}>
              <Text style={styles.weightLbl}>
                Weighed {packet.afterTime ? new Date(packet.afterTime).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '—'}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.noRecordCard}>
            <Icon name="scale" size={24} color={COLORS.muted} />
            <Text style={styles.noRecordTxt}>Not yet weighed</Text>
          </View>
        )}

        <View style={{height: 40}} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.bg},
  centerWrap: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  loadingTxt: {color: COLORS.muted, fontSize: 14, marginTop: 12},
  imageBanner: {height: 230, position: 'relative', overflow: 'hidden', justifyContent: 'center', alignItems: 'center'},
  bubble: {position: 'absolute', backgroundColor: '#fff'},
  bannerIconWrap: {alignItems: 'center', justifyContent: 'center', zIndex: 2},
  bannerIconBg: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  accentDot: {
    width: 10, height: 10, borderRadius: 5,
    position: 'absolute', bottom: -2, right: -2,
  },
  bannerOverlay: {position: 'absolute', left: 0, right: 0, bottom: 0, height: 80},
  backBtn: {
    position: 'absolute', top: 48, left: SPACING.lg,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.30)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },
  bannerBadge: {
    position: 'absolute', bottom: 14, left: SPACING.lg,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.40)', borderRadius: RADIUS.pill,
    paddingHorizontal: 12, paddingVertical: 5, zIndex: 10,
  },
  bannerBadgeTxt: {color: '#fff', fontSize: 13, fontWeight: '700'},
  bannerTag: {
    position: 'absolute', top: 52, right: SPACING.lg,
    borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4,
    zIndex: 10,
  },
  bannerTagTxt: {fontSize: 11, fontWeight: '800', letterSpacing: 0.5},
  scroll: {flex: 1},
  headerCard: {paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md},
  productName: {fontSize: 26, fontWeight: '800', color: COLORS.text, marginBottom: 4},
  productSub: {fontSize: 14, color: COLORS.muted},
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.md,
  },
  infoCard: {
    width: '47%', backgroundColor: COLORS.white,
    borderRadius: RADIUS.md, padding: SPACING.md, ...SHADOWS.card,
  },
  infoLabel: {fontSize: 11, color: COLORS.muted, fontWeight: '600', marginBottom: 2},
  infoValue: {fontSize: 13, fontWeight: '700', color: COLORS.text},
  recordSection: {marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card},
  recordTitleRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.border},
  recordTitle:   {fontSize: 13, fontWeight: '700', color: COLORS.text, padding: SPACING.md},
  viewHistoryBtn: {flexDirection: 'row', alignItems: 'center', paddingRight: SPACING.md, gap: 2},
  viewHistoryTxt: {fontSize: 12, fontWeight: '700', color: COLORS.primary},
  recordPhoto:   {width: '100%', height: 200},
  weightRow:     {flexDirection: 'row'},
  weightBox:     {flex: 1, alignItems: 'center', padding: SPACING.md, gap: 4, borderRightWidth: 1, borderRightColor: COLORS.border},
  weightVal:     {fontSize: 18, fontWeight: '800', color: COLORS.text},
  weightLbl:     {fontSize: 11, color: COLORS.muted, fontWeight: '600'},
  noRecordCard:  {marginHorizontal: SPACING.lg, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.white, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border},
  noRecordTxt:   {fontSize: 13, color: COLORS.muted},
});
