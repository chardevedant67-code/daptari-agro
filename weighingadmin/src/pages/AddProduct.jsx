import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Alert, Box, Breadcrumbs, Button, Card, Chip, FormControl, Grid,
  InputLabel, Link, MenuItem, Select, TextField, Typography,
  InputAdornment, CircularProgress, Divider,
} from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import QrCodeIcon from '@mui/icons-material/QrCode';
import EcoIcon from '@mui/icons-material/LocalFlorist';
import ScienceIcon from '@mui/icons-material/Science';
import GrassIcon from '@mui/icons-material/Grass';
import BiotechIcon from '@mui/icons-material/Biotech';
import SaveIcon from '@mui/icons-material/Save';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import Layout from '../components/Layout';

const BASE_URL = 'http://localhost:5001';

const SEED_TYPES = [
  { id: 'organic',  label: 'Organic',  icon: <EcoIcon />,     desc: 'Naturally grown',     code: 'OR' },
  { id: 'hybrid',   label: 'Hybrid',   icon: <ScienceIcon />, desc: 'Cross-bred varieties', code: 'HY' },
  { id: 'heirloom', label: 'Heirloom', icon: <GrassIcon />,   desc: 'Open-pollinated',      code: 'HE' },
  { id: 'modified', label: 'Modified', icon: <BiotechIcon />, desc: 'Genetically enhanced',  code: 'MO' },
];

const LOCATIONS = [
  'Warehouse A - Cold Storage',
  'Warehouse B - Ambient',
  'Greenhouse Section 04',
  'Distribution Hub 12',
];

const deriveSeedCode  = (name)  => name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'SD';
const deriveBatchCode = (batch) => batch.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4) || 'B1';

