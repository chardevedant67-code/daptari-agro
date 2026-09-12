import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Button, TextField, Typography, Alert, Divider
} from '@mui/material';
import QrCodeIcon from '@mui/icons-material/QrCode';
import LockResetIcon from '@mui/icons-material/LockReset';
import VerifiedIcon from '@mui/icons-material/Verified';
import SecurityIcon from '@mui/icons-material/Security';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { authAPI } from '../services/api';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [success, setSuccess]   = useState(false);
  const [error, setError]       = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    if (!token) {
      setError('This reset link is missing its token. Please request a new password reset link.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await authAPI.resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.message || 'This reset link is invalid or has expired. Please request a new one.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Left Branding Panel — matches ForgotPassword.jsx layout */}
      <Box sx={{
        flex: 1, display: { xs: 'none', md: 'flex' }, flexDirection: 'column',
        background: 'linear-gradient(145deg, #0f1550 0%, #1a227f 50%, #3d47a3 100%)',
        alignItems: 'center', justifyContent: 'center', px: 6, position: 'relative', overflow: 'hidden'
      }}>
        <Box sx={{ position: 'absolute', top: -80, right: -80, width: 300, height: 300, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
        <Box sx={{ position: 'absolute', bottom: -60, left: -60, width: 240, height: 240, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />

        <Box sx={{ position: 'relative', textAlign: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, mb: 5 }}>
            <Box sx={{ width: 52, height: 52, borderRadius: 3, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <QrCodeIcon sx={{ color: '#fff', fontSize: 28 }} />
            </Box>
            <Box sx={{ textAlign: 'left' }}>
              <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: 22, lineHeight: 1 }}>INDUSCORE</Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em' }}>ADMIN PORTAL</Typography>
            </Box>
          </Box>

          <Typography variant="h4" sx={{ color: '#fff', fontWeight: 800, mb: 2, fontSize: 32 }}>
            Industrial Management<br />Made Simple
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.65)', fontSize: 15, lineHeight: 1.7, mb: 5 }}>
            Monitor machines, track QR products,<br />and manage weight records in real time.
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            {[
              { icon: <VerifiedIcon sx={{ fontSize: 16 }} />, label: 'ISO 27001 Certified' },
              { icon: <SecurityIcon sx={{ fontSize: 16 }} />, label: '256-bit Encryption' },
            ].map(b => (
              <Box key={b.label} sx={{
                display: 'flex', alignItems: 'center', gap: 0.8,
                background: 'rgba(255,255,255,0.1)', borderRadius: 99,
                px: 2, py: 0.8, border: '1px solid rgba(255,255,255,0.15)'
              }}>
                <Box sx={{ color: '#86efac' }}>{b.icon}</Box>
                <Typography sx={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>{b.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Right Form */}
      <Box sx={{
        width: { xs: '100%', md: 480 },
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: 4, background: '#f1f5f9'
      }}>
        <Box sx={{ width: '100%', maxWidth: 400 }}>
          <Box sx={{ mb: 4 }}>
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={() => navigate('/login')}
              sx={{ color: '#64748b', textTransform: 'none', fontWeight: 600, fontSize: 14, mb: 3 }}
            >
              Back to Sign In
            </Button>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 5 }}>
              <Box sx={{ width: 36, height: 36, borderRadius: 2, background: 'linear-gradient(135deg,#1a227f,#3d47a3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <LockResetIcon sx={{ color: '#fff', fontSize: 18 }} />
              </Box>
              <Typography sx={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>Password Reset</Typography>
            </Box>

            {!success ? (
              <>
                <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>Set a new password</Typography>
                <Typography sx={{ color: '#64748b', fontSize: 14, mb: 4 }}>
                  Choose a new password for your account. It must be at least 6 characters.
                </Typography>

                <Box component="form" onSubmit={handleSubmit}>
                  <TextField
                    fullWidth label="New password" type="password" required
                    value={password} onChange={e => setPassword(e.target.value)}
                    sx={{ mb: 2 }}
                    InputProps={{ sx: { borderRadius: 2, background: '#fff' } }}
                  />
                  <TextField
                    fullWidth label="Confirm new password" type="password" required
                    value={confirm} onChange={e => setConfirm(e.target.value)}
                    sx={{ mb: 3 }}
                    InputProps={{ sx: { borderRadius: 2, background: '#fff' } }}
                  />

                  {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

                  <Button
                    type="submit" variant="contained" fullWidth size="large"
                    disabled={loading}
                    sx={{ borderRadius: 2, py: 1.5, fontWeight: 700, fontSize: 15, background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}
                  >
                    {loading ? 'Resetting...' : 'Reset Password'}
                  </Button>
                </Box>
              </>
            ) : (
              <Box sx={{ textAlign: 'center' }}>
                <Box sx={{
                  width: 64, height: 64, borderRadius: '50%', background: '#dcfce7',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 3
                }}>
                  <VerifiedIcon sx={{ color: '#16a34a', fontSize: 32 }} />
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>Password reset!</Typography>
                <Typography sx={{ color: '#64748b', fontSize: 14, mb: 4 }}>
                  Your password has been changed successfully. You can now sign in with your new password.
                </Typography>
                <Button
                  variant="outlined" fullWidth
                  onClick={() => navigate('/login')}
                  sx={{ borderRadius: 2, py: 1.2, fontWeight: 700, borderColor: '#cbd5e1', color: '#0f172a' }}
                >
                  Go to Sign In
                </Button>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 3 }}>
            <Typography sx={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>FOR AUTHORIZED PERSONNEL ONLY</Typography>
          </Divider>
        </Box>
      </Box>
    </Box>
  );
}
