import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button, TextInput as PaperInput} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useDispatch} from 'react-redux';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {registerThunk} from '../store/slices/userSlice';
import {ensureReachableBaseUrl, checkServerConnection} from '../services/serverConfig';

export default function RegisterScreen() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const [form, setForm] = useState({name: '', email: '', password: '', confirm: ''});
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverStatus, setServerStatus] = useState('checking'); // 'checking' | 'found' | 'not-found'

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = await ensureReachableBaseUrl();
      const reachable = url ? await checkServerConnection(url) : false;
      if (cancelled) return;
      setServerStatus(reachable ? 'found' : 'not-found');
    })();
    return () => { cancelled = true; };
  }, []);

  const set = key => val => setForm(p => ({...p, [key]: val}));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Full name is required';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Invalid email address';
    if (!form.password) e.password = 'Password is required';
    else if (form.password.length < 6) e.password = 'Minimum 6 characters';
    if (form.password !== form.confirm) e.confirm = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setServerError('');
    setLoading(true);

    const result = await dispatch(registerThunk({
      name: form.name,
      email: form.email,
      password: form.password,
    }));

    setLoading(false);

    if (registerThunk.fulfilled.match(result)) {
      setSuccess(true);
      setTimeout(() => navigation.replace('Login'), 1500);
      return;
    }

    const err = result.payload || {type: 'network', message: 'Registration failed'};
    setServerError(err.message);
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.topTitle}>Create Account</Text>
        <View style={{width: 38}} />
      </View>

      {/* Hero */}
      <View style={styles.heroWrap}>
        <View style={styles.heroBox}>
          <Icon name="person-add" size={36} color={COLORS.white} />
        </View>
        <Text style={styles.heading}>Join IndusCore</Text>
        <Text style={styles.headingCaption}>
          Create your operator account to get started
        </Text>
      </View>

      {/* Success */}
      {success && (
        <View style={styles.successBox}>
          <Icon name="check-circle" size={20} color="#16a34a" />
          <Text style={styles.successTxt}>Account created! Redirecting to login...</Text>
        </View>
      )}

      {/* Form */}
      {!success && (
        <View style={styles.form}>
          <PaperInput
            mode="outlined"
            label="Full Name"
            value={form.name}
            onChangeText={t => {set('name')(t); setErrors(p => ({...p, name: ''}));}}
            left={<PaperInput.Icon icon="account-outline" />}
            outlineColor={COLORS.border}
            activeOutlineColor={COLORS.primary}
            outlineStyle={{borderRadius: RADIUS.md}}
            error={!!errors.name}
            style={styles.input}
          />
          {!!errors.name && <Text style={styles.errText}>{errors.name}</Text>}

          <PaperInput
            mode="outlined"
            label="Email Address"
            value={form.email}
            onChangeText={t => {set('email')(t); setErrors(p => ({...p, email: ''}));}}
            keyboardType="email-address"
            autoCapitalize="none"
            left={<PaperInput.Icon icon="email-outline" />}
            outlineColor={COLORS.border}
            activeOutlineColor={COLORS.primary}
            outlineStyle={{borderRadius: RADIUS.md}}
            error={!!errors.email}
            style={styles.input}
          />
          {!!errors.email && <Text style={styles.errText}>{errors.email}</Text>}

          <PaperInput
            mode="outlined"
            label="Password"
            value={form.password}
            onChangeText={t => {set('password')(t); setErrors(p => ({...p, password: ''}));}}
            secureTextEntry={!showPw}
            left={<PaperInput.Icon icon="lock-outline" />}
            right={
              <PaperInput.Icon
                icon={showPw ? 'eye-off-outline' : 'eye-outline'}
                onPress={() => setShowPw(p => !p)}
              />
            }
            outlineColor={COLORS.border}
            activeOutlineColor={COLORS.primary}
            outlineStyle={{borderRadius: RADIUS.md}}
            error={!!errors.password}
            style={styles.input}
          />
          {!!errors.password && <Text style={styles.errText}>{errors.password}</Text>}

          <PaperInput
            mode="outlined"
            label="Confirm Password"
            value={form.confirm}
            onChangeText={t => {set('confirm')(t); setErrors(p => ({...p, confirm: ''}));}}
            secureTextEntry={!showConfirm}
            left={<PaperInput.Icon icon="lock-check-outline" />}
            right={
              <PaperInput.Icon
                icon={showConfirm ? 'eye-off-outline' : 'eye-outline'}
                onPress={() => setShowConfirm(p => !p)}
              />
            }
            outlineColor={COLORS.border}
            activeOutlineColor={COLORS.primary}
            outlineStyle={{borderRadius: RADIUS.md}}
            error={!!errors.confirm}
            style={styles.input}
          />
          {!!errors.confirm && <Text style={styles.errText}>{errors.confirm}</Text>}

          {serverStatus !== 'found' && (
            <View style={[styles.serverErrBox, serverStatus === 'checking' && styles.serverInfoBox]}>
              <Icon
                name={serverStatus === 'checking' ? 'wifi-tethering' : 'wifi-off'}
                size={16}
                color={serverStatus === 'checking' ? COLORS.primary : COLORS.danger}
              />
              <Text style={[styles.serverErrTxt, serverStatus === 'checking' && {color: COLORS.primary}]}>
                {serverStatus === 'checking'
                  ? 'Finding server on local network...'
                  : 'Server not found. Make sure your phone and computer are connected to the same WiFi.'}
              </Text>
            </View>
          )}

          {!!serverError && (
            <View style={styles.serverErrBox}>
              <Icon name="error-outline" size={16} color={COLORS.danger} />
              <Text style={styles.serverErrTxt}>{serverError}</Text>
            </View>
          )}

          <Button
            mode="contained"
            onPress={handleRegister}
            loading={loading}
            disabled={loading}
            icon="account-plus"
            contentStyle={styles.btnContent}
            labelStyle={styles.btnLabel}
            style={styles.btn}
            buttonColor={COLORS.primary}>
            {loading ? 'Creating Account...' : 'Create Account'}
          </Button>

          <View style={styles.loginRow}>
            <Text style={styles.loginCaption}>Already have an account? </Text>
            <Pressable onPress={() => navigation.replace('Login')}>
              <Text style={styles.loginLink}>Sign In</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.bg},
  content: {paddingHorizontal: SPACING.lg, paddingBottom: 40},
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: SPACING.lg, marginBottom: SPACING.xl,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center',
    ...SHADOWS.card,
  },
  topTitle: {flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: COLORS.text},
  heroWrap: {alignItems: 'center', marginBottom: SPACING.xl},
  heroBox: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
    ...SHADOWS.primary, marginBottom: SPACING.md,
  },
  heading: {fontSize: 26, fontWeight: '700', color: COLORS.text, marginBottom: 6},
  headingCaption: {fontSize: 13, color: COLORS.muted, textAlign: 'center', maxWidth: 260},
  successBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#dcfce7', borderRadius: RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.md,
  },
  successTxt: {fontSize: 14, color: '#16a34a', fontWeight: '600', flex: 1},
  form: {},
  input: {marginBottom: SPACING.sm, backgroundColor: COLORS.white},
  errText: {color: COLORS.danger, fontSize: 12, marginTop: -4, marginBottom: SPACING.sm},
  serverErrBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fee2e2', borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: SPACING.md,
  },
  serverErrTxt: {color: COLORS.danger, fontSize: 13, fontWeight: '600', flex: 1},
  serverInfoBox: {backgroundColor: '#e0e7ff'},
  btn: {borderRadius: RADIUS.md, marginTop: SPACING.md},
  btnContent: {height: 52},
  btnLabel: {fontSize: 16, fontWeight: '700', letterSpacing: 0.3},
  loginRow: {flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.lg},
  loginCaption: {fontSize: 13, color: COLORS.muted},
  loginLink: {fontSize: 13, color: COLORS.primary, fontWeight: '700'},
});
