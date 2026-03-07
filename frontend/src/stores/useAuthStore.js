import { create } from 'zustand';
import { socket } from '../lib/socket.js';

const API = '/api/auth';
const WASOS_API = '/api/wasos';
const SIGNAL_API = '/api/signal';

export const useAuthStore = create((set, get) => ({
  user: null,
  loading: true,
  isImpersonating: false,
  realUser: null,

  // Dialog states
  loginOpen: false,
  passwordChangeOpen: false,
  securityDialogOpen: false,
  adminPanelOpen: false,
  wasosLoginOpen: false,
  signalLinkOpen: false,

  // MFA state
  mfaPending: null,          // { mfaToken, methods }
  mfaSetupRequired: false,

  // WaSOS state
  wasosLoggedIn: false,
  wasosLoading: false,
  wasosUploadOpen: false,
  wasosUploadData: null, // { image, coordinates, filename, preview }
  wasosUploading: false,

  // Signal state
  signalLinked: false,
  signalPhone: null,
  signalUploadOpen: false,
  signalUploadData: null, // { image, coordinates, filename, preview }
  signalUploading: false,

  setLoginOpen: (v) => set({ loginOpen: v }),
  setPasswordChangeOpen: (v) => set({ passwordChangeOpen: v }),
  setSecurityDialogOpen: (v) => set({ securityDialogOpen: v }),
  setAdminPanelOpen: (v) => set({ adminPanelOpen: v }),
  setWasosLoginOpen: (v) => set({ wasosLoginOpen: v }),
  setWasosUploadOpen: (v) => set({ wasosUploadOpen: v, ...(v ? {} : { wasosUploadData: null }) }),
  setSignalLinkOpen: (v) => set({ signalLinkOpen: v }),
  setSignalUploadOpen: (v) => set({ signalUploadOpen: v, ...(v ? {} : { signalUploadData: null }) }),

  checkSession: async () => {
    try {
      const res = await fetch(`${API}/me`, { credentials: 'include' });
      const data = await res.json();
      // Normalize: ensure orgId and orgName are available
      const user = data ? { ...data, orgId: data.orgId || null, orgName: data.orgName || null } : null;
      set({
        user,
        loading: false,
        isImpersonating: !!data?.isImpersonating,
        realUser: data?.realUser || null,
      });
      if (user) {
        if (!socket.connected) socket.connect();
        if (user.mustChangePassword) {
          set({ passwordChangeOpen: true });
        }
        if (user.mfaSetupRequired) {
          set({ securityDialogOpen: true, mfaSetupRequired: true });
        }
        // Check WaSOS status if enabled
        if (user.wasosEnabled) {
          get().checkWasosStatus();
        }
        // Check Signal status if enabled
        if (user.signalEnabled) {
          get().checkSignalStatus();
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
    const data = await res.json();

    // MFA required - don't create session yet
    if (data.mfaRequired) {
      set({ mfaPending: { mfaToken: data.mfaToken, methods: data.methods } });
      return data;
    }

    const user = data;
    set({ user, loginOpen: false, mfaPending: null });
    // Super-admins see a different UI tree; reload to avoid complex unmount issues
    if (user.role === 'super_admin') {
      window.location.reload();
      return user;
    }
    if (!socket.connected) socket.connect();
    if (user.mustChangePassword) {
      set({ passwordChangeOpen: true });
    }
    if (user.mfaSetupRequired) {
      set({ securityDialogOpen: true, mfaSetupRequired: true });
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

  verifyMfa: async (method, code, credential) => {
    const { mfaPending } = get();
    if (!mfaPending) throw new Error('No MFA session');

    // WebAuthn uses a different endpoint
    if (method === 'webauthn') {
      const res = await fetch(`${API}/mfa/webauthn/auth-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mfaToken: mfaPending.mfaToken, credential }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'MFA verification failed');
      }
      const user = await res.json();
      set({ user, loginOpen: false, mfaPending: null });
      if (!socket.connected) socket.connect();
      if (user.mustChangePassword) set({ passwordChangeOpen: true });
      if (user.mfaSetupRequired) set({ securityDialogOpen: true, mfaSetupRequired: true });
      return user;
    }

    const res = await fetch(`${API}/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mfaToken: mfaPending.mfaToken, method, code }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'MFA verification failed');
    }
    const user = await res.json();
    set({ user, loginOpen: false, mfaPending: null });
    if (user.role === 'super_admin') { window.location.reload(); return user; }
    if (!socket.connected) socket.connect();
    if (user.mustChangePassword) set({ passwordChangeOpen: true });
    if (user.mfaSetupRequired) set({ securityDialogOpen: true, mfaSetupRequired: true });
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

  // Impersonation methods
  startImpersonation: async (userId) => {
    const res = await fetch(`${API}/impersonate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Impersonation failed');
    }
    window.location.reload();
  },

  stopImpersonation: async () => {
    const res = await fetch(`${API}/stop-impersonate`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to stop impersonation');
    }
    window.location.reload();
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

  // Signal methods
  checkSignalStatus: async () => {
    try {
      const res = await fetch(`${SIGNAL_API}/status`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        set({ signalLinked: data.linked, signalPhone: data.phone });
      }
    } catch {
      set({ signalLinked: false, signalPhone: null });
    }
  },

  prepareSignalUpload: (imageData, coordinates, filename) => {
    set({
      signalUploadOpen: true,
      signalUploadData: {
        image: imageData,
        coordinates,
        filename,
        preview: imageData,
      },
    });
  },

  uploadToSignal: async (groupId, caption) => {
    const { signalUploadData } = get();
    if (!signalUploadData?.image) {
      throw new Error('No image to upload');
    }

    set({ signalUploading: true });
    try {
      const res = await fetch(`${SIGNAL_API}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          groupId,
          image: signalUploadData.image,
          caption: caption || '',
          filename: signalUploadData.filename,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Send failed');
      }

      set({ signalUploading: false });
      return true;
    } catch (err) {
      set({ signalUploading: false });
      throw err;
    }
  },

  unlinkSignal: async () => {
    try {
      await fetch(`${SIGNAL_API}/unlink`, {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch {}
    set({ signalLinked: false, signalPhone: null });
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
