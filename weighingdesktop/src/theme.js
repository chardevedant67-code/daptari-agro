import { createTheme } from '@mui/material/styles';

// System fonts only — nothing is fetched from the network.
const theme = createTheme({
  palette: {
    primary: { main: '#1f6f43' },
    secondary: { main: '#1a227f' },
    background: { default: '#f4f6f8' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
  },
});

export default theme;
