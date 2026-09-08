import React, {useState, useCallback} from 'react';
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet,
  Switch, Text, TextInput, View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useFocusEffect} from '@react-navigation/native';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {useDispatch, useSelector} from 'react-redux';
import {logoutThunk, updateProfileThunk} from '../store/slices/userSlice';
import {toggleNotificationsThunk} from '../store/slices/notificationSlice';
import {getRecords} from '../services/localStore';

import {BASE_URL} from '../config';
import {getBaseUrl, setBaseUrl, autoDiscover, checkServerConnection} from '../services/serverConfig';

const Row = ({icon, label, sub, right, onPress, danger}) => (
  <Pressable
    style={({pressed}) => [styles.row, pressed && {opacity: 0.7}]}
    onPress={onPress}
    disabled={!onPress}>
    <View style={[styles.rowIcon, {backgroundColor: danger ? '#fee2e210' : COLORS.track}]}>
      <Icon name={icon} size={20} color={danger ? '#dc2626' : COLORS.primary} />
    </View>
    <View style={styles.rowInfo}>
      <Text style={[styles.rowLabel, danger && {color: '#dc2626'}]}>{label}</Text>
      {!!sub && <Text style={styles.rowSub}>{sub}</Text>}
    </View>
    {right}
  </Pressable>
);

