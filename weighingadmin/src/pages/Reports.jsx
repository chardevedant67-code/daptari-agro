import { useState, useEffect } from 'react';
import {
  Box, Button, Card, Chip, CircularProgress, FormControl, Grid, InputLabel,
  MenuItem, Select, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, TextField, LinearProgress, Alert,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import FilterListIcon from '@mui/icons-material/FilterList';
import ScaleIcon from '@mui/icons-material/Scale';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import { sessionAPI } from '../services/api';

// Same limit used elsewhere in this app for a single bounded report-style
// fetch (packetRoutes.js/sessionRoutes.js both cap history reads at 200
// server-side). Reports summarizes a date range in one request rather than
// paginating — Weighing History (Records page) already covers page-by-page
// browsing of every session.
const REPORT_LIMIT = 200;

const statusStyle = {
  linked: { bg: '#dcfce7', color: '#16a34a', label: 'Linked' },
  active: { bg: '#fef9c3', color: '#ca8a04', label: 'Active' },
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
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'weighing-report.csv'; a.click();
};

const exportExcel = (sessions) => {
  const h = ['Packet ID', 'Batch Name', 'Batch Number', 'Seed Type', 'Before Weight', 'After Weight', 'Difference', 'Date/Time', 'Operator', 'Device ID', 'Status'];
  const rows = sessions.map(s => [
    s.measurement.packetUniqueId || s.packet?.uniqueId || '',
    s.batch?.batchName || '', s.batch?.batchNumber || '', s.batch?.seedType || '',
    s.measurement.beforeWeight ?? '', s.measurement.afterWeight ?? '', s.measurement.difference ?? '',
    new Date(s.measurement.createdAt).toLocaleString(),
    s.operator?.name || '', s.device?.deviceId || '', s.measurement.status || '',
  ]);
  const tsv = [h, ...rows].map(r => r.join('\t')).join('\n');
  const blob = new Blob([tsv], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'weighing-report.xls'; a.click();
};

export default function Reports() {
  const [sessions, setSessions]   = useState([]);
  const [pagination, setPagination] = useState({ total: 0 });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [datePreset, setDatePreset]     = useState('7d');
  const [customStart, setCustomStart]   = useState('');
  const [customEnd, setCustomEnd]       = useState('');

  const getDateRange = () => {
    if (datePreset === 'custom') {
      return { from: customStart || undefined, to: customEnd || undefined };
    }
    const now = new Date();
    const from = new Date(now);
    if (datePreset === '24h') from.setHours(from.getHours() - 24);
    if (datePreset === '7d')  from.setDate(from.getDate() - 7);
    if (datePreset === '30d') from.setDate(from.getDate() - 30);
    return { from: from.toISOString() };
  };

  const fetchReport = () => {
    const { from, to } = getDateRange();
    const params = { limit: REPORT_LIMIT };
    if (statusFilter) params.status = statusFilter;
    if (from) params.from = from;
    if (to) params.to = to;
    sessionAPI.getAll(params)
      .then(r => {
        setSessions(r.data.sessions || []);
        setPagination(r.data.pagination || { total: 0 });
        setError('');
      })
      .catch(err => setError(err.response?.data?.message || 'Could not load report data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchReport(); }, [statusFilter, datePreset, customStart, customEnd]);

  const resetFilters = () => {
    setStatusFilter(''); setDatePreset('7d'); setCustomStart(''); setCustomEnd('');
  };

  // Real metrics only — computed from the actually-returned sessions, never
  // recalculating `measurement.difference` and never grading PASS/FAIL/WARN
  // (WeightSession has no such concept).
  const linkedCount = sessions.filter(s => s.measurement.status === 'linked').length;
  const diffs = sessions.map(s => s.measurement.difference).filter(d => typeof d === 'number');
  const avgDifference = diffs.length ? (diffs.reduce((a, b) => a + b, 0) / diffs.length) : null;
  const minDifference = diffs.length ? Math.min(...diffs) : null;
  const maxDifference = diffs.length ? Math.max(...diffs) : null;
  const maxAbsDiff = diffs.length ? Math.max(...diffs.map(d => Math.abs(d))) : 0;

  const chartRows = sessions.slice(0, 10);

  return (
    <Layout>
      <PageHeader
        title="Weighing Reports"
        subtitle="Measurement analysis from real SeedBatch → SeedPacket → WeightSession data"
        actions={
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => exportCSV(sessions)}
              sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#475569' }}>Export CSV</Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => exportExcel(sessions)}
              sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#475569' }}>Export Excel</Button>
          </Box>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

      {/* Filters — map only to real /api/sessions params */}
      <Card sx={{ p: 2.5, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} label="Status" onChange={e => setStatusFilter(e.target.value)} sx={{ borderRadius: 2 }}>
              <MenuItem value="">All</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="linked">Linked</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Date Preset</InputLabel>
            <Select value={datePreset} label="Date Preset" onChange={e => setDatePreset(e.target.value)} sx={{ borderRadius: 2 }}>
              <MenuItem value="24h">Last 24 Hours</MenuItem>
              <MenuItem value="7d">Last 7 Days</MenuItem>
              <MenuItem value="30d">Last 30 Days</MenuItem>
              <MenuItem value="custom">Custom Range</MenuItem>
            </Select>
          </FormControl>
          {datePreset === 'custom' && (
            <>
              <TextField size="small" label="Start Date" type="date" value={customStart}
                onChange={e => setCustomStart(e.target.value)} InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 150, '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
              <TextField size="small" label="End Date" type="date" value={customEnd}
                onChange={e => setCustomEnd(e.target.value)} InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 150, '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
            </>
          )}
          <Button startIcon={<FilterListIcon />} variant="outlined" onClick={resetFilters}
            sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#64748b' }}>Reset</Button>
        </Box>
      </Card>

      {/* KPI Cards — real WeightSession metrics only */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {[
          { title: 'Total Measurements', value: String(pagination.total ?? sessions.length), icon: <ScaleIcon sx={{ color: '#1a227f', fontSize: 22 }} />, iconBg: 'rgba(26,34,127,0.08)' },
          { title: 'Linked',             value: String(linkedCount),                          icon: <TaskAltIcon sx={{ color: '#10b981', fontSize: 22 }} />, iconBg: 'rgba(16,185,129,0.08)' },
          { title: 'Avg Difference',     value: avgDifference != null ? `${avgDifference.toFixed(2)} kg` : '—', icon: <TrendingUpIcon sx={{ color: '#6366f1', fontSize: 22 }} />, iconBg: 'rgba(99,102,241,0.08)' },
          { title: 'Min / Max Difference', value: (minDifference != null && maxDifference != null) ? `${minDifference.toFixed(2)} / ${maxDifference.toFixed(2)} kg` : '—', icon: <CompareArrowsIcon sx={{ color: '#f59e0b', fontSize: 22 }} />, iconBg: 'rgba(245,158,11,0.08)' },
        ].map(c => (
          <Grid size={{ xs: 12, sm: 6, md: 3 }} key={c.title}><StatCard {...c} /></Grid>
        ))}
      </Grid>

      {/* Chart — real per-measurement difference, most recent first */}
      <Card sx={{ p: 3, mb: 3 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 0.5 }}>
          Weight Difference — Recent Measurements
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#64748b', mb: 2 }}>
          {sessions.length} measurement{sessions.length === 1 ? '' : 's'} in selected period · showing up to 10 most recent
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress sx={{ color: '#1a227f' }} /></Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
            {chartRows.map((s) => {
              const d = s.measurement.difference;
              const val = d != null && maxAbsDiff > 0 ? (Math.abs(d) / maxAbsDiff) * 100 : 0;
              const barColor = d == null ? '#cbd5e1' : d < 0 ? '#dc2626' : '#16a34a';
              return (
                <Box key={s.measurement.sessionId} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography sx={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#1a227f', minWidth: 130 }}>
                    {s.measurement.packetUniqueId || s.packet?.uniqueId || '—'}
                  </Typography>
                  <LinearProgress variant="determinate" value={val}
                    sx={{ flex: 1, height: 10, borderRadius: 99, background: '#f1f5f9',
                      '& .MuiLinearProgress-bar': { background: barColor, borderRadius: 99 } }} />
                  <Typography sx={{ fontSize: 12, fontWeight: 800, minWidth: 60, color: barColor }}>
                    {d != null ? `${d} kg` : '—'}
                  </Typography>
                </Box>
              );
            })}
            {chartRows.length === 0 && <Typography sx={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', py: 2 }}>No measurements in selected period</Typography>}
          </Box>
        )}
      </Card>

      {/* Measurement Table */}
      <Card>
        <Box sx={{ px: 3, py: 2.5, borderBottom: '1px solid #f1f5f9' }}>
          <Typography sx={{ fontWeight: 700, fontSize: 15 }}>Measurement Log</Typography>
          <Typography sx={{ fontSize: 12, color: '#64748b' }}>Showing {sessions.length} of {pagination.total ?? sessions.length} measurements in selected period</Typography>
        </Box>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress sx={{ color: '#1a227f' }} /></Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {['Packet ID', 'Batch', 'Seed Type', 'Before', 'After', 'Difference', 'Date & Time', 'Operator', 'Device ID', 'Status'].map(h => <TableCell key={h}>{h}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.length === 0
                  ? <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4, color: '#94a3b8' }}>No measurements in selected period</TableCell></TableRow>
                  : sessions.map((s) => {
                      const m = s.measurement;
                      const sc = statusStyle[m.status] || statusStyle.active;
                      return (
                        <TableRow key={m.sessionId} hover>
                          <TableCell sx={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#1a227f' }}>
                            {m.packetUniqueId || s.packet?.uniqueId || '—'}
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
                          <TableCell sx={{ fontSize: 13 }}>{s.operator?.name || '—'}</TableCell>
                          <TableCell sx={{ fontSize: 12, fontFamily: 'monospace' }}>{s.device?.deviceId || '—'}</TableCell>
                          <TableCell><Chip label={sc.label} size="small" sx={{ fontSize: 11, fontWeight: 800, background: sc.bg, color: sc.color }} /></TableCell>
                        </TableRow>
                      );
                    })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Layout>
  );
}
