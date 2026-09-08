import React, {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View, Pressable} from 'react-native';
import {Button, TextInput as PaperInput} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {loginThunk, clearError} from '../store/slices/userSlice';

export default function LoginScreen() {
  const navigation = useNavigation();
  const dispatch   = useDispatch();
  const {loading, error} = useSelector(s => s.user);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [emailErr, setEmailErr] = useState('');
  const [pwErr,    setPwErr]    = useState('');

  useEffect(() => {
    dispatch(clearError());
    return () => dispatch(clearError());
  }, [dispatch]);

  const validate = () => {
    let ok = true;
    if (!email.trim()) { setEmailErr('Email is required'); ok = false; }
    else if (!/\S+@\S+\.\S+/.test(email)) { setEmailErr('Enter a valid email'); ok = false; }
    if (!password) { setPwErr('Password is required'); ok = false; }
    else if (password.length < 6) { setPwErr('Minimum 6 characters'); ok = false; }
    return ok;
  };

  const handleSignIn = async () => {
    setEmailErr(''); setPwErr('');
    dispatch(clearError());
    if (!validate()) return;
    const result = await dispatch(loginThunk({email: email.trim(), password}));
    if (loginThunk.fulfilled.match(result)) navigation.replace('MainTabs');
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={() => navigation.replace('Splash')}>
          <Icon name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.topTitle}>Sign In</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.heroWrap}>
        <View style={styles.heroBox}>
          <Icon name="lock-open" size={36} color={COLORS.white} />
        </View>
        <Text style={styles.heading}>Welcome Back</Text>
        <Text style={styles.headingCaption}>Sign in to access the industrial management system</Text>
      </View>

      <View style={styles.form}>
        <PaperInput
          mode="outlined" label="Email Address" value={email}
          onChangeText={t => { setEmail(t); setEmailErr(''); }}
          keyboardType="email-address" autoCapitalize="none"
          left={<PaperInput.Icon icon="email-outline" />}
          outlineColor={emailErr ? COLORS.danger : COLORS.border}
          activeOutlineColor={COLORS.primary}
          outlineStyle={{borderRadius: RADIUS.md}}
          textColor="#111827" style={styles.input}
        />
        {!!emailErr && <Text style={styles.errText}>{emailErr}</Text>}

        <PaperInput
          mode="outlined" label="Password" value={password}
          onChangeText={t => { setPassword(t); setPwErr(''); }}
          secureTextEntry={!showPw}
          left={<PaperInput.Icon icon="lock-outline" />}
          right={<PaperInput.Icon icon={showPw ? 'eye-off-outline' : 'eye-outline'} onPress={() => setShowPw(p => !p)} />}
          outlineColor={pwErr ? COLORS.danger : COLORS.border}
          activeOutlineColor={COLORS.primary}
          outlineStyle={{borderRadius: RADIUS.md}}
          textColor="#111827" style={styles.input}
        />
        {!!pwErr && <Text style={styles.errText}>{pwErr}</Text>}

        {!!error && (
          <View style={styles.serverErrBox}>
            <Icon name="error-outline" size={16} color={COLORS.danger} />
            <Text style={styles.serverErrTxt}>{error}</Text>
          </View>
        )}

        <Button
          mode="contained" onPress={handleSignIn} loading={loading} disabled={loading}
          icon="login" contentStyle={styles.signInContent} labelStyle={styles.signInLabel}
          style={styles.signInBtn} buttonColor={COLORS.primary}>
          {loading ? 'Signing In...' : 'Sign In'}
        </Button>

        <View style={styles.createRow}>
          <Text style={styles.createCaption}>Don't have an account? </Text>
          <Pressable onPress={() => navigation.push('Register')}>
            <Text style={styles.createLink}>Create Account</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:          {flex: 1, backgroundColor: COLORS.bg},
  content:       {paddingHorizontal: SPACING.lg, paddingBottom: 40},
  topBar:        {flexDirection: 'row', alignItems: 'center', paddingTop: SPACING.lg, marginBottom: SPACING.xl},
  backBtn:       {width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', ...SHADOWS.card},
  headerSpacer:  {width: 38},
  topTitle:      {flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: COLORS.text},
  heroWrap:      {alignItems: 'center', marginBottom: SPACING.xl},
  heroBox:       {width: 72, height: 72, borderRadius: 20, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', ...SHADOWS.primary, marginBottom: SPACING.md},
  heading:       {fontSize: 26, fontWeight: '700', color: COLORS.text, marginBottom: 6},
  headingCaption:{fontSize: 13, color: COLORS.muted, textAlign: 'center', maxWidth: 260},
  form:          {},
  input:         {marginBottom: SPACING.sm, backgroundColor: COLORS.white},
  errText:       {color: COLORS.danger, fontSize: 12, marginBottom: SPACING.sm, marginLeft: 4},
  serverErrBox:  {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fee2e2', borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: SPACING.md},
  serverErrTxt:  {color: COLORS.danger, fontSize: 13, fontWeight: '600', flex: 1},
  signInBtn:     {borderRadius: RADIUS.md, marginTop: SPACING.sm},
  signInContent: {height: 52},
  signInLabel:   {fontSize: 16, fontWeight: '700', letterSpacing: 0.3, color: '#ffffff'},
  createRow:     {flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.lg},
  createCaption: {fontSize: 13, color: COLORS.muted},
  createLink:    {fontSize: 13, color: COLORS.primary, fontWeight: '700'},
});