export default function SettingsScreen() {
  const navigation  = useNavigation();
  const dispatch    = useDispatch();
  const {user, token} = useSelector(s => s.user);
  const notificationsEnabled = useSelector(s => s.notifications.enabled);
  const [autoSync, setAutoSync] = useState(true);
  const [vibration, setVibration] = useState(false);
  const [recordCount, setRecordCount] = useState(0);
  const [serverStatus, setServerStatus] = useState('checking');
  const [editModal, setEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [urlModal, setUrlModal] = useState(false);
  const [editUrl, setEditUrl] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(getBaseUrl);

  const refreshServerStatus = useCallback(async (url = getBaseUrl()) => {
    setCurrentUrl(getBaseUrl());
    setServerStatus('checking');
    const online = await checkServerConnection(url);
    setServerStatus(online ? 'online' : 'offline');
    return online;
  }, []);

  useFocusEffect(
    useCallback(() => {
      setRecordCount(getRecords().length);
      refreshServerStatus();
    }, [refreshServerStatus]),
  );

  const openEdit = () => {
    setEditName(user?.name || '');
    setEditEmail(user?.email || '');
    setEditModal(true);
  };

  const saveProfile = async () => {
    if (!editName.trim()) { Alert.alert('Error', 'Name cannot be empty'); return; }
    setSaving(true);
    const result = await dispatch(updateProfileThunk({name: editName.trim(), email: editEmail.trim(), token}));
    setSaving(false);
    setEditModal(false);
    if (updateProfileThunk.fulfilled.match(result)) {
      Alert.alert('Saved', 'Profile updated successfully');
    } else {
      Alert.alert('Error', result.payload || 'Failed to update');
    }
  };

  const handleClearRecords = () => {
    Alert.alert(
      'Clear Local Records',
      `This will delete ${recordCount} locally saved records. This cannot be undone.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear', style: 'destructive',
          onPress: () => {
            // Clear records from store
            getRecords().splice(0);
            setRecordCount(0);
            Alert.alert('Cleared', 'All local records have been removed.');
          },
        },
      ],
    );
  };

  const openUrlModal = () => {
    setEditUrl(getBaseUrl());
    setUrlModal(true);
  };

  const saveUrl = async () => {
    const url = editUrl.trim().replace(/\/$/, '');
    if (!url.startsWith('http')) {
      Alert.alert('Invalid URL', 'URL must start with http:// or https://');
      return;
    }
    await setBaseUrl(url);
    setCurrentUrl(url);
    setUrlModal(false);
    const online = await refreshServerStatus(url);
    if (online) {
      Alert.alert('Connected', 'Server is reachable!');
    } else {
      Alert.alert('Saved', 'URL saved. Server not reachable right now.');
    }
  };

  const handleAutoDiscover = async () => {
    setDiscovering(true);
    setUrlModal(false);
    const found = await autoDiscover([editUrl.trim()]);
    setDiscovering(false);
    if (found) {
      setCurrentUrl(found);
      setEditUrl(found);
      setServerStatus('online');
      Alert.alert('Found!', `Server found at:\n${found}`);
    } else {
      setServerStatus('offline');
      Alert.alert('Not Found', 'Could not find server automatically.\nEnter the URL manually.');
      setUrlModal(true);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => { await dispatch(logoutThunk()); navigation.replace('Login'); },
      },
    ]);
  };

  const displayName  = user?.name  || 'Operator';
  const displayEmail = user?.email || '';
  const displayRole  = user?.role  || 'Operator';

  const statusColor = serverStatus === 'online' ? '#16a34a' : serverStatus === 'offline' ? '#dc2626' : '#ca8a04';
  const statusBg    = serverStatus === 'online' ? '#dcfce7' : serverStatus === 'offline' ? '#fee2e2' : '#fef9c3';
  const statusLabel = serverStatus === 'online' ? 'Online' : serverStatus === 'offline' ? 'Offline' : '...';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Profile card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>
              {displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profileEmail}>{displayEmail}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleTxt}>{displayRole.toUpperCase()}</Text>
            </View>
          </View>
          <Pressable style={styles.editBtn} onPress={openEdit}>
            <Icon name="edit" size={16} color={COLORS.primary} />
            <Text style={styles.editTxt}>Edit</Text>
          </Pressable>
        </View>

        {/* App preferences */}
        <Text style={styles.sectionLabel}>APP PREFERENCES</Text>
        <View style={styles.group}>
          <Row
            icon="notifications"
            label="Notifications"
            sub={notificationsEnabled ? 'Alert on weighing results' : 'Notifications disabled'}
            right={
              <Switch
                value={notificationsEnabled}
                onValueChange={v => { dispatch(toggleNotificationsThunk(v)); }}
                trackColor={{true: COLORS.primary}}
                thumbColor={COLORS.white}
              />
            }
          />
          <View style={styles.divider} />
          <Row
            icon="sync"
            label="Auto Sync"
            sub={autoSync ? 'Syncing when server available' : 'Manual sync only'}
            right={
              <Switch
                value={autoSync}
                onValueChange={setAutoSync}
                trackColor={{true: COLORS.primary}}
                thumbColor={COLORS.white}
              />
            }
          />
          <View style={styles.divider} />
          <Row
            icon="vibration"
            label="Vibration"
            sub="Haptic feedback on scan"
            right={
              <Switch
                value={vibration}
                onValueChange={setVibration}
                trackColor={{true: COLORS.primary}}
                thumbColor={COLORS.white}
              />
            }
          />
        </View>

        {/* Device & connection */}
        <Text style={styles.sectionLabel}>DEVICE & CONNECTION</Text>
        <View style={styles.group}>
          <Row
            icon="wifi"
            label="Server Connection"
            sub={currentUrl}
            onPress={async () => {
              const online = await refreshServerStatus();
              Alert.alert(online ? 'Connected' : 'Offline', online ? 'Server is reachable!' : 'Cannot reach server.');
            }}
            right={
              <View style={styles.connRight}>
                <View style={[styles.statusBadge, {backgroundColor: statusBg}]}>
                  <Text style={[styles.statusTxt, {color: statusColor}]}>
                    {discovering ? '...' : statusLabel}
                  </Text>
                </View>
                <Pressable style={styles.editBtn} onPress={openUrlModal}>
                  <Icon name="edit" size={14} color={COLORS.primary} />
                  <Text style={styles.editTxt}>Edit</Text>
                </Pressable>
              </View>
            }
          />
          <View style={styles.divider} />
          <Row
            icon="qr-code-scanner"
            label="Scanner Mode"
            sub={serverStatus === 'online' ? 'Live — scanning real products' : 'Offline — connect server to scan'}
            onPress={() =>
              Alert.alert(
                'Scanner Mode',
                serverStatus === 'online'
                  ? 'Live Mode\n\nConnected to server. Scanning QR codes will fetch real product data.'
                  : 'Offline Mode\n\nServer not reachable. Check your server connection above.',
                [{text: 'OK'}],
              )
            }
            right={
              serverStatus === 'online'
                ? <View style={[styles.statusBadge, {backgroundColor: '#dcfce7'}]}>
                    <Text style={[styles.statusTxt, {color: '#16a34a'}]}>Live</Text>
                  </View>
                : serverStatus === 'offline'
                ? <View style={[styles.statusBadge, {backgroundColor: '#fee2e2'}]}>
                    <Text style={[styles.statusTxt, {color: '#dc2626'}]}>Offline</Text>
                  </View>
                : <View style={[styles.statusBadge, {backgroundColor: '#fef9c3'}]}>
                    <Text style={[styles.statusTxt, {color: '#ca8a04'}]}>...</Text>
                  </View>
            }
          />
          <View style={styles.divider} />
          <Row
            icon="storage"
            label="Local Storage"
            sub={`${recordCount} record${recordCount !== 1 ? 's' : ''} saved on device`}
            onPress={recordCount > 0 ? handleClearRecords : undefined}
            right={
              recordCount > 0
                ? <View style={[styles.statusBadge, {backgroundColor: 'rgba(26,34,127,0.08)'}]}>
                    <Text style={[styles.statusTxt, {color: COLORS.primary}]}>{recordCount}</Text>
                  </View>
                : <Icon name="check-circle" size={18} color="#16a34a" />
            }
          />
        </View>

        {/* About */}
        <Text style={styles.sectionLabel}>ABOUT</Text>
        <View style={styles.group}>
          <Row
            icon="info"
            label="App Version"
            sub="Automated Weighing & QR Tracking"
            right={<Text style={styles.versionTxt}>v1.0.0</Text>}
          />
          <View style={styles.divider} />
          <Row
            icon="business"
            label="Organization"
            sub="Industrial Management Systems"
            onPress={() =>
              Alert.alert(
                'Induscore',
                'Industrial Management Systems\n\nAutomated Weighing & QR Tracking Platform\nVersion 1.0.0\n\n© 2026 Induscore. All rights reserved.',
                [{text: 'Close'}],
              )
            }
            right={<Icon name="chevron-right" size={20} color={COLORS.muted} />}
          />
        </View>

        {/* Account */}
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.group}>
          <Row
            icon="logout"
            label="Sign Out"
            danger
            onPress={handleSignOut}
            right={<Icon name="chevron-right" size={20} color="#dc2626" />}
          />
        </View>

        <View style={{height: 32}} />
      </ScrollView>

      {/* Server URL Modal */}
      <Modal visible={urlModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Server URL</Text>
              <Pressable onPress={() => setUrlModal(false)}>
                <Icon name="close" size={22} color={COLORS.muted} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Server Address</Text>
            <TextInput
              style={styles.input}
              value={editUrl}
              onChangeText={setEditUrl}
              placeholder="http://192.168.1.x:5000"
              placeholderTextColor={COLORS.muted}
              autoCapitalize="none"
              keyboardType="url"
              autoCorrect={false}
            />
            <Text style={styles.urlHint}>
              Physical phone: use your PC/server WiFi IPv4, not your phone's IPv4 (run ipconfig on PC){'\n'}
              Emulator: use http://10.0.2.2:5000
            </Text>

            <Pressable style={styles.saveBtn} onPress={saveUrl}>
              <Icon name="save" size={18} color={COLORS.white} />
              <Text style={styles.saveBtnTxt}>Save & Test</Text>
            </Pressable>

            <Pressable style={styles.discoverBtn} onPress={handleAutoDiscover}>
              <Icon name="search" size={18} color={COLORS.primary} />
              <Text style={styles.discoverTxt}>Auto Discover</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal visible={editModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <Pressable onPress={() => setEditModal(false)}>
                <Icon name="close" size={22} color={COLORS.muted} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholder="Your name"
              placeholderTextColor={COLORS.muted}
            />

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.input}
              value={editEmail}
              onChangeText={setEditEmail}
              placeholder="your@email.com"
              placeholderTextColor={COLORS.muted}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Pressable
              style={[styles.saveBtn, saving && {opacity: 0.6}]}
              onPress={saveProfile}
              disabled={saving}>
              <Icon name="save" size={18} color={COLORS.white} />
              <Text style={styles.saveBtnTxt}>{saving ? 'Saving...' : 'Save Profile'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  scroll: {padding: SPACING.lg, gap: SPACING.sm},
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card,
    marginBottom: SPACING.sm,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  avatarTxt: {fontSize: 18, fontWeight: '800', color: COLORS.white},
  profileInfo: {flex: 1},
  profileName: {fontSize: 16, fontWeight: '700', color: COLORS.text},
  profileEmail: {fontSize: 12, color: COLORS.muted, marginBottom: 5},
  roleBadge: {alignSelf: 'flex-start', backgroundColor: COLORS.track, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 3},
  roleTxt: {fontSize: 10, fontWeight: '800', color: COLORS.primary, letterSpacing: 1},
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.track, borderRadius: RADIUS.pill,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  editTxt: {fontSize: 12, fontWeight: '700', color: COLORS.primary},
  sectionLabel: {fontSize: 11, fontWeight: '700', color: COLORS.muted, letterSpacing: 1, marginTop: SPACING.sm, marginBottom: 4, marginLeft: 4},
  group: {backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', ...SHADOWS.card},
  divider: {height: 1, backgroundColor: COLORS.border, marginLeft: 56 + SPACING.md * 2},
  row: {flexDirection: 'row', alignItems: 'center', padding: SPACING.md, gap: SPACING.md},
  rowIcon: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  rowInfo: {flex: 1},
  rowLabel: {fontSize: 14, fontWeight: '600', color: COLORS.text},
  rowSub: {fontSize: 12, color: COLORS.muted, marginTop: 1},
  statusBadge: {borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 3},
  statusTxt: {fontSize: 11, fontWeight: '700'},
  connRight: {flexDirection: 'row', alignItems: 'center', gap: SPACING.xs},
  versionTxt: {fontSize: 13, fontWeight: '700', color: COLORS.muted},
  urlHint: {fontSize: 11, color: COLORS.muted, marginTop: SPACING.sm, lineHeight: 18},
  discoverBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: COLORS.track, borderRadius: RADIUS.md,
    height: 48, marginTop: SPACING.sm,
  },
  discoverTxt: {color: COLORS.primary, fontWeight: '700', fontSize: 14},
  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: SPACING.lg, paddingBottom: 36,
  },
  modalHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg},
  modalTitle: {fontSize: 17, fontWeight: '800', color: COLORS.text},
  fieldLabel: {fontSize: 12, fontWeight: '600', color: COLORS.muted, marginBottom: 6, marginTop: SPACING.md},
  input: {
    height: 48, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, fontSize: 14, color: COLORS.text,
    backgroundColor: COLORS.bg,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    height: 52, marginTop: SPACING.xl,
  },
  saveBtnTxt: {color: COLORS.white, fontSize: 15, fontWeight: '700'},
});
