import { useState } from 'react';
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Typography, Chip, CircularProgress, Grid,
  MenuItem,
} from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import { batchAPI } from '../services/api';

// Shared with the Batches page's "New Batch" flow (and now Products' "New
// Batch" button) so there is exactly one implementation of batch creation —
// same fields, same validation, same POST /api/batches call, same permanent
// QR generation on the backend. Nothing here creates or fakes a batch on
// the frontend; the backend remains the sole source of truth.
const SEED_PRESETS = [
  { label: 'Soyabean',  code: 'SO' },
  { label: 'Wheat',     code: 'WH' },
  { label: 'Rice',      code: 'RI' },
  { label: 'Maize',     code: 'MA' },
  { label: 'Cotton',    code: 'CO' },
  { label: 'Mustard',   code: 'MU' },
  { label: 'Groundnut', code: 'GN' },
  { label: 'Sunflower', code: 'SF' },
];

const EMPTY_FORM = {
  seedType: '', seedCategory: '', seedCode: '', batchNumber: '', batchCode: '', count: '',
  month: '', year: '', warehouse: '', rack: '', shelf: '',
};

const WAREHOUSE_OPTIONS = ['Warehouse A', 'Warehouse B', 'Warehouse C'];
const RACK_OPTIONS      = ['Rack 1', 'Rack 2', 'Rack 3', 'Rack 4'];
const SHELF_OPTIONS     = ['Shelf 1', 'Shelf 2', 'Shelf 3', 'Shelf 4'];
const SEED_CATEGORY_OPTIONS = ['Organic', 'Hybrid', 'Open Pollinated', 'Heirloom', 'Conventional'];

