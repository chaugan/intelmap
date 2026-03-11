/**
 * Declutter algorithm — iterative force repulsion to resolve overlapping items.
 *
 * @param {Array<{ id: string, cx: number, cy: number, w: number, h: number }>} items
 *   Screen-space center and bounding-box dimensions.
 * @param {{ padding?: number, maxIterations?: number }} opts
 * @returns {Map<string, { dx: number, dy: number }>} pixel offsets per item id
 */
export function declutter(items, { padding = 6, maxIterations = 50 } = {}) {
  if (items.length < 2) return new Map();

  // Initialize offsets
  const offsets = new Map();
  for (const item of items) {
    offsets.set(item.id, { dx: 0, dy: 0 });
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    let anyOverlap = false;

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const oa = offsets.get(a.id);
        const ob = offsets.get(b.id);

        const ax = a.cx + oa.dx;
        const ay = a.cy + oa.dy;
        const bx = b.cx + ob.dx;
        const by = b.cy + ob.dy;

        const halfWA = a.w / 2 + padding;
        const halfHA = a.h / 2 + padding;
        const halfWB = b.w / 2 + padding;
        const halfHB = b.h / 2 + padding;

        const overlapX = (halfWA + halfWB) - Math.abs(ax - bx);
        const overlapY = (halfHA + halfHB) - Math.abs(ay - by);

        if (overlapX > 0 && overlapY > 0) {
          anyOverlap = true;

          let dx = bx - ax;
          let dy = by - ay;

          // Jitter if centers coincide
          if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
          }

          // Push along the axis with less overlap (more natural separation)
          if (overlapX < overlapY) {
            const push = overlapX / 2 * Math.sign(dx || 1);
            oa.dx -= push;
            ob.dx += push;
          } else {
            const push = overlapY / 2 * Math.sign(dy || 1);
            oa.dy -= push;
            ob.dy += push;
          }
        }
      }
    }

    if (!anyOverlap) break;
  }

  // Remove zero offsets
  for (const [id, off] of offsets) {
    if (Math.abs(off.dx) < 0.5 && Math.abs(off.dy) < 0.5) {
      offsets.delete(id);
    }
  }

  return offsets;
}
