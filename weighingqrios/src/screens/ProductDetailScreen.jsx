import React, {useEffect, useState} from 'react';
import {Image, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useNavigation, useRoute} from '@react-navigation/native';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {fetchLatestRecord} from '../services/api';
import {BASE_URL} from '../config';

const SEED_THEMES = {
  'Organic':   {colors: ['#14532d','#166534','#15803d'], icon: 'local-florist', accent: '#4ade80', label: 'Organic Seed'},
  'Hybrid':    {colors: ['#1e3a5f','#1d4ed8','#2563eb'], icon: 'science',       accent: '#60a5fa', label: 'Hybrid Variety'},
  'Heirloom':  {colors: ['#713f12','#92400e','#b45309'], icon: 'grass',         accent: '#fcd34d', label: 'Heirloom Seed'},
  'Modified':  {colors: ['#4c1d95','#6d28d9','#7c3aed'], icon: 'biotech',       accent: '#c4b5fd', label: 'Modified Seed'},
  'default':   {colors: ['#1e3a5f','#1a227f','#3730a3'], icon: 'local-florist', accent: '#a5b4fc', label: 'Seed Product'},
};

function getTheme(product) {
  const type = product.seedType || '';
  return SEED_THEMES[type] || SEED_THEMES.default;
}

function getBubbles(productId = '') {
  const seed = productId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return [
    {size: 140, top: -40, right: -30, op: 0.12},
    {size: 90,  top: 60,  right: 80,  op: 0.09},
    {size: 60,  top: 10,  left: 40,   op: 0.07},
    {size: 110, bottom: -20, left: -20, op: 0.10},
  ];
}

function ProductBanner({product, onBack, recordPhoto}) {
  const theme   = getTheme(product);
  const bubbles = getBubbles(product.productId);
  const photoUri = product.imageUrl ? `${BASE_URL}${product.imageUrl}` : recordPhoto || null;

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
            <View key={i} style={[styles.bubble, {width: b.size, height: b.size, borderRadius: b.size / 2, opacity: b.op, top: b.top, right: b.right, left: b.left, bottom: b.bottom}]} />
          ))}
          <View style={styles.bannerIconWrap}>
            <View style={[styles.bannerIconBg, {borderColor: theme.accent + '55'}]}>
              <Icon name={theme.icon} size={52} color={theme.accent} />
            </View>
          </View>
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.60)']} style={styles.bannerOverlay} />
        </LinearGradient>
      )}
      <Pressable style={styles.backBtn} onPress={onBack}>
        <Icon name="arrow-back" size={20} color="#fff" />
      </Pressable>
      <View style={styles.bannerBadge}>
        <Icon name={theme.icon} size={13} color="#fff" />
        <Text style={styles.bannerBadgeTxt}>{product.productName}</Text>
      </View>
      <View style={[styles.bannerTag, {backgroundColor: theme.accent + 'cc'}]}>
        <Text style={[styles.bannerTagTxt, {color: theme.colors[0]}]}>{theme.label}</Text>
      </View>
    </View>
  );
}

