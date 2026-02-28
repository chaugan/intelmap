import { create } from 'zustand';

const API = '/api/monitoring';

// YOLO labels (80 COCO + tank)
export const YOLO_LABELS = [
  'airplane', 'apple', 'backpack', 'banana', 'baseball bat', 'baseball glove',
  'bear', 'bed', 'bench', 'bicycle', 'bird', 'boat', 'book', 'bottle', 'bowl',
  'broccoli', 'bus', 'cake', 'car', 'carrot', 'cat', 'cell phone', 'chair',
  'clock', 'couch', 'cow', 'cup', 'dining table', 'dog', 'donut', 'elephant',
  'fire hydrant', 'fork', 'frisbee', 'giraffe', 'hair drier', 'handbag',
  'horse', 'hot dog', 'keyboard', 'kite', 'knife', 'laptop', 'microwave',
  'motorcycle', 'mouse', 'orange', 'oven', 'parking meter', 'person', 'pizza',
  'potted plant', 'refrigerator', 'remote', 'sandwich', 'scissors', 'sheep',
  'sink', 'skateboard', 'skis', 'snowboard', 'spoon', 'sports ball',
  'stop sign', 'suitcase', 'surfboard', 'tank', 'teddy bear', 'tennis racket',
  'tie', 'toaster', 'toilet', 'toothbrush', 'traffic light', 'train',
  'truck', 'tv', 'umbrella', 'vase', 'wine glass', 'zebra'
];

export const SNOOZE_OPTIONS = [
  { value: 0, labelNo: 'Ingen slumring, motta alle varsler', labelEn: 'No snooze, receive all alerts' },
  { value: 15, labelNo: '15 minutter', labelEn: '15 minutes' },
  { value: 60, labelNo: '1 time', labelEn: '1 hour' },
  { value: 360, labelNo: '6 timer', labelEn: '6 hours' },
  { value: 1440, labelNo: '1 dag', labelEn: '1 day' },
];

export const useMonitoringStore = create((set, get) => ({
  // Config state
  enabled: false,
  ntfyChannel: null,
  configLoaded: false,

  // Subscriptions
  subscriptions: [],
  loading: false,
  error: null,

  // All monitored camera IDs (for map markers)
  monitoredCameraIds: [],

  // Preselect camera from map popup
  preselectCamera: null,

  // Detection history for selected camera
  selectedCameraId: null,
  detections: [],
  detectionsPage: 1,
  detectionsTotalCount: 0,
  detectionsLoading: false,

  // Highlight camera (for cross-tab navigation)
  highlightCameraId: null,

  // Fetch monitoring config
  fetchConfig: async () => {
    try {
      const res = await fetch(`${API}/config`, { credentials: 'include' });
      if (!res.ok) {
        set({ configLoaded: true, enabled: false });
        return;
      }
      const data = await res.json();
      set({
        enabled: data.enabled,
        ntfyChannel: data.ntfyChannel,
        configLoaded: true,
      });
    } catch {
      set({ configLoaded: true, enabled: false });
    }
  },

  // Fetch user's monitor subscriptions
  fetchSubscriptions: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${API}/subscriptions`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch subscriptions');
      const data = await res.json();
      set({ subscriptions: data, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  // Fetch monitored camera IDs (for map markers)
  fetchMonitoredCameras: async () => {
    try {
      const res = await fetch(`${API}/cameras`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      set({ monitoredCameraIds: data.cameraIds || [] });
    } catch {
      // Silently fail
    }
  },

  // Subscribe to monitor a camera
  subscribe: async (cameraId, labels, snoozeMinutes = 0, cameraName = null, lat = null, lon = null) => {
    try {
      const res = await fetch(`${API}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cameraId, cameraName, lat, lon, labels, snoozeMinutes }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to subscribe');
      }
      // Refresh subscriptions
      await get().fetchSubscriptions();
      await get().fetchMonitoredCameras();
      return true;
    } catch (err) {
      set({ error: err.message });
      return false;
    }
  },

  // Update monitor subscription
  updateSubscription: async (cameraId, labels, snoozeMinutes) => {
    try {
      const res = await fetch(`${API}/${cameraId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ labels, snoozeMinutes }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update subscription');
      }
      // Refresh subscriptions
      await get().fetchSubscriptions();
      return true;
    } catch (err) {
      set({ error: err.message });
      return false;
    }
  },

  // Unsubscribe from monitoring
  unsubscribe: async (cameraId) => {
    try {
      const res = await fetch(`${API}/${cameraId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to unsubscribe');
      }
      set((s) => ({
        subscriptions: s.subscriptions.filter((sub) => sub.cameraId !== cameraId),
        selectedCameraId: s.selectedCameraId === cameraId ? null : s.selectedCameraId,
      }));
      await get().fetchMonitoredCameras();
      return true;
    } catch (err) {
      set({ error: err.message });
      return false;
    }
  },

  // Fetch detection history for a camera
  fetchDetections: async (cameraId, page = 1) => {
    set({ detectionsLoading: true, selectedCameraId: cameraId });
    try {
      const res = await fetch(`${API}/${cameraId}/detections?page=${page}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch detections');
      const data = await res.json();
      set({
        detections: data.detections,
        detectionsPage: data.page,
        detectionsTotalCount: data.totalCount,
        detectionsLoading: false,
      });
    } catch (err) {
      set({ detectionsLoading: false });
    }
  },

  // Clear error
  clearError: () => set({ error: null }),

  // Set preselect camera (from map popup)
  setPreselectCamera: (camera) => set({ preselectCamera: camera }),

  // Clear preselect camera
  clearPreselectCamera: () => set({ preselectCamera: null }),

  // Set highlight camera (for cross-tab navigation from Cameras tab)
  setHighlightCamera: (cameraId) => set({ highlightCameraId: cameraId }),

  // Clear highlight camera
  clearHighlightCamera: () => set({ highlightCameraId: null }),
}));
