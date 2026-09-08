import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { productAPI } from '../services/api';
import {
  Box, Button, Card, Chip, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Grid, IconButton, LinearProgress,
  Menu, MenuItem, Tab, Tabs, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, InputBase, Paper
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import QrCodeIcon from '@mui/icons-material/QrCode';
import InventoryIcon from '@mui/icons-material/Inventory';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PrintIcon from '@mui/icons-material/Print';
import EcoIcon from '@mui/icons-material/LocalFlorist';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';

function printQRLabel(product) {
  const qrSrc = `http://localhost:5001${product.qrCodeUrl}`;
  const win = window.open('', '_blank', 'width=400,height=500');
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>QR Label — ${product.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; background: #fff; }
    .label {
      width: 50mm; height: 50mm;
      border: 1px solid #ccc;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 3mm; gap: 2mm;
      page-break-inside: avoid;
    }
    .label img { width: 28mm; height: 28mm; }
    .label .name { font-size: 7pt; font-weight: 700; text-align: center; color: #0f172a; }
    .label .pid  { font-size: 6pt; font-family: monospace; color: #1a227f; }
    .label .batch{ font-size: 5.5pt; color: #64748b; }
    .sheet {
      display: grid;
      grid-template-columns: repeat(4, 50mm);
      gap: 3mm;
      padding: 10mm;
    }
    @media print {
      body { margin: 0; }
      .no-print { display: none; }
      .sheet { padding: 5mm; }
    }
  </style>
</head>
<body>
  <div style="padding:8px;background:#f1f5f9;display:flex;gap:8px;align-items:center" class="no-print">
    <button onclick="window.print()" style="background:#1a227f;color:#fff;border:none;padding:8px 20px;border-radius:6px;font-weight:700;cursor:pointer;font-size:13px">
      🖨️ Print
    </button>
    <span style="font-size:12px;color:#475569">Paper: 50×50mm sticker labels &nbsp;|&nbsp; A4 pe 4 columns fit honge</span>
  </div>
  <div class="sheet">
    ${Array(8).fill(`
    <div class="label">
      <img src="${qrSrc}" alt="QR"/>
      <div class="name">${product.name}</div>
      <div class="pid">${product.id}</div>
      <div class="batch">Batch: ${product.batch}</div>
    </div>`).join('')}
  </div>
</body>
</html>`);
  win.document.close();
}

const seedTypeColor = (s) => {
  if (!s) return { bg: '#f1f5f9', color: '#64748b' };
  if (s === 'Organic')  return { bg: '#dcfce7', color: '#16a34a' };
  if (s === 'Hybrid')   return { bg: '#dbeafe', color: '#1d4ed8' };
  if (s === 'Heirloom') return { bg: '#fef9c3', color: '#ca8a04' };
  return { bg: '#fce7f3', color: '#db2777' };
};

export default function Products() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Three-dot menu state
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuProduct, setMenuProduct] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openMenu = (e, product) => { setMenuAnchor(e.currentTarget); setMenuProduct(product); };
  const closeMenu = () => { setMenuAnchor(null); };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await productAPI.delete(menuProduct._id);
      setProducts(prev => prev.filter(p => p._id !== menuProduct._id));
      setTotal(t => t - 1);
    } catch (_) {}
    setDeleting(false);
    setConfirmDelete(false);
    closeMenu();
  };

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const res = await productAPI.getAll({ search, limit: 10 });
        setProducts(res.data.products);
        setTotal(res.data.count);
      } catch (_) {}
      setLoading(false);
    };
    const t = setTimeout(fetch, 300);
    return () => clearTimeout(t);
  }, [search]);

  const mapped = products.map(p => ({
    id: p.productId,
    _id: p._id,
    name: p.productName,
    category: p.seedType,
    batch: p.batchNumber,
    location: p.storageLocation,
    qrCodeUrl: p.qrCodeUrl,
  }));

  return (
    <Layout>
      <PageHeader
        title="Product Inventory"
        subtitle="Manage all registered product batches and QR labels"
        showSearch={false}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/products/add')}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}>
            New Product
          </Button>
        }
      />

      {/* Stats */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {[
          { title: 'Total Products', value: String(total || 0), icon: <InventoryIcon sx={{ color: '#1a227f', fontSize: 22 }} />, iconBg: 'rgba(26,34,127,0.08)' },
          { title: 'Organic', value: String(products.filter(p => p.seedType === 'Organic').length), icon: <InventoryIcon sx={{ color: '#10b981', fontSize: 22 }} />, iconBg: 'rgba(16,185,129,0.08)' },
          { title: 'Hybrid', value: String(products.filter(p => p.seedType === 'Hybrid').length), icon: <InventoryIcon sx={{ color: '#6366f1', fontSize: 22 }} />, iconBg: 'rgba(99,102,241,0.08)' },
          { title: 'Heirloom / Modified', value: String(products.filter(p => p.seedType === 'Heirloom' || p.seedType === 'Modified').length), icon: <InventoryIcon sx={{ color: '#f59e0b', fontSize: 22 }} />, iconBg: 'rgba(245,158,11,0.08)' },
        ].map(c => (
          <Grid size={{ xs: 12, sm: 6, md: 3 }} key={c.title}>
            <StatCard {...c} />
          </Grid>
        ))}
      </Grid>

      {/* Seed type breakdown */}
      {total > 0 && (
        <Card sx={{ p: 2.5, mb: 2.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>Seed Type Distribution</Typography>
            <Typography sx={{ fontSize: 13, color: '#1a227f', fontWeight: 700 }}>{total} products</Typography>
          </Box>
          <LinearProgress variant="determinate"
            value={total ? (products.filter(p => p.seedType === 'Organic').length / total) * 100 : 0}
            sx={{ height: 8, borderRadius: 99, background: '#f1f5f9', '& .MuiLinearProgress-bar': { background: '#10b981', borderRadius: 99 } }} />
        </Card>
      )}

      {/* Table */}
      <Card>
        <Box sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, fontSize: 13, minWidth: 0, px: 1.5, minHeight: 40 } }}>
            <Tab label="All Products" />
            <Tab label="Recently Added" />
          </Tabs>
          <Paper elevation={0} sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.5, border: '1px solid #e2e8f0', borderRadius: 2, minWidth: 220 }}>
            <SearchIcon sx={{ color: '#94a3b8', fontSize: 18, mr: 1 }} />
            <InputBase placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} sx={{ fontSize: 13, flex: 1 }} />
          </Paper>
        </Box>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {['Product ID', 'Product Name', 'Batch Info', 'Location', 'QR Label', ''].map(h => <TableCell key={h}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: '#94a3b8' }}>Loading...</TableCell></TableRow>}
              {!loading && mapped.length === 0 && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: '#94a3b8' }}>No products found</TableCell></TableRow>}
              {mapped.map(p => {
                const sc = seedTypeColor(p.category);
                return (
                  <TableRow key={p.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#1a227f' }}>{p.id}</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <Box sx={{ width: 34, height: 34, borderRadius: 1.5, background: 'rgba(26,34,127,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <EcoIcon sx={{ fontSize: 16, color: '#1a227f' }} />
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{p.name}</Typography>
                          <Chip label={p.category || '—'} size="small" sx={{ fontSize: 10, fontWeight: 700, background: sc.bg, color: sc.color, height: 18, mt: 0.3 }} />
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>{p.batch}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 13, color: '#475569' }}>{p.location}</TableCell>
                    <TableCell>
                      <Button size="small" variant="outlined" startIcon={<QrCodeIcon sx={{ fontSize: '14px !important' }} />}
                        onClick={() => window.open(`http://localhost:5001${p.qrCodeUrl || ''}`, '_blank')}
                        sx={{ borderRadius: 1.5, fontSize: 11, fontWeight: 700, textTransform: 'none', py: 0.4, borderColor: '#1a227f', color: '#1a227f' }}>
                        QR Label
                      </Button>
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={(e) => openMenu(e, p)}><MoreVertIcon fontSize="small" /></IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        <Box sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9' }}>
          <Typography sx={{ fontSize: 12, color: '#64748b' }}>Showing {mapped.length} of {total} products</Typography>
          <Box sx={{ display: 'flex', gap: 0.8, alignItems: 'center' }}>
            <Typography sx={{ fontSize: 12, color: '#64748b', mr: 1 }}>Page</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1a227f' }}>1</Typography>
            <Typography sx={{ fontSize: 12, color: '#64748b' }}>of {Math.ceil(total / 10) || 1}</Typography>
          </Box>
        </Box>
      </Card>
      {/* Three-dot dropdown menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={() => { closeMenu(); navigate(`/products/edit/${menuProduct?._id}`); }}
          sx={{ gap: 1.2, fontSize: 13 }}>
          <EditIcon fontSize="small" sx={{ color: '#1a227f' }} /> Edit
        </MenuItem>
        <MenuItem onClick={() => { printQRLabel(menuProduct); closeMenu(); }}
          sx={{ gap: 1.2, fontSize: 13 }}>
          <PrintIcon fontSize="small" sx={{ color: '#1a227f' }} /> Print QR Label
        </MenuItem>
        <MenuItem onClick={() => { setConfirmDelete(true); closeMenu(); }}
          sx={{ gap: 1.2, fontSize: 13, color: '#ef4444' }}>
          <DeleteIcon fontSize="small" /> Delete
        </MenuItem>
      </Menu>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle sx={{ fontWeight: 700 }}>Delete Product?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <strong>{menuProduct?.name}</strong> aur uska QR permanently delete ho jayega. Yeh undo nahi ho sakta.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setConfirmDelete(false)} variant="outlined" sx={{ borderRadius: 2 }}>Cancel</Button>
          <Button onClick={handleDelete} variant="contained" color="error" disabled={deleting} sx={{ borderRadius: 2 }}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Layout>
  );
}
