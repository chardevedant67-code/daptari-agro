import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, Grid, LinearProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import AllInboxIcon from '@mui/icons-material/AllInbox';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import ScaleIcon from '@mui/icons-material/Scale';
import QrCodeIcon from '@mui/icons-material/QrCode';
import AddIcon from '@mui/icons-material/Add';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import api, { sessionAPI } from '../services/api';

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData]         = useState(null);
  const [recent, setRecent]     = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/stats')
      .then(res => setData(res.data))
      .catch(() => {});
    sessionAPI.getAll({ limit: 5 })
      .then(res => setRecent(res.data.sessions || []))
      .catch(() => {})
      .finally(() => setRecentLoading(false));
  }, []);

  // Real current-system metrics only (SeedBatch → SeedPacket → WeightSession).
  // The legacy `stats` block still exists in the response for backward
  // compatibility but is intentionally not used for these cards.
  const cs = data?.currentSystem || {};
  const totalBatches      = cs.totalBatches ?? 0;
  const totalPackets      = cs.totalPackets ?? 0;
  const filledPackets     = cs.filledPackets ?? 0;
  const pendingPackets    = cs.pendingPackets ?? 0;
  const totalMeasurements = cs.totalMeasurements ?? 0;
  const fillPct = totalPackets > 0 ? Math.round((filledPackets / totalPackets) * 100) : 0;

  return (
    <Layout>
      <PageHeader
        title="Dashboard"
        subtitle="Welcome back — here's what's happening today"
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/batches')}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}>
            New Batch
          </Button>
        }
      />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {[
          { title: 'Total Batches',       value: String(totalBatches),      icon: <Inventory2Icon sx={{ color: '#1a227f', fontSize: 22 }} />,      iconBg: 'rgba(26,34,127,0.08)' },
          { title: 'Total Packets',       value: String(totalPackets),      icon: <AllInboxIcon sx={{ color: '#0369a1', fontSize: 22 }} />,        iconBg: '#f0f9ff' },
          { title: 'Filled Packets',      value: String(filledPackets),     icon: <TaskAltIcon sx={{ color: '#15803d', fontSize: 22 }} />,          iconBg: '#f0fdf4' },
          { title: 'Pending Packets',     value: String(pendingPackets),    icon: <PendingActionsIcon sx={{ color: '#c2410c', fontSize: 22 }} />,   iconBg: '#fff7ed' },
          { title: 'Total Measurements',  value: String(totalMeasurements), icon: <ScaleIcon sx={{ color: '#6366f1', fontSize: 22 }} />,            iconBg: 'rgba(99,102,241,0.08)' },
        ].map(c => <Grid size={{ xs: 12, sm: 6, md: 4 }} key={c.title}><StatCard {...c} /></Grid>)}
      </Grid>

      <Grid container spacing={2.5}>
        {/* Fill progress — real values only, safe when totalPackets is 0 */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3, height: '100%' }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 0.5 }}>Packet Completion</Typography>
            <Typography sx={{ fontSize: 12, color: '#64748b', mb: 2.5 }}>
              {totalPackets > 0
                ? `${filledPackets} of ${totalPackets} packets weighed`
                : 'No packets created yet'}
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography sx={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Fill progress</Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: fillPct === 100 ? '#15803d' : '#1a227f' }}>{fillPct}%</Typography>
            </Box>
            <LinearProgress variant="determinate" value={fillPct} sx={{
              height: 10, borderRadius: 99, background: '#f1f5f9',
              '& .MuiLinearProgress-bar': {
                borderRadius: 99,
                background: fillPct === 100 ? 'linear-gradient(90deg,#16a34a,#22c55e)' : 'linear-gradient(90deg,#1a227f,#6366f1)',
              },
            }} />
          </Card>
        </Grid>

        {/* QR CTA */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', color: '#fff', p: 3, height: '100%' }}>
            <Box sx={{ width: 44, height: 44, borderRadius: 2.5, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2 }}>
              <QrCodeIcon sx={{ color: '#fff', fontSize: 24 }} />
            </Box>
            <Typography sx={{ fontWeight: 800, fontSize: 16, color: '#fff', mb: 0.5 }}>QR Production</Typography>
            <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', mb: 2.5 }}>Generate batch QR codes for seed packets.</Typography>
            <Button variant="contained" onClick={() => navigate('/batches')}
              sx={{ background: '#fff', color: '#1a227f', fontWeight: 700, '&:hover': { background: '#f1f5f9' } }}>
              Launch QR Generator
            </Button>
          </Card>
        </Grid>
      </Grid>

      {/* Recent Weighings — real WeightSession data via GET /api/sessions */}
      <Card sx={{ mt: 2.5 }}>
        <Box sx={{ px: 3, py: 2.5, borderBottom: '1px solid #f1f5f9' }}>
          <Typography sx={{ fontWeight: 700, fontSize: 15 }}>Recent Weighings</Typography>
          <Typography sx={{ fontSize: 12, color: '#64748b' }}>Latest real measurements from the field</Typography>
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {['Packet ID', 'Batch', 'Before', 'After', 'Difference', 'Date & Time', 'Operator'].map(h => <TableCell key={h}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {recentLoading ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 3, color: '#94a3b8' }}>Loading…</TableCell></TableRow>
              ) : recent.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 3, color: '#94a3b8' }}>No weighing activity yet</TableCell></TableRow>
              ) : recent.map((s) => {
                const m = s.measurement;
                return (
                  <TableRow key={m.sessionId} hover>
                    <TableCell sx={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#1a227f' }}>
                      {m.packetUniqueId || s.packet?.uniqueId || '—'}
                    </TableCell>
                    <TableCell sx={{ fontSize: 13 }}>{s.batch?.batchName || '—'}</TableCell>
                    <TableCell sx={{ fontSize: 13, fontWeight: 700 }}>{m.beforeWeight != null ? `${m.beforeWeight} kg` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 13, fontWeight: 700 }}>{m.afterWeight != null ? `${m.afterWeight} kg` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 13, fontWeight: 800 }}>{m.difference != null ? `${m.difference} kg` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 12, fontFamily: 'monospace', color: '#475569' }}>
                      {m.createdAt ? new Date(m.createdAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell sx={{ fontSize: 13 }}>{s.operator?.name || '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Layout>
  );
}
