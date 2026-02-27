import { create } from 'zustand';

const API = '/api/timelapse';

export const useTimelapseStore = create((set, get) => ({
  // Drawer state
  drawerOpen: JSON.parse(localStorage.getItem('timelapseDrawerOpen') || 'false'),
  drawerWidth: parseInt(localStorage.getItem('timelapseDrawerWidth') || '500', 10),
  activeTab: 'cameras', // 'cameras' | 'player' | 'exports'

  // Camera subscriptions
  cameras: [],
  loading: false,
  error: null,

  // Currently selected camera for player
  selectedCamera: null,

  // Player state
  playerTime: null, // Current time position in playback
  playbackSpeed: 1,
  isPlaying: false,
  isLive: true,

  // Exports
  exports: [],
  exportsLoading: false,

  // Actions
  openDrawer: () => {
    localStorage.setItem('timelapseDrawerOpen', 'true');
    set({ drawerOpen: true });
  },
  closeDrawer: () => {
    localStorage.setItem('timelapseDrawerOpen', 'false');
    set({ drawerOpen: false });
  },
  toggleDrawer: () => set((s) => {
    const next = !s.drawerOpen;
    localStorage.setItem('timelapseDrawerOpen', JSON.stringify(next));
    return { drawerOpen: next };
  }),
  setDrawerWidth: (width) => {
    localStorage.setItem('timelapseDrawerWidth', String(width));
    set({ drawerWidth: width });
  },
  setActiveTab: (tab) => set({ activeTab: tab }),

  setSelectedCamera: (camera) => set({
    selectedCamera: camera,
    activeTab: 'player',
    playerTime: null,
    isLive: true,
  }),

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setPlayerTime: (time) => set({ playerTime: time, isLive: false }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  goLive: () => set({ isLive: true, playerTime: null }),

  // Fetch user's subscribed cameras
  fetchCameras: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${API}/cameras`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch cameras');
      const data = await res.json();
      set({ cameras: data, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  // Subscribe to a camera
  subscribe: async (cameraId, cameraName = '') => {
    try {
      const res = await fetch(`${API}/subscribe/${cameraId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: cameraName }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to subscribe');
      }
      // Refresh camera list
      await get().fetchCameras();
      return true;
    } catch (err) {
      set({ error: err.message });
      return false;
    }
  },

  // Check if can unsubscribe (returns info for confirmation dialog)
  checkUnsubscribe: async (cameraId) => {
    try {
      const res = await fetch(`${API}/subscribe/${cameraId}/check`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json();
        return { canUnsubscribe: false, error: data.error };
      }
      return await res.json();
    } catch (err) {
      return { canUnsubscribe: false, error: err.message };
    }
  },

  // Unsubscribe from a camera
  unsubscribe: async (cameraId, force = false) => {
    try {
      const url = force ? `${API}/subscribe/${cameraId}?force=true` : `${API}/subscribe/${cameraId}`;
      const res = await fetch(url, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to unsubscribe');
      }

      // Update local state
      set((s) => ({
        cameras: s.cameras.filter((c) => c.cameraId !== cameraId),
        selectedCamera: s.selectedCamera?.cameraId === cameraId ? null : s.selectedCamera,
      }));
      return { success: true };
    } catch (err) {
      set({ error: err.message });
      return { success: false, error: err.message };
    }
  },

  // Get camera status
  getCameraStatus: async (cameraId) => {
    try {
      const res = await fetch(`${API}/status/${cameraId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to get status');
      return await res.json();
    } catch (err) {
      return null;
    }
  },

  // Fetch exports
  fetchExports: async () => {
    set({ exportsLoading: true });
    try {
      const res = await fetch(`${API}/exports`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch exports');
      const data = await res.json();
      set({ exports: data, exportsLoading: false });
    } catch (err) {
      set({ exportsLoading: false });
    }
  },

  // Create export
  createExport: async (cameraId, startTime, endTime) => {
    try {
      const res = await fetch(`${API}/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cameraId, startTime, endTime }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create export');
      }
      const data = await res.json();
      // Refresh exports list
      await get().fetchExports();
      return data;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  // Delete export
  deleteExport: async (exportId) => {
    try {
      const res = await fetch(`${API}/exports/${exportId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete export');
      set((s) => ({
        exports: s.exports.filter((e) => e.id !== exportId),
      }));
      return true;
    } catch (err) {
      return false;
    }
  },

  // Get HLS playlist URL
  getPlaylistUrl: (cameraId) => `${API}/stream/${cameraId}/playlist.m3u8`,

  // Get frame URL
  getFrameUrl: (cameraId, timestamp) =>
    timestamp
      ? `${API}/frame/${cameraId}/${timestamp}.jpg`
      : `${API}/frame/${cameraId}/latest.jpg`,

  // Get export download URL
  getExportDownloadUrl: (exportId) => `${API}/exports/${exportId}/download`,

  // Clear error
  clearError: () => set({ error: null }),
}));
