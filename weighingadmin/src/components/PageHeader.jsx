import { Box, Typography, Avatar, IconButton, InputBase, Paper } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import SearchIcon from '@mui/icons-material/Search';
import { useAuth } from '../context/AuthContext';

export default function PageHeader({ title, subtitle, actions, showSearch = false }) {
  const { admin } = useAuth();
  const initials = admin?.name?.split(' ').map(n => n[0]).join('').slice(0, 2) || 'A';
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      mb: 3, pb: 2.5, borderBottom: '1px solid #e2e8f0'
    }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a' }}>{title}</Typography>
        {subtitle && <Typography sx={{ fontSize: 13, color: '#64748b', mt: 0.3 }}>{subtitle}</Typography>}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {showSearch && (
          <Paper elevation={0} sx={{
            display: 'flex', alignItems: 'center', px: 1.5, py: 0.5,
            border: '1px solid #e2e8f0', borderRadius: 2, minWidth: 220
          }}>
            <SearchIcon sx={{ color: '#94a3b8', fontSize: 18, mr: 1 }} />
            <InputBase placeholder="Search..." sx={{ fontSize: 13, flex: 1 }} />
          </Paper>
        )}

        {actions}

        <IconButton size="small" sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
          <NotificationsIcon sx={{ fontSize: 20, color: '#64748b' }} />
        </IconButton>

        <Avatar sx={{ width: 34, height: 34, background: 'linear-gradient(135deg,#1a227f,#6366f1)', fontSize: 13, fontWeight: 700 }}>{initials}</Avatar>
      </Box>
    </Box>
  );
}
