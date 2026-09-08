import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Box, Breadcrumbs, Button, Card, CircularProgress, FormControl, Grid,
  InputLabel, Link, MenuItem, Select, TextField, Typography
} from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import EcoIcon from '@mui/icons-material/LocalFlorist';
import ScienceIcon from '@mui/icons-material/Science';
import GrassIcon from '@mui/icons-material/Grass';
import BiotechIcon from '@mui/icons-material/Biotech';
import SaveIcon from '@mui/icons-material/Save';
import Layout from '../components/Layout';
import { productAPI } from '../services/api';

const SEED_TYPES = [
  { id: 'Organic',  label: 'Organic',  icon: <EcoIcon />,     desc: 'Naturally grown' },
  { id: 'Hybrid',   label: 'Hybrid',   icon: <ScienceIcon />, desc: 'Cross-bred varieties' },
  { id: 'Heirloom', label: 'Heirloom', icon: <GrassIcon />,   desc: 'Open-pollinated' },
  { id: 'Modified', label: 'Modified', icon: <BiotechIcon />, desc: 'Genetically enhanced' },
];

const LOCATIONS = [
  'Warehouse A - Cold Storage',
  'Warehouse B - Ambient',
  'Greenhouse Section 04',
  'Distribution Hub 12',
];

export default function EditProduct() {
  const navigate  = useNavigate();
  const { id }    = useParams();

  const [form, setForm]     = useState({ name: '', batch: '', location: '', seedType: '' });
  const [productId, setProductId] = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [success, setSuccess]   = useState(false);
  const [error,   setError]     = useState('');

  useEffect(() => {
    productAPI.getOne(id)
      .then(res => {
        const p = res.data.product;
        setForm({
          name:      p.productName || '',
          batch:     p.batchNumber || '',
          location:  p.storageLocation || '',
          seedType:  p.seedType || '',
        });
        setProductId(p.productId || '');
      })
      .catch(() => setError('Failed to load product'))
      .finally(() => setLoading(false));
  }, [id]);

  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target?.value ?? e }));

  const handleSave = async () => {
    setSaving(true); setError(''); setSuccess(false);
    try {
      await productAPI.update(id, {
        productName:     form.name,
        batchNumber:     form.batch,
        storageLocation: form.location,
        seedType:        form.seedType,
      });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update product');
    } finally {
      setSaving(false);
    }
  };

  const canSave = !saving && form.name && form.batch && form.location && form.seedType;

  if (loading) {
    return (
      <Layout>
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
          <CircularProgress />
        </Box>
      </Layout>
    );
  }

  return (
    <Layout>
      <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} sx={{ mb: 2 }}>
        <Link underline="hover" color="inherit" onClick={() => navigate('/dashboard')} sx={{ cursor: 'pointer', fontSize: 13 }}>Dashboard</Link>
        <Link underline="hover" color="inherit" onClick={() => navigate('/products')}  sx={{ cursor: 'pointer', fontSize: 13 }}>Products</Link>
        <Typography sx={{ fontSize: 13, color: '#1a227f', fontWeight: 600 }}>Edit Product</Typography>
      </Breadcrumbs>

      <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', mb: 0.5 }}>Edit Product</Typography>
      <Typography sx={{ fontSize: 13, color: '#64748b', mb: 3.5 }}>
        Update product details — Product ID <strong style={{ fontFamily: 'monospace' }}>{productId}</strong> stays the same
      </Typography>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ p: 3.5 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 2.5 }}>Product Information</Typography>
            <Grid container spacing={2.5}>
              <Grid size={12}>
                <TextField fullWidth label="Product Name" required value={form.name} onChange={set('name')}
                  InputProps={{ sx: { borderRadius: 2 } }} />
              </Grid>
              <Grid size={6}>
                <TextField fullWidth label="Product ID" value={productId} disabled
                  helperText="Auto-generated — cannot be changed"
                  InputProps={{ sx: { borderRadius: 2, fontFamily: 'monospace', color: '#94a3b8' } }} />
              </Grid>
              <Grid size={6}>
                <TextField fullWidth label="Batch Number" required value={form.batch} onChange={set('batch')}
                  InputProps={{ sx: { borderRadius: 2, fontFamily: 'monospace' } }} />
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

            <Typography sx={{ fontWeight: 700, fontSize: 15, mt: 3.5, mb: 2 }}>Seed Type</Typography>
            <Grid container spacing={1.5}>
              {SEED_TYPES.map(t => (
                <Grid size={6} key={t.id}>
                  <Box
                    onClick={() => set('seedType')(t.id)}
                    sx={{
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

            {error   && <Alert severity="error"   sx={{ mt: 2, borderRadius: 2 }}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mt: 2, borderRadius: 2 }}>Product updated successfully!</Alert>}

            <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
              <Button variant="outlined" fullWidth onClick={() => navigate('/products')} sx={{ borderRadius: 2, py: 1.3 }}>Cancel</Button>
              <Button
                variant="contained" fullWidth startIcon={<SaveIcon />}
                disabled={!canSave}
                onClick={handleSave}
                sx={{ borderRadius: 2, py: 1.3, background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </Box>
          </Card>
        </Grid>
      </Grid>
    </Layout>
  );
}
