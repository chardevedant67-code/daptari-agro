import React, {useState, useCallback} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useSelector, useDispatch} from 'react-redux';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import NotificationPanel from '../ui/components/NotificationPanel';

import {fetchSessions} from '../services/api';
import {logoutThunk} from '../store/slices/userSlice';

export default function DashboardScreen() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const user = useSelector(s => s.user.user);
  const token = useSelector(s => s.user.token);
  const notifications = useSelector(s => s.notifications.list);
  const unreadCount = notifications.filter(n => !n.read).length;
  const [stats, setStats] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notifVisible, setNotifVisible] = useState(false);

  // Real current-system data only (SeedBatch → SeedPacket → WeightSession).
  // "Recent Records" shows the last 5 completed (linked) measurements;
  // "Total Measurements" is the server's own count for that same filter
  // (`pagination.total`), so it stays accurate regardless of how many rows
  // were actually fetched. "Active Sessions" replaces the old legacy
  // Pass-Rate card, which has no equivalent in WeightSession — rather than
  // invent a fake rate, this shows a different, real, currently-meaningful
  // number instead.
  const loadData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [linked, active] = await Promise.all([
        fetchSessions({status: 'linked', limit: 5}, token),
        fetchSessions({status: 'active', limit: 1}, token),
      ]);
      setRecords(linked.sessions || []);
      setStats({
        totalMeasurements: linked.pagination?.total ?? (linked.sessions || []).length,
        activeSessions: active.pagination?.total ?? 0,
      });
    } catch (err) {
      setError(err.message || 'Could not load dashboard data');
      setRecords([]);
      setStats(null);
    }
    setLoading(false);
  }, [token]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const statCards = [
    {icon: 'scale', label: 'Total Measurements', value: stats?.totalMeasurements ?? '—', color: COLORS.primary},
    {icon: 'pending-actions', label: 'Active Sessions', value: stats?.activeSessions ?? '—', color: '#ca8a04'},
  ];

  const displayName = user?.name || 'Operator';

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerAvatar}>
          <Icon name="account-circle" size={28} color={COLORS.primary} />
        </View>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Dashboard</Text>
          <Text style={styles.headerSub}>System Online</Text>
        </View>
        <Pressable style={styles.bellBtn} onPress={() => setNotifVisible(true)}>
          <Icon name="notifications" size={22} color={COLORS.primary} />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeTxt}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <NotificationPanel visible={notifVisible} onClose={() => setNotifVisible(false)} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Welcome Card */}
        <View style={styles.welcomeCard}>
          <View style={styles.avatarCircle}>
            <Icon name="account-circle" size={42} color={COLORS.primary} />
          </View>
          <View style={styles.welcomeInfo}>
            <Text style={styles.welcomeLabel}>WELCOME BACK</Text>
            <Text style={styles.welcomeName}>{displayName}</Text>
            <View style={styles.onlineRow}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineTxt}>Connected to server</Text>
            </View>
          </View>
        </View>

        {/* Stat cards */}
        {loading ? (
          <ActivityIndicator color={COLORS.primary} size="large" />
        ) : (
          <View style={styles.statRow}>
            {statCards.map(s => (
              <View key={s.label} style={styles.statCard}>
                <Icon name={s.icon} size={26} color={s.color} />
                <Text style={[styles.statValue, {color: s.color}]}>{String(s.value)}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Two scan action buttons */}
        <View style={styles.scanRow}>
          <Pressable
            style={({pressed}) => [styles.scanCard, pressed && {opacity: 0.88}]}
            onPress={() => navigation.push('Scanner')}>
            <View style={[styles.scanIconCircle, {backgroundColor: COLORS.primary}]}>
              <Icon name="qr-code-scanner" size={28} color={COLORS.white} />
            </View>
            <Text style={styles.scanCardTitle}>Product Info</Text>
            <Text style={styles.scanCardMeta}>Scan QR to view product details</Text>
          </Pressable>
          <Pressable
            style={({pressed}) => [styles.scanCard, styles.scanCardAlt, pressed && {opacity: 0.88}]}
            onPress={() => navigation.push('WeighScan')}>
            <View style={[styles.scanIconCircle, {backgroundColor: '#0ea76a'}]}>
              <Icon name="scale" size={28} color={COLORS.white} />
            </View>
            <Text style={styles.scanCardTitle}>Weigh & Record</Text>
            <Text style={styles.scanCardMeta}>Photo + QR scan + weight capture</Text>
          </Pressable>
        </View>

        {/* Error state — a failed request never falls back to fake/local data */}
        {!loading && !!error && (
          <View style={styles.emptyBox}>
            <Icon name="error-outline" size={36} color={COLORS.danger} />
            <Text style={[styles.emptyTxt, {color: COLORS.danger}]}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={loadData}>
              <Icon name="refresh" size={16} color={COLORS.white} />
              <Text style={styles.retryTxt}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* Recent records preview — real completed (linked) WeightSessions */}
        {!loading && !error && records.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Recent Records</Text>
            {records.map((s, i) => {
              const m = s.measurement;
              const diff = m.difference;
              const isLoss = diff != null && diff < 0;
              return (
                <View key={m.sessionId || i} style={styles.recentCard}>
                  <View style={[styles.recentIcon, {backgroundColor: isLoss ? '#fef9c3' : COLORS.track}]}>
                    <Icon name="inventory" size={18} color={isLoss ? '#ca8a04' : COLORS.primary} />
                  </View>
                  <View style={styles.recentInfo}>
                    <Text style={styles.recentName}>{s.batch?.seedType || 'Seed Packet'}</Text>
                    <Text style={styles.recentMeta}>{m.packetUniqueId || s.packet?.uniqueId || '—'}</Text>
                  </View>
                  <Text style={[styles.recentWeight, {color: isLoss ? '#ca8a04' : COLORS.primary}]}>
                    {diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} kg` : '—'}
                  </Text>
                </View>
              );
            })}
          </>
        )}

        {/* Empty state when no records */}
        {!loading && !error && records.length === 0 && (
          <View style={styles.emptyBox}>
            <Icon name="history" size={36} color={COLORS.muted} />
            <Text style={styles.emptyTxt}>No records yet</Text>
          </View>
        )}

        {/* Quick-access grid */}
        <View style={styles.grid}>
          <Pressable style={styles.gridCard} onPress={() => navigation.navigate('MainTabs', {initialTab: 'history'})}>
            <View style={[styles.gridIcon, {backgroundColor: COLORS.track}]}>
              <Icon name="history" size={24} color={COLORS.primary} />
            </View>
            <Text style={styles.gridTitle}>View History</Text>
            <Text style={styles.gridMeta}>Past records</Text>
          </Pressable>
          <Pressable style={styles.gridCard} onPress={() => navigation.push('Scanner')}>
            <View style={[styles.gridIcon, {backgroundColor: 'rgba(79,70,229,0.10)'}]}>
              <Icon name="qr-code-scanner" size={24} color="#4f46e5" />
            </View>
            <Text style={styles.gridTitle}>New Scan</Text>
            <Text style={styles.gridMeta}>Scan product QR</Text>
          </Pressable>
        </View>

        {/* Sign Out — must clear the Redux/AsyncStorage auth state via the
            existing logoutThunk, not just navigate away, or the JWT stays
            valid and a relaunch silently restores this session. */}
        <Pressable
          style={styles.signOutBtn}
          onPress={async () => {
            await dispatch(logoutThunk());
            navigation.replace('Login');
          }}>
          <Icon name="logout" size={18} color={COLORS.danger} />
          <Text style={styles.signOutTxt}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.bg},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.border},
  headerAvatar: {width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.track, alignItems: 'center', justifyContent: 'center'},
  headerCenter: {flex: 1, alignItems: 'center'},
  headerTitle: {fontSize: 16, fontWeight: '700', color: COLORS.text},
  headerSub: {fontSize: 11, color: COLORS.success || '#16a34a', fontWeight: '600'},
  bellBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.track, alignItems: 'center', justifyContent: 'center'},
  badge: {position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: COLORS.white},
  badgeTxt: {fontSize: 10, fontWeight: '800', color: COLORS.white},
  scrollContent: {padding: SPACING.lg, gap: SPACING.md},
  welcomeCard: {flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.md, ...SHADOWS.card},
  avatarCircle: {width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.track, alignItems: 'center', justifyContent: 'center'},
  welcomeInfo: {flex: 1},
  welcomeLabel: {fontSize: 10, fontWeight: '700', color: COLORS.muted, letterSpacing: 1, marginBottom: 2},
  welcomeName: {fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 4},
  onlineRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  onlineDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success || '#16a34a'},
  onlineTxt: {fontSize: 12, color: COLORS.muted, fontWeight: '500'},
  statRow: {flexDirection: 'row', gap: SPACING.md},
  statCard: {flex: 1, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card},
  statValue: {fontSize: 22, fontWeight: '700'},
  statLabel: {fontSize: 11, color: COLORS.muted, fontWeight: '600', textAlign: 'center'},
  scanRow: {flexDirection: 'row', gap: SPACING.md},
  scanCard: {flex: 1, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, alignItems: 'flex-start', gap: 6, ...SHADOWS.card},
  scanCardAlt: {borderColor: '#bbf7d0'},
  scanIconCircle: {width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 4},
  scanCardTitle: {fontSize: 14, fontWeight: '700', color: COLORS.text},
  scanCardMeta: {fontSize: 11, color: COLORS.muted},
  sectionTitle: {fontSize: 14, fontWeight: '700', color: COLORS.text},
  recentCard: {flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.md, ...SHADOWS.card},
  recentIcon: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  recentInfo: {flex: 1},
  recentName: {fontSize: 13, fontWeight: '700', color: COLORS.text},
  recentMeta: {fontSize: 11, color: COLORS.muted},
  recentWeight: {fontSize: 14, fontWeight: '800'},
  emptyBox: {alignItems: 'center', paddingVertical: SPACING.lg, gap: SPACING.sm},
  emptyTxt: {fontSize: 14, color: COLORS.muted, fontWeight: '600', textAlign: 'center'},
  retryBtn: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 9, marginTop: 2},
  retryTxt: {color: COLORS.white, fontWeight: '700', fontSize: 13},
  grid: {flexDirection: 'row', gap: SPACING.md},
  gridCard: {flex: 1, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card},
  gridIcon: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm},
  gridTitle: {fontSize: 14, fontWeight: '700', color: COLORS.text, marginBottom: 2},
  gridMeta: {fontSize: 11, color: COLORS.muted},
  signOutBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.danger},
  signOutTxt: {color: COLORS.danger, fontWeight: '700', fontSize: 15},
});
