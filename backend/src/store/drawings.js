import { v4 as uuid } from 'uuid';

export function createDrawingStore() {
  const items = new Map();

  return {
    getAll: () => Array.from(items.values()),
    get: (id) => items.get(id),
    size: () => items.size,
    set: (id, data) => items.set(id, data),
    add(data) {
      const drawing = {
        ...data,
        id: uuid(),
        type: 'drawing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      items.set(drawing.id, drawing);
      return drawing;
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
