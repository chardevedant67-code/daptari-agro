import { useState, useEffect, useCallback } from 'react';
import {
  Avatar, Box, Button, Card, Chip, CircularProgress, Grid, IconButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Alert, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem, Snackbar, Switch,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import Menu from '@mui/material/Menu';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import { adminAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

// Admin model's own roles — separate from the User/operator model shown on
// the Operators page (see that page's own comment on the same naming
// overlap). Matches server/models/Admin.js's schema enum exactly — never a
// different list than what the backend actually accepts.
const ADMIN_ROLES = ['superadmin', 'admin', 'operator'];
const roleStyle = {
  superadmin: { bg: 'rgba(26,34,127,0.08)', color: '#1a227f' },
  admin:      { bg: '#f0fdf4', color: '#16a34a' },
  operator:   { bg: '#fef9c3', color: '#ca8a04' },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPTY_CREATE_FORM = { name: '', email: '', password: '', role: 'admin' };

const initials = (name) => name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';
const avatarColor = (i) => ['#1a227f', '#6366f1', '#10b981', '#f59e0b', '#f43f5e'][i % 5];

// E.7-A/B — Admin list (real data via GET /api/admin/all) plus Create and
// Delete (E.7-B), both superadmin-only. Edit/Activate-Deactivate/password
// reset are later E.7 sub-steps, not part of this one.
export default function Admins() {
  // The backend is the real authority on all of this (every mutation route
  // below is already allowRoles('superadmin')-gated server-side) — this
  // only decides whether to show controls the current user could never
  // actually use, so they don't hit an avoidable 403.
  const { admin: currentAdmin } = useAuth();
  const isSuperadmin = currentAdmin?.role === 'superadmin';

  const [admins, setAdmins]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const fetchAdmins = useCallback(() => {
    setLoading(true); setError('');
    adminAPI.getAll()
      .then(r => setAdmins(r.data.admins || []))
      .catch(err => setError(err.response?.data?.message || 'Could not load admins'))
      .finally(() => setLoading(false));
  }, []);

  // Deferred via setTimeout(..., 0) rather than called directly in the
  // effect body — same technique Products.jsx's fetchInventory effect
  // already uses in this project; avoids the react-hooks/set-state-in-effect
  // lint rule without changing what fetchAdmins itself does or when it
  // effectively runs (still immediately on mount).
  useEffect(() => {
    const t = setTimeout(fetchAdmins, 0);
    return () => clearTimeout(t);
  }, [fetchAdmins]);

  // One shared snackbar for both success and error feedback (Create and
  // Delete both use it) — same Snackbar+Alert building block already used
  // elsewhere in this app (Products.jsx's create-success toast, Operators.jsx's
  // delete-conflict toast), just consolidated instead of duplicated.
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });
  const showSnack = (message, severity = 'success') => setSnack({ open: true, message, severity });
  const closeSnack = () => setSnack(s => ({ ...s, open: false }));

  // ── Create Admin ──────────────────────────────────────────────
  const [createOpen, setCreateOpen]   = useState(false);
  const [createForm, setCreateForm]   = useState(EMPTY_CREATE_FORM);
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState('');

  const closeCreate = () => {
    if (creating) return; // don't let the dialog be dismissed mid-request
    setCreateOpen(false);
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateError('');
  };

  const handleCreate = async () => {
    setCreateError('');
    if (!createForm.name.trim()) { setCreateError('Name is required'); return; }
    if (!createForm.email.trim() || !EMAIL_RE.test(createForm.email.trim())) { setCreateError('A valid email is required'); return; }
    if (createForm.password.length < 6) { setCreateError('Password must be at least 6 characters'); return; }
    if (!ADMIN_ROLES.includes(createForm.role)) { setCreateError('Select a valid role'); return; }

    setCreating(true);
    try {
      await adminAPI.create({
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        password: createForm.password,
        role: createForm.role,
      });
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE_FORM);
      showSnack('Admin created successfully');
      fetchAdmins();
    } catch (err) {
      // Real API error only — dialog stays open, fields are left exactly as
      // typed so the admin can fix and retry. Never claim success here.
      setCreateError(err.response?.data?.message || 'Failed to create admin');
    } finally {
      setCreating(false);
    }
  };

  // ── Delete Admin ──────────────────────────────────────────────
  const [anchor, setAnchor]     = useState(null);
  const [selected, setSelected] = useState(null);

  const openMenu = (e, a) => { setAnchor(e.currentTarget); setSelected(a); };
  const closeMenu = () => setAnchor(null);

  const handleDelete = async (target) => {
    setAnchor(null);
    if (!target) return;
    if (!window.confirm(`Delete admin "${target.name}" (${target.email})? This cannot be undone.`)) return;
    try {
      await adminAPI.delete(target._id || target.id);
      showSnack('Admin deleted successfully');
      fetchAdmins();
    } catch (err) {
      // Covers the backend's own self-delete block and any other conflict,
      // shown exactly as returned — the list is left exactly as it was,
      // never assumed deleted.
      showSnack(err.response?.data?.message || 'Failed to delete admin', 'error');
    }
  };

  // ── Edit Admin (E.7-C) — name, role, isActive only. Email is never part
  // of editForm and is never sent — the backend's own PUT /api/admin/:id
  // doesn't accept it either, so this isn't a restriction beyond what the
  // API already enforces. ─────────────────────────────────────────
  const [editOpen, setEditOpen]     = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm]     = useState({ name: '', role: 'admin', isActive: true });
  const [editing, setEditing]       = useState(false);
  const [editError, setEditError]   = useState('');

  const openEdit = () => {
    if (!selected) return;
    setEditTarget(selected);
    setEditForm({ name: selected.name || '', role: selected.role, isActive: selected.isActive });
    setEditError('');
    setEditOpen(true);
    setAnchor(null);
  };

  const closeEdit = () => {
    if (editing) return; // don't let the dialog be dismissed mid-request
    setEditOpen(false);
    setEditTarget(null);
    setEditError('');
  };

  const handleEditSave = async () => {
    setEditError('');
    if (!editForm.name.trim()) { setEditError('Name is required'); return; }
    if (!ADMIN_ROLES.includes(editForm.role)) { setEditError('Select a valid role'); return; }
    if (typeof editForm.isActive !== 'boolean') { setEditError('Select a valid status'); return; }

    // The backend has no special protection here — it already allows a
    // superadmin to deactivate any admin (including the last active
    // superadmin) or demote another superadmin, with no safeguard. Since the
    // UI is the only place this gets surfaced, an extra confirmation is
    // shown for exactly these two consequences before saving — this doesn't
    // block or alter what the backend would otherwise allow, it only makes
    // the destructive result explicit before it happens.
    const isDeactivating = editTarget.isActive && !editForm.isActive;
    const isSuperadminRoleChange = editTarget.role === 'superadmin' && editForm.role !== editTarget.role;
    if (isDeactivating && !window.confirm(`Deactivate admin "${editTarget.name}" (${editTarget.email})? They will immediately lose access.`)) return;
    if (isSuperadminRoleChange && !window.confirm(`Change "${editTarget.name}" (${editTarget.email}) from superadmin to ${editForm.role}? This removes their superadmin access.`)) return;

    setEditing(true);
    try {
      await adminAPI.update(editTarget._id || editTarget.id, {
        name: editForm.name.trim(),
        role: editForm.role,
        isActive: editForm.isActive,
      });
      setEditOpen(false);
      setEditTarget(null);
      showSnack('Admin updated successfully');
      fetchAdmins();
    } catch (err) {
      // Real API error only — dialog stays open, the row is left exactly as
      // it was until a real success response arrives.
      setEditError(err.response?.data?.message || 'Failed to update admin');
    } finally {
      setEditing(false);
    }
  };

  const counts = {
    total:      admins.length,
    active:     admins.filter(a => a.isActive).length,
    superadmin: admins.filter(a => a.role === 'superadmin').length,
  };

  const columns = isSuperadmin ? ['Admin', 'Email', 'Role', 'Status', ''] : ['Admin', 'Email', 'Role', 'Status'];

  return (
    <Layout>
      <PageHeader
        title="Admins"
        subtitle="View all administrator accounts"
        actions={isSuperadmin ? (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}>
            Create Admin
          </Button>
        ) : undefined}
      />

      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {[
          { title: 'Total Admins', value: String(counts.total),      icon: <AdminPanelSettingsIcon sx={{ color: '#1a227f', fontSize: 22 }} />, iconBg: 'rgba(26,34,127,0.08)' },
          { title: 'Active',       value: String(counts.active),     icon: <AdminPanelSettingsIcon sx={{ color: '#10b981', fontSize: 22 }} />, iconBg: 'rgba(16,185,129,0.08)' },
          { title: 'Superadmins',  value: String(counts.superadmin), icon: <AdminPanelSettingsIcon sx={{ color: '#6366f1', fontSize: 22 }} />, iconBg: 'rgba(99,102,241,0.08)' },
        ].map(c => <Grid size={{ xs: 12, sm: 6, md: 4 }} key={c.title}><StatCard {...c} /></Grid>)}
      </Grid>

      <Card>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress sx={{ color: '#1a227f' }} /></Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {columns.map(h => <TableCell key={h}>{h}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {admins.length === 0 ? (
                  <TableRow><TableCell colSpan={columns.length} align="center" sx={{ py: 4, color: '#94a3b8' }}>No admins found</TableCell></TableRow>
                ) : admins.map((a, i) => {
                  const rc = roleStyle[a.role] || roleStyle.admin;
                  return (
                    <TableRow key={a._id || a.id} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar sx={{ width: 34, height: 34, fontSize: 12, fontWeight: 700, background: avatarColor(i) }}>{initials(a.name)}</Avatar>
                          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{a.name}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ fontSize: 13, color: '#475569' }}>{a.email}</TableCell>
                      <TableCell><Chip label={a.role} size="small" sx={{ fontSize: 11, fontWeight: 700, background: rc.bg, color: rc.color }} /></TableCell>
                      <TableCell>
                        <Chip label={a.isActive ? 'Active' : 'Inactive'} size="small"
                          sx={{ fontSize: 11, fontWeight: 700,
                            background: a.isActive ? '#dcfce7' : '#f1f5f9',
                            color: a.isActive ? '#16a34a' : '#94a3b8' }} />
                      </TableCell>
                      {isSuperadmin && (
                        <TableCell>
                          <IconButton size="small" onClick={(e) => openMenu(e, a)}><MoreVertIcon fontSize="small" /></IconButton>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {isSuperadmin && (
        <>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu}>
            <MenuItem onClick={openEdit}>Edit</MenuItem>
            <MenuItem onClick={() => handleDelete(selected)} sx={{ color: '#dc2626' }}>Delete</MenuItem>
          </Menu>

          {/* Create Admin Dialog */}
          <Dialog open={createOpen} onClose={closeCreate} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontWeight: 700 }}>Create Admin</DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
              <TextField
                label="Full Name" fullWidth
                value={createForm.name}
                onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
                InputProps={{ sx: { borderRadius: 2 } }}
              />
              <TextField
                label="Email Address" type="email" fullWidth
                value={createForm.email}
                onChange={e => setCreateForm(p => ({ ...p, email: e.target.value }))}
                InputProps={{ sx: { borderRadius: 2 } }}
              />
              <TextField
                label="Password" type="password" fullWidth
                value={createForm.password}
                onChange={e => setCreateForm(p => ({ ...p, password: e.target.value }))}
                helperText="Minimum 6 characters"
                InputProps={{ sx: { borderRadius: 2 } }}
              />
              <FormControl fullWidth>
                <InputLabel>Role</InputLabel>
                <Select
                  value={createForm.role} label="Role"
                  onChange={e => setCreateForm(p => ({ ...p, role: e.target.value }))}
                  sx={{ borderRadius: 2 }}
                >
                  {ADMIN_ROLES.map(r => <MenuItem key={r} value={r} sx={{ textTransform: 'capitalize' }}>{r}</MenuItem>)}
                </Select>
              </FormControl>
              {createError && <Alert severity="error" sx={{ borderRadius: 2 }}>{createError}</Alert>}
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
              <Button onClick={closeCreate} variant="outlined" disabled={creating}>Cancel</Button>
              <Button onClick={handleCreate} variant="contained" disabled={creating}
                sx={{ background: '#1a227f' }}>{creating ? 'Creating...' : 'Create Admin'}</Button>
            </DialogActions>
          </Dialog>

          {/* Edit Admin Dialog (E.7-C) — name, role, status only */}
          <Dialog open={editOpen} onClose={closeEdit} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontWeight: 700 }}>Edit Admin</DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
              <TextField
                label="Email" fullWidth disabled
                value={editTarget?.email || ''}
                helperText="Email cannot be changed"
                InputProps={{ sx: { borderRadius: 2, color: '#94a3b8' } }}
              />
              <TextField
                label="Full Name" fullWidth
                value={editForm.name}
                onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                InputProps={{ sx: { borderRadius: 2 } }}
              />
              <FormControl fullWidth>
                <InputLabel>Role</InputLabel>
                <Select
                  value={editForm.role} label="Role"
                  onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}
                  sx={{ borderRadius: 2 }}
                >
                  {ADMIN_ROLES.map(r => <MenuItem key={r} value={r} sx={{ textTransform: 'capitalize' }}>{r}</MenuItem>)}
                </Select>
              </FormControl>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                  Status: {editForm.isActive ? 'Active' : 'Inactive'}
                </Typography>
                <Switch
                  checked={editForm.isActive}
                  onChange={e => setEditForm(p => ({ ...p, isActive: e.target.checked }))}
                  sx={{
                    '& .MuiSwitch-switchBase.Mui-checked': { color: '#1a227f' },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { background: '#1a227f' },
                  }}
                />
              </Box>
              {editError && <Alert severity="error" sx={{ borderRadius: 2 }}>{editError}</Alert>}
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
              <Button onClick={closeEdit} variant="outlined" disabled={editing}>Cancel</Button>
              <Button onClick={handleEditSave} variant="contained" disabled={editing}
                sx={{ background: '#1a227f' }}>{editing ? 'Saving...' : 'Save Changes'}</Button>
            </DialogActions>
          </Dialog>
        </>
      )}

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={closeSnack}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={closeSnack} sx={{ borderRadius: 2 }}>{snack.message}</Alert>
      </Snackbar>
    </Layout>
  );
}
