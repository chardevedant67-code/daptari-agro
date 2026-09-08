import React, {useEffect, useRef, useState, useCallback} from 'react';
import {Animated, StyleSheet, Text, View, TextInput, Modal, Pressable, ScrollView} from 'react-native';
import {ProgressBar} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import PrimaryButton from '../ui/components/PrimaryButton';
import {BASE_URL} from '../config';

const RING_SIZE = 140;
const POLL_INTERVAL = 2000;

export default function WeighingScreen({route}) {
  const navigation = useNavigation();
  const product    = route?.params?.product;
  const spin       = useRef(new Animated.Value(0)).current;
  const pulse      = useRef(new Animated.Value(1)).current;
  const pollRef    = useRef(null);

  const [machines, setMachines]           = useState([]);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [showMachinePicker, setShowMachinePicker] = useState(false);
  const [machineError, setMachineError]   = useState(false);
  const [nominalInput, setNominalInput]   = useState(product?.nominalWeight?.toString() || '');
  const [liveWeight, setLiveWeight]       = useState(null);
  const [arduinoStatus, setArduinoStatus] = useState('waiting');
  const [lastUpdated, setLastUpdated]     = useState(null);

  useEffect(() => {
    fetch(`${BASE_URL}/p/api/machines`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.machines.length) {
          setMachines(d.machines);
          setSelectedMachine(d.machines[0]);
          setMachineError(false);
        } else {
          setMachines([]); setSelectedMachine(null); setMachineError(true);
        }
      })
      .catch(() => { setMachines([]); setSelectedMachine(null); setMachineError(true); });
  }, []);

  const pollWeight = useCallback(() => {
    fetch(`${BASE_URL}/p/api/weight/latest`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.weight !== null && d.weight !== undefined) {
          setLiveWeight(d.weight);
          setArduinoStatus('live');
          setLastUpdated(new Date());
        } else {
          setArduinoStatus('waiting');
        }
      })
      .catch(() => setArduinoStatus('stale'));
  }, []);

  useEffect(() => {
    pollWeight();
    pollRef.current = setInterval(pollWeight, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [pollWeight]);

  useEffect(() => {
    Animated.loop(Animated.timing(spin, {toValue: 1, duration: 1200, useNativeDriver: true})).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, {toValue: 0.3, duration: 750, useNativeDriver: true}),
      Animated.timing(pulse, {toValue: 1,   duration: 750, useNativeDriver: true}),
    ])).start();
  }, [spin, pulse]);

  const rotate = spin.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});

  const handleCapture = () => {
    if (!liveWeight || !parseFloat(nominalInput)) return;
    navigation.push('Result', {product, machine: selectedMachine, weight: liveWeight, nominalWeight: parseFloat(nominalInput)});
  };

  const statusConfig = {
    live:    {color: '#10b981', bg: '#dcfce7', label: 'LIVE', icon: 'wifi'},
    waiting: {color: '#f59e0b', bg: '#fef3c7', label: 'WAITING', icon: 'wifi-off'},
    stale:   {color: '#dc2626', bg: '#fee2e2', label: 'NO SIGNAL', icon: 'signal-wifi-off'},
  };
  const sc = statusConfig[arduinoStatus];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <View style={styles.ringWrap}>
        <View style={styles.outerRing} />
        <Animated.View style={[styles.spinRing, {transform: [{rotate}], borderTopColor: sc.color}]} />
        <View style={styles.ringCenter}>
          {liveWeight !== null ? (
            <>
              <Text style={[styles.liveWeightVal, {color: sc.color}]}>{liveWeight.toFixed(2)}</Text>
              <Text style={[styles.liveWeightUnit, {color: sc.color}]}>kg</Text>
            </>
          ) : (
            <>
              <Icon name="scale" size={34} color={COLORS.muted} />
              <Text style={styles.syncingLbl}>WAITING</Text>
            </>
          )}
        </View>
      </View>

      <View style={[styles.statusBadge, {backgroundColor: sc.bg}]}>
        <Icon name={sc.icon} size={14} color={sc.color} />
        <Text style={[styles.statusBadgeTxt, {color: sc.color}]}>
          Arduino {sc.label}
          {lastUpdated ? `  •  ${lastUpdated.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'})}` : ''}
        </Text>
      </View>

      <Text style={styles.headline}>Live Weight Reading</Text>
      <Text style={styles.subline}>{product?.productName || 'Product'} — Arduino se auto-update</Text>

      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Processing Status</Text>
          <View style={[styles.chip, {backgroundColor: sc.bg}]}>
            <Animated.View style={[styles.chipDot, {opacity: pulse, backgroundColor: sc.color}]} />
            <Text style={[styles.chipTxt, {color: sc.color}]}>{sc.label}</Text>
          </View>
        </View>
        <ProgressBar
          progress={arduinoStatus === 'live' ? 1 : arduinoStatus === 'waiting' ? 0.3 : 0.05}
          color={sc.color} style={styles.bar}
        />
        <View style={[styles.weightDisplay, {borderColor: sc.color}]}>
          <Text style={styles.weightDisplayLbl}>Actual Weight from Arduino</Text>
          <Text style={[styles.weightDisplayVal, {color: sc.color}]}>
            {liveWeight !== null ? `${liveWeight.toFixed(3)} kg` : '— waiting for signal —'}
          </Text>
        </View>
        <View style={styles.inputWrap}>
          <Text style={styles.inputLbl}>Nominal Weight (kg)</Text>
          <TextInput
            style={styles.input} placeholder="e.g. 5.00"
            placeholderTextColor={COLORS.muted} keyboardType="numeric"
            value={nominalInput} onChangeText={setNominalInput}
          />
        </View>
      </View>

      {machineError && (
        <View style={styles.errorBox}>
          <Icon name="error-outline" size={18} color="#dc2626" />
          <Text style={styles.errorTxt}>No machines available</Text>
        </View>
      )}

      <PrimaryButton
        title="Capture Weight" onPress={handleCapture} style={styles.captureBtn}
        disabled={liveWeight === null || !nominalInput || machineError || arduinoStatus !== 'live'}
      />

      {arduinoStatus !== 'live' && (
        <Text style={styles.waitingHint}>
          Arduino se weight signal ka wait kar raha hai...{'\n'}Make sure Arduino is on the same network.
        </Text>
      )}

      <Modal visible={showMachinePicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Select Machine</Text>
            {machines.map(m => (
              <Pressable key={m._id} style={styles.machineOption} onPress={() => { setSelectedMachine(m); setShowMachinePicker(false); }}>
                <Text style={styles.machineId}>{m.machineId}</Text>
                <Text style={styles.machineName}>{m.name}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.cancelBtn} onPress={() => setShowMachinePicker(false)}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll:          {flex: 1, backgroundColor: COLORS.bg},
  root:            {padding: SPACING.lg, alignItems: 'center', paddingBottom: SPACING.xl * 2},
  ringWrap:        {width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center', marginVertical: SPACING.lg},
  outerRing:       {position: 'absolute', width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2, borderWidth: 4, borderColor: COLORS.track},
  spinRing:        {position: 'absolute', width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2, borderWidth: 4, borderColor: 'transparent'},
  ringCenter:      {position: 'absolute', alignItems: 'center'},
  liveWeightVal:   {fontSize: 28, fontWeight: '900', letterSpacing: -1},
  liveWeightUnit:  {fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: -2},
  syncingLbl:      {fontSize: 9, fontWeight: '700', color: COLORS.muted, letterSpacing: 1, marginTop: 4},
  statusBadge:     {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: RADIUS.pill, marginBottom: SPACING.sm},
  statusBadgeTxt:  {fontSize: 11, fontWeight: '700'},
  headline:        {fontSize: 20, fontWeight: '700', color: COLORS.text, textAlign: 'center', marginBottom: 4},
  subline:         {fontSize: 12, color: COLORS.muted, textAlign: 'center', marginBottom: SPACING.lg},
  statusCard:      {width: '100%', backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.md, ...SHADOWS.card},
  statusRow:       {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm},
  statusLabel:     {fontSize: 13, fontWeight: '600', color: COLORS.text},
  chip:            {flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4},
  chipDot:         {width: 7, height: 7, borderRadius: 3.5},
  chipTxt:         {fontSize: 11, fontWeight: '700'},
  bar:             {height: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.track, marginBottom: SPACING.md},
  weightDisplay:   {borderWidth: 2, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', marginBottom: SPACING.md},
  weightDisplayLbl:{fontSize: 11, color: COLORS.muted, fontWeight: '600', marginBottom: 4},
  weightDisplayVal:{fontSize: 28, fontWeight: '900', letterSpacing: -1},
  inputWrap:       {width: '100%'},
  inputLbl:        {fontSize: 11, color: COLORS.muted, fontWeight: '600', marginBottom: 4},
  input:           {borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 8, fontSize: 14, fontWeight: '700', color: COLORS.text, backgroundColor: '#f8fafc'},
  errorBox:        {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fee2e2', borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 10, width: '100%', marginBottom: SPACING.sm},
  errorTxt:        {fontSize: 13, fontWeight: '700', color: '#dc2626'},
  captureBtn:      {width: '100%'},
  waitingHint:     {marginTop: SPACING.sm, fontSize: 11, color: COLORS.muted, textAlign: 'center', lineHeight: 18},
  modalOverlay:    {flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end'},
  modalBox:        {backgroundColor: COLORS.white, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SPACING.lg},
  modalTitle:      {fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: SPACING.md},
  machineOption:   {paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border},
  machineId:       {fontSize: 14, fontWeight: '700', color: COLORS.primary},
  machineName:     {fontSize: 12, color: COLORS.muted, marginTop: 2},
  cancelBtn:       {marginTop: SPACING.md, alignItems: 'center', paddingVertical: SPACING.md},
  cancelTxt:       {fontSize: 15, color: COLORS.danger, fontWeight: '700'},
});
