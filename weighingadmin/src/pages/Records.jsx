import { useState, useEffect } from 'react';
import {
  Avatar, Box, Button, Card, Chip, CircularProgress, FormControl, Grid,
  InputLabel, MenuItem, Select, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, TextField, Alert, Dialog, DialogContent,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import FilterListIcon from '@mui/icons-material/FilterList';
import ImageIcon from '@mui/icons-material/Image';
import ScaleIcon from '@mui/icons-material/Scale';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import { sessionAPI } from '../services/api';

// Same hardcoded API host already used elsewhere in this app (services/api.js,
// batchAPI.qrBaseUrl(), AddProduct.jsx) — only relative/local paths need it;
// real Cloudinary URLs are already absolute and must be used as-is.
const API_ORIGIN = 'http://localhost:5001';
const resolvePhotoUrl = (url) => {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url}`;
};

const statusStyle = {
  linked:    { bg: '#dcfce7', color: '#16a34a', label: 'Linked' },
  active:    { bg: '#fef9c3', color: '#ca8a04', label: 'Active' },
  cancelled: { bg: '#f1f5f9', color: '#64748b', label: 'Cancelled' },
};

const exportCSV = (sessions) => {
  const h = ['Packet ID', 'Batch Name', 'Batch Number', 'Seed Type', 'Before Weight', 'After Weight', 'Difference', 'Date/Time', 'Operator', 'Device ID', 'Status'];
  const rows = sessions.map(s => [
    s.measurement.packetUniqueId || s.packet?.uniqueId || '',
    s.batch?.batchName || '', s.batch?.batchNumber || '', s.batch?.seedType || '',
    s.measurement.beforeWeight ?? '', s.measurement.afterWeight ?? '', s.measurement.difference ?? '',
    new Date(s.measurement.createdAt).toLocaleString(),
    s.operator?.name || '', s.device?.deviceId || '', s.measurement.status || '',
  ]);
  const csv = [h, ...rows].map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'weighing-history.csv'; a.click();
};

export default function Records() {
  const [sessions, setSessions]     = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 8, total: 0, totalPages: 1 });
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [page, setPage]             = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate]     = useState('');
  const [toDate, setToDate]         = useState('');
  const [viewPhoto, setViewPhoto]   = useState(null); // { url, label } | null

  const PER_PAGE = 8;

  const fetchSessions = () => {
    setLoading(true); setError('');
    const params = { page, limit: PER_PAGE };
    if (statusFilter) params.status = statusFilter;
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;
    sessionAPI.getAll(params)
      .then(r => {
        setSessions(r.data.sessions || []);
        setPagination(r.data.pagination || { page, limit: PER_PAGE, total: 0, totalPages: 1 });
      })
      .catch(err => setError(err.response?.data?.message || 'Could not load weighing history'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchSessions(); }, [page, statusFilter, fromDate, toDate]);

  const resetFilters = () => {
    setStatusFilter(''); setFromDate(''); setToDate(''); setPage(1);
  };

  const totalPages = pagination.totalPages || 1;
  const linkedCount = sessions.filter(s => s.measurement.status === 'linked').length;
  const diffsOnPage = sessions.map(s => s.measurement.difference).filter(d => d != null);
  const avgDifference = diffsOnPage.length
    ? (diffsOnPage.reduce((sum, d) => sum + d, 0) / diffsOnPage.length).toFixed(2)
    : '0';

  return (
    <Layout>
      <PageHeader
        title="Weighing History"
        subtitle="Real seed packet measurements from SeedBatch → SeedPacket → WeightSession"
        actions={
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => exportCSV(sessions)}
            sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#475569' }}>Export CSV</Button>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {[
          { title: 'Total Measurements', value: String(pagination.total),  icon: <ScaleIcon sx={{ color: '#1a227f', fontSize: 22 }} />, iconBg: 'rgba(26,34,127,0.08)' },
          { title: 'Avg Difference',     value: `${avgDifference} kg`,     icon: <ScaleIcon sx={{ color: '#6366f1', fontSize: 22 }} />, iconBg: 'rgba(99,102,241,0.08)' },
          { title: 'Linked (This Page)', value: String(linkedCount),       icon: <ScaleIcon sx={{ color: '#10b981', fontSize: 22 }} />, iconBg: 'rgba(16,185,129,0.08)' },
          { title: 'This Page',          value: String(sessions.length),   icon: <ScaleIcon sx={{ color: '#f59e0b', fontSize: 22 }} />, iconBg: 'rgba(245,158,11,0.08)' },
        ].map(c => <Grid size={{ xs: 12, sm: 6, md: 3 }} key={c.title}><StatCard {...c} /></Grid>)}
      </Grid>

      {/* Filters — only map to real /api/sessions query params */}
      <Card sx={{ p: 2, mb: 2.5 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} label="Status" onChange={e => { setStatusFilter(e.target.value); setPage(1); }} sx={{ borderRadius: 2 }}>
              <MenuItem value="">All</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="linked">Linked</MenuItem>
              <MenuItem value="cancelled">Cancelled</MenuItem>
            </Select>
          </FormControl>
          <TextField size="small" label="From" type="date" value={fromDate}
            onChange={e => { setFromDate(e.target.value); setPage(1); }}
            InputLabelProps={{ shrink: true }} sx={{ minWidth: 150, '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
          <TextField size="small" label="To" type="date" value={toDate}
            onChange={e => { setToDate(e.target.value); setPage(1); }}
            InputLabelProps={{ shrink: true }} sx={{ minWidth: 150, '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
          <Button startIcon={<FilterListIcon />} variant="outlined" onClick={resetFilters}
            sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#475569' }}>Reset</Button>
        </Box>
      </Card>

      <Card>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress sx={{ color: '#1a227f' }} /></Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {['Packet ID', 'Batch', 'Seed Type', 'Before', 'After', 'Difference', 'Date & Time', 'Operator', 'Device ID', 'Status', 'Photos'].map(h => <TableCell key={h}>{h}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.length === 0 ? (
                  <TableRow><TableCell colSpan={11} align="center" sx={{ py: 4, color: '#94a3b8' }}>No weighing sessions yet — measurements recorded from the mobile app will appear here</TableCell></TableRow>
                ) : sessions.map((s) => {
                  const m = s.measurement;
                  const sc = statusStyle[m.status] || statusStyle.active;
                  const beforeUrl = resolvePhotoUrl(m.beforePhotoUrl);
                  const afterUrl  = resolvePhotoUrl(m.afterPhotoUrl);
                  return (
                    <TableRow key={m.sessionId} hover>
                      <TableCell>
                        <Typography sx={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#1a227f' }}>
                          {m.packetUniqueId || s.packet?.uniqueId || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{s.batch?.batchName || '—'}</Typography>
                        <Typography sx={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{s.batch?.batchNumber || ''}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 13 }}>{s.batch?.seedType || '—'}</TableCell>
                      <TableCell sx={{ fontSize: 13, fontWeight: 700 }}>{m.beforeWeight != null ? `${m.beforeWeight} kg` : '—'}</TableCell>
                      <TableCell sx={{ fontSize: 13, fontWeight: 700 }}>{m.afterWeight != null ? `${m.afterWeight} kg` : '—'}</TableCell>
                      <TableCell sx={{ fontSize: 14, fontWeight: 800, color: m.difference != null && m.difference < 0 ? '#dc2626' : '#0f172a' }}>
                        {m.difference != null ? `${m.difference} kg` : '—'}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, fontFamily: 'monospace', color: '#475569' }}>
                        {m.createdAt ? new Date(m.createdAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar sx={{ width: 26, height: 26, fontSize: 10, fontWeight: 700, background: 'rgba(26,34,127,0.12)', color: '#1a227f' }}>
                            {s.operator?.name?.charAt(0) || '?'}
                          </Avatar>
                          <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{s.operator?.name || '—'}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, fontFamily: 'monospace' }}>{s.device?.deviceId || '—'}</TableCell>
                      <TableCell><Chip label={sc.label} size="small" sx={{ fontSize: 11, fontWeight: 800, background: sc.bg, color: sc.color }} /></TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <Button size="small" disabled={!beforeUrl} onClick={() => setViewPhoto({ url: beforeUrl, label: 'Before Photo' })}
                            startIcon={<ImageIcon sx={{ fontSize: '14px !important' }} />}
                            sx={{ fontSize: 10, minWidth: 0, px: 0.8, py: 0.2, textTransform: 'none' }}>
                            {beforeUrl ? 'Before' : '—'}
                          </Button>
                          <Button size="small" disabled={!afterUrl} onClick={() => setViewPhoto({ url: afterUrl, label: 'After Photo' })}
                            startIcon={<ImageIcon sx={{ fontSize: '14px !important' }} />}
                            sx={{ fontSize: 10, minWidth: 0, px: 0.8, py: 0.2, textTransform: 'none' }}>
                            {afterUrl ? 'After' : '—'}
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        <Box sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9' }}>
          <Typography sx={{ fontSize: 12, color: '#64748b' }}>
            Page {pagination.page} of {totalPages} — {pagination.total} total measurements
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.8 }}>
            <Button size="small" variant="outlined" disabled={page === 1} onClick={() => setPage(p => p - 1)}
              sx={{ minWidth: 32, height: 32, p: 0, borderRadius: 1.5, borderColor: '#e2e8f0', color: '#64748b' }}>‹</Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
              <Button key={p} size="small" variant={page === p ? 'contained' : 'outlined'} onClick={() => setPage(p)}
                sx={{ minWidth: 32, height: 32, p: 0, borderRadius: 1.5, fontSize: 12, ...(page === p ? { background: '#1a227f' } : { borderColor: '#e2e8f0', color: '#64748b' }) }}>{p}</Button>
            ))}
            <Button size="small" variant="outlined" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              sx={{ minWidth: 32, height: 32, p: 0, borderRadius: 1.5, borderColor: '#e2e8f0', color: '#64748b' }}>›</Button>
          </Box>
        </Box>
      </Card>

      {/* Photo viewer */}
      <Dialog open={Boolean(viewPhoto)} onClose={() => setViewPhoto(null)} maxWidth="sm" fullWidth>
        <DialogContent sx={{ p: 1.5 }}>
          {viewPhoto?.url && (
            <Box component="img" src={viewPhoto.url} alt={viewPhoto.label}
              sx={{ width: '100%', borderRadius: 2, display: 'block' }} />
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
