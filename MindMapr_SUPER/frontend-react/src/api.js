import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000/api';

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
};

export const mapsAPI = {
  save: (room, nodes, edges) => api.post('/maps/save', { room, nodes, edges }),
  load: (room) => api.get(`/maps/load?room=${encodeURIComponent(room)}`),
};

export const aiAPI = {
  analyze: (nodes, edges) => api.post('/ai/analyze', { nodes, edges }),
};

export const adminAPI = {
  getUsers: () => api.get('/admin/users'),
  getRooms: () => api.get('/admin/rooms'),
};

export default api;
