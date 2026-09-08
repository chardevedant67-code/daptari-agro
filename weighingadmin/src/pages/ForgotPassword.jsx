import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, TextField, Typography, Alert, Link, Divider
} from '@mui/material';
import QrCodeIcon from '@mui/icons-material/QrCode';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import VerifiedIcon from '@mui/icons-material/Verified';
import SecurityIcon from '@mui/icons-material/Security';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    // Simulate API call
    setTimeout(() => {
      setLoading(false);
      setSuccess(true);
    }, 1500);
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
                <MarkEmailReadIcon sx={{ color: '#fff', fontSize: 18 }} />
              </Box>
              <Typography sx={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>Password Recovery</Typography>
            </Box>

            {!success ? (
              <>
                <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>Forgot password?</Typography>
                <Typography sx={{ color: '#64748b', fontSize: 14, mb: 4 }}>
                  Enter the email address associated with your account and we'll send you a link to reset your password.
                </Typography>

                <Box component="form" onSubmit={handleSubmit}>
                  <TextField
                    fullWidth label="Email address" type="email" required
                    value={email} onChange={e => setEmail(e.target.value)}
                    sx={{ mb: 3 }}
                    InputProps={{ sx: { borderRadius: 2, background: '#fff' } }}
                  />

                  {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

                  <Button
                    type="submit" variant="contained" fullWidth size="large"
                    disabled={loading}
                    sx={{ borderRadius: 2, py: 1.5, fontWeight: 700, fontSize: 15, background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}
                  >
                    {loading ? 'Sending Link...' : 'Send Recovery Link'}
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
                <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>Email Sent!</Typography>
                <Typography sx={{ color: '#64748b', fontSize: 14, mb: 4 }}>
                  We've sent a password recovery link to <strong>{email}</strong>. Please check your inbox and follow the instructions.
                </Typography>
                <Button
                  variant="outlined" fullWidth
                  onClick={() => navigate('/login')}
                  sx={{ borderRadius: 2, py: 1.2, fontWeight: 700, borderColor: '#cbd5e1', color: '#0f172a' }}
                >
                  Return to Sign In
                </Button>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 3 }}>
            <Typography sx={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>FOR AUTHORIZED PERSONNEL ONLY</Typography>
          </Divider>

          <Box sx={{ p: 2, background: 'rgba(26,34,127,0.04)', borderRadius: 2, border: '1px solid rgba(26,34,127,0.1)' }}>
            <Typography sx={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
              If you don't receive the email within 5 minutes, please check your spam folder or contact support.
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
