import axios from 'axios';

function inferApiBaseUrl() {
  const fromEnv = process.env.REACT_APP_API_BASE_URL;
  if (fromEnv) return fromEnv;

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = String(window.location.port || '');

    // Local dev default: CRA on 3001, backend on 3000.
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && port === '3001') {
      return `${protocol}//${hostname}:3000/api`;
    }

    // Otherwise prefer same-origin API.
    // Prefer relative path so CRA dev proxy forwards to backend during development.
    return '/api';
  }

  return '/api';
}

const API_BASE_URL = inferApiBaseUrl();

if (process.env.NODE_ENV !== 'production') {
  // Helpful during local dev when CRA auto-switches ports.
  // eslint-disable-next-line no-console
  console.log('[MindMapr] API_BASE_URL =', API_BASE_URL);
}

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Add token to requests if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (email, password, username) => api.post('/auth/register', { email, password, username }),
  updateProfile: (username) => api.put('/auth/profile', { username }),
  changePassword: (oldPassword, newPassword) => api.post('/auth/change-password', { oldPassword, newPassword }),
  requestReset: (email) => api.post('/auth/request-reset', { email }),
  resetPassword: (token, newPassword) => api.post('/auth/reset-password', { token, newPassword }),
};

export const mapsAPI = {
  save: (room, nodes, edges) => api.post('/maps/save', { room, nodes, edges }),
  load: (room) => api.get(`/maps/load?room=${encodeURIComponent(room)}`),
  list: () => api.get('/maps/list'),
  deleteSave: (id) => api.delete(`/maps/${encodeURIComponent(id)}`),
  publicRooms: (limit = 200) => api.get(`/maps/public?limit=${encodeURIComponent(limit)}`),
  history: (room, limit = 50) => api.get(`/maps/history?room=${encodeURIComponent(room)}&limit=${encodeURIComponent(limit)}`),
  loadSave: (id) => api.get(`/maps/load-save?id=${encodeURIComponent(id)}`),
};

export const roomsAPI = {
  getMeta: (room) => api.get(`/rooms/meta?room=${encodeURIComponent(room)}`),
  updateMeta: (room, { name, description, tags } = {}) => api.put('/rooms/meta', { room, name, description, tags }),
};

// AI endpoints removed

export const adminAPI = {
  getUsers: () => api.get('/admin/users'),
  getRooms: () => api.get('/admin/rooms'),
  getLogs: (limit = 200) => api.get(`/admin/logs?limit=${encodeURIComponent(limit)}`),
  // AI example admin endpoints removed
};

export const teamsAPI = {
  create: (name, description) => api.post('/teams', { name, description }),
  list: () => api.get('/teams'),
  members: (teamId) => api.get(`/teams/${encodeURIComponent(teamId)}/members`),
  addMember: (teamId, email, role = 'viewer') => api.post(`/teams/${encodeURIComponent(teamId)}/members`, { email, role }),
  setRole: (teamId, userId, role) => api.put(`/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, { role }),
  removeMember: (teamId, userId) => api.delete(`/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`),
};

export const commentsAPI = {
  list: (room, limit = 200) => api.get(`/comments?room=${encodeURIComponent(room)}&limit=${encodeURIComponent(limit)}`),
  create: (room, content, nodeId = null) => api.post('/comments', { room, content, nodeId }),
  remove: (id) => api.delete(`/comments/${encodeURIComponent(id)}`),
};

export default api;
