import React, {useState, useCallback} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useSelector} from 'react-redux';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {fetchSessions} from '../services/api';

// Real current-system analytics only (SeedBatch → SeedPacket → WeightSession).
// GET /api/sessions has server-side pagination, so two requests are made:
//  - an unfiltered `limit=1` call, purely to read `pagination.total` (the
//    true all-time session count, independent of how many rows are fetched)
//  - a `status=linked, limit=200` call, whose `pagination.total` gives the
//    true all-time linked (completed) count, and whose up-to-200 `sessions`
//    array is the real sample used for the average/min/max/breakdown below.
// The sample is clearly labelled as capped when the true total exceeds it,
// so this screen never silently understates an all-time figure.
const SAMPLE_LIMIT = 200;

export default function AnalyticsScreen() {
  const token = useSelector(state => state.user.token);
  const [sessions, setSessions] = useState([]);
  const [totalMeasurements, setTotalMeasurements] = useState(null);
  const [linkedTotal, setLinkedTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAnalytics = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [all, linked] = await Promise.all([
        fetchSessions({limit: 1}, token),
        fetchSessions({status: 'linked', limit: SAMPLE_LIMIT}, token),
      ]);
      setTotalMeasurements(all.pagination?.total ?? 0);
      setLinkedTotal(linked.pagination?.total ?? (linked.sessions || []).length);
      setSessions(linked.sessions || []);
    } catch (err) {
      setError(err.message || 'Could not load analytics data');
      setSessions([]);
      setTotalMeasurements(null);
      setLinkedTotal(null);
    }
    setLoading(false);
  }, [token]);

  useFocusEffect(useCallback(() => { fetchAnalytics(); }, [fetchAnalytics]));

  // Every figure below is derived only from `sessions` (the real fetched
  // sample) or from the server's own `pagination.total` — nothing here is
  // invented when data is missing; a missing metric renders as '—'.
  const diffs = sessions
    .map(s => s.measurement?.difference)
    .filter(d => typeof d === 'number');
  const avgDiff = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
  const minDiff = diffs.length ? Math.min(...diffs) : null;
  const maxDiff = diffs.length ? Math.max(...diffs) : null;
  const sampleCapped = linkedTotal != null && linkedTotal > sessions.length;

  // Recent measurements — the sample is already newest-first from the server.
  const recentSessions = sessions.slice(0, 5);

  // Real breakdown by seed type (the actual SeedBatch.seedType field) —
  // the direct current-system equivalent of the old per-product breakdown.
  const typeMap = {};
  sessions.forEach(s => {
    const name = s.batch?.seedType || 'Unknown';
    if (!typeMap[name]) typeMap[name] = {name, count: 0, diffSum: 0, diffCount: 0};
    typeMap[name].count += 1;
    if (typeof s.measurement?.difference === 'number') {
      typeMap[name].diffSum += s.measurement.difference;
      typeMap[name].diffCount += 1;
    }
  });
  const maxTypeCount = Math.max(1, ...Object.values(typeMap).map(t => t.count));
  const typeStats = Object.values(typeMap)
    .map(t => ({
      ...t,
      avgDiff: t.diffCount ? t.diffSum / t.diffCount : null,
      pct: Math.round((t.count / maxTypeCount) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const statCards = [
    {icon: 'scale', label: 'Total Measurements', value: totalMeasurements != null ? String(totalMeasurements) : '—', color: COLORS.primary},
    {icon: 'check-circle', label: 'Linked (Completed)', value: linkedTotal != null ? String(linkedTotal) : '—', color: '#16a34a'},
    {icon: 'trending-up', label: 'Avg Difference', value: avgDiff != null ? `${avgDiff >= 0 ? '+' : ''}${avgDiff.toFixed(2)} kg` : '—', color: '#6366f1'},
    {icon: 'compare-arrows', label: 'Min / Max Diff', value: (minDiff != null && maxDiff != null) ? `${minDiff.toFixed(2)} / ${maxDiff.toFixed(2)} kg` : '—', color: '#ca8a04'},
  ];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Analytics</Text>
        <Text style={styles.headerSub}>Real-time Overview</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.loadingWrap}>
          <Icon name="error-outline" size={36} color={COLORS.danger} />
          <Text style={[styles.emptyTxt, {color: COLORS.danger, marginTop: SPACING.sm}]}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={fetchAnalytics}>
            <Icon name="refresh" size={16} color={COLORS.white} />
            <Text style={styles.retryTxt}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Stat cards */}
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

          {/* Breakdown by seed type */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Difference by Seed Type</Text>
            <Text style={styles.cardSub}>
              {sampleCapped
                ? `Based on the most recent ${sessions.length} of ${linkedTotal} linked measurements`
                : 'Average weight difference by seed type'}
            </Text>
            {typeStats.length === 0 ? (
              <Text style={styles.emptyTxt}>No measurements yet</Text>
            ) : (
              typeStats.map(t => (
                <View key={t.name} style={styles.productRow}>
                  <View style={styles.productInfo}>
                    <Text style={styles.productName}>{t.name}</Text>
                    <Text style={styles.productMeta}>{t.count} measurement{t.count === 1 ? '' : 's'}</Text>
                  </View>
                  <View style={styles.productBarWrap}>
                    <View style={styles.productBarTrack}>
                      <View style={[styles.productBarFill, {
                        width: `${t.pct}%`,
                        backgroundColor: t.avgDiff == null ? COLORS.muted : t.avgDiff < 0 ? '#dc2626' : '#16a34a',
                      }]} />
                    </View>
                    <Text style={[styles.productPct, {
                      color: t.avgDiff == null ? COLORS.muted : t.avgDiff < 0 ? '#dc2626' : '#16a34a',
                    }]}>{t.avgDiff != null ? `${t.avgDiff >= 0 ? '+' : ''}${t.avgDiff.toFixed(2)}` : '—'}</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Recent measurements */}
          <View style={[styles.card, {marginBottom: SPACING.xxl}]}>
            <Text style={styles.cardTitle}>Recent Measurements</Text>
            <Text style={styles.cardSub}>Latest completed weighings</Text>
            {recentSessions.length === 0 ? (
              <Text style={styles.emptyTxt}>No measurements yet</Text>
            ) : (
              recentSessions.map((s, idx) => {
                const diff = s.measurement?.difference;
                const isLoss = diff != null && diff < 0;
                const color = isLoss ? '#dc2626' : '#16a34a';
                return (
                  <View key={s.measurement?.sessionId || idx} style={styles.machineRow}>
                    <View style={[styles.machineIcon, {backgroundColor: color + '18'}]}>
                      <Icon name="inventory" size={18} color={color} />
                    </View>
                    <View style={styles.machineInfo}>
                      <Text style={styles.machineId}>{s.measurement?.packetUniqueId || s.packet?.uniqueId || '—'}</Text>
                      <Text style={styles.machineName}>{s.batch?.seedType || 'Seed Packet'}</Text>
                    </View>
                    <View style={[styles.countBadge, {backgroundColor: color + '18'}]}>
                      <Text style={[styles.countTxt, {color}]}>{diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} kg` : '—'}</Text>
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
  root: {flex: 1, backgroundColor: COLORS.bg},
  header: {
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md,
    backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerTitle: {fontSize: 20, fontWeight: '700', color: COLORS.text},
  headerSub: {fontSize: 12, color: COLORS.muted, marginTop: 2},
  loadingWrap: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.lg, gap: SPACING.sm},
  retryBtn: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 9, marginTop: 4},
  retryTxt: {color: COLORS.white, fontWeight: '700', fontSize: 13},
  scroll: {padding: SPACING.lg, gap: SPACING.md},
  cardGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm},
  statCard: {
    width: '47.5%', backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card,
  },
  statIconCircle: {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm},
  statValue: {fontSize: 24, fontWeight: '800', marginBottom: 2},
  statLabel: {fontSize: 11, color: COLORS.muted, fontWeight: '600'},
  card: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card,
  },
  cardTitle: {fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 2},
  cardSub: {fontSize: 12, color: COLORS.muted, marginBottom: SPACING.lg},
  emptyTxt: {fontSize: 13, color: COLORS.muted, textAlign: 'center', paddingVertical: SPACING.md},
  productRow: {marginBottom: SPACING.md},
  productInfo: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6},
  productName: {fontSize: 13, fontWeight: '600', color: COLORS.text, flex: 1},
  productMeta: {fontSize: 11, color: COLORS.muted},
  productBarWrap: {flexDirection: 'row', alignItems: 'center', gap: SPACING.sm},
  productBarTrack: {flex: 1, height: 8, backgroundColor: COLORS.track, borderRadius: 4, overflow: 'hidden'},
  productBarFill: {height: '100%', borderRadius: 4},
  productPct: {fontSize: 12, fontWeight: '800', width: 56, textAlign: 'right'},
  machineRow: {flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.md},
  machineIcon: {width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center'},
  machineInfo: {flex: 1},
  machineId: {fontSize: 13, fontWeight: '700', color: COLORS.text, fontFamily: 'monospace'},
  machineName: {fontSize: 11, color: COLORS.muted},
  countBadge: {borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 4},
  countTxt: {fontSize: 12, fontWeight: '800'},
});
