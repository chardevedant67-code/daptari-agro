import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import theme from './theme/theme';
import { AuthProvider } from './context/AuthContext';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import EditProduct from './pages/EditProduct';
import Settings from './pages/Settings';
import Batches from './pages/Batches';
import Machines from './pages/Machines';
import Operators from './pages/Operators';
import Records from './pages/Records';
import Reports from './pages/Reports';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? <Navigate to="/dashboard" replace /> : children;
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login"        element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
            <Route path="/reset-password"  element={<PublicRoute><ResetPassword /></PublicRoute>} />
            <Route path="/dashboard"    element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="/products"     element={<PrivateRoute><Products /></PrivateRoute>} />
            {/* "Add Product" used to render its own duplicate batch-creation
                form here (it always called POST /api/batches). The Batches
                page's "New Batch" dialog is the one real creation flow, so
                this old route now redirects there instead of maintaining a
                second, diverging form (see Step 10). */}
            <Route path="/products/add"      element={<Navigate to="/batches" replace />} />
            <Route path="/products/edit/:id" element={<PrivateRoute><EditProduct /></PrivateRoute>} />
            <Route path="/batches"      element={<PrivateRoute><Batches /></PrivateRoute>} />
            <Route path="/machines"     element={<PrivateRoute><Machines /></PrivateRoute>} />
            <Route path="/operators"    element={<PrivateRoute><Operators /></PrivateRoute>} />
            <Route path="/records"      element={<PrivateRoute><Records /></PrivateRoute>} />
            <Route path="/reports"      element={<PrivateRoute><Reports /></PrivateRoute>} />
            <Route path="/settings"     element={<PrivateRoute><Settings /></PrivateRoute>} />

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