// `onCreated(responseData)` fires only after a real, successful
// POST /api/batches response — callers use it to refresh their own view
// (e.g. Batches re-fetches its list; Products, which has no SeedBatch data
// of its own to refresh, just shows the real result) without this component
// needing to know which page it's rendered on.
export default function NewBatchDialog({ open, onClose, onCreated }) {
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);

  const handlePreset = (p) => setForm(f => ({ ...f, seedType: p.label, seedCode: p.code }));

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => {
      const upd = { ...f, [name]: value };
      if (name === 'batchNumber') upd.batchCode = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (name === 'seedType')    upd.seedCode  = value.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
      return upd;
    });
  };

  const handleClose = () => {
    if (creating) return; // don't let the dialog be dismissed mid-request
    setCreateError('');
    onClose();
  };

  const handleCreate = async () => {
    setCreateError('');
    const missing = [];
    if (!form.seedType)    missing.push('Seed Name');
    if (!form.seedCode)    missing.push('Seed Code');
    if (!form.batchNumber) missing.push('Batch Number');
    if (!form.batchCode)   missing.push('Batch Code');
    if (!form.count)       missing.push('Count');
    if (missing.length > 0) { setCreateError(`Fill: ${missing.join(', ')}`); return; }
    try {
      setCreating(true);
      const res = await batchAPI.create({
        batchName:   `${form.seedType} ${form.batchNumber}`,
        seedType:    form.seedType,
        seedCategory: form.seedCategory,
        seedCode:    form.seedCode,
        batchNumber: form.batchNumber,
        batchCode:   form.batchCode,
        count:       parseInt(form.count),
        month:       form.month,
        year:        form.year,
        warehouse:   form.warehouse,
        rack:        form.rack,
        shelf:       form.shelf,
      });
      if (!res.data.success) throw new Error(res.data.message);
      setForm(EMPTY_FORM);
      setCreateError('');
      onCreated?.(res.data);
      onClose();
    } catch (err) {
      // Real API error only — the dialog stays open and the entered fields
      // are left exactly as the user typed them so they can fix and retry.
      setCreateError(err.response?.data?.message || err.message || 'Error creating batch');
    } finally {
      setCreating(false);
    }
  };

  const previewId = form.seedCode && form.batchCode && form.count
    ? `PRD-${form.seedCode}${form.batchCode}-001  →  PRD-${form.seedCode}${form.batchCode}-${String(form.count).padStart(3,'0')}`
    : null;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 18 }}>Create New Batch</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', mb: 1, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Quick Select
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.7, mb: 2.5 }}>
          {SEED_PRESETS.map(p => (
            <Chip key={p.code} label={`${p.label} (${p.code})`} size="small" clickable
              onClick={() => handlePreset(p)}
              sx={{
                fontWeight: 600, fontSize: 11,
                background: form.seedCode === p.code ? 'rgba(26,34,127,0.12)' : '#f1f5f9',
                color:      form.seedCode === p.code ? '#1a227f' : '#475569',
                border:     form.seedCode === p.code ? '1px solid #1a227f' : '1px solid transparent',
              }}
            />
          ))}
        </Box>

        <Grid container spacing={2}>
          <Grid item xs={8}>
            <TextField fullWidth label="Seed Name" name="seedType" value={form.seedType}
              onChange={handleChange} size="small" placeholder="e.g. Soybean" />
          </Grid>
          <Grid item xs={4}>
            <TextField fullWidth label="Seed Code" name="seedCode" value={form.seedCode}
              onChange={handleChange} size="small"
              inputProps={{ maxLength: 4, style: { textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700 } }}
              helperText="Auto-derived" />
          </Grid>
          <Grid item xs={12}>
            <TextField select fullWidth name="seedCategory" value={form.seedCategory}
              onChange={handleChange} size="small"
              SelectProps={{
                displayEmpty: true,
                MenuProps: {
                  PaperProps: {
                    sx: {
                      mt: 0.5,
                      borderRadius: 2,
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
                    },
                  },
                },
              }}>
              <MenuItem value=""><em>Select Seed Type</em></MenuItem>
              {SEED_CATEGORY_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Batch Number" name="batchNumber" value={form.batchNumber}
              onChange={handleChange} size="small" placeholder="e.g. BA-09" />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Batch Code" name="batchCode" value={form.batchCode}
              onChange={handleChange} size="small"
              inputProps={{ style: { textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700 } }}
              helperText="Auto-derived" />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth label="Number of QR Codes" name="count" value={form.count}
              onChange={handleChange} size="small" type="number"
              placeholder="e.g. 500"
              inputProps={{ min: 1, max: 5000 }} />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Month" name="month" value={form.month}
              onChange={handleChange} size="small" type="number"
              placeholder="e.g. 6" inputProps={{ min: 1, max: 12 }} />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Year" name="year" value={form.year}
              onChange={handleChange} size="small" type="number"
              placeholder="e.g. 2026" />
          </Grid>
          <Grid item xs={4}>
            <TextField select fullWidth name="warehouse" value={form.warehouse}
              onChange={handleChange} size="small"
              SelectProps={{ displayEmpty: true }}>
              <MenuItem value=""><em>Select Warehouse</em></MenuItem>
              {WAREHOUSE_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={4}>
            <TextField select fullWidth name="rack" value={form.rack}
              onChange={handleChange} size="small"
              SelectProps={{ displayEmpty: true }}>
              <MenuItem value=""><em>Select Rack</em></MenuItem>
              {RACK_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={4}>
            <TextField select fullWidth name="shelf" value={form.shelf}
              onChange={handleChange} size="small"
              SelectProps={{ displayEmpty: true }}>
              <MenuItem value=""><em>Select Shelf</em></MenuItem>
              {SHELF_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
            </TextField>
          </Grid>
        </Grid>

        {previewId && (
          <Box sx={{ mt: 2, p: 1.5, background: '#f0f4ff', borderRadius: 2, border: '1px solid #c7d2fe' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#1a227f', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Preview</Typography>
            <Typography sx={{ fontFamily: 'monospace', fontSize: 12, color: '#3d47a3', fontWeight: 700 }}>{previewId}</Typography>
            <Typography sx={{ fontSize: 11, color: '#64748b', mt: 0.3 }}>{form.count} unique QR codes will be generated</Typography>
          </Box>
        )}
        {createError && (
          <Box sx={{ mt: 2, p: 1.5, background: '#fef2f2', borderRadius: 2, border: '1px solid #fecaca' }}>
            <Typography sx={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>⚠ {createError}</Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={handleClose} variant="outlined" sx={{ borderRadius: 2 }}>Cancel</Button>
        <Button onClick={handleCreate} variant="contained" disabled={creating}
          startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <QrCode2Icon />}
          sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', borderRadius: 2 }}>
          {creating ? 'Generating...' : `Generate ${form.count || ''} QRs`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
