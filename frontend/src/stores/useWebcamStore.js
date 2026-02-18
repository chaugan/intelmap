import { create } from 'zustand';

export const useWebcamStore = create((set) => ({
  cameras: [],
  openCameras: [],
  loading: false,
  error: null,

  setCameras: (cameras) => set({ cameras }),
  toggleCamera: (camera) => set((s) => {
    const id = camera.properties.id;
    const isOpen = s.openCameras.some((c) => c.properties.id === id);
    return {
      openCameras: isOpen
        ? s.openCameras.filter((c) => c.properties.id !== id)
        : [...s.openCameras, camera],
    };
  }),
  closeCamera: (id) => set((s) => ({
    openCameras: s.openCameras.filter((c) => c.properties.id !== id),
  })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
