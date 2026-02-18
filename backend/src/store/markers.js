import { v4 as uuid } from 'uuid';

export function createMarkerStore() {
  const items = new Map();

  return {
    getAll: () => Array.from(items.values()),
    get: (id) => items.get(id),
    size: () => items.size,
    set: (id, data) => items.set(id, data),
    add(data) {
      const marker = {
        ...data,
        id: uuid(),
        type: 'marker',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      items.set(marker.id, marker);
      return marker;
    },
    update(id, changes) {
      const existing = items.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...changes, id, updatedAt: new Date().toISOString() };
      items.set(id, updated);
      return updated;
    },
    delete(id) {
      return items.delete(id);
    },
  };
}
