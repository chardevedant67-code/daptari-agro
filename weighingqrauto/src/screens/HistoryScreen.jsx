import React, {useState, useCallback} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';

import {BASE_URL} from '../config';
const TABS = ['All', 'PASS', 'FAIL'];

export default function HistoryScreen() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const fetchRecords = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${BASE_URL}/p/api/records`, {signal: controller.signal});
      clearTimeout(timer);
      const data = await res.json();
      if (data.success) {
        setRecords(data.records || []);
      } else {
        setRecords([]);
      }
    } catch (_) {
      setRecords([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); fetchRecords(); }, [fetchRecords]));

  const onRefresh = () => { setRefreshing(true); fetchRecords(); };

  const filtered = activeTab === 0 ? records : records.filter(r => r.status === TABS[activeTab]);

  const passCount = records.filter(r => r.status === 'PASS').length;
  const passRate = records.length ? Math.round((passCount / records.length) * 100) : 0;

  const renderItem = ({item}) => {
    const isWarn = item.status === 'WARN';
    const isFail = item.status === 'FAIL';
    const iconName = isFail ? 'cancel' : isWarn ? 'warning' : 'inventory';
    const iconColor = isFail ? COLORS.danger : isWarn ? '#ca8a04' : COLORS.primary;
    const iconBg = isFail ? '#fee2e2' : isWarn ? '#fef9c3' : COLORS.track;
    return (
      <View style={styles.record}>
        <View style={[styles.recordIcon, {backgroundColor: iconBg}]}>
          <Icon name={iconName} size={20} color={iconColor} />
        </View>
        <View style={styles.recordInfo}>
          <Text style={styles.recordName}>{item.product?.productName || '—'}</Text>
          <Text style={styles.recordMeta}>{item.machine?.machineId || '—'} · {item.machine?.name || ''}</Text>
        </View>
        <View style={styles.recordRight}>
          <Text style={[styles.recordWeight, {color: iconColor}]}>{item.actualWeight} kg</Text>
          <Text style={styles.recordTime}>{new Date(item.createdAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>History</Text>
        <Pressable style={styles.searchBtn} onPress={onRefresh}>
          <Icon name="refresh" size={22} color={COLORS.primary} />
        </Pressable>
      </View>

      {/* Filter tabs */}
      <View style={styles.tabs}>
        {TABS.map((tab, i) => (
          <Pressable key={tab} style={styles.tab} onPress={() => setActiveTab(i)}>
            <Text style={[styles.tabTxt, activeTab === i && styles.tabTxtActive]}>{tab}</Text>
            {activeTab === i && <View style={styles.tabIndicator} />}
          </Pressable>
        ))}
      </View>

      {/* Summary card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryLeft}>
          <Text style={styles.summaryLbl}>TOTAL RECORDS</Text>
          <Text style={styles.summaryVal}>{records.length.toLocaleString()}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryRight}>
          <Text style={styles.summaryLbl}>PASS RATE</Text>
          <Text style={[styles.summaryVal, {color: passRate >= 80 ? '#86efac' : '#fde68a'}]}>{passRate}%</Text>
        </View>
      </View>

      {/* Records section */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Weight Records</Text>
        <Text style={styles.viewAll}>{filtered.length} entries</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} size="large" style={{marginTop: SPACING.xl}} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, i) => item._id || String(i)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Icon name="history" size={40} color={COLORS.muted} />
              <Text style={styles.emptyTxt}>No records yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.bg},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.border},
  headerTitle: {fontSize: 20, fontWeight: '700', color: COLORS.text},
  searchBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.track, alignItems: 'center', justifyContent: 'center'},
  tabs: {flexDirection: 'row', backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.border},
  tab: {flex: 1, alignItems: 'center', paddingVertical: SPACING.md, position: 'relative'},
  tabTxt: {fontSize: 14, fontWeight: '600', color: COLORS.muted},
  tabTxtActive: {color: COLORS.primary},
  tabIndicator: {position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 3, backgroundColor: COLORS.primary, borderRadius: 2},
  summaryCard: {flexDirection: 'row', marginHorizontal: SPACING.lg, marginVertical: SPACING.md, backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, padding: SPACING.lg, ...SHADOWS.primary},
  summaryLeft: {flex: 1},
  summaryDivider: {width: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: SPACING.md},
  summaryRight: {flex: 1, alignItems: 'flex-end'},
  summaryLbl: {fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.7)', letterSpacing: 1, marginBottom: 4},
  summaryVal: {fontSize: 22, fontWeight: '700', color: COLORS.white},
  sectionRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm},
  sectionTitle: {fontSize: 14, fontWeight: '700', color: COLORS.text},
  viewAll: {fontSize: 13, color: COLORS.primary, fontWeight: '600'},
  list: {paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg, gap: SPACING.sm},
  record: {flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.md, ...SHADOWS.card},
  recordIcon: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'},
  recordInfo: {flex: 1},
  recordName: {fontSize: 14, fontWeight: '700', color: COLORS.text, marginBottom: 2},
  recordMeta: {fontSize: 11, color: COLORS.muted},
  recordRight: {alignItems: 'flex-end'},
  recordWeight: {fontSize: 14, fontWeight: '700'},
  recordTime: {fontSize: 11, color: COLORS.muted, marginTop: 2},
  emptyBox: {alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.md},
  emptyTxt: {fontSize: 15, color: COLORS.muted, fontWeight: '600'},
});
