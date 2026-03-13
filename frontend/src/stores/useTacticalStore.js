import { create } from 'zustand';
import { socket } from '../lib/socket.js';

function loadTacticalLayerVisibility(projectId) {
  try {
    const raw = localStorage.getItem(`tacticalLayers:${projectId}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

export const useTacticalStore = create((set, get) => ({
  // projectId → { markers[], drawings[], layers[] }
  projects: {},
  activeProjectId: null,    // receives new markers/drawings
  activeLayerId: null,      // default layer for new markers/drawings
  visibleProjectIds: [],    // ordered: first = bottom z-layer, last = top
  layerVisibility: {},      // layerId → bool (client-local overrides)
  labelVisibility: {},      // layerId → bool (client-local, default true; controls label display)
  itemVisibility: {},       // viewshedId/rfCoverageId → bool (client-local per-item toggle)

  // --- Project management ---

  setActiveProject: (projectId) => set({ activeProjectId: projectId, activeLayerId: null }),
  setActiveLayer: (layerId) => set({ activeLayerId: layerId }),

  showProject: (projectId, drawerOrder) => set((s) => {
    if (s.visibleProjectIds.includes(projectId)) return {};
    let newVisible = [...s.visibleProjectIds, projectId];
    // Respect drawer order if provided
    if (drawerOrder && drawerOrder.length > 0) {
      const orderMap = new Map(drawerOrder.map((id, i) => [id, i]));
      newVisible.sort((a, b) => {
        const ai = orderMap.has(a) ? orderMap.get(a) : Infinity;
        const bi = orderMap.has(b) ? orderMap.get(b) : Infinity;
        return ai - bi;
      });
    }
    // Join socket room
    socket.emit('client:project:join', { projectId });
    // If no active project, set this one
    const activeProjectId = s.activeProjectId || projectId;
    return { visibleProjectIds: newVisible, activeProjectId };
  }),

  hideProject: (projectId) => set((s) => {
    const newVisible = s.visibleProjectIds.filter(id => id !== projectId);
    socket.emit('client:project:leave', { projectId });
    // If we hid the active project, pick another or null
    const wasActive = s.activeProjectId === projectId;
    const activeProjectId = wasActive
      ? (newVisible[newVisible.length - 1] || null)
      : s.activeProjectId;
    const activeLayerId = wasActive ? null : s.activeLayerId;
    // Disable all "not_in_use" layers for this project and reset label visibility
    const proj = s.projects[projectId];
    const newVis = { ...s.layerVisibility };
    const newLabelVis = { ...s.labelVisibility };
    if (proj) {
      for (const l of proj.layers) {
        if (l.category === 'not_in_use') newVis[l.id] = false;
        delete newLabelVis[l.id]; // reset labels to default (on)
      }
    }
    return { visibleProjectIds: newVisible, activeProjectId, activeLayerId, layerVisibility: newVis, labelVisibility: newLabelVis };
  }),

  reorderProjects: (orderedIds) => set({ visibleProjectIds: orderedIds }),

  // --- Project state (from server) ---

  setProjectState: (projectId, { markers, drawings, layers, pins, viewsheds, rfCoverages }) => set((s) => {
    const allLayers = layers || [];
    // Restore saved layer visibility from localStorage
    const saved = loadTacticalLayerVisibility(projectId);
    const newVis = { ...s.layerVisibility };
    const newLabelVis = { ...s.labelVisibility };
    for (const l of allLayers) {
      // Force all "not_in_use" layers to be hidden regardless of saved state
      if (l.category === 'not_in_use') {
        newVis[l.id] = false;
      } else if (l.id in (saved.layerVisibility || {})) {
        newVis[l.id] = saved.layerVisibility[l.id];
      }
      if (l.id in (saved.labelVisibility || {})) {
        newLabelVis[l.id] = saved.labelVisibility[l.id];
      }
    }
    return {
      projects: {
        ...s.projects,
        [projectId]: { markers: markers || [], drawings: drawings || [], layers: allLayers, pins: pins || [], viewsheds: viewsheds || [], rfCoverages: rfCoverages || [] },
      },
      layerVisibility: newVis,
      labelVisibility: newLabelVis,
    };
  }),

  removeProjectData: (projectId) => set((s) => {
    const { [projectId]: _, ...rest } = s.projects;
    return { projects: rest };
  }),

  // --- Per-item CRUD ---

  addMarker: (projectId, marker) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: { ...proj, markers: [...proj.markers, marker] },
      },
    };
  }),

  updateMarker: (projectId, updated) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: {
          ...proj,
          markers: proj.markers.map(m => m.id === updated.id ? updated : m),
        },
      },
    };
  }),

  deleteMarker: (projectId, id) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: {
          ...proj,
          markers: proj.markers.filter(m => m.id !== id),
        },
      },
    };
  }),

  addDrawing: (projectId, drawing) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: { ...proj, drawings: [...proj.drawings, drawing] },
      },
    };
  }),

  updateDrawing: (projectId, updated) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: {
          ...proj,
          drawings: proj.drawings.map(d => d.id === updated.id ? updated : d),
        },
      },
    };
  }),

  deleteDrawing: (projectId, id) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: {
          ...proj,
          drawings: proj.drawings.filter(d => d.id !== id),
        },
      },
    };
  }),

  addLayer: (projectId, layer) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: { ...proj, layers: [...proj.layers, layer] },
      },
    };
  }),

  updateLayer: (projectId, updated) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: {
          ...proj,
          layers: proj.layers.map(l => l.id === updated.id ? updated : l),
        },
      },
    };
  }),

  deleteLayer: (projectId, id) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: {
          ...proj,
          layers: proj.layers.filter(l => l.id !== id),
          markers: proj.markers.filter(m => m.layerId !== id),
          drawings: proj.drawings.filter(d => d.layerId !== id),
        },
      },
    };
  }),

  addPin: (projectId, pin) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: { ...proj, pins: [...(proj.pins || []), pin] },
      },
    };
  }),

  updatePin: (projectId, updated) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: {
          ...proj,
          pins: (proj.pins || []).map(p => p.id === updated.id ? updated : p),
        },
      },
    };
  }),

  deletePin: (projectId, id) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: { ...proj, pins: (proj.pins || []).filter(p => p.id !== id) },
      },
    };
  }),

  addViewshed: (projectId, viewshed) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: { ...proj, viewsheds: [...(proj.viewsheds || []), viewshed] },
      },
    };
  }),

  updateViewshed: (projectId, updated) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: {
          ...proj,
          viewsheds: (proj.viewsheds || []).map(v => v.id === updated.id ? { ...v, ...updated } : v),
        },
      },
    };
  }),

  deleteViewshed: (projectId, id) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: { ...proj, viewsheds: (proj.viewsheds || []).filter(v => v.id !== id) },
      },
    };
  }),

  clearViewsheds: (projectId) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: { ...proj, viewsheds: [] },
      },
    };
  }),

  addRFCoverage: (projectId, coverage) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    const existing = proj.rfCoverages || [];
    if (existing.some(c => c.id === coverage.id)) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: { ...proj, rfCoverages: [...existing, coverage] },
      },
    };
  }),

  updateRFCoverageLabel: (projectId, id, showLabel) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: {
          ...proj,
          rfCoverages: (proj.rfCoverages || []).map(c => c.id === id ? { ...c, showLabel } : c),
        },
      },
    };
  }),

  deleteRFCoverage: (projectId, id) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: { ...proj, rfCoverages: (proj.rfCoverages || []).filter(c => c.id !== id) },
      },
    };
  }),

  clearRFCoverages: (projectId) => set((s) => {
    const proj = s.projects[projectId];
    if (!proj) return {};
    return {
      projects: {
        ...s.projects,
        [projectId]: { ...proj, rfCoverages: [] },
      },
    };
  }),

  toggleLayerVisibility: (layerId) => set((s) => ({
    layerVisibility: {
      ...s.layerVisibility,
      [layerId]: s.layerVisibility[layerId] === false ? true : false,
    },
  })),

  toggleLabelVisibility: (layerId) => set((s) => ({
    labelVisibility: {
      ...s.labelVisibility,
      [layerId]: s.labelVisibility[layerId] === false ? true : false,
    },
  })),

  toggleItemVisibility: (itemId) => set((s) => ({
    itemVisibility: {
      ...s.itemVisibility,
      [itemId]: s.itemVisibility[itemId] === false ? true : false,
    },
  })),

  // --- Computed helpers (not in store, use outside) ---
}));

// Auto-save tactical layer visibility per project to localStorage
let _tacticalSaveTimer = null;
useTacticalStore.subscribe((state, prev) => {
  if (state.layerVisibility === prev.layerVisibility && state.labelVisibility === prev.labelVisibility) return;
  clearTimeout(_tacticalSaveTimer);
  _tacticalSaveTimer = setTimeout(() => {
    const s = useTacticalStore.getState();
    // Save visibility for each visible project's layers
    for (const pid of s.visibleProjectIds) {
      const proj = s.projects[pid];
      if (!proj) continue;
      const layerIds = proj.layers.map(l => l.id);
      const layerVis = {};
      const labelVis = {};
      for (const lid of layerIds) {
        if (lid in s.layerVisibility) layerVis[lid] = s.layerVisibility[lid];
        if (lid in s.labelVisibility) labelVis[lid] = s.labelVisibility[lid];
      }
      try {
        localStorage.setItem(`tacticalLayers:${pid}`, JSON.stringify({ layerVisibility: layerVis, labelVisibility: labelVis }));
      } catch { /* quota */ }
    }
  }, 500);
});

/**
 * Get all visible markers across all visible projects, respecting layer visibility.
 */
export function getAllVisibleMarkers(state) {
  const { projects, visibleProjectIds, layerVisibility } = state;
  const allMarkers = [];
  for (const pid of visibleProjectIds) {
    const proj = projects[pid];
    if (!proj) continue;
    const visLayerIds = new Set(
      proj.layers.filter(l => layerVisibility[l.id] !== false).map(l => l.id)
    );
    for (const m of proj.markers) {
      if (!m.layerId || visLayerIds.has(m.layerId)) {
        allMarkers.push({ ...m, _projectId: pid });
      }
    }
  }
  return allMarkers;
}

/**
 * Get all visible drawings across all visible projects, respecting layer visibility.
 */
/**
 * Get all visible pins across all visible projects, respecting layer visibility.
 */
export function getAllVisiblePins(state) {
  const { projects, visibleProjectIds, layerVisibility } = state;
  const allPins = [];
  for (const pid of visibleProjectIds) {
    const proj = projects[pid];
    if (!proj) continue;
    const visLayerIds = new Set(
      proj.layers.filter(l => layerVisibility[l.id] !== false).map(l => l.id)
    );
    for (const p of (proj.pins || [])) {
      if (!p.layerId || visLayerIds.has(p.layerId)) {
        allPins.push({ ...p, _projectId: pid });
      }
    }
  }
  return allPins;
}

export function getAllVisibleDrawings(state) {
  const { projects, visibleProjectIds, layerVisibility } = state;
  const allDrawings = [];
  for (const pid of visibleProjectIds) {
    const proj = projects[pid];
    if (!proj) continue;
    const visLayerIds = new Set(
      proj.layers.filter(l => layerVisibility[l.id] !== false).map(l => l.id)
    );
    for (const d of proj.drawings) {
      if (!d.layerId || visLayerIds.has(d.layerId)) {
        allDrawings.push({ ...d, _projectId: pid });
      }
    }
  }
  return allDrawings;
}
