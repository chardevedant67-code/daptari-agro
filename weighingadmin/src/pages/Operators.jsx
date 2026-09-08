import { useState, useEffect } from 'react';
import {
  Avatar, Box, Button, Card, Chip, CircularProgress, Grid, IconButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem, Alert
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PeopleIcon from '@mui/icons-material/People';
import Menu from '@mui/material/Menu';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import api from '../services/api';

const roleStyle = {
  superadmin: { bg: '#ede9fe', color: '#7c3aed' },
  admin:      { bg: 'rgba(26,34,127,0.08)', color: '#1a227f' },
  operator:   { bg: '#f0fdf4', color: '#16a34a' },
};

const initials = (name) => name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';
const avatarColor = (i) => ['#1a227f', '#6366f1', '#10b981', '#f59e0b', '#f43f5e'][i % 5];

export default function Operators() {
  const [operators, setOperators] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [anchor, setAnchor]       = useState(null);
  const [selected, setSelected]   = useState(null);
  const [addOpen, setAddOpen]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'operator' });

  const fetchOperators = () => {
    setLoading(true);
    api.get('/admin/all')
      .then(r => setOperators(r.data.admins || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOperators(); }, []);

  const handleAdd = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/admin/create', form);
      setAddOpen(false);
      setForm({ name: '', email: '', password: '', role: 'operator' });
      fetchOperators();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create operator');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    try { await api.delete(`/admin/${id}`); fetchOperators(); } catch (_) {}
    setAnchor(null);
  };

  const handleToggle = async (op) => {
    try {
      await api.put(`/admin/${op._id}`, { isActive: !op.isActive });
      fetchOperators();
    } catch (_) {}
    setAnchor(null);
  };

  const counts = {
    total:  operators.length,
    active: operators.filter(o => o.isActive).length,
    admins: operators.filter(o => o.role === 'admin' || o.role === 'superadmin').length,
  };

  return (
    <Layout>
      <PageHeader
        title="Operators"
        subtitle="Manage all system users and their access levels"
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}>
            Add Operator
          </Button>
        }
      />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {[
          { title: 'Total Operators', value: String(counts.total),  icon: <PeopleIcon sx={{ color: '#1a227f', fontSize: 22 }} />, iconBg: 'rgba(26,34,127,0.08)' },
          { title: 'Active',          value: String(counts.active), icon: <PeopleIcon sx={{ color: '#10b981', fontSize: 22 }} />, iconBg: 'rgba(16,185,129,0.08)' },
          { title: 'Admins',          value: String(counts.admins), icon: <PeopleIcon sx={{ color: '#6366f1', fontSize: 22 }} />, iconBg: 'rgba(99,102,241,0.08)' },
          { title: 'Inactive',        value: String(counts.total - counts.active), icon: <PeopleIcon sx={{ color: '#f59e0b', fontSize: 22 }} />, iconBg: 'rgba(245,158,11,0.08)' },
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
                  {['Operator', 'Email', 'Role', 'Status', ''].map(h => <TableCell key={h}>{h}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {operators.length === 0 ? (
                  <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: '#94a3b8' }}>No operators yet</TableCell></TableRow>
                ) : operators.map((op, i) => {
                  const rc = roleStyle[op.role] || roleStyle.operator;
                  return (
                    <TableRow key={op._id} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar sx={{ width: 34, height: 34, fontSize: 12, fontWeight: 700, background: avatarColor(i) }}>{initials(op.name)}</Avatar>
                          <Box>
                            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{op.name}</Typography>
                            <Typography sx={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{op._id?.slice(-6).toUpperCase()}</Typography>
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ fontSize: 13, color: '#475569' }}>{op.email}</TableCell>
                      <TableCell><Chip label={op.role} size="small" sx={{ fontSize: 11, fontWeight: 700, background: rc.bg, color: rc.color }} /></TableCell>
                      <TableCell>
                        <Chip label={op.isActive ? 'Active' : 'Inactive'} size="small"
                          sx={{ fontSize: 11, fontWeight: 700,
                            background: op.isActive ? '#dcfce7' : '#f1f5f9',
                            color: op.isActive ? '#16a34a' : '#94a3b8' }} />
                      </TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={e => { setAnchor(e.currentTarget); setSelected(op); }}><MoreVertIcon fontSize="small" /></IconButton>
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
        <MenuItem onClick={() => handleToggle(selected)}>
          {selected?.isActive ? 'Deactivate' : 'Activate'}
        </MenuItem>
        <MenuItem onClick={() => handleDelete(selected?._id)} sx={{ color: '#dc2626' }}>Delete</MenuItem>
      </Menu>

      {/* Add Operator Dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Add New Operator</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField label="Full Name" fullWidth value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} InputProps={{ sx: { borderRadius: 2 } }} />
          <TextField label="Email Address" type="email" fullWidth value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} InputProps={{ sx: { borderRadius: 2 } }} />
          <TextField label="Password" type="password" fullWidth value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} InputProps={{ sx: { borderRadius: 2 } }} />
          <FormControl fullWidth>
            <InputLabel>Role</InputLabel>
            <Select value={form.role} label="Role" onChange={e => setForm(p => ({ ...p, role: e.target.value }))} sx={{ borderRadius: 2 }}>
              <MenuItem value="operator">Operator</MenuItem>
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="superadmin">Super Admin</MenuItem>
            </Select>
          </FormControl>
          {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Button onClick={() => setAddOpen(false)} variant="outlined">Cancel</Button>
          <Button onClick={handleAdd} variant="contained" disabled={saving || !form.name || !form.email || !form.password}
            sx={{ background: '#1a227f' }}>{saving ? 'Creating...' : 'Create Operator'}</Button>
        </DialogActions>
      </Dialog>
    </Layout>
  );
}