export default function ProductDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const product = route.params?.product;
  const [record, setRecord] = useState(null);

  useEffect(() => {
    if (product?.productId) {
      fetchLatestRecord(product.productId).then(r => setRecord(r));
    }
  }, [product]);

  if (!product) {
    return (
      <View style={styles.centerWrap}>
        <ActivityIndicator color={COLORS.primary} size="large" />
        <Text style={styles.loadingTxt}>Loading product...</Text>
      </View>
    );
  }

  const created = new Date(product.createdAt).toLocaleDateString('en-US', {year: 'numeric', month: 'short', day: 'numeric'});
  const infoCards = [
    {icon: 'qr-code',        label: 'Product ID', value: product.productId},
    {icon: 'location-on',    label: 'Location',   value: product.storageLocation},
    {icon: 'inventory-2',    label: 'Batch',       value: product.batchNumber},
    {icon: 'local-florist',  label: 'Seed Type',   value: product.seedType},
    {icon: 'person',         label: 'Added By',    value: product.createdBy?.name || 'System'},
    {icon: 'calendar-today', label: 'Created',     value: created},
  ];

  const recordPhoto  = record?.photoUrl ? `${BASE_URL}${record.photoUrl}` : null;
  const recordWeight = record?.actualWeight;
  const recordTime   = record?.createdAt
    ? new Date(record.createdAt).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})
    : null;

  return (
    <View style={styles.root}>
      <ProductBanner product={product} onBack={() => navigation.goBack()} recordPhoto={recordPhoto} />
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <Text style={styles.productName}>{product.productName}</Text>
          <Text style={styles.productSub}>{product.seedType} · {product.storageLocation}</Text>
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

        {record ? (
          <View style={styles.recordSection}>
            <Pressable style={styles.recordTitleRow} onPress={() => navigation.navigate('MainTabs', {initialTab: 'history'})}>
              <Text style={styles.recordTitle}>Last Weigh Record</Text>
              <View style={styles.viewHistoryBtn}>
                <Text style={styles.viewHistoryTxt}>View History</Text>
                <Icon name="chevron-right" size={16} color={COLORS.primary} />
              </View>
            </Pressable>
            <View style={styles.weightRow}>
              <View style={styles.weightBox}>
                <Icon name="scale" size={20} color={COLORS.primary} />
                <Text style={styles.weightVal}>{recordWeight?.toFixed(2)} kg</Text>
                <Text style={styles.weightLbl}>Recorded Weight</Text>
              </View>
              {recordTime && (
                <View style={styles.weightBox}>
                  <Icon name="schedule" size={20} color={COLORS.muted} />
                  <Text style={[styles.weightVal, {fontSize: 14}]}>{recordTime}</Text>
                  <Text style={styles.weightLbl}>Weighed At</Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.noRecordCard}>
            <Icon name="scale" size={24} color={COLORS.muted} />
            <Text style={styles.noRecordTxt}>No weigh record yet</Text>
          </View>
        )}
        <View style={{height: 40}} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:           {flex: 1, backgroundColor: COLORS.bg},
  centerWrap:     {flex: 1, alignItems: 'center', justifyContent: 'center'},
  loadingTxt:     {color: COLORS.muted, fontSize: 14, marginTop: 12},
  imageBanner:    {height: 230, position: 'relative', overflow: 'hidden', justifyContent: 'center', alignItems: 'center'},
  bubble:         {position: 'absolute', backgroundColor: '#fff'},
  bannerIconWrap: {alignItems: 'center', justifyContent: 'center', zIndex: 2},
  bannerIconBg:   {width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1.5, alignItems: 'center', justifyContent: 'center'},
  bannerOverlay:  {position: 'absolute', left: 0, right: 0, bottom: 0, height: 80},
  backBtn:        {position: 'absolute', top: 52, left: SPACING.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.30)', alignItems: 'center', justifyContent: 'center', zIndex: 10},
  bannerBadge:    {position: 'absolute', bottom: 14, left: SPACING.lg, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.40)', borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 5, zIndex: 10},
  bannerBadgeTxt: {color: '#fff', fontSize: 13, fontWeight: '700'},
  bannerTag:      {position: 'absolute', top: 52, right: SPACING.lg, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4, zIndex: 10},
  bannerTagTxt:   {fontSize: 11, fontWeight: '800', letterSpacing: 0.5},
  scroll:         {flex: 1},
  headerCard:     {paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md},
  productName:    {fontSize: 26, fontWeight: '800', color: COLORS.text, marginBottom: 4},
  productSub:     {fontSize: 14, color: COLORS.muted},
  grid:           {flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.md},
  infoCard:       {width: '47%', backgroundColor: COLORS.white, borderRadius: RADIUS.md, padding: SPACING.md, ...SHADOWS.card},
  infoLabel:      {fontSize: 11, color: COLORS.muted, fontWeight: '600', marginBottom: 2},
  infoValue:      {fontSize: 13, fontWeight: '700', color: COLORS.text},
  recordSection:  {marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card},
  recordTitleRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.border},
  recordTitle:    {fontSize: 13, fontWeight: '700', color: COLORS.text, padding: SPACING.md},
  viewHistoryBtn: {flexDirection: 'row', alignItems: 'center', paddingRight: SPACING.md, gap: 2},
  viewHistoryTxt: {fontSize: 12, fontWeight: '700', color: COLORS.primary},
  weightRow:      {flexDirection: 'row'},
  weightBox:      {flex: 1, alignItems: 'center', padding: SPACING.md, gap: 4, borderRightWidth: 1, borderRightColor: COLORS.border},
  weightVal:      {fontSize: 20, fontWeight: '800', color: COLORS.text},
  weightLbl:      {fontSize: 11, color: COLORS.muted, fontWeight: '600'},
  noRecordCard:   {marginHorizontal: SPACING.lg, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.white, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border},
  noRecordTxt:    {fontSize: 13, color: COLORS.muted},
});
