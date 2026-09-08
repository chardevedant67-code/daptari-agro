import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(() => {
    const stored = localStorage.getItem('admin');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(false);

  const login = async (email, password, rememberMe) => {
    setLoading(true);
    try {
      const res = await authAPI.login({ email, password, rememberMe });
      const { token, admin: adminData } = res.data;
      localStorage.setItem('token', token);
      localStorage.setItem('admin', JSON.stringify(adminData));
      setAdmin(adminData);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.response?.data?.message || 'Login failed' };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try { await authAPI.logout(); } catch (_) {}
    localStorage.removeItem('token');
    localStorage.removeItem('admin');
    setAdmin(null);
  };

  return (
    <AuthContext.Provider value={{ admin, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
