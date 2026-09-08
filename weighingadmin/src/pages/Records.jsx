import { useState, useEffect } from 'react';
import {
  Avatar, Box, Button, Card, Chip, CircularProgress, FormControl, Grid, IconButton,
  InputLabel, MenuItem, Select, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, Paper, InputBase, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions, TextField, Alert
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import AddIcon from '@mui/icons-material/Add';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DeleteIcon from '@mui/icons-material/Delete';
import ScaleIcon from '@mui/icons-material/Scale';
import Menu from '@mui/material/Menu';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import api, { recordAPI } from '../services/api';

const statusStyle = { PASS: { bg: '#dcfce7', color: '#16a34a' }, FAIL: { bg: '#fee2e2', color: '#dc2626' }, WARN: { bg: '#fef9c3', color: '#ca8a04' } };
const weightColor = { PASS: '#16a34a', FAIL: '#dc2626', WARN: '#ca8a04' };

const exportCSV = (records) => {
  const h = ['Product', 'Batch', 'Machine', 'Weight', 'Nominal', 'DateTime', 'Operator', 'Status'];
  const rows = records.map(r => [
    r.product?.productName || '', r.product?.batchNumber || '',
    r.machine?.machineId || '', r.actualWeight, r.nominalWeight,
    new Date(r.createdAt).toLocaleString(), r.operator?.name || '', r.status
  ]);
  const csv = [h, ...rows].map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'weight-records.csv'; a.click();
};

export default function Records() {
  const [records, setRecords]   = useState([]);
  const [machines, setMachines] = useState([]);
  const [products, setProducts] = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [machineFilter, setMachineFilter] = useState('');
  const [statusFilter, setStatusFilter]   = useState('');
  const [anchor, setAnchor]     = useState(null);
  const [anchorRecord, setAnchorRecord] = useState(null);
  const [newOpen, setNewOpen]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState('');
  const [form, setForm] = useState({ productId: '', machineId: '', actualWeight: '', nominalWeight: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const PER_PAGE = 8;

  const fetchRecords = () => {
    setLoading(true);
    const params = { page, limit: PER_PAGE };
    if (machineFilter) params.machine = machineFilter;
    if (statusFilter)  params.status  = statusFilter;
    api.get('/records', { params })
      .then(r => { setRecords(r.data.records); setTotal(r.data.count); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRecords(); }, [page, machineFilter, statusFilter]);
  useEffect(() => {
    api.get('/machines').then(r => setMachines(r.data.machines)).catch(() => {});
    api.get('/products').then(r => setProducts(r.data.products)).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true); setSaveMsg('');
    try {
      await api.post('/records', form);
      setSaveMsg('success'); setNewOpen(false);
      setForm({ productId: '', machineId: '', actualWeight: '', nominalWeight: '' });
      fetchRecords();
    } catch (err) {
      setSaveMsg(err.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await recordAPI.delete(anchorRecord._id);
      setRecords(prev => prev.filter(r => r._id !== anchorRecord._id));
      setTotal(t => t - 1);
    } catch (_) {}
    setDeleting(false);
    setConfirmDelete(false);
    setAnchor(null);
    setAnchorRecord(null);
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  // Stats
  const passRate = records.length ? Math.round((records.filter(r => r.status === 'PASS').length / records.length) * 100) : 0;
  const avgWeight = records.length ? (records.reduce((s, r) => s + r.actualWeight, 0) / records.length).toFixed(2) : '0';

  return (
    <Layout>
      <PageHeader
        title="Weight Records"
        subtitle="Monitor and log all manufacturing weight measurements"
        actions={
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => exportCSV(records)}
              sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#475569' }}>Export CSV</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}
              sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', borderRadius: 2 }}>New Record</Button>
          </Box>
        }
      />

      {saveMsg === 'success' && <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>Record saved!</Alert>}

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {[
          { title: 'Total Entries',      value: String(total),       icon: <ScaleIcon sx={{ color: '#1a227f', fontSize: 22 }} />, iconBg: 'rgba(26,34,127,0.08)' },
          { title: 'Avg Weight',         value: `${avgWeight} kg`,   icon: <ScaleIcon sx={{ color: '#6366f1', fontSize: 22 }} />, iconBg: 'rgba(99,102,241,0.08)' },
          { title: 'Pass Rate',          value: `${passRate}%`,      icon: <ScaleIcon sx={{ color: '#10b981', fontSize: 22 }} />, iconBg: 'rgba(16,185,129,0.08)' },
          { title: 'This Page',          value: String(records.length), icon: <ScaleIcon sx={{ color: '#f59e0b', fontSize: 22 }} />, iconBg: 'rgba(245,158,11,0.08)' },
        ].map(c => <Grid size={{ xs: 12, sm: 6, md: 3 }} key={c.title}><StatCard {...c} /></Grid>)}
      </Grid>

      {/* Filters */}
      <Card sx={{ p: 2, mb: 2.5 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Machine</InputLabel>
            <Select value={machineFilter} label="Machine" onChange={e => { setMachineFilter(e.target.value); setPage(1); }} sx={{ borderRadius: 2 }}>
              <MenuItem value="">All Machines</MenuItem>
              {machines.map(m => <MenuItem key={m._id} value={m._id}>{m.machineId} — {m.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} label="Status" onChange={e => { setStatusFilter(e.target.value); setPage(1); }} sx={{ borderRadius: 2 }}>
              <MenuItem value="">All</MenuItem>
              <MenuItem value="PASS">Pass</MenuItem>
              <MenuItem value="FAIL">Fail</MenuItem>
              <MenuItem value="WARN">Warning</MenuItem>
            </Select>
          </FormControl>
          <Button startIcon={<FilterListIcon />} variant="outlined"
            onClick={() => { setMachineFilter(''); setStatusFilter(''); setPage(1); }}
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
                  {['Product / Batch', 'Machine', 'Weight', 'Date & Time', 'Operator', 'Status', ''].map(h => <TableCell key={h}>{h}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {records.length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4, color: '#94a3b8' }}>No records yet — add your first weight record</TableCell></TableRow>
                ) : records.map((r, i) => {
                  const sc = statusStyle[r.status] || statusStyle.PASS;
                  return (
                    <TableRow key={i} hover>
                      <TableCell>
                        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{r.product?.productName || '—'}</Typography>
                        <Typography sx={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{r.product?.batchNumber || ''}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={r.machine?.machineId || '—'} size="small" sx={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11, background: 'rgba(26,34,127,0.06)', color: '#1a227f' }} />
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: 14, fontWeight: 800, color: weightColor[r.status] }}>{r.actualWeight} {r.unit}</Typography>
                        <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>nom: {r.nominalWeight} {r.unit}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, fontFamily: 'monospace', color: '#475569' }}>{new Date(r.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar sx={{ width: 26, height: 26, fontSize: 10, fontWeight: 700, background: 'rgba(26,34,127,0.12)', color: '#1a227f' }}>
                            {r.operator?.name?.charAt(0) || '?'}
                          </Avatar>
                          <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{r.operator?.name || '—'}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell><Chip label={r.status} size="small" sx={{ fontSize: 11, fontWeight: 800, background: sc.bg, color: sc.color }} /></TableCell>
                      <TableCell><IconButton size="small" onClick={e => { setAnchor(e.currentTarget); setAnchorRecord(r); }}><MoreVertIcon fontSize="small" /></IconButton></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        <Box sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9' }}>
          <Typography sx={{ fontSize: 12, color: '#64748b' }}>
            Page {page} of {totalPages || 1} — {total} total records
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

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => { setAnchor(null); setAnchorRecord(null); }}>
        <MenuItem onClick={() => { exportCSV(records); setAnchor(null); setAnchorRecord(null); }}>Export</MenuItem>
        <MenuItem onClick={() => { setConfirmDelete(true); setAnchor(null); }} sx={{ color: '#dc2626', gap: 1 }}>
          <DeleteIcon fontSize="small" /> Delete
        </MenuItem>
      </Menu>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle sx={{ fontWeight: 700 }}>Delete Record?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This weight record for <strong>{anchorRecord?.product?.productName || 'this product'}</strong> will be permanently deleted. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setConfirmDelete(false)} variant="outlined" sx={{ borderRadius: 2 }}>Cancel</Button>
          <Button onClick={handleDelete} variant="contained" color="error" disabled={deleting} sx={{ borderRadius: 2 }}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* New Record Dialog */}
      <Dialog open={newOpen} onClose={() => setNewOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Add New Weight Record</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <FormControl fullWidth required>
            <InputLabel>Product</InputLabel>
            <Select value={form.productId} label="Product" onChange={e => setForm(p => ({ ...p, productId: e.target.value }))} sx={{ borderRadius: 2 }}>
              {products.map(p => <MenuItem key={p._id} value={p._id}>{p.productName} ({p.productId})</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth required>
            <InputLabel>Machine</InputLabel>
            <Select value={form.machineId} label="Machine" onChange={e => setForm(p => ({ ...p, machineId: e.target.value }))} sx={{ borderRadius: 2 }}>
              {machines.map(m => <MenuItem key={m._id} value={m._id}>{m.machineId} — {m.name}</MenuItem>)}
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField label="Actual Weight (kg)" type="number" fullWidth required value={form.actualWeight} onChange={e => setForm(p => ({ ...p, actualWeight: e.target.value }))} InputProps={{ sx: { borderRadius: 2 } }} />
            <TextField label="Nominal Weight (kg)" type="number" fullWidth required value={form.nominalWeight} onChange={e => setForm(p => ({ ...p, nominalWeight: e.target.value }))} InputProps={{ sx: { borderRadius: 2 } }} />
          </Box>
          {saveMsg && saveMsg !== 'success' && <Alert severity="error" sx={{ borderRadius: 2 }}>{saveMsg}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Button onClick={() => setNewOpen(false)} variant="outlined">Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={saving || !form.productId || !form.machineId || !form.actualWeight}
            sx={{ background: '#1a227f' }}>{saving ? 'Saving...' : 'Save Record'}</Button>
        </DialogActions>
      </Dialog>
    </Layout>
  );
}
