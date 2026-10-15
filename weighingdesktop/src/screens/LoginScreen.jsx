import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  validateEmail,
  validateLoginPassword,
  validateNewPassword,
  validateConfirmPassword,
  validateName,
} from '../validation';

const desktop = window.desktop;

function EyeIcon({ off }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

function PasswordField({ label, value, onChange, error, testId, autoComplete }) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      label={label}
      type={visible ? 'text' : 'password'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={Boolean(error)}
      helperText={error || ' '}
      autoComplete={autoComplete}
      fullWidth
      slotProps={{
        htmlInput: { 'data-testid': testId },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                aria-label={visible ? 'Hide password' : 'Show password'}
                data-testid={`${testId}-toggle`}
                onClick={() => setVisible((v) => !v)}
                edge="end"
                size="small"
              >
                <EyeIcon off={visible} />
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

// Screen 1 of 2. Login, Sign Up and Forgot Password are three views of this
// one screen. Every action here is a call to the existing backend — there
// are no local accounts and no built-in credentials.
export default function LoginScreen({ onSignedIn, serverUrl, version }) {
  const [view, setView] = useState('login'); // 'login' | 'signup' | 'forgot'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  function switchView(next) {
    setView(next);
    setError('');
    setNotice('');
    setFieldErrors({});
    setPassword('');
    setConfirm('');
  }

  // Runs `action` only if every validator passes; shows the server's own
  // message if the request is refused.
  async function submit(event, checks, action) {
    event.preventDefault();
    setError('');
    setNotice('');
    const errors = {};
    for (const [key, message] of Object.entries(checks)) {
      if (message) errors[key] = message;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const onLogin = (event) => submit(
    event,
    { email: validateEmail(email), password: validateLoginPassword(password) },
    async () => onSignedIn(await desktop.call('auth.login', email.trim(), password)),
  );

  const onSignup = (event) => submit(
    event,
    {
      name: validateName(name),
      email: validateEmail(email),
      password: validateNewPassword(password),
      confirm: validateConfirmPassword(password, confirm),
    },
    async () => {
      const result = await desktop.call('auth.register', name.trim(), email.trim(), password);
      switchView('login');
      setNotice(result.message);
    },
  );

  const onForgot = (event) => submit(
    event,
    { email: validateEmail(email) },
    async () => {
      const result = await desktop.call('auth.forgotPassword', email.trim());
      setNotice(`${result.message} Open the link in the email to choose a new password, then sign in here.`);
    },
  );

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
      <Paper elevation={3} sx={{ width: '100%', maxWidth: 440, p: 4 }} data-testid="login-screen">
        <Typography variant="h5" fontWeight={700} gutterBottom>Seed Management</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sign in with your Admin account to open the Excel Data Manager.
        </Typography>

        {view !== 'forgot' && (
          <Tabs value={view} onChange={(_e, next) => switchView(next)} variant="fullWidth" sx={{ mb: 3 }}>
            <Tab label="Login" value="login" data-testid="tab-login" />
            <Tab label="Sign Up" value="signup" data-testid="tab-signup" />
          </Tabs>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="auth-error">{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mb: 2 }} data-testid="auth-notice">{notice}</Alert>}

        {view === 'login' && (
          <Box component="form" onSubmit={onLogin} noValidate>
            <Stack spacing={1}>
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={Boolean(fieldErrors.email)}
                helperText={fieldErrors.email || ' '}
                autoComplete="username"
                autoFocus
                fullWidth
                slotProps={{ htmlInput: { 'data-testid': 'login-email' } }}
              />
              <PasswordField label="Password" value={password} onChange={setPassword} error={fieldErrors.password} testId="login-password" autoComplete="current-password" />
              <Button type="submit" variant="contained" size="large" disabled={busy} data-testid="login-submit">
                {busy ? 'Signing in…' : 'Login'}
              </Button>
              <Box sx={{ textAlign: 'center', pt: 1 }}>
                <Link component="button" type="button" variant="body2" onClick={() => switchView('forgot')} data-testid="forgot-link">
                  Forgot password?
                </Link>
              </Box>
            </Stack>
          </Box>
        )}

        {view === 'signup' && (
          <Box component="form" onSubmit={onSignup} noValidate>
            <Stack spacing={1}>
              <Alert severity="info" sx={{ mb: 1 }}>
                Sign Up creates an operator account for the mobile app. Operator accounts cannot open
                desktop records — a Superadmin creates Admin accounts.
              </Alert>
              <TextField
                label="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={Boolean(fieldErrors.name)}
                helperText={fieldErrors.name || ' '}
                autoComplete="name"
                fullWidth
                slotProps={{ htmlInput: { 'data-testid': 'signup-name' } }}
              />
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={Boolean(fieldErrors.email)}
                helperText={fieldErrors.email || ' '}
                autoComplete="username"
                fullWidth
                slotProps={{ htmlInput: { 'data-testid': 'signup-email' } }}
              />
              <PasswordField label="Password" value={password} onChange={setPassword} error={fieldErrors.password} testId="signup-password" autoComplete="new-password" />
              <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} error={fieldErrors.confirm} testId="signup-confirm" autoComplete="new-password" />
              <Button type="submit" variant="contained" size="large" disabled={busy} data-testid="signup-submit">
                {busy ? 'Creating account…' : 'Sign Up'}
              </Button>
            </Stack>
          </Box>
        )}

        {view === 'forgot' && (
          <Box component="form" onSubmit={onForgot} noValidate>
            <Stack spacing={1}>
              <Typography variant="subtitle1" fontWeight={600}>Reset your password</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Enter your Admin account email. If it is registered, a reset link is emailed to it.
              </Typography>
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={Boolean(fieldErrors.email)}
                helperText={fieldErrors.email || ' '}
                autoComplete="username"
                autoFocus
                fullWidth
                slotProps={{ htmlInput: { 'data-testid': 'forgot-email' } }}
              />
              <Button type="submit" variant="contained" size="large" disabled={busy} data-testid="forgot-submit">
                {busy ? 'Sending…' : 'Send reset link'}
              </Button>
              <Box sx={{ textAlign: 'center', pt: 1 }}>
                <Link component="button" type="button" variant="body2" onClick={() => switchView('login')} data-testid="back-to-login">
                  Back to login
                </Link>
              </Box>
            </Stack>
          </Box>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3, textAlign: 'center' }} data-testid="app-version">
          Version {version}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }} data-testid="server-url">
          Server: {serverUrl}
        </Typography>
      </Paper>
    </Box>
  );
}
