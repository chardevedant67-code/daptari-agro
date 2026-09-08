import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, Grid, Typography } from '@mui/material';
import InventoryIcon from '@mui/icons-material/Inventory';
import QrCodeIcon from '@mui/icons-material/QrCode';
import AddIcon from '@mui/icons-material/Add';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import api from '../services/api';

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/dashboard/stats')
      .then(res => setData(res.data))
      .catch(() => {});
  }, []);

  const stats = data?.stats || {};

  return (
    <Layout>
      <PageHeader
        title="Dashboard"
        subtitle="Welcome back — here's what's happening today"
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/products/add')}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}>
            New Product
          </Button>
        }
      />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatCard
            title="Total Products"
            value={String(stats.totalProducts ?? 0)}
            icon={<InventoryIcon sx={{ color: '#1a227f', fontSize: 22 }} />}
            iconBg="rgba(26,34,127,0.08)"
          />
        </Grid>
      </Grid>

      {/* QR CTA */}
      <Card sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', color: '#fff', p: 3, maxWidth: 420 }}>
        <Box sx={{ width: 44, height: 44, borderRadius: 2.5, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2 }}>
          <QrCodeIcon sx={{ color: '#fff', fontSize: 24 }} />
        </Box>
        <Typography sx={{ fontWeight: 800, fontSize: 16, color: '#fff', mb: 0.5 }}>QR Production</Typography>
        <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', mb: 2.5 }}>Generate batch QR codes for registered products.</Typography>
        <Button variant="contained" onClick={() => navigate('/products/add')}
          sx={{ background: '#fff', color: '#1a227f', fontWeight: 700, '&:hover': { background: '#f1f5f9' } }}>
          Launch QR Generator
        </Button>
      </Card>
    </Layout>
  );
}
