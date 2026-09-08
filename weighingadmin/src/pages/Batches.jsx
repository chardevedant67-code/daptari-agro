import { useState, useEffect } from 'react';
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Typography, Chip, IconButton, Tooltip, CircularProgress,
  Grid, InputAdornment, LinearProgress, Avatar,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import InventoryIcon from '@mui/icons-material/Inventory';
import AllInboxIcon from '@mui/icons-material/AllInbox';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { batchAPI } from '../services/api';

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

const GRADIENTS = [
  'linear-gradient(135deg,#1a227f,#3d47a3)',
  'linear-gradient(135deg,#065f46,#059669)',
  'linear-gradient(135deg,#7c2d12,#ea580c)',
  'linear-gradient(135deg,#4c1d95,#7c3aed)',
  'linear-gradient(135deg,#831843,#db2777)',
  'linear-gradient(135deg,#1e3a5f,#0ea5e9)',
  'linear-gradient(135deg,#3b2500,#d97706)',
  'linear-gradient(135deg,#14532d,#16a34a)',
];

export default function Batches() {
  const [batches, setBatches]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [createOpen, setCreateOpen]   = useState(false);
  const [creating,   setCreating]     = useState(false);
  const [createError,setCreateError]  = useState('');
  // QR drawer state
  const [qrBatch,    setQrBatch]    = useState(null);
  const [packets,    setPackets]    = useState([]);
  const [qrLoading,  setQrLoading]  = useState(false);
  const [dlLoading,  setDlLoading]  = useState({}); // batchId → true/false

  const [form, setForm] = useState({ seedType:'', seedCode:'', batchNumber:'', batchCode:'', count:'' });

  useEffect(() => { fetchBatches(); }, []);

  const fetchBatches = async () => {
    try {
      setLoading(true);
      const { data } = await batchAPI.getAll();
      setBatches(data.batches || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

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

  const handleCreate = async () => {
    setCreateError('');
    const missing = [];
    if (!form.seedType)    missing.push('Seed Type');
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
        seedCode:    form.seedCode,
        batchNumber: form.batchNumber,
        batchCode:   form.batchCode,
        count:       parseInt(form.count),
      });
      if (!res.data.success) throw new Error(res.data.message);
      setCreateOpen(false);
      setCreateError('');
      setForm({ seedType:'', seedCode:'', batchNumber:'', batchCode:'', count:'' });
      fetchBatches();
    } catch (err) {
      setCreateError(err.response?.data?.message || err.message || 'Error creating batch');
    } finally {
      setCreating(false);
    }
  };

  const openQRDrawer = async (batch) => {
    setQrBatch(batch);
    setPackets([]);
    setQrLoading(true);
    try {
      const { data } = await batchAPI.qrList(batch._id);
      setPackets(data.packets || []);
    } catch { /* silent */ }
    finally { setQrLoading(false); }
  };

  const downloadQR = (qrUrl, name) => {
    const a = document.createElement('a');
    a.href = `${batchAPI.qrBaseUrl()}${qrUrl}`;
    a.download = `${name}.png`;
    a.target = '_blank';
    a.click();
  };

  const downloadAll = () => {
    packets.forEach((p, i) => setTimeout(() => downloadQR(p.qrCodeUrl, p.uniqueId), i * 80));
  };

  const downloadBatch = async (batch) => {
    setDlLoading(prev => ({ ...prev, [batch._id]: true }));
    try {
      const { data } = await batchAPI.qrList(batch._id);
      const pkts = data.packets || [];
      pkts.forEach((p, i) => setTimeout(() => downloadQR(p.qrCodeUrl, p.uniqueId), i * 80));
    } catch { /* silent */ }
    finally { setDlLoading(prev => ({ ...prev, [batch._id]: false })); }
  };

  // Aggregate stats
  const totalQRs    = batches.reduce((s, b) => s + b.count, 0);
  const totalFilled = batches.reduce((s, b) => s + (b.filledCount || 0), 0);

  const previewId = form.seedCode && form.batchCode && form.count
    ? `PRD-${form.seedCode}${form.batchCode}-001  →  PRD-${form.seedCode}${form.batchCode}-${String(form.count).padStart(3,'0')}`
    : null;

  return (
    <Layout>
      <PageHeader
        title="Seed Batches"
        subtitle="Generate and manage bulk QR codes for seed packets"
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', borderRadius: 2, px: 2.5 }}>
            New Batch
          </Button>
        }
      />

      {/* Summary bar */}
      {!loading && batches.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          {[
            { icon: <InventoryIcon sx={{ fontSize: 20 }} />, label: 'Total Batches', value: batches.length, color: '#1a227f', bg: 'rgba(26,34,127,0.07)' },
            { icon: <AllInboxIcon  sx={{ fontSize: 20 }} />, label: 'Total QR Codes', value: totalQRs,        color: '#0369a1', bg: '#f0f9ff' },
            { icon: <TaskAltIcon   sx={{ fontSize: 20 }} />, label: 'Filled Packets', value: totalFilled,     color: '#15803d', bg: '#f0fdf4' },
          ].map(s => (
            <Box key={s.label} sx={{
              display: 'flex', alignItems: 'center', gap: 1.5,
              background: s.bg, borderRadius: 2.5, px: 2.5, py: 1.5,
              border: `1px solid ${s.color}22`, flex: '1 1 140px',
            }}>
              <Box sx={{ color: s.color }}>{s.icon}</Box>
              <Box>
                <Typography sx={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</Typography>
                <Typography sx={{ fontSize: 11, color: '#64748b', fontWeight: 600, mt: 0.2 }}>{s.label}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 12 }}>
          <CircularProgress />
        </Box>
      ) : batches.length === 0 ? (
        <Box sx={{
          textAlign: 'center', py: 12, border: '2px dashed #e2e8f0',
          borderRadius: 4, background: '#fafafa',
        }}>
          <QrCode2Icon sx={{ fontSize: 64, color: '#cbd5e1', mb: 2 }} />
          <Typography sx={{ fontWeight: 700, fontSize: 16, color: '#475569' }}>No batches yet</Typography>
          <Typography sx={{ fontSize: 13, color: '#94a3b8', mt: 0.5, mb: 3 }}>Create your first batch to generate QR sticker codes</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', borderRadius: 2 }}>
            Create First Batch
          </Button>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {batches.map((b, idx) => {
            const SC      = b.seedCode, BC = b.batchCode;
            const filled  = b.filledCount || 0;
            const pct     = b.count > 0 ? Math.round((filled / b.count) * 100) : 0;
            const gradient = GRADIENTS[idx % GRADIENTS.length];
            const first   = `PRD-${SC}${BC}-001`;
            const last    = `PRD-${SC}${BC}-${String(b.count).padStart(3,'0')}`;

            return (
              <Box key={b._id} sx={{
                display: 'flex', alignItems: 'stretch',
                borderRadius: 3, border: '1px solid #e2e8f0', overflow: 'hidden',
                background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
                transition: 'box-shadow 0.2s',
                '&:hover': { boxShadow: '0 6px 24px rgba(0,0,0,0.1)' },
              }}>

                {/* Left accent strip */}
                <Box sx={{
                  width: 88, flexShrink: 0, background: gradient,
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: 0.5, p: 2, position: 'relative', overflow: 'hidden',
                }}>
                  <Box sx={{ position:'absolute', top:-18, right:-18, width:60, height:60, borderRadius:'50%', background:'rgba(255,255,255,0.1)' }} />
                  <Typography sx={{ fontSize: 22, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{SC}</Typography>
                  <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 600, fontFamily: 'monospace' }}>{BC}</Typography>
                </Box>

                {/* Main content */}
                <Box sx={{ flex: 1, p: 2.5, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', minWidth: 0 }}>

                  {/* Batch info */}
                  <Box sx={{ minWidth: 160, flex: '1 1 160px' }}>
                    <Chip label={b.seedType} size="small"
                      sx={{ background: 'rgba(26,34,127,0.08)', color: '#1a227f', fontWeight: 700, fontSize: 10, mb: 0.8, height: 20 }} />
                    <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>
                      {b.batchName}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: '#94a3b8', mt: 0.3, fontFamily: 'monospace' }}>
                      {b.batchNumber} · {new Date(b.createdAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}
                    </Typography>
                  </Box>

                  {/* QR Range */}
                  <Box sx={{ minWidth: 180, flex: '1 1 180px' }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', mb: 0.5 }}>QR ID RANGE</Typography>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#1a227f' }}>{first}</Typography>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>→ {last}</Typography>
                  </Box>

                  {/* Stats */}
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flex: '0 0 auto' }}>
                    {[
                      { label: 'TOTAL', value: b.count,          bg: '#f0f4ff', color: '#1a227f' },
                      { label: 'FILLED', value: filled,           bg: '#f0fdf4', color: '#15803d' },
                      { label: 'EMPTY',  value: b.count - filled, bg: '#fff7ed', color: '#c2410c' },
                    ].map(s => (
                      <Box key={s.label} sx={{ textAlign: 'center', background: s.bg, borderRadius: 2, px: 1.5, py: 1 }}>
                        <Typography sx={{ fontSize: 18, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</Typography>
                        <Typography sx={{ fontSize: 9, color: '#64748b', fontWeight: 700, letterSpacing: '0.05em' }}>{s.label}</Typography>
                      </Box>
                    ))}
                  </Box>

                  {/* Progress */}
                  <Box sx={{ minWidth: 120, flex: '1 1 120px' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography sx={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>Fill progress</Typography>
                      <Typography sx={{ fontSize: 10, fontWeight: 700, color: pct === 100 ? '#15803d' : '#1a227f' }}>{pct}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={pct} sx={{
                      height: 6, borderRadius: 3, background: '#e2e8f0',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 3,
                        background: pct === 100
                          ? 'linear-gradient(90deg,#16a34a,#22c55e)'
                          : 'linear-gradient(90deg,#1a227f,#6366f1)',
                      },
                    }} />
                  </Box>

                  {/* Buttons */}
                  <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                    <Button variant="outlined" startIcon={<QrCode2Icon />}
                      onClick={() => openQRDrawer(b)}
                      sx={{
                        borderRadius: 2, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                        borderColor: '#e2e8f0', color: '#1a227f', px: 2,
                        '&:hover': { borderColor: '#1a227f', background: 'rgba(26,34,127,0.04)' },
                      }}>
                      View QRs
                    </Button>
                    <Tooltip title={`Download all ${b.count} QR codes`}>
                      <Button variant="contained"
                        onClick={() => downloadBatch(b)}
                        disabled={!!dlLoading[b._id]}
                        sx={{
                          borderRadius: 2, minWidth: 44, px: 1.5,
                          background: 'linear-gradient(135deg,#1a227f,#3d47a3)',
                          '&:hover': { background: 'linear-gradient(135deg,#141a5e,#2d3590)' },
                        }}>
                        {dlLoading[b._id]
                          ? <CircularProgress size={16} color="inherit" />
                          : <DownloadIcon sx={{ fontSize: 18 }} />
                        }
                      </Button>
                    </Tooltip>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* ── QR Viewer Dialog ── */}
      <Dialog open={!!qrBatch} onClose={() => setQrBatch(null)} maxWidth="md" fullWidth
        PaperProps={{ sx: { borderRadius: 3, maxHeight: '85vh' } }}>
        {qrBatch && (
          <>
            <DialogTitle sx={{ p: 0 }}>
              <Box sx={{
                background: GRADIENTS[batches.findIndex(b => b._id === qrBatch._id) % GRADIENTS.length],
                p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <Box>
                  <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{qrBatch.batchName}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontFamily: 'monospace' }}>
                    PRD-{qrBatch.seedCode}{qrBatch.batchCode}-001 → -{String(qrBatch.count).padStart(3,'0')}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Button variant="contained" startIcon={<DownloadIcon />} onClick={downloadAll}
                    disabled={qrLoading || packets.length === 0}
                    sx={{ background: 'rgba(255,255,255,0.2)', '&:hover': { background: 'rgba(255,255,255,0.3)' }, borderRadius: 2, fontSize: 12 }}>
                    Download All
                  </Button>
                  <IconButton onClick={() => setQrBatch(null)} sx={{ color: '#fff' }}>
                    <CloseIcon />
                  </IconButton>
                </Box>
              </Box>
            </DialogTitle>

            <DialogContent sx={{ p: 2.5 }}>
              {qrLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <>
                  {/* Summary chips */}
                  <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
                    <Chip icon={<AllInboxIcon sx={{ fontSize: '16px !important' }} />}
                      label={`${packets.length} total`} size="small"
                      sx={{ background: 'rgba(26,34,127,0.08)', color: '#1a227f', fontWeight: 700 }} />
                    <Chip icon={<CheckCircleIcon sx={{ fontSize: '16px !important' }} />}
                      label={`${packets.filter(p=>p.status==='filled').length} filled`} size="small"
                      sx={{ background: '#f0fdf4', color: '#15803d', fontWeight: 700 }} />
                    <Chip label={`${packets.filter(p=>p.status==='empty').length} empty`} size="small"
                      sx={{ background: '#f8fafc', color: '#64748b', fontWeight: 700 }} />
                  </Box>

                  {/* QR pills grid */}
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
                    {packets.map(pkt => (
                      <Box key={pkt.uniqueId} sx={{
                        display: 'flex', alignItems: 'center', gap: 0.8,
                        px: 1.5, py: 0.7, borderRadius: 2,
                        border: '1.5px solid',
                        borderColor: pkt.status === 'filled' ? '#bbf7d0' : '#e2e8f0',
                        background: pkt.status === 'filled' ? '#f0fdf4' : '#fafafa',
                        cursor: 'pointer',
                        '&:hover': { borderColor: '#1a227f', background: '#f0f4ff' },
                      }}>
                        <Box sx={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: pkt.status === 'filled' ? '#16a34a' : '#cbd5e1',
                          flexShrink: 0,
                        }} />
                        <Typography sx={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                          {pkt.uniqueId}
                        </Typography>
                        <Tooltip title="Download QR">
                          <IconButton size="small" onClick={() => downloadQR(pkt.qrCodeUrl, pkt.uniqueId)}
                            sx={{ p: 0.2, color: '#94a3b8', '&:hover': { color: '#1a227f' } }}>
                            <DownloadIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ))}
                  </Box>
                </>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>

      {/* ── Create Batch Dialog ── */}
      <Dialog open={createOpen} onClose={() => { setCreateOpen(false); setCreateError(''); }} maxWidth="sm" fullWidth
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
              <TextField fullWidth label="Seed Type" name="seedType" value={form.seedType}
                onChange={handleChange} size="small" placeholder="e.g. Soyabean" />
            </Grid>
            <Grid item xs={4}>
              <TextField fullWidth label="Seed Code" name="seedCode" value={form.seedCode}
                onChange={handleChange} size="small"
                inputProps={{ maxLength: 4, style: { textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700 } }}
                helperText="Auto-derived" />
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
              <TextField fullWidth label="Count — Number of QR Codes" name="count" value={form.count}
                onChange={handleChange} size="small" type="number"
                InputProps={{ endAdornment: <InputAdornment position="end">QR codes</InputAdornment> }}
                inputProps={{ min: 1, max: 5000 }} />
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
          <Button onClick={() => { setCreateOpen(false); setCreateError(''); }} variant="outlined" sx={{ borderRadius: 2 }}>Cancel</Button>
          <Button onClick={handleCreate} variant="contained" disabled={creating}
            startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <QrCode2Icon />}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', borderRadius: 2 }}>
            {creating ? 'Generating...' : `Generate ${form.count || ''} QRs`}
          </Button>
        </DialogActions>
      </Dialog>
    </Layout>
  );
}
