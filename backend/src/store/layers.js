import { v4 as uuid } from 'uuid';

export function createLayerStore() {
  const items = new Map();

  return {
    getAll: () => Array.from(items.values()),
    get: (id) => items.get(id),
    size: () => items.size,
    set: (id, data) => items.set(id, data),
    add(data) {
      const layer = {
        ...data,
        id: uuid(),
        visible: true,
        createdAt: new Date().toISOString(),
      };
      items.set(layer.id, layer);
      return layer;
    },
    update(id, changes) {
      const existing = items.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...changes, id };
      items.set(id, updated);
      return updated;
    },
    delete(id) {
      return items.delete(id);
    },
  };
}
