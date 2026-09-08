import { useState, useEffect } from 'react';
import {
  Box, Button, Card, Chip, CircularProgress, Grid, IconButton, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem, Alert
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import Menu from '@mui/material/Menu';
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
const effColor = (e) => e >= 80 ? '#16a34a' : e >= 40 ? '#ca8a04' : '#dc2626';

export default function Machines() {
  const [machines, setMachines] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [anchor, setAnchor]     = useState(null);
  const [selected, setSelected] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addOpen, setAddOpen]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [form, setForm] = useState({ machineId: '', name: '', line: '', location: '', category: 'packing', status: 'Standby', efficiency: 0, runtime: 0 });

  const fetchMachines = () => {
    setLoading(true);
    api.get('/machines').then(r => setMachines(r.data.machines)).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchMachines(); }, []);

  const handleAdd = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/machines', form);
      setAddOpen(false);
      setForm({ machineId: '', name: '', line: '', location: '', category: 'packing', status: 'Standby', efficiency: 0, runtime: 0 });
      fetchMachines();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add machine');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    try { await api.delete(`/machines/${id}`); fetchMachines(); } catch (_) {}
    setAnchor(null);
  };

  const counts = {
    total:       machines.length,
    running:     machines.filter(m => m.status === 'Running').length,
    maintenance: machines.filter(m => m.status === 'Maintenance').length,
    fault:       machines.filter(m => m.status === 'Fault').length,
  };

  return (
    <Layout>
      <PageHeader
        title="Machines"
        subtitle="Monitor all registered industrial weighing machines"
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}>
            Add Machine
          </Button>
        }
      />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {[
          { title: 'Total Machines', value: String(counts.total),       icon: <PrecisionManufacturingIcon sx={{ color: '#1a227f', fontSize: 22 }} />, iconBg: 'rgba(26,34,127,0.08)' },
          { title: 'Running',        value: String(counts.running),      icon: <PrecisionManufacturingIcon sx={{ color: '#10b981', fontSize: 22 }} />, iconBg: 'rgba(16,185,129,0.08)' },
          { title: 'Maintenance',    value: String(counts.maintenance),  icon: <PrecisionManufacturingIcon sx={{ color: '#f59e0b', fontSize: 22 }} />, iconBg: 'rgba(245,158,11,0.08)' },
          { title: 'Fault',          value: String(counts.fault),        icon: <PrecisionManufacturingIcon sx={{ color: '#f43f5e', fontSize: 22 }} />, iconBg: 'rgba(244,63,94,0.08)' },
        ].map(c => <Grid size={{ xs: 12, sm: 6, md: 3 }} key={c.title}><StatCard {...c} /></Grid>)}
      </Grid>

      <Card>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress sx={{ color: '#1a227f' }} /></Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {['Machine ID', 'Name', 'Line / Location', 'Runtime', 'Efficiency', 'Status', ''].map(h => <TableCell key={h}>{h}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {machines.length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4, color: '#94a3b8' }}>No machines yet — add your first machine</TableCell></TableRow>
                ) : machines.map(m => {
                  const sc = statusStyle[m.status] || statusStyle.Standby;
                  return (
                    <TableRow key={m._id} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700, color: '#1a227f', fontSize: 13 }}>{m.machineId}</TableCell>
                      <TableCell sx={{ fontSize: 13, fontWeight: 600 }}>{m.name}</TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: 13 }}>{m.line}</Typography>
                        <Typography sx={{ fontSize: 11, color: '#64748b' }}>{m.location}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 13, fontWeight: 600 }}>{m.runtime} hrs</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography sx={{ fontSize: 14, fontWeight: 800, color: effColor(m.efficiency), minWidth: 38 }}>{m.efficiency}%</Typography>
                          <LinearProgress variant="determinate" value={m.efficiency}
                            sx={{ flex: 1, height: 5, borderRadius: 99, background: '#f1f5f9', '& .MuiLinearProgress-bar': { background: effColor(m.efficiency), borderRadius: 99 } }} />
                        </Box>
                      </TableCell>
                      <TableCell><Chip label={m.status} size="small" sx={{ fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.color }} /></TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={e => { setAnchor(e.currentTarget); setSelected(m); }}><MoreVertIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => { setDetailOpen(true); setAnchor(null); }}>View Details</MenuItem>
        <MenuItem onClick={() => handleDelete(selected?._id)} sx={{ color: '#dc2626' }}>Remove</MenuItem>
      </Menu>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Machine Details — {selected?.machineId}</DialogTitle>
        <DialogContent dividers>
          {selected && [
            ['Machine ID', selected.machineId], ['Name', selected.name], ['Line', selected.line],
            ['Location', selected.location], ['Category', selected.category],
            ['Runtime', `${selected.runtime} hrs`], ['Efficiency', `${selected.efficiency}%`], ['Status', selected.status],
          ].map(([k, v]) => (
            <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', py: 1, borderBottom: '1px solid #f1f5f9' }}>
              <Typography sx={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>{k}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{v}</Typography>
            </Box>
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDetailOpen(false)} variant="contained" sx={{ background: '#1a227f' }}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Add New Machine</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField label="Machine ID *" fullWidth value={form.machineId} onChange={e => setForm(p => ({ ...p, machineId: e.target.value }))} InputProps={{ sx: { borderRadius: 2 } }} />
          <TextField label="Machine Name *" fullWidth value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} InputProps={{ sx: { borderRadius: 2 } }} />
          <TextField label="Production Line *" fullWidth value={form.line} onChange={e => setForm(p => ({ ...p, line: e.target.value }))} InputProps={{ sx: { borderRadius: 2 } }} />
          <TextField label="Location *" fullWidth value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} InputProps={{ sx: { borderRadius: 2 } }} />
          <FormControl fullWidth>
            <InputLabel>Category</InputLabel>
            <Select value={form.category} label="Category" onChange={e => setForm(p => ({ ...p, category: e.target.value }))} sx={{ borderRadius: 2 }}>
              {['packing','sorting','filling','other'].map(c => <MenuItem key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</MenuItem>)}
            </Select>
          </FormControl>
          {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Button onClick={() => setAddOpen(false)} variant="outlined">Cancel</Button>
          <Button onClick={handleAdd} variant="contained" disabled={saving || !form.machineId || !form.name} sx={{ background: '#1a227f' }}>
            {saving ? 'Adding...' : 'Add Machine'}
          </Button>
        </DialogActions>
      </Dialog>
    </Layout>
  );
}
