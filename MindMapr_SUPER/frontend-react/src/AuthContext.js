import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from './api';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

function safeLocalStorageGet(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

function safeLocalStorageRemove(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => safeLocalStorageGet('token'));
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
        safeLocalStorageRemove('token');
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
      safeLocalStorageSet('token', newToken);
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
      safeLocalStorageSet('token', newToken);
      setToken(newToken);
      setUser(userData);
      return { success: true, user: userData, token: newToken };
    } catch (error) {
      return { success: false, error: error.response?.data?.error || 'Registration failed' };
    }
  };

  const logout = () => {
    safeLocalStorageRemove('token');
    setToken(null);
    setUser(null);
  };

  const changePassword = async (oldPassword, newPassword) => {
    try {
      await authAPI.changePassword(oldPassword, newPassword);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error || 'Password change failed' };
    }
  };

  const normalizedRole = String(user?.role || '').toLowerCase();
  const isAdmin = normalizedRole === 'admin';
  const isAuthenticated = !!user;

  // Permission map: admin has full access, others have none in admin panel
  const ADMIN_PERMISSIONS = [
    'users.read', 'users.manage',
    'rooms.read', 'rooms.approve', 'rooms.delete',
    'saves.read', 'saves.delete',
    'stats.read',
    'logs.read',
    'settings.read', 'settings.write',
  ];

  function can(permission) {
    if (isAdmin) return true;
    return false;
  }

  return (
    <AuthContext.Provider value={{
      user,
      token,
      loading,
      login,
      register,
      logout,
      changePassword,
      isAdmin,
      isAuthenticated,
      can,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
