import React, {useState, useCallback} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {ActivityIndicator, ScrollView, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {BASE_URL} from '../config';

export default function AnalyticsScreen() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${BASE_URL}/p/api/records`, {signal: controller.signal});
      clearTimeout(timer);
      const data = await res.json();
      setRecords(data.success ? (data.records || []) : []);
    } catch (_) {
      setRecords([]);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { fetchRecords(); }, [fetchRecords]));

  const totalWeighings = records.length;
  const totalPass      = records.filter(r => r.status === 'PASS').length;
  const totalFail      = records.filter(r => r.status === 'FAIL').length;
  const passRate       = totalWeighings ? Math.round((totalPass / totalWeighings) * 100) : 0;

  const productMap = {};
  records.forEach(r => {
    const name = r.product?.productName || 'Unknown';
    if (!productMap[name]) productMap[name] = {name, total: 0, pass: 0};
    productMap[name].total += 1;
    if (r.status === 'PASS') productMap[name].pass += 1;
  });
  const productStats = Object.values(productMap)
    .map(p => ({...p, pct: p.total ? Math.round((p.pass / p.total) * 100) : 0}))
    .sort((a, b) => b.total - a.total).slice(0, 8);

  const machineMap = {};
  records.forEach(r => {
    const id = r.machine?.machineId || 'Unknown';
    const name = r.machine?.name || '';
    if (!machineMap[id]) machineMap[id] = {id, name, count: 0};
    machineMap[id].count += 1;
  });
  const machineStats = Object.values(machineMap).sort((a, b) => b.count - a.count).slice(0, 5);
  const MACHINE_COLORS = [COLORS.primary, '#7c3aed', '#0891b2', '#ca8a04', '#dc2626'];

  const statCards = [
    {icon: 'scale',        label: 'Total Weighings', value: String(totalWeighings), color: COLORS.primary},
    {icon: 'check-circle', label: 'Total Pass',       value: String(totalPass),     color: '#16a34a'},
    {icon: 'cancel',       label: 'Total Fail',       value: String(totalFail),     color: '#dc2626'},
    {icon: 'percent',      label: 'Pass Rate',         value: `${passRate}%`,        color: '#ca8a04'},
  ];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Analytics</Text>
        <Text style={styles.headerSub}>Real-time Overview</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={COLORS.primary} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.cardGrid}>
            {statCards.map(s => (
              <View key={s.label} style={styles.statCard}>
                <View style={[styles.statIconCircle, {backgroundColor: s.color + '18'}]}>
                  <Icon name={s.icon} size={22} color={s.color} />
                </View>
                <Text style={[styles.statValue, {color: s.color}]}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Product Performance</Text>
            <Text style={styles.cardSub}>Pass rate by product</Text>
            {productStats.length === 0 ? (
              <Text style={styles.emptyTxt}>No data available</Text>
            ) : (
              productStats.map(p => (
                <View key={p.name} style={styles.productRow}>
                  <View style={styles.productInfo}>
                    <Text style={styles.productName}>{p.name}</Text>
                    <Text style={styles.productMeta}>{p.pass}/{p.total} passed</Text>
                  </View>
                  <View style={styles.productBarWrap}>
                    <View style={styles.productBarTrack}>
                      <View style={[styles.productBarFill, {width: `${p.pct}%`, backgroundColor: p.pct >= 90 ? '#16a34a' : p.pct >= 75 ? '#ca8a04' : '#dc2626'}]} />
                    </View>
                    <Text style={[styles.productPct, {color: p.pct >= 90 ? '#16a34a' : p.pct >= 75 ? '#ca8a04' : '#dc2626'}]}>{p.pct}%</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={[styles.card, {marginBottom: SPACING.xxl}]}>
            <Text style={styles.cardTitle}>Machine Utilization</Text>
            <Text style={styles.cardSub}>Weighings per machine</Text>
            {machineStats.length === 0 ? (
              <Text style={styles.emptyTxt}>No data available</Text>
            ) : (
              machineStats.map((m, idx) => {
                const color = MACHINE_COLORS[idx % MACHINE_COLORS.length];
                return (
                  <View key={m.id} style={styles.machineRow}>
                    <View style={[styles.machineIcon, {backgroundColor: color + '18'}]}>
                      <Icon name="precision-manufacturing" size={18} color={color} />
                    </View>
                    <View style={styles.machineInfo}>
                      <Text style={styles.machineId}>{m.id}</Text>
                      <Text style={styles.machineName}>{m.name}</Text>
                    </View>
                    <View style={[styles.countBadge, {backgroundColor: color + '18'}]}>
                      <Text style={[styles.countTxt, {color}]}>{m.count}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:            {flex: 1, backgroundColor: COLORS.bg},
  header:          {paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.border},
  headerTitle:     {fontSize: 20, fontWeight: '700', color: COLORS.text},
  headerSub:       {fontSize: 12, color: COLORS.muted, marginTop: 2},
  loadingWrap:     {flex: 1, alignItems: 'center', justifyContent: 'center'},
  scroll:          {padding: SPACING.lg, gap: SPACING.md},
  cardGrid:        {flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm},
  statCard:        {width: '47.5%', backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card},
  statIconCircle:  {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm},
  statValue:       {fontSize: 24, fontWeight: '800', marginBottom: 2},
  statLabel:       {fontSize: 11, color: COLORS.muted, fontWeight: '600'},
  card:            {backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card},
  cardTitle:       {fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 2},
  cardSub:         {fontSize: 12, color: COLORS.muted, marginBottom: SPACING.lg},
  emptyTxt:        {fontSize: 13, color: COLORS.muted, textAlign: 'center', paddingVertical: SPACING.md},
  productRow:      {marginBottom: SPACING.md},
  productInfo:     {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6},
  productName:     {fontSize: 13, fontWeight: '600', color: COLORS.text, flex: 1},
  productMeta:     {fontSize: 11, color: COLORS.muted},
  productBarWrap:  {flexDirection: 'row', alignItems: 'center', gap: SPACING.sm},
  productBarTrack: {flex: 1, height: 8, backgroundColor: COLORS.track, borderRadius: 4, overflow: 'hidden'},
  productBarFill:  {height: '100%', borderRadius: 4},
  productPct:      {fontSize: 12, fontWeight: '800', width: 36, textAlign: 'right'},
  machineRow:      {flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.md},
  machineIcon:     {width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center'},
  machineInfo:     {flex: 1},
  machineId:       {fontSize: 13, fontWeight: '700', color: COLORS.text},
  machineName:     {fontSize: 11, color: COLORS.muted},
  countBadge:      {borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 4},
  countTxt:        {fontSize: 14, fontWeight: '800'},
});
