import React, {useState} from 'react';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useDispatch} from 'react-redux';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import PrimaryButton from '../ui/components/PrimaryButton';
import {addRecord} from '../services/localStore';
import {addNotification} from '../store/slices/notificationSlice';
import {BASE_URL} from '../config';

const getStatus = (actual, nominal) => {
  const pct = (Math.abs(actual - nominal) / nominal) * 100;
  if (pct <= 2) return 'PASS';
  if (pct <= 5) return 'WARN';
  return 'FAIL';
};

const statusColor = {PASS: COLORS.success || '#16a34a', WARN: '#ca8a04', FAIL: '#dc2626'};
const statusIcon  = {PASS: 'check-circle', WARN: 'warning', FAIL: 'cancel'};
const statusBg    = {PASS: '#dcfce7', WARN: '#fef9c3', FAIL: '#fee2e2'};

export default function ResultScreen({route}) {
  const navigation = useNavigation();
  const dispatch   = useDispatch();
  const {product, machine, weight = 0, nominalWeight = 0} = route?.params || {};
  const status = getStatus(weight, nominalWeight);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const handleConfirm = async () => {
    setSaving(true); setError('');
    let savedToServer = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${BASE_URL}/api/records`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({productId: product?._id, machineId: machine?._id || machine?.machineId, actualWeight: weight, nominalWeight, unit: 'kg'}),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      if (data.success) savedToServer = true;
    } catch (_) {}

    if (!savedToServer) addRecord({status, actualWeight: weight, nominalWeight, product, machine});

    setSaving(false);
    const statusLabels = {PASS: 'Within tolerance', WARN: 'Slight deviation', FAIL: 'Out of tolerance'};
    dispatch(addNotification({
      type: status,
      title: `Weighing ${status} — ${product?.productName || 'Unknown Product'}`,
      body: `${weight.toFixed(2)} kg  •  Nominal: ${nominalWeight.toFixed(2)} kg  •  ${statusLabels[status]}`,
    }));
    navigation.navigate('MainTabs', {initialTab: 'history'});
  };

  const DETAILS = [
    {icon: 'inventory',              label: 'PRODUCT',     value: product?.productName || '—', sub: product?.batchNumber ? `Batch: ${product.batchNumber}` : ''},
    {icon: 'precision-manufacturing', label: 'MACHINE',    value: machine?.machineId || '—',   sub: machine?.name || ''},
    {icon: 'schedule',               label: 'MEASURED AT', value: new Date().toLocaleTimeString(), sub: new Date().toLocaleDateString()},
  ];

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[styles.heroCircle, {backgroundColor: statusBg[status]}]}>
            <Icon name={statusIcon[status]} size={48} color={statusColor[status]} />
          </View>
          <Text style={styles.readingLabel}>CURRENT READING</Text>
          <View style={styles.readingRow}>
            <Text style={[styles.weightVal, {color: statusColor[status]}]}>{weight.toFixed(2)}</Text>
            <Text style={styles.weightUnit}>kg</Text>
          </View>
          <View style={[styles.stableChip, {backgroundColor: statusBg[status]}]}>
            <Icon name={statusIcon[status]} size={14} color={statusColor[status]} />
            <Text style={[styles.stableTxt, {color: statusColor[status]}]}>
              {status === 'PASS' ? 'Within tolerance' : status === 'WARN' ? 'Slight deviation' : 'Out of tolerance'}
            </Text>
          </View>
          <Text style={styles.nominalTxt}>Nominal: {nominalWeight.toFixed(2)} kg</Text>
        </View>

        <Text style={styles.sectionLbl}>DETAILS</Text>
        {DETAILS.map(d => (
          <View key={d.label} style={styles.detailCard}>
            <View style={styles.detailIcon}><Icon name={d.icon} size={22} color={COLORS.primary} /></View>
            <View style={styles.detailText}>
              <Text style={styles.detailLbl}>{d.label}</Text>
              <Text style={styles.detailVal}>{d.value}</Text>
              {Boolean(d.sub) && <Text style={styles.detailSub}>{d.sub}</Text>}
            </View>
          </View>
        ))}

        {Boolean(error) && (
          <View style={styles.errorBox}>
            <Icon name="error" size={16} color="#dc2626" />
            <Text style={styles.errorTxt}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.actions}>
        {saving ? (
          <ActivityIndicator color={COLORS.primary} size="large" />
        ) : (
          <>
            <PrimaryButton title="Confirm & Save" onPress={handleConfirm} style={styles.confirmBtn} />
            <Pressable style={styles.reweighBtn} onPress={() => navigation.pop()}>
              <Icon name="refresh" size={18} color={COLORS.muted} />
              <Text style={styles.reweighTxt}>Re-weigh</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         {flex: 1, backgroundColor: COLORS.bg},
  scroll:       {paddingHorizontal: SPACING.lg, paddingBottom: 16},
  hero:         {alignItems: 'center', paddingVertical: SPACING.xl},
  heroCircle:   {width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md},
  readingLabel: {fontSize: 11, fontWeight: '700', color: COLORS.primary, letterSpacing: 1.5, marginBottom: 6},
  readingRow:   {flexDirection: 'row', alignItems: 'flex-end', gap: 4},
  weightVal:    {fontSize: 56, fontWeight: '700', letterSpacing: -1},
  weightUnit:   {fontSize: 22, fontWeight: '600', color: COLORS.muted, marginBottom: 10},
  stableChip:   {flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.pill, paddingHorizontal: SPACING.md, paddingVertical: 5, marginTop: SPACING.sm},
  stableTxt:    {fontSize: 12, fontWeight: '700'},
  nominalTxt:   {fontSize: 13, color: COLORS.muted, marginTop: 6},
  sectionLbl:   {fontSize: 11, fontWeight: '700', color: COLORS.muted, letterSpacing: 1, marginBottom: SPACING.sm},
  detailCard:   {flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.md, marginBottom: SPACING.sm, ...SHADOWS.card},
  detailIcon:   {width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.track, alignItems: 'center', justifyContent: 'center'},
  detailText:   {flex: 1},
  detailLbl:    {fontSize: 11, color: COLORS.muted, fontWeight: '600', marginBottom: 2},
  detailVal:    {fontSize: 14, fontWeight: '600', color: COLORS.text},
  detailSub:    {fontSize: 11, color: COLORS.muted, marginTop: 1},
  errorBox:     {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fee2e2', borderRadius: RADIUS.md, padding: SPACING.md, marginTop: SPACING.sm},
  errorTxt:     {fontSize: 13, color: '#dc2626', flex: 1},
  actions:      {padding: SPACING.lg, gap: SPACING.md, backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.border},
  confirmBtn:   {width: '100%'},
  reweighBtn:   {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, backgroundColor: '#f1f5f9', borderRadius: RADIUS.md},
  reweighTxt:   {color: COLORS.muted, fontWeight: '700', fontSize: 15},
});
