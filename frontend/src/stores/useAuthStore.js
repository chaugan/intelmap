import { create } from 'zustand';
import { socket } from '../lib/socket.js';

const API = '/api/auth';

export const useAuthStore = create((set, get) => ({
  user: null,
  loading: true,

  // Dialog states
  loginOpen: false,
  passwordChangeOpen: false,
  adminPanelOpen: false,

  setLoginOpen: (v) => set({ loginOpen: v }),
  setPasswordChangeOpen: (v) => set({ passwordChangeOpen: v }),
  setAdminPanelOpen: (v) => set({ adminPanelOpen: v }),

  checkSession: async () => {
    try {
      const res = await fetch(`${API}/me`, { credentials: 'include' });
      const user = await res.json();
      set({ user, loading: false });
      if (user) {
        if (!socket.connected) socket.connect();
        if (user.mustChangePassword) {
          set({ passwordChangeOpen: true });
        }
      }
    } catch {
      set({ user: null, loading: false });
    }
  },

  login: async (username, password) => {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Login failed');
    }
    const user = await res.json();
    set({ user, loginOpen: false });
    if (!socket.connected) socket.connect();
    if (user.mustChangePassword) {
      set({ passwordChangeOpen: true });
    }
    return user;
  },

  logout: async () => {
    try {
      await fetch(`${API}/logout`, { method: 'POST', credentials: 'include' });
    } catch {}
    socket.disconnect();
    set({ user: null });
  },

  changePassword: async (currentPassword, newPassword) => {
    const res = await fetch(`${API}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to change password');
    }
    const user = await res.json();
    set({ user, passwordChangeOpen: false });
    return user;
  },

  dismissPasswordChange: async () => {
    try {
      await fetch(`${API}/dismiss-password-change`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {}
    socket.disconnect();
    set({ user: null, passwordChangeOpen: false });
  },
}));
