import { useState, useEffect, useCallback } from 'react';
import { batchAPI } from '../services/api';
import {
  Box, Button, Card, Chip, Grid, IconButton, LinearProgress,
  Menu, MenuItem, Tab, Tabs, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, InputBase, Paper, Snackbar, Alert, TextField, Tooltip
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
import NewBatchDialog from '../components/NewBatchDialog';

// Escapes text before it is interpolated into the print-label HTML below —
// product.name/id/batch/qrCodeUrl are admin-entered/DB values, and this HTML
// is built via document.write() with no other sanitization, so nothing
// dynamic may reach it unescaped (including inside the img src="..." attribute,
// where escaping the quote character also prevents attribute breakout).
// `&` is replaced first so entities added for the other characters are never
// themselves re-escaped. null/undefined become '' rather than the literal
// text "undefined"/"null".
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function printQRLabel(product) {
  const qrSrc = escapeHtml(`${batchAPI.qrBaseUrl()}${product.qrCodeUrl}`);
  const win = window.open('', '_blank', 'width=400,height=500');
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>QR Label — ${escapeHtml(product.name)}</title>
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
      <div class="name">${escapeHtml(product.name)}</div>
      <div class="pid">${escapeHtml(product.id)}</div>
      <div class="batch">Batch: ${escapeHtml(product.batch)}</div>
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
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ organic: 0, hybrid: 0, heirloomModified: 0 });
  const [loading, setLoading] = useState(true);

  // Product Inventory filters — real SeedBatch/SeedPacket data only.
  const [seed, setSeed] = useState('');
  const [batch, setBatch] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [seedOptions, setSeedOptions] = useState([]);
  const [batchOptions, setBatchOptions] = useState([]);
  const [warehouseOptions, setWarehouseOptions] = useState([]);
  // Real pagination — every filter/search change handler below also resets
  // page to 1 directly, so a stale page number never survives a new filter
  // combination (done in the handlers, not an effect, to avoid a cascading
  // render from calling setState inside a useEffect body).
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const hasActiveFilters = Boolean(seed || batch || warehouse);
  const clearFilters = () => { setSeed(''); setBatch(''); setWarehouse(''); setPage(1); };
  const handleBatchChange = (v) => { setBatch(v); setPage(1); };
  const handleWarehouseChange = (v) => { setWarehouse(v); setPage(1); };
  const handleSearchChange = (v) => { setSearch(v); setPage(1); };

  // Three-dot menu state
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuProduct, setMenuProduct] = useState(null);

  // New Batch dialog — opens directly on this page instead of redirecting
  // to /batches. onCreated triggers an immediate inventory refresh below so
  // the newly created batch's packets show up without a page reload.
  const [createOpen, setCreateOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const openMenu = (e, product) => { setMenuAnchor(e.currentTarget); setMenuProduct(product); };
  const closeMenu = () => { setMenuAnchor(null); };

  // Batch dropdown depends on the selected seed — reset it whenever the
  // seed changes so a stale, no-longer-relevant batch can't linger.
  const handleSeedChange = (v) => { setSeed(v); setBatch(''); setPage(1); };

  // Shared by the debounced filter/search effect below and by the New Batch
  // dialog's onCreated callback, so a successful batch creation can refresh
  // cards/dropdowns/table immediately without duplicating the fetch logic.
  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await batchAPI.inventory({
        search,
        seedType: seed || undefined,
        batchNumber: batch || undefined,
        warehouse: warehouse || undefined,
        page,
      });
      setProducts(res.data.products);
      setTotal(res.data.totalProducts);
      setCounts({
        organic: res.data.organicCount,
        hybrid: res.data.hybridCount,
        heirloomModified: res.data.heirloomModifiedCount,
      });
      setSeedOptions(res.data.seedOptions);
      setBatchOptions(res.data.batchOptions);
      setWarehouseOptions(res.data.warehouseOptions);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch (_) {}
    setLoading(false);
  }, [search, seed, batch, warehouse, page]);

  useEffect(() => {
    const t = setTimeout(fetchInventory, 300);
    return () => clearTimeout(t);
  }, [fetchInventory]);

  const mapped = products;

  return (
    <Layout>
      <PageHeader
        title="Product Inventory"
        subtitle="Manage all registered product batches and QR labels"
        showSearch={false}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}>
            New Batch
          </Button>
        }
      />

      {/* Filters */}
      <Card sx={{ p: 2, mb: 2.5 }}>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField select size="small" value={seed} onChange={e => handleSeedChange(e.target.value)}
            SelectProps={{ displayEmpty: true }} sx={{ minWidth: 160 }}>
            <MenuItem value=""><em>Select Seed</em></MenuItem>
            {seedOptions.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
          </TextField>
          <TextField select size="small" value={batch} onChange={e => handleBatchChange(e.target.value)}
            SelectProps={{ displayEmpty: true }} sx={{ minWidth: 160 }}>
            <MenuItem value=""><em>Select Batch</em></MenuItem>
            {batchOptions.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
          </TextField>
          <TextField select size="small" value={warehouse} onChange={e => handleWarehouseChange(e.target.value)}
            SelectProps={{ displayEmpty: true }} sx={{ minWidth: 160 }}>
            <MenuItem value=""><em>Select Warehouse</em></MenuItem>
            {warehouseOptions.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
          </TextField>
          {hasActiveFilters && (
            <Button size="small" onClick={clearFilters} sx={{ textTransform: 'none', fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>
              Clear Filters
            </Button>
          )}
        </Box>
      </Card>

      {/* Stats */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {[
          { title: 'Total Products', value: String(total || 0), icon: <InventoryIcon sx={{ color: '#1a227f', fontSize: 22 }} />, iconBg: 'rgba(26,34,127,0.08)' },
          { title: 'Organic', value: String(counts.organic || 0), icon: <InventoryIcon sx={{ color: '#10b981', fontSize: 22 }} />, iconBg: 'rgba(16,185,129,0.08)' },
          { title: 'Hybrid', value: String(counts.hybrid || 0), icon: <InventoryIcon sx={{ color: '#6366f1', fontSize: 22 }} />, iconBg: 'rgba(99,102,241,0.08)' },
          { title: 'Heirloom / Modified', value: String(counts.heirloomModified || 0), icon: <InventoryIcon sx={{ color: '#f59e0b', fontSize: 22 }} />, iconBg: 'rgba(245,158,11,0.08)' },
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
            value={total ? (counts.organic / total) * 100 : 0}
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
            <InputBase placeholder="Search products..." value={search} onChange={e => handleSearchChange(e.target.value)} sx={{ fontSize: 13, flex: 1 }} />
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
                        onClick={() => window.open(`${batchAPI.qrBaseUrl()}${p.qrCodeUrl || ''}`, '_blank')}
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

        <Box sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ fontSize: 12, color: '#64748b' }}>Showing {mapped.length} of {total} products</Typography>
          <Box sx={{ display: 'flex', gap: 0.8, alignItems: 'center' }}>
            <Button size="small" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
              sx={{ minWidth: 0, px: 1, fontSize: 12, fontWeight: 600, textTransform: 'none', color: '#1a227f' }}>
              Previous
            </Button>
            <Typography sx={{ fontSize: 12, color: '#64748b', mr: 1 }}>Page</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1a227f' }}>{page}</Typography>
            <Typography sx={{ fontSize: 12, color: '#64748b' }}>of {totalPages || 1}</Typography>
            <Button size="small" disabled={page >= (totalPages || 1)} onClick={() => setPage(p => p + 1)}
              sx={{ minWidth: 0, px: 1, fontSize: 12, fontWeight: 600, textTransform: 'none', color: '#1a227f' }}>
              Next
            </Button>
          </Box>
        </Box>
      </Card>
      {/* Three-dot dropdown menu — Edit/Delete are disabled here because these
          rows are real SeedPacket records; there is no current SeedBatch/
          SeedPacket edit or delete API, and the legacy Product edit/delete
          endpoints must never be called with a SeedPacket id. Print QR Label
          is unaffected and keeps using the packet's existing permanent QR. */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <Tooltip title="Editing isn't available yet for Product Inventory records" placement="left">
          <span>
            <MenuItem disabled sx={{ gap: 1.2, fontSize: 13 }}>
              <EditIcon fontSize="small" sx={{ color: '#1a227f' }} /> Edit
            </MenuItem>
          </span>
        </Tooltip>
        <MenuItem onClick={() => { printQRLabel(menuProduct); closeMenu(); }}
          sx={{ gap: 1.2, fontSize: 13 }}>
          <PrintIcon fontSize="small" sx={{ color: '#1a227f' }} /> Print QR Label
        </MenuItem>
        <Tooltip title="Deleting isn't available yet for Product Inventory records" placement="left">
          <span>
            <MenuItem disabled sx={{ gap: 1.2, fontSize: 13, color: '#ef4444' }}>
              <DeleteIcon fontSize="small" /> Delete
            </MenuItem>
          </span>
        </Tooltip>
      </Menu>

      <NewBatchDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(data) => {
          setSuccessMsg(`${data.packets.length} QR codes generated for "${data.batch.batchName}"`);
          fetchInventory();
        }}
      />
      <Snackbar open={!!successMsg} autoHideDuration={5000} onClose={() => setSuccessMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" onClose={() => setSuccessMsg('')} sx={{ borderRadius: 2 }}>
          {successMsg}
        </Alert>
      </Snackbar>
    </Layout>
  );
}
