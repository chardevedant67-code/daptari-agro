import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: { main: '#1a227f', light: '#3d47a3', dark: '#0f1550', contrastText: '#fff' },
    secondary: { main: '#6366f1' },
    success: { main: '#10b981' },
    warning: { main: '#f59e0b' },
    error: { main: '#f43f5e' },
    background: { default: '#f1f5f9', paper: '#ffffff' },
    text: { primary: '#0f172a', secondary: '#64748b' },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", sans-serif',
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600, borderRadius: 8 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04)', borderRadius: 14 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', backgroundColor: '#f8fafc' },
      },
    },
  },
});

export default theme;
