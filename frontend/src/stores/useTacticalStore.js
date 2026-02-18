import { create } from 'zustand';

export const useTacticalStore = create((set) => ({
  markers: [],
  drawings: [],
  layers: [],

  // Full state replacement
  setState: (state) => set({
    markers: state.markers || [],
    drawings: state.drawings || [],
    layers: state.layers || [],
  }),

  // Markers
  addMarker: (marker) => set((s) => ({ markers: [...s.markers, marker] })),
  updateMarker: (updated) => set((s) => ({
    markers: s.markers.map((m) => (m.id === updated.id ? updated : m)),
  })),
  deleteMarker: (id) => set((s) => ({
    markers: s.markers.filter((m) => m.id !== id),
  })),

  // Drawings
  addDrawing: (drawing) => set((s) => ({ drawings: [...s.drawings, drawing] })),
  updateDrawing: (updated) => set((s) => ({
    drawings: s.drawings.map((d) => (d.id === updated.id ? updated : d)),
  })),
  deleteDrawing: (id) => set((s) => ({
    drawings: s.drawings.filter((d) => d.id !== id),
  })),

  // Layers
  addLayer: (layer) => set((s) => ({ layers: [...s.layers, layer] })),
  updateLayer: (updated) => set((s) => ({
    layers: s.layers.map((l) => (l.id === updated.id ? updated : l)),
  })),
  deleteLayer: (id) => set((s) => ({
    layers: s.layers.filter((l) => l.id !== id),
    markers: s.markers.filter((m) => m.layerId !== id),
    drawings: s.drawings.filter((d) => d.layerId !== id),
  })),
}));
