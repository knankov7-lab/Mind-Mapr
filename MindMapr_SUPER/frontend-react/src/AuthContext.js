import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from './api';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  function decodeJwtPayload(jwtToken) {
    if (!jwtToken) return null;
    const parts = String(jwtToken).split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];

    // base64url -> base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    try {
      const json = atob(padded);
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (token) {
      // Decode token to get user info (simple decode, in production use a library)
      const payload = decodeJwtPayload(token);
      if (payload) {
        setUser(payload);
      } else {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
      }
    } else {
      setUser(null);
    }
    setLoading(false);
  }, [token]);

  const login = async (email, password) => {
    try {
      const res = await authAPI.login(email, password);
      const { token: newToken, user: userData } = res.data;
      localStorage.setItem('token', newToken);
      setToken(newToken);
      setUser(userData);
      return { success: true, user: userData, token: newToken };
    } catch (error) {
      return { success: false, error: error.response?.data?.error || 'Login failed' };
    }
  };

  const register = async (email, password, username) => {
    try {
      const res = await authAPI.register(email, password, username);
      const { token: newToken, user: userData } = res.data;
      localStorage.setItem('token', newToken);
      setToken(newToken);
      setUser(userData);
      return { success: true, user: userData, token: newToken };
    } catch (error) {
      return { success: false, error: error.response?.data?.error || 'Registration failed' };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  const normalizedRole = String(user?.role || '').toLowerCase();
  const isAdmin = ['admin', 'super-admin', 'ops-admin'].includes(normalizedRole);
  const isSuperAdmin = normalizedRole === 'super-admin' || normalizedRole === 'admin';
  const isOpsAdmin = normalizedRole === 'ops-admin';
  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider value={{
      user,
      token,
      loading,
      login,
      register,
      logout,
      isAdmin,
      isSuperAdmin,
      isOpsAdmin,
      isAuthenticated,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
