import { create } from 'zustand';
import { socket } from '../lib/socket.js';

const API = '/api/auth';
const WASOS_API = '/api/wasos';

export const useAuthStore = create((set, get) => ({
  user: null,
  loading: true,

  // Dialog states
  loginOpen: false,
  passwordChangeOpen: false,
  adminPanelOpen: false,
  wasosLoginOpen: false,

  // WaSOS state
  wasosLoggedIn: false,
  wasosLoading: false,
  wasosUploadOpen: false,
  wasosUploadData: null, // { image, coordinates, filename, preview }
  wasosUploading: false,

  setLoginOpen: (v) => set({ loginOpen: v }),
  setPasswordChangeOpen: (v) => set({ passwordChangeOpen: v }),
  setAdminPanelOpen: (v) => set({ adminPanelOpen: v }),
  setWasosLoginOpen: (v) => set({ wasosLoginOpen: v }),
  setWasosUploadOpen: (v) => set({ wasosUploadOpen: v, ...(v ? {} : { wasosUploadData: null }) }),

  checkSession: async () => {
    try {
      const res = await fetch(`${API}/me`, { credentials: 'include' });
      const data = await res.json();
      // Normalize: ensure orgId and orgName are available
      const user = data ? { ...data, orgId: data.orgId || null, orgName: data.orgName || null } : null;
      set({ user, loading: false });
      if (user) {
        if (!socket.connected) socket.connect();
        if (user.mustChangePassword) {
          set({ passwordChangeOpen: true });
        }
        // Check WaSOS status if enabled
        if (user.wasosEnabled) {
          get().checkWasosStatus();
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

  // WaSOS methods
  checkWasosStatus: async () => {
    try {
      const res = await fetch(`${WASOS_API}/status`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        set({ wasosLoggedIn: data.loggedIn });
      }
    } catch {
      set({ wasosLoggedIn: false });
    }
  },

  wasosLogin: async (username, password) => {
    set({ wasosLoading: true });
    try {
      const res = await fetch(`${WASOS_API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Login failed');
      }
      set({ wasosLoggedIn: true, wasosLoginOpen: false, wasosLoading: false });
      return true;
    } catch (err) {
      set({ wasosLoading: false });
      throw err;
    }
  },

  wasosLogout: async () => {
    try {
      await fetch(`${WASOS_API}/logout?clearCredentials=true`, {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch {}
    set({ wasosLoggedIn: false });
  },

  // Prepare WaSOS upload - stores data and opens dialog
  prepareWasosUpload: (imageData, coordinates, filename) => {
    set({
      wasosUploadOpen: true,
      wasosUploadData: {
        image: imageData,
        coordinates,
        filename,
        preview: imageData, // base64 can be used directly as src
      },
    });
  },

  // Perform WaSOS upload with description
  uploadToWasos: async (description) => {
    const { wasosUploadData } = get();
    if (!wasosUploadData?.image) {
      throw new Error('No image to upload');
    }

    set({ wasosUploading: true });
    try {
      const res = await fetch(`${WASOS_API}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text: description || '',
          coordinates: wasosUploadData.coordinates,
          image: wasosUploadData.image,
          filename: wasosUploadData.filename,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload failed');
      }

      // Don't close dialog here - let WasosUploadDialog show success state first
      set({ wasosUploading: false });
      return true;
    } catch (err) {
      set({ wasosUploading: false });
      throw err;
    }
  },
}));
