import { create } from 'zustand';

const API = '/api/projects';

export const useProjectStore = create((set, get) => ({
  myProjects: [],
  groups: [],
  loading: false,

  fetchProjects: async () => {
    set({ loading: true });
    try {
      const res = await fetch(API, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        set({ myProjects: data, loading: false });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  createProject: async (name, groupId) => {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, groupId: groupId || undefined }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create project');
    }
    const project = await res.json();
    set((s) => ({ myProjects: [project, ...s.myProjects] }));
    return project;
  },

  deleteProject: async (id) => {
    const res = await fetch(`${API}/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete project');
    }
    set((s) => ({ myProjects: s.myProjects.filter(p => p.id !== id) }));
  },

  renameProject: async (id, name) => {
    const res = await fetch(`${API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to rename project');
    }
    set((s) => ({
      myProjects: s.myProjects.map(p => p.id === id ? { ...p, name } : p),
    }));
  },

  // Share project with a group (additive)
  shareProject: async (id, groupId) => {
    const res = await fetch(`${API}/${id}/share`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ groupId }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to share project');
    }
    get().fetchProjects();
  },

  // Unshare from a specific group
  unshareFromGroup: async (id, groupId) => {
    const res = await fetch(`${API}/${id}/share/${groupId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to unshare project');
    }
    get().fetchProjects();
  },

  // Unshare from all groups (make private)
  unshareProject: async (id) => {
    const res = await fetch(`${API}/${id}/share`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to unshare project');
    }
    get().fetchProjects();
  },

  fetchGroups: async () => {
    try {
      const res = await fetch('/api/groups', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        set({ groups: data });
      }
    } catch {}
  },

  reorderMyProjects: (orderedIds) => set((s) => {
    const idOrder = new Map(orderedIds.map((id, i) => [id, i]));
    const sorted = [...s.myProjects].sort((a, b) => {
      const ai = idOrder.has(a.id) ? idOrder.get(a.id) : Infinity;
      const bi = idOrder.has(b.id) ? idOrder.get(b.id) : Infinity;
      return ai - bi;
    });
    return { myProjects: sorted };
  }),
}));
