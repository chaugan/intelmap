import { create } from 'zustand';

const API = '/api/timelapse';

export const useTimelapseStore = create((set, get) => ({
  // Drawer state
  drawerOpen: false,
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
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
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

  // Unsubscribe from a camera
  unsubscribe: async (cameraId) => {
    try {
      const res = await fetch(`${API}/subscribe/${cameraId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to unsubscribe');

      // Update local state
      set((s) => ({
        cameras: s.cameras.filter((c) => c.cameraId !== cameraId),
        selectedCamera: s.selectedCamera?.cameraId === cameraId ? null : s.selectedCamera,
      }));
      return true;
    } catch (err) {
      set({ error: err.message });
      return false;
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
