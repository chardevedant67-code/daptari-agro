import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Box, Drawer, List, ListItem, ListItemButton, ListItemIcon,
  ListItemText, Typography, Divider, Avatar, Chip
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import DashboardIcon from '@mui/icons-material/Dashboard';
import InventoryIcon from '@mui/icons-material/Inventory';
import QrCodeIcon from '@mui/icons-material/QrCode';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import SettingsIcon from '@mui/icons-material/Settings';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import PeopleIcon from '@mui/icons-material/People';
import ScaleIcon from '@mui/icons-material/Scale';
import AssessmentIcon from '@mui/icons-material/Assessment';

const DRAWER_WIDTH = 256;

const navGroups = [
  {
    label: 'MAIN',
    items: [
      { label: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
    ],
  },
  {
    label: 'PRODUCTS & QR',
    items: [
      { label: 'Products',  icon: <InventoryIcon />, path: '/products' },
      { label: 'Batches',   icon: <QrCode2Icon />,  path: '/batches' },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { label: 'Records',   icon: <ScaleIcon />,                    path: '/records' },
      { label: 'Machines',  icon: <PrecisionManufacturingIcon />,   path: '/machines' },
      { label: 'Operators', icon: <PeopleIcon />,                   path: '/operators' },
      { label: 'Reports',   icon: <AssessmentIcon />,               path: '/reports' },
    ],
  },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, admin } = useAuth();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          boxSizing: 'border-box',
          borderRight: '1px solid #e2e8f0',
          background: '#fff',
        },
      }}
    >
      {/* Logo */}
      <Box sx={{ px: 3, py: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 38, height: 38, borderRadius: 2,
          background: 'linear-gradient(135deg, #1a227f, #3d47a3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <QrCodeIcon sx={{ color: '#fff', fontSize: 20 }} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 15, color: '#0f172a', lineHeight: 1.2 }}>INDUSCORE</Typography>
          <Typography sx={{ fontSize: 10, color: '#64748b', fontWeight: 600, letterSpacing: '0.08em' }}>ADMIN PORTAL</Typography>
        </Box>
      </Box>

      <Divider />

      {/* Nav */}
      <Box sx={{ px: 1.5, py: 1, flex: 1, overflowY: 'auto' }}>
        {navGroups.map((group) => (
          <Box key={group.label} sx={{ mb: 1 }}>
            <Typography sx={{ px: 1.5, pt: 1.5, pb: 0.5, fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em' }}>
              {group.label}
            </Typography>
            <List disablePadding>
              {group.items.map((item) => {
                const active = location.pathname === item.path;
                return (
                  <ListItem key={item.path} disablePadding sx={{ mb: 0.3 }}>
                    <ListItemButton
                      onClick={() => navigate(item.path)}
                      sx={{
                        borderRadius: 2, px: 1.5, py: 0.9,
                        background: active ? 'rgba(26,34,127,0.08)' : 'transparent',
                        '&:hover': { background: active ? 'rgba(26,34,127,0.12)' : '#f8fafc' },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 34, color: active ? '#1a227f' : '#94a3b8', '& svg': { fontSize: 20 } }}>
                        {item.icon}
                      </ListItemIcon>
                      <ListItemText
                        primary={item.label}
                        primaryTypographyProps={{
                          fontSize: 13.5, fontWeight: active ? 700 : 500,
                          color: active ? '#1a227f' : '#475569',
                        }}
                      />
                      {active && <Box sx={{ width: 3, height: 18, borderRadius: 4, background: '#1a227f', ml: 1 }} />}
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      <Divider />

      {/* Settings + User */}
      <Box sx={{ px: 1.5, py: 1 }}>
        <ListItemButton
          onClick={() => navigate('/settings')}
          sx={{ borderRadius: 2, px: 1.5, py: 1, '&:hover': { background: '#f8fafc' } }}
        >
          <ListItemIcon sx={{ minWidth: 36, color: '#94a3b8' }}><SettingsIcon /></ListItemIcon>
          <ListItemText primary="Settings" primaryTypographyProps={{ fontSize: 14, fontWeight: 500, color: '#475569' }} />
        </ListItemButton>
        <ListItemButton
          onClick={() => { logout(); navigate('/login'); }}
          sx={{ borderRadius: 2, px: 1.5, py: 1, '&:hover': { background: '#fee2e2' } }}
        >
          <ListItemIcon sx={{ minWidth: 36, color: '#f43f5e' }}><LogoutIcon /></ListItemIcon>
          <ListItemText primary="Sign Out" primaryTypographyProps={{ fontSize: 14, fontWeight: 600, color: '#f43f5e' }} />
        </ListItemButton>
      </Box>

      <Box sx={{ px: 2, py: 2, borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Avatar sx={{ width: 34, height: 34, background: 'linear-gradient(135deg, #1a227f, #6366f1)', fontSize: 13, fontWeight: 700 }}>
          {admin?.name?.split(' ').map(n => n[0]).join('').slice(0, 2) || 'A'}
        </Avatar>
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a', lineHeight: 1.2, noWrap: true }}>{admin?.name || 'Admin'}</Typography>
          <Typography sx={{ fontSize: 11, color: '#64748b' }}>{admin?.email || ''}</Typography>
        </Box>
        <Chip label={admin?.role || 'Admin'} size="small" sx={{ fontSize: 10, fontWeight: 700, background: 'rgba(26,34,127,0.08)', color: '#1a227f', textTransform: 'capitalize' }} />
      </Box>
    </Drawer>
  );
}
