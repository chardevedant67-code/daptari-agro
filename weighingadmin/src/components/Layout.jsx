import { Box } from '@mui/material';
import Sidebar from './Sidebar';

export default function Layout({ children }) {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', background: '#f1f5f9' }}>
      <Sidebar />
      <Box component="main" sx={{ flex: 1, p: 3.5, overflow: 'auto', minWidth: 0 }}>
        {children}
      </Box>
    </Box>
  );
}