export default function AddProduct() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', batch: '', location: '', seedType: '', count: '1' });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [result,  setResult]  = useState(null);

  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target?.value ?? e }));

  const seedCode  = deriveSeedCode(form.name);
  const batchCode = deriveBatchCode(form.batch);
  const count     = Math.max(1, parseInt(form.count) || 1);

  const previewFirst = form.name && form.batch ? `PRD-${seedCode}${batchCode}-001` : '—';
  const previewLast  = count > 1 && form.name && form.batch
    ? `PRD-${seedCode}${batchCode}-${String(count).padStart(3,'0')}`
    : null;

  const canSave = !saving && form.name.trim() && form.batch.trim() && form.location && form.seedType && count >= 1;

  const handleSave = async () => {
    setSaving(true); setError(''); setResult(null);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${BASE_URL}/api/batches`, {
        batchName:   `${form.name} ${form.batch}`,
        seedType:    form.name,
        seedCode,
        batchNumber: form.batch,
        batchCode,
        count,
      }, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.data.success) throw new Error(res.data.message);
      setResult({ batch: res.data.batch, packets: res.data.packets });
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const downloadQR = (url, name) => {
    const a = document.createElement('a');
    a.href = `${BASE_URL}${url}`;
    a.download = `${name}.png`;
    a.target = '_blank';
    a.click();
  };

  const downloadAll = () => {
    if (!result?.packets) return;
    result.packets.forEach((p, i) => setTimeout(() => downloadQR(p.qrCodeUrl, p.uniqueId), i * 80));
  };

  const reset = () => {
    setResult(null);
    setForm({ name: '', batch: '', location: '', seedType: '', count: '1' });
    setError('');
  };

  return (
    <Layout>
      <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} sx={{ mb: 2 }}>
        <Link underline="hover" color="inherit" onClick={() => navigate('/dashboard')} sx={{ cursor: 'pointer', fontSize: 13 }}>Dashboard</Link>
        <Link underline="hover" color="inherit" onClick={() => navigate('/products')}  sx={{ cursor: 'pointer', fontSize: 13 }}>Products</Link>
        <Typography sx={{ fontSize: 13, color: '#1a227f', fontWeight: 600 }}>Add New Product</Typography>
      </Breadcrumbs>

      <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', mb: 0.5 }}>Add New Product</Typography>
      <Typography sx={{ fontSize: 13, color: '#64748b', mb: 3.5 }}>
        Enter <b>Count</b> = number of QR sticker codes to print for this batch (e.g. 100 packets → 100 unique QRs)
      </Typography>

      <Grid container spacing={3}>
        {/* ── Form ── */}
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ p: 3.5 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 2.5 }}>Product Information</Typography>
            <Grid container spacing={2.5}>
              <Grid size={12}>
                <TextField fullWidth label="Product Name *" value={form.name} onChange={set('name')}
                  placeholder="e.g. Soyabean, Wheat, Rice..."
                  helperText={form.name ? `Seed code auto-derived: ${seedCode}` : ''}
                  InputProps={{ sx: { borderRadius: 2 } }} />
              </Grid>
              <Grid size={12}>
                <TextField fullWidth label="Batch Number *" value={form.batch} onChange={set('batch')}
                  placeholder="e.g. BA-09, LOT-2024-01"
                  helperText={form.batch ? `Batch code auto-derived: ${batchCode}` : ''}
                  InputProps={{ sx: { borderRadius: 2, fontFamily: 'monospace' } }} />
              </Grid>

              {/* COUNT */}
              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Count — Number of QR Codes *"
                  type="number"
                  value={form.count}
                  onChange={set('count')}
                  inputProps={{ min: 1, max: 5000 }}
                  InputProps={{
                    sx: { borderRadius: 2, fontWeight: 700, fontSize: 16 },
                    endAdornment: (
                      <InputAdornment position="end">
                        <Chip
                          label={`${count} QR${count > 1 ? 's' : ''}`}
                          size="small"
                          sx={{ background: 'rgba(26,34,127,0.1)', color: '#1a227f', fontWeight: 700, fontSize: 11 }}
                        />
                      </InputAdornment>
                    ),
                  }}
                  helperText={
                    count === 1
                      ? `1 QR sticker → ${previewFirst}`
                      : `${count} unique QR stickers: ${previewFirst} → PRD-${seedCode}${batchCode}-${String(count).padStart(3,'0')}`
                  }
                />
              </Grid>

              <Grid size={12}>
                <FormControl fullWidth required>
                  <InputLabel>Storage Location</InputLabel>
                  <Select value={form.location} label="Storage Location" onChange={set('location')} sx={{ borderRadius: 2 }}>
                    {LOCATIONS.map(l => <MenuItem key={l} value={l}>{l}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {/* Seed Type */}
            <Typography sx={{ fontWeight: 700, fontSize: 15, mt: 3.5, mb: 2 }}>Seed Category</Typography>
            <Grid container spacing={1.5}>
              {SEED_TYPES.map(t => (
                <Grid size={6} key={t.id}>
                  <Box onClick={() => set('seedType')(t.id)} sx={{
                    p: 2, borderRadius: 2, cursor: 'pointer', border: '2px solid',
                    borderColor: form.seedType === t.id ? '#1a227f' : '#e2e8f0',
                    background:  form.seedType === t.id ? 'rgba(26,34,127,0.04)' : '#fff',
                    display: 'flex', alignItems: 'center', gap: 1.5, transition: 'all 0.15s',
                    '&:hover': { borderColor: '#1a227f' },
                  }}>
                    <Box sx={{ color: form.seedType === t.id ? '#1a227f' : '#94a3b8' }}>{t.icon}</Box>
                    <Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 700, color: form.seedType === t.id ? '#1a227f' : '#0f172a' }}>{t.label}</Typography>
                      <Typography sx={{ fontSize: 11, color: '#64748b' }}>{t.desc}</Typography>
                    </Box>
                  </Box>
                </Grid>
              ))}
            </Grid>

            {error && <Alert severity="error" sx={{ mt: 2.5, borderRadius: 2 }}>{error}</Alert>}

            <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
              <Button variant="outlined" fullWidth onClick={() => navigate('/products')} sx={{ borderRadius: 2, py: 1.3 }}>
                Cancel
              </Button>
              <Button variant="contained" fullWidth
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                disabled={!canSave}
                onClick={handleSave}
                sx={{ borderRadius: 2, py: 1.3, background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}>
                {saving ? `Generating ${count} QR${count > 1 ? 's' : ''}...` : `Generate ${count} QR Code${count > 1 ? 's' : ''}`}
              </Button>
            </Box>
          </Card>
        </Grid>

        {/* ── Preview / Result ── */}
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card sx={{ p: 3.5, position: 'sticky', top: 20 }}>

            {!result ? (
              <>
                <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 2.5 }}>QR Code Preview</Typography>
                <Box sx={{
                  border: '2px dashed #e2e8f0', borderRadius: 3, p: 4,
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  minHeight: 180, background: '#fafafa', mb: 2.5,
                }}>
                  {count > 1 && form.name ? (
                    <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5, flexWrap: 'wrap', justifyContent: 'center' }}>
                      {[0,1,2].map(n => (
                        <Box key={n} sx={{ width: 36, height: 36, border: '2px solid #1a227f', borderRadius: 1.5,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          opacity: 1 - n * 0.2 }}>
                          <QrCodeIcon sx={{ fontSize: 20, color: '#1a227f' }} />
                        </Box>
                      ))}
                      {count > 3 && (
                        <Box sx={{ width: 36, height: 36, border: '2px dashed #94a3b8', borderRadius: 1.5,
                          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Typography sx={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>+{count-3}</Typography>
                        </Box>
                      )}
                    </Box>
                  ) : (
                    <QrCodeIcon sx={{ fontSize: 72, color: form.name ? '#1a227f' : '#cbd5e1', mb: 1.5 }} />
                  )}
                  <Typography sx={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#1a227f', textAlign: 'center', lineHeight: 2 }}>
                    {previewFirst}
                    {previewLast && <><br/>↓<br/>{previewLast}</>}
                  </Typography>
                </Box>

                {form.name && (
                  <Box sx={{ background: 'rgba(26,34,127,0.04)', borderRadius: 2, p: 2, border: '1px solid rgba(26,34,127,0.1)' }}>
                    {[
                      { label: 'Product',    value: form.name || '—' },
                      { label: 'Batch',      value: form.batch || '—' },
                      { label: 'Seed Code',  value: seedCode + ' (auto)' },
                      { label: 'Batch Code', value: batchCode + ' (auto)' },
                      { label: 'Count',      value: `${count} QR codes` },
                      { label: 'Location',   value: form.location || '—' },
                    ].map(r => (
                      <Box key={r.label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4 }}>
                        <Typography sx={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{r.label}</Typography>
                        <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>{r.value}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </>
            ) : (
              /* Result panel */
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                  <CheckCircleIcon sx={{ color: '#10b981', fontSize: 30 }} />
                  <Box>
                    <Typography sx={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
                      {result.packets.length} QR Codes Generated!
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: '#64748b' }}>{result.batch.batchName}</Typography>
                  </Box>
                </Box>

                <Box sx={{ background: '#f0fdf4', borderRadius: 2, p: 2, mb: 2, border: '1px solid #bbf7d0' }}>
                  <Typography sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#15803d' }}>
                    {result.packets[0]?.uniqueId}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: '#64748b', mt: 0.3 }}>
                    to {result.packets[result.packets.length - 1]?.uniqueId}
                  </Typography>
                </Box>

                <Button fullWidth variant="contained" startIcon={<DownloadIcon />}
                  onClick={downloadAll}
                  sx={{ mb: 1.5, background: 'linear-gradient(135deg,#1a227f,#3d47a3)', borderRadius: 2, py: 1.2 }}>
                  Download All {result.packets.length} QR Codes
                </Button>

                <Divider sx={{ my: 1.5 }} />

                <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#64748b', mb: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Individual QRs
                </Typography>
                <Box sx={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {result.packets.map(p => (
                    <Box key={p.uniqueId} sx={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      px: 1.5, py: 0.7, borderRadius: 1.5, background: '#f8fafc', border: '1px solid #e2e8f0',
                    }}>
                      <Typography sx={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#0f172a' }}>
                        {p.uniqueId}
                      </Typography>
                      <Button size="small" startIcon={<DownloadIcon sx={{ fontSize: '12px !important' }} />}
                        onClick={() => downloadQR(p.qrCodeUrl, p.uniqueId)}
                        sx={{ fontSize: 10, minWidth: 0, py: 0.2 }}>
                        DL
                      </Button>
                    </Box>
                  ))}
                </Box>

                <Button fullWidth variant="outlined" sx={{ mt: 2, borderRadius: 2 }} onClick={reset}>
                  Add Another Product
                </Button>
              </>
            )}
          </Card>
        </Grid>
      </Grid>
    </Layout>
  );
}
