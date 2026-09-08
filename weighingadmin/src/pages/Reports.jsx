import { useState, useEffect } from 'react';
import {
  Box, Button, Card, Chip, CircularProgress, FormControl, Grid, InputLabel,
  MenuItem, Select, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import FilterListIcon from '@mui/icons-material/FilterList';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BoltIcon from '@mui/icons-material/Bolt';
import WarningIcon from '@mui/icons-material/Warning';
import SpeedIcon from '@mui/icons-material/Speed';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import api from '../services/api';

const statusStyle = {
  Running:     { bg: '#dcfce7', color: '#16a34a' },
  Standby:     { bg: '#fef9c3', color: '#ca8a04' },
  Maintenance: { bg: '#fee2e2', color: '#dc2626' },
  Fault:       { bg: '#fce7f3', color: '#db2777' },
};

const exportCSV = (rows) => {
  const h = ['Machine ID', 'Name', 'Line', 'Location', 'Runtime (hrs)', 'Efficiency %', 'Status', 'Category'];
  const csv = [h, ...rows.map(m => [m.machineId, m.name, m.line, m.location, m.runtime, m.efficiency, m.status, m.category])].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'machine-report.csv'; a.click();
};

const exportExcel = (rows) => {
  const h = ['Machine ID', 'Name', 'Line', 'Location', 'Runtime (hrs)', 'Efficiency %', 'Status', 'Category'];
  const tsv = [h, ...rows.map(m => [m.machineId, m.name, m.line, m.location, m.runtime, m.efficiency, m.status, m.category])].map(r => r.join('\t')).join('\n');
  const blob = new Blob([tsv], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'machine-report.xls'; a.click();
};

export default function Reports() {
  const [machines, setMachines]   = useState([]);
  const [records, setRecords]     = useState([]);
  const [filtered, setFiltered]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [category, setCategory]   = useState('all');
  const [datePreset, setDatePreset] = useState('7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd]     = useState('');
  const [metric, setMetric]       = useState('efficiency');
  const [detailMachine, setDetailMachine] = useState(null);

  useEffect(() => {
    api.get('/machines')
      .then(r => { setMachines(r.data.machines); setFiltered(r.data.machines); })
      .catch(() => {})
      .finally(() => setLoading(false));
    api.get('/records')
      .then(r => setRecords(r.data.records || []))
      .catch(() => {});
  }, []);

  const getDateBoundary = () => {
    const now = new Date();
    if (datePreset === '24h') { const d = new Date(now); d.setHours(d.getHours() - 24); return d; }
    if (datePreset === '7d')  { const d = new Date(now); d.setDate(d.getDate() - 7);    return d; }
    if (datePreset === '30d') { const d = new Date(now); d.setDate(d.getDate() - 30);   return d; }
    return null;
  };

  const filteredRecords = records.filter(r => {
    const created = new Date(r.createdAt);
    if (datePreset === 'custom') {
      if (customStart && created < new Date(customStart)) return false;
      if (customEnd)   { const end = new Date(customEnd); end.setHours(23,59,59,999); if (created > end) return false; }
      return true;
    }
    const boundary = getDateBoundary();
    return boundary ? created >= boundary : true;
  });

  const applyFilters = () => {
    setFiltered(machines.filter(m => category === 'all' || m.category === category));
  };

  const resetFilters = () => {
    setCategory('all'); setDatePreset('7d'); setMetric('efficiency');
    setCustomStart(''); setCustomEnd('');
    setFiltered(machines);
  };

  const avgEff = filtered.length ? Math.round(filtered.reduce((s, m) => s + m.efficiency, 0) / filtered.length) : 0;
  const downtimeCount = filtered.filter(m => m.status === 'Fault' || m.status === 'Maintenance').length;

  return (
    <Layout>
      <PageHeader
        title="Reports & Analytics"
        subtitle="System performance analysis and machine operational logs"
        actions={
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => exportCSV(filtered)}
              sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#475569' }}>Export CSV</Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => exportExcel(filtered)}
              sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#475569' }}>Export Excel</Button>
          </Box>
        }
      />

      {/* Filters */}
      <Card sx={{ p: 2.5, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Machine Category</InputLabel>
            <Select value={category} label="Machine Category" onChange={e => setCategory(e.target.value)} sx={{ borderRadius: 2 }}>
              <MenuItem value="all">All Categories</MenuItem>
              <MenuItem value="packing">Packing Line</MenuItem>
              <MenuItem value="sorting">Sorting Line</MenuItem>
              <MenuItem value="filling">Filling Line</MenuItem>
              <MenuItem value="other">Other</MenuItem>
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
              <TextField
                size="small"
                label="Start Date"
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 150, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
              />
              <TextField
                size="small"
                label="End Date"
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 150, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
              />
            </>
          )}
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Metric</InputLabel>
            <Select value={metric} label="Metric" onChange={e => setMetric(e.target.value)} sx={{ borderRadius: 2 }}>
              <MenuItem value="efficiency">Efficiency %</MenuItem>
              <MenuItem value="runtime">Runtime hrs</MenuItem>
            </Select>
          </FormControl>
          <Button startIcon={<FilterListIcon />} variant="contained" onClick={applyFilters}
            sx={{ borderRadius: 2, background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}>Apply Filters</Button>
          <Button variant="outlined" onClick={resetFilters}
            sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#64748b' }}>Reset</Button>
        </Box>
      </Card>

      {/* KPI Cards */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {[
          { title: 'Avg Efficiency',     value: `${avgEff}%`,                    icon: <SpeedIcon sx={{ color: '#1a227f', fontSize: 22 }} />, iconBg: 'rgba(26,34,127,0.08)' },
          { title: 'Total Machines',     value: String(machines.length),         icon: <AssessmentIcon sx={{ color: '#10b981', fontSize: 22 }} />, iconBg: 'rgba(16,185,129,0.08)' },
          { title: 'Downtime / Faults',  value: String(downtimeCount),           icon: <WarningIcon sx={{ color: '#f59e0b', fontSize: 22 }} />, iconBg: 'rgba(245,158,11,0.08)' },
          { title: 'Running Now',        value: String(machines.filter(m => m.status === 'Running').length), icon: <BoltIcon sx={{ color: '#6366f1', fontSize: 22 }} />, iconBg: 'rgba(99,102,241,0.08)' },
        ].map(c => (
          <Grid size={{ xs: 12, sm: 6, md: 3 }} key={c.title}><StatCard {...c} /></Grid>
        ))}
      </Grid>

      {/* Chart / Bar visualization */}
      <Card sx={{ p: 3, mb: 3 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 0.5 }}>
          {metric === 'efficiency' ? 'Efficiency %' : 'Runtime (hrs)'} — {datePreset === '24h' ? 'Last 24h' : datePreset === '7d' ? 'Last 7 days' : datePreset === '30d' ? 'Last 30 days' : 'Custom range'}
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#64748b', mb: 2 }}>Machine performance overview ({filtered.length} machines) · {filteredRecords.length} records in selected period</Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress sx={{ color: '#1a227f' }} /></Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
            {filtered.map(m => {
              const val = metric === 'efficiency' ? m.efficiency : Math.min(m.runtime * 4, 100);
              const displayVal = metric === 'efficiency' ? `${m.efficiency}%` : `${m.runtime} hrs`;
              const barColor = m.efficiency >= 80 ? '#10b981' : m.efficiency >= 40 ? '#f59e0b' : '#f43f5e';
              return (
                <Box key={m._id} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography sx={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#1a227f', minWidth: 70 }}>{m.machineId}</Typography>
                  <LinearProgress variant="determinate" value={val}
                    sx={{ flex: 1, height: 10, borderRadius: 99, background: '#f1f5f9',
                      '& .MuiLinearProgress-bar': { background: barColor, borderRadius: 99 } }} />
                  <Typography sx={{ fontSize: 12, fontWeight: 800, minWidth: 50, color: barColor }}>{displayVal}</Typography>
                </Box>
              );
            })}
            {filtered.length === 0 && <Typography sx={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', py: 2 }}>No machines match filter</Typography>}
          </Box>
        )}
      </Card>

      {/* Machine Log Table */}
      <Card>
        <Box sx={{ px: 3, py: 2.5, borderBottom: '1px solid #f1f5f9' }}>
          <Typography sx={{ fontWeight: 700, fontSize: 15 }}>Machine Operational Log</Typography>
          <Typography sx={{ fontSize: 12, color: '#64748b' }}>Showing {filtered.length} machines</Typography>
        </Box>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress sx={{ color: '#1a227f' }} /></Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {['Machine ID', 'Name', 'Line / Location', 'Runtime (hrs)', 'Efficiency %', 'Status', 'Details'].map(h => <TableCell key={h}>{h}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.length === 0
                  ? <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4, color: '#94a3b8' }}>No machines match filter</TableCell></TableRow>
                  : filtered.map(m => {
                      const sc = statusStyle[m.status] || statusStyle.Standby;
                      return (
                        <TableRow key={m._id} hover>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', background: sc.color }} />
                              <Typography sx={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: '#1a227f' }}>{m.machineId}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell sx={{ fontSize: 13, fontWeight: 600 }}>{m.name}</TableCell>
                          <TableCell>
                            <Typography sx={{ fontSize: 13 }}>{m.line}</Typography>
                            <Typography sx={{ fontSize: 11, color: '#64748b' }}>{m.location}</Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 13, fontWeight: 700 }}>{m.runtime} hrs</TableCell>
                          <TableCell>
                            <Typography sx={{ fontSize: 14, fontWeight: 800, color: m.efficiency >= 85 ? '#16a34a' : m.efficiency >= 50 ? '#ca8a04' : '#dc2626' }}>
                              {m.efficiency}%
                            </Typography>
                          </TableCell>
                          <TableCell><Chip label={m.status} size="small" sx={{ fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.color }} /></TableCell>
                          <TableCell>
                            <Button size="small" variant="outlined" onClick={() => setDetailMachine(m)}
                              sx={{ fontSize: 12, fontWeight: 600, borderRadius: 1.5, borderColor: '#1a227f', color: '#1a227f', textTransform: 'none', py: 0.3, px: 1.2 }}>
                              View Details
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {/* Machine Detail Dialog */}
      <Dialog open={Boolean(detailMachine)} onClose={() => setDetailMachine(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Machine Details — {detailMachine?.machineId}</DialogTitle>
        <DialogContent dividers>
          {detailMachine && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {[
                ['Machine ID',  detailMachine.machineId],
                ['Name',        detailMachine.name],
                ['Line',        detailMachine.line],
                ['Location',    detailMachine.location],
                ['Category',    detailMachine.category],
                ['Runtime',     `${detailMachine.runtime} hrs`],
                ['Efficiency',  `${detailMachine.efficiency}%`],
                ['Status',      detailMachine.status],
              ].map(([k, v]) => (
                <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', py: 1.2, borderBottom: '1px solid #f1f5f9' }}>
                  <Typography sx={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>{k}</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, fontFamily: k === 'Machine ID' ? 'monospace' : 'inherit' }}>{v}</Typography>
                </Box>
              ))}
              <Box sx={{ mt: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#64748b', mb: 1 }}>Efficiency Gauge</Typography>
                <LinearProgress variant="determinate" value={detailMachine.efficiency}
                  sx={{ height: 10, borderRadius: 99, background: '#f1f5f9',
                    '& .MuiLinearProgress-bar': { background: detailMachine.efficiency >= 80 ? '#10b981' : detailMachine.efficiency >= 40 ? '#f59e0b' : '#f43f5e', borderRadius: 99 } }} />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDetailMachine(null)} variant="contained" sx={{ background: '#1a227f' }}>Close</Button>
        </DialogActions>
      </Dialog>
    </Layout>
  );
}
