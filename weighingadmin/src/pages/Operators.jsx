import { useState, useEffect } from 'react';
import {
  Avatar, Box, Button, Card, Chip, CircularProgress, Grid, IconButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem, Alert, Snackbar
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PeopleIcon from '@mui/icons-material/People';
import Menu from '@mui/material/Menu';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import { userAdminAPI } from '../services/api';

// User model's own roles (field accounts) — never Admin's admin/superadmin.
// Admin/back-office account management lives elsewhere, not on this page.
const roleStyle = {
  operator:   { bg: '#f0fdf4', color: '#16a34a' },
  supervisor: { bg: 'rgba(26,34,127,0.08)', color: '#1a227f' },
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
  const [actionMsg, setActionMsg] = useState(''); // delete-conflict/error feedback
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'operator' });

  // Admin-mediated password recovery for operators (Step 9A Option 1) —
  // mobile Users have no self-service reset flow.
  const [pwdOpen, setPwdOpen]     = useState(false);
  const [pwdValue, setPwdValue]   = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError]   = useState('');

  const fetchOperators = () => {
    setLoading(true);
    userAdminAPI.getAll()
      .then(r => setOperators(r.data.users || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOperators(); }, []);

  const handleAdd = async () => {
    setSaving(true); setError('');
    try {
      await userAdminAPI.create(form);
      setAddOpen(false);
      setForm({ name: '', email: '', password: '', role: 'operator' });
      fetchOperators();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create operator');
    } finally { setSaving(false); }
  };

  // A 409 here means this operator has historical weighing records — the
  // backend refuses the delete and asks for deactivation instead, so that
  // response must reach the admin rather than fail silently.
  //
  // Confirmation gate before the existing delete call (E.6) — Cancel makes
  // no API call at all; only Confirm proceeds to the same delete + refresh
  // (or 409 error surfacing) that already existed.
  const handleDelete = async (op) => {
    setAnchor(null);
    if (!op) return;
    if (!window.confirm(`Delete operator "${op.name}" (${op.email})? This cannot be undone.`)) return;
    try {
      await userAdminAPI.delete(op._id);
      fetchOperators();
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Failed to delete operator');
    }
  };

  const handleToggle = async (op) => {
    try {
      await userAdminAPI.update(op._id, { isActive: !op.isActive });
      fetchOperators();
    } catch (_) {}
    setAnchor(null);
  };

  const closePwdDialog = () => { setPwdOpen(false); setPwdError(''); setPwdValue(''); };

  const handleSetPassword = async () => {
    if (!selected || pwdValue.length < 6) return;
    setPwdSaving(true); setPwdError('');
    try {
      await userAdminAPI.setPassword(selected._id, pwdValue);
      closePwdDialog();
    } catch (err) {
      setPwdError(err.response?.data?.message || 'Failed to update password');
    } finally {
      setPwdSaving(false);
    }
  };

  const counts = {
    total:       operators.length,
    active:      operators.filter(o => o.isActive).length,
    supervisors: operators.filter(o => o.role === 'supervisor').length,
  };

  return (
    <Layout>
      <PageHeader
        title="Operators"
        subtitle="Manage field operators and supervisors"
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
          { title: 'Supervisors',     value: String(counts.supervisors), icon: <PeopleIcon sx={{ color: '#6366f1', fontSize: 22 }} />, iconBg: 'rgba(99,102,241,0.08)' },
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
        <MenuItem onClick={() => { setPwdOpen(true); setAnchor(null); }}>Set Password</MenuItem>
        <MenuItem onClick={() => handleToggle(selected)}>
          {selected?.isActive ? 'Deactivate' : 'Activate'}
        </MenuItem>
        <MenuItem onClick={() => handleDelete(selected)} sx={{ color: '#dc2626' }}>Delete</MenuItem>
      </Menu>

      {/* Set Password Dialog — superadmin-mediated recovery for a locked-out operator */}
      <Dialog open={pwdOpen} onClose={closePwdDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Set Password — {selected?.name}</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="New Password" type="password" fullWidth autoFocus
            value={pwdValue} onChange={e => setPwdValue(e.target.value)}
            InputProps={{ sx: { borderRadius: 2 } }}
          />
          {pwdError && <Alert severity="error" sx={{ borderRadius: 2 }}>{pwdError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Button onClick={closePwdDialog} variant="outlined">Cancel</Button>
          <Button onClick={handleSetPassword} variant="contained" disabled={pwdSaving || pwdValue.length < 6}
            sx={{ background: '#1a227f' }}>{pwdSaving ? 'Saving...' : 'Set Password'}</Button>
        </DialogActions>
      </Dialog>

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
              <MenuItem value="supervisor">Supervisor</MenuItem>
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

      <Snackbar open={!!actionMsg} autoHideDuration={5000} onClose={() => setActionMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => setActionMsg('')} sx={{ borderRadius: 2 }}>{actionMsg}</Alert>
      </Snackbar>
    </Layout>
  );
}
