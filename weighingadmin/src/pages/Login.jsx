import { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box, Button, Checkbox, Divider, FormControlLabel,
  IconButton, InputAdornment, Link, TextField, Typography, Alert
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import QrCodeIcon from '@mui/icons-material/QrCode';
import LockIcon from '@mui/icons-material/Lock';
import VerifiedIcon from '@mui/icons-material/Verified';
import SecurityIcon from '@mui/icons-material/Security';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const navigate = useNavigate();
  const { login, loading } = useAuth();
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    const result = await login(email, password, keep);
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.message);
    }
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Left Branding Panel */}
      <Box sx={{
        flex: 1, display: { xs: 'none', md: 'flex' }, flexDirection: 'column',
        background: 'linear-gradient(145deg, #0f1550 0%, #1a227f 50%, #3d47a3 100%)',
        alignItems: 'center', justifyContent: 'center', px: 6, position: 'relative', overflow: 'hidden'
      }}>
        {/* Background circles */}
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

          {/* Badges */}
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

      {/* Right Login Form */}
      <Box sx={{
        width: { xs: '100%', md: 480 },
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: 4, background: '#f1f5f9'
      }}>
        <Box sx={{ width: '100%', maxWidth: 400 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 5 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: 2, background: 'linear-gradient(135deg,#1a227f,#3d47a3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LockIcon sx={{ color: '#fff', fontSize: 18 }} />
            </Box>
            <Typography sx={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>Secure Sign In</Typography>
          </Box>

          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', mb: 0.5 }}>Welcome back</Typography>
          <Typography sx={{ color: '#64748b', fontSize: 14, mb: 4 }}>Sign in to your admin account</Typography>

          <Box component="form" onSubmit={handleLogin}>
            <TextField
              fullWidth label="Email address" type="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              sx={{ mb: 2 }}
              InputProps={{ sx: { borderRadius: 2, background: '#fff' } }}
            />
            <TextField
              fullWidth label="Password" required
              type={showPass ? 'text' : 'password'}
              value={password} onChange={e => setPassword(e.target.value)}
              sx={{ mb: 2 }}
              InputProps={{
                sx: { borderRadius: 2, background: '#fff' },
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowPass(p => !p)}>
                      {showPass ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <FormControlLabel
                control={<Checkbox size="small" checked={keep} onChange={e => setKeep(e.target.checked)} sx={{ color: '#1a227f' }} />}
                label={<Typography sx={{ fontSize: 13, color: '#475569' }}>Keep me logged in for 30 days</Typography>}
              />
              <Link 
                component={RouterLink} 
                to="/forgot-password" 
                underline="hover" 
                sx={{ fontSize: 13, color: '#1a227f', fontWeight: 600 }}
              >
                Forgot password?
              </Link>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

            <Button
              type="submit" variant="contained" fullWidth size="large"
              disabled={loading}
              sx={{ borderRadius: 2, py: 1.5, fontWeight: 700, fontSize: 15, background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}
            >
              {loading ? 'Signing In...' : 'Sign In to Portal'}
            </Button>
          </Box>

          <Divider sx={{ my: 3 }}>
            <Typography sx={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>FOR AUTHORIZED PERSONNEL ONLY</Typography>
          </Divider>

          <Box sx={{ p: 2, background: 'rgba(26,34,127,0.04)', borderRadius: 2, border: '1px solid rgba(26,34,127,0.1)' }}>
            <Typography sx={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
              Access restricted to registered employees of Industrial Systems Ltd.
              Contact your system administrator for credentials.
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
