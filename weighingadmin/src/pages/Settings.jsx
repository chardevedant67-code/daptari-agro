import { useState } from 'react';
import {
  Box, Button, Card, Divider, Grid, Switch, TextField,
  Typography, Alert, Avatar, Snackbar, CircularProgress,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import LockIcon from '@mui/icons-material/Lock';
import NotificationsIcon from '@mui/icons-material/Notifications';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../context/AuthContext';
import { adminAPI } from '../services/api';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';

export default function Settings() {
  const { admin, logout } = useAuth();

  // Profile
  const [name, setName]         = useState(admin?.name || '');
  const [email, setEmail]       = useState(admin?.email || '');
  const [jobTitle, setJobTitle] = useState('System Administrator');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg]         = useState('');
  const [profileErr, setProfileErr]         = useState('');

  // Password
  const [pwForm, setPwForm]   = useState({ current: '', newPw: '', confirm: '' });
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError]   = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  // Notifications
  const [notifs, setNotifs] = useState({
    email: true, lowStock: true, machFault: true, dailyReport: false,
  });
  const [notifSaved, setNotifSaved] = useState(false);

  // Snackbar
  const [snack, setSnack] = useState('');

  const saveProfile = async () => {
    if (!name.trim()) { setProfileErr('Name cannot be empty'); return; }
    setProfileLoading(true); setProfileErr(''); setProfileMsg('');
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 4000);
      await adminAPI.update(admin?.id, { name: name.trim(), email: email.trim() });
      setProfileMsg('Profile updated successfully!');
    } catch (err) {
      // Do not claim success when the update wasn't actually persisted.
      setProfileErr(err.response?.data?.message || 'Unable to save changes — server unreachable');
    }
    setProfileLoading(false);
  };

  const savePw = async () => {
    setPwError(''); setPwSuccess('');
    if (!pwForm.current) { setPwError('Enter current password'); return; }
    if (pwForm.newPw.length < 6) { setPwError('New password must be at least 6 characters'); return; }
    if (pwForm.newPw !== pwForm.confirm) { setPwError('Passwords do not match'); return; }
    setPwLoading(true);
    try {
      await adminAPI.changePassword({
        currentPassword: pwForm.current,
        newPassword: pwForm.newPw,
      });
      setPwSuccess('Password updated successfully!');
      setPwForm({ current: '', newPw: '', confirm: '' });
    } catch (err) {
      const msg = err.response?.data?.message;
      setPwError(msg || 'Failed to update password. Please try again.');
    }
    setPwLoading(false);
  };

  const saveNotifs = () => {
    localStorage.setItem('notifPrefs', JSON.stringify(notifs));
    setNotifSaved(true);
    setTimeout(() => setNotifSaved(false), 2500);
    setSnack('Notification preferences saved!');
  };

  const handleSignOutAll = () => {
    if (window.confirm('Sign out of all devices? You will be redirected to login.')) {
      logout();
    }
  };

  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2) || 'A';

  return (
    <Layout>
      <PageHeader title="Settings" subtitle="Manage your account and system preferences" />

      <Grid container spacing={3}>

        {/* ── Profile ── */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
              <SaveIcon sx={{ color: '#1a227f' }} />
              <Typography sx={{ fontWeight: 700, fontSize: 15 }}>Profile Information</Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
              <Avatar sx={{ width: 56, height: 56, background: 'linear-gradient(135deg,#1a227f,#6366f1)', fontSize: 20, fontWeight: 700 }}>
                {initials}
              </Avatar>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 15 }}>{name || 'Admin'}</Typography>
                <Typography sx={{ fontSize: 13, color: '#64748b' }}>{email}</Typography>
                <Typography sx={{ fontSize: 11, color: '#1a227f', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {admin?.role}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Full Name"
                value={name}
                onChange={e => setName(e.target.value)}
                fullWidth
                InputProps={{ sx: { borderRadius: 2 } }}
              />
              <TextField
                label="Email Address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                fullWidth
                type="email"
                InputProps={{ sx: { borderRadius: 2 } }}
              />
              <TextField
                label="Job Title"
                value={jobTitle}
                onChange={e => setJobTitle(e.target.value)}
                fullWidth
                InputProps={{ sx: { borderRadius: 2 } }}
              />
            </Box>

            {profileErr && <Alert severity="error"   sx={{ mt: 2, borderRadius: 2 }}>{profileErr}</Alert>}
            {profileMsg && <Alert severity="success" sx={{ mt: 2, borderRadius: 2 }}>{profileMsg}</Alert>}

            <Button
              variant="contained"
              startIcon={profileLoading ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
              onClick={saveProfile}
              disabled={profileLoading}
              sx={{ mt: 2.5, background: '#1a227f', borderRadius: 2 }}>
              {profileLoading ? 'Saving...' : 'Save Profile'}
            </Button>
          </Card>
        </Grid>

        {/* ── Password ── */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
              <LockIcon sx={{ color: '#1a227f' }} />
              <Typography sx={{ fontWeight: 700, fontSize: 15 }}>Change Password</Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Current Password"
                type="password"
                fullWidth
                value={pwForm.current}
                onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))}
                InputProps={{ sx: { borderRadius: 2 } }}
              />
              <TextField
                label="New Password"
                type="password"
                fullWidth
                value={pwForm.newPw}
                onChange={e => setPwForm(p => ({ ...p, newPw: e.target.value }))}
                helperText="Minimum 6 characters"
                InputProps={{ sx: { borderRadius: 2 } }}
              />
              <TextField
                label="Confirm New Password"
                type="password"
                fullWidth
                value={pwForm.confirm}
                onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
                error={!!pwForm.confirm && pwForm.newPw !== pwForm.confirm}
                helperText={pwForm.confirm && pwForm.newPw !== pwForm.confirm ? 'Does not match' : ''}
                InputProps={{ sx: { borderRadius: 2 } }}
              />
            </Box>

            {pwError   && <Alert severity="error"   sx={{ mt: 2, borderRadius: 2 }}>{pwError}</Alert>}
            {pwSuccess && <Alert severity="success" sx={{ mt: 2, borderRadius: 2 }}>{pwSuccess}</Alert>}

            <Button
              variant="contained"
              startIcon={pwLoading ? <CircularProgress size={16} color="inherit" /> : <LockIcon />}
              onClick={savePw}
              disabled={pwLoading}
              sx={{ mt: 2.5, background: '#1a227f', borderRadius: 2 }}>
              {pwLoading ? 'Updating...' : 'Update Password'}
            </Button>
          </Card>
        </Grid>

        {/* ── Notifications ── */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <NotificationsIcon sx={{ color: '#1a227f' }} />
              <Typography sx={{ fontWeight: 700, fontSize: 15 }}>Notification Preferences</Typography>
            </Box>

            {[
              { key: 'email',       label: 'Email Notifications',  sub: 'Receive alerts via email' },
              { key: 'lowStock',    label: 'Low Stock Alerts',      sub: 'Notify when items reach minimum threshold' },
              { key: 'machFault',   label: 'Machine Fault Alerts',  sub: 'Immediate alerts on machine failures' },
              { key: 'dailyReport', label: 'Daily Report Summary',  sub: 'Automated daily performance report' },
            ].map(n => (
              <Box key={n.key} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5, borderBottom: '1px solid #f1f5f9' }}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{n.label}</Typography>
                  <Typography sx={{ fontSize: 11, color: '#64748b' }}>{n.sub}</Typography>
                </Box>
                <Switch
                  checked={notifs[n.key]}
                  onChange={e => setNotifs(p => ({ ...p, [n.key]: e.target.checked }))}
                  sx={{
                    '& .MuiSwitch-switchBase.Mui-checked': { color: '#1a227f' },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { background: '#1a227f' },
                  }}
                />
              </Box>
            ))}

            {notifSaved && <Alert severity="success" sx={{ mt: 2, borderRadius: 2 }}>Preferences saved!</Alert>}

            <Button
              variant="outlined"
              startIcon={<SaveIcon />}
              onClick={saveNotifs}
              sx={{ mt: 2.5, borderColor: '#1a227f', color: '#1a227f', borderRadius: 2 }}>
              Save Preferences
            </Button>
          </Card>
        </Grid>

        {/* ── Danger Zone ── */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3, border: '1px solid #fee2e2' }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15, color: '#dc2626', mb: 1 }}>Danger Zone</Typography>
            <Typography sx={{ fontSize: 13, color: '#64748b', mb: 2.5 }}>
              These actions are irreversible. Proceed with caution.
            </Typography>
            <Divider sx={{ mb: 2.5 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Button
                variant="outlined"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={handleSignOutAll}
                sx={{ borderRadius: 2, justifyContent: 'flex-start' }}>
                Sign Out of All Devices
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={() => {
                  if (window.confirm('Deactivate your account? You will lose access immediately.')) {
                    logout();
                  }
                }}
                sx={{ borderRadius: 2, justifyContent: 'flex-start' }}>
                Deactivate Account
              </Button>
            </Box>
          </Card>
        </Grid>

      </Grid>

      <Snackbar
        open={!!snack}
        autoHideDuration={2500}
        onClose={() => setSnack('')}
        message={snack}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Layout>
  );
}
