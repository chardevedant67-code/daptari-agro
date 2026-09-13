import { useState, useEffect, useCallback } from 'react';
import {
  Avatar, Box, Card, Chip, CircularProgress, Grid,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Alert,
} from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import { adminAPI } from '../services/api';

// Admin model's own roles — separate from the User/operator model shown on
// the Operators page (see that page's own comment on the same naming
// overlap).
const roleStyle = {
  superadmin: { bg: 'rgba(26,34,127,0.08)', color: '#1a227f' },
  admin:      { bg: '#f0fdf4', color: '#16a34a' },
  operator:   { bg: '#fef9c3', color: '#ca8a04' },
};

const initials = (name) => name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';
const avatarColor = (i) => ['#1a227f', '#6366f1', '#10b981', '#f59e0b', '#f43f5e'][i % 5];

// E.7-A — read-only Admin list. Real data only, via the existing
// GET /api/admin/all (superadmin-only, password already excluded by the
// backend). No create/edit/delete/activate/password actions here — those
// are later E.7 sub-steps, added only once this list view is validated.
export default function Admins() {
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
  // already uses in this project (there with a real 300ms debounce; here
  // with 0, since there's no input to debounce and the fetch should still
  // fire effectively immediately on mount). react-hooks/set-state-in-effect
  // flags a function that sets state being invoked synchronously inside an
  // effect; scheduling it instead avoids that without changing what
  // fetchAdmins itself does.
  useEffect(() => {
    const t = setTimeout(fetchAdmins, 0);
    return () => clearTimeout(t);
  }, [fetchAdmins]);

  const counts = {
    total:      admins.length,
    active:     admins.filter(a => a.isActive).length,
    superadmin: admins.filter(a => a.role === 'superadmin').length,
  };

  return (
    <Layout>
      <PageHeader
        title="Admins"
        subtitle="View all administrator accounts"
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
                  {['Admin', 'Email', 'Role', 'Status'].map(h => <TableCell key={h}>{h}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {admins.length === 0 ? (
                  <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4, color: '#94a3b8' }}>No admins found</TableCell></TableRow>
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
