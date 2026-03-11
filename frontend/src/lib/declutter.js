/**
 * Declutter algorithm — iterative force repulsion to resolve overlapping items.
 *
 * @param {Array<{ id: string, cx: number, cy: number, w: number, h: number }>} items
 *   Screen-space center and bounding-box dimensions.
 * @param {{ padding?: number, maxIterations?: number }} opts
 * @returns {Map<string, { dx: number, dy: number }>} pixel offsets per item id
 */
export function declutter(items, { padding = 14, maxIterations = 150 } = {}) {
  if (items.length < 2) return new Map();

  const n = items.length;

  // Initialize offsets — for items near the same position,
  // pre-spread them radially so the solver starts from a good state
  const offsets = new Map();

  // Cluster nearby items (within 5px)
  const assigned = new Array(n).fill(-1);
  const clusters = []; // array of arrays of indices
  for (let i = 0; i < n; i++) {
    if (assigned[i] >= 0) continue;
    const cluster = [i];
    assigned[i] = clusters.length;
    for (let j = i + 1; j < n; j++) {
      if (assigned[j] >= 0) continue;
      const dx = items[i].cx - items[j].cx;
      const dy = items[i].cy - items[j].cy;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
        cluster.push(j);
        assigned[j] = clusters.length;
      }
    }
    clusters.push(cluster);
  }

  for (const cluster of clusters) {
    if (cluster.length > 1) {
      // Pre-spread in a circle
      const radius = Math.max(70, cluster.length * 30);
      for (let k = 0; k < cluster.length; k++) {
        const angle = (k / cluster.length) * Math.PI * 2 - Math.PI / 2;
        offsets.set(items[cluster[k]].id, {
          dx: Math.cos(angle) * radius,
          dy: Math.sin(angle) * radius,
        });
      }
    } else {
      offsets.set(items[cluster[0]].id, { dx: 0, dy: 0 });
    }
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    let anyOverlap = false;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = items[i];
        const b = items[j];
        const oa = offsets.get(a.id);
        const ob = offsets.get(b.id);

        const ax = a.cx + oa.dx;
        const ay = a.cy + oa.dy;
        const bx = b.cx + ob.dx;
        const by = b.cy + ob.dy;

        const sepX = a.w / 2 + b.w / 2 + padding;
        const sepY = a.h / 2 + b.h / 2 + padding;

        const overlapX = sepX - Math.abs(ax - bx);
        const overlapY = sepY - Math.abs(ay - by);

        if (overlapX > 0 && overlapY > 0) {
          anyOverlap = true;

          // Direction from a to b
          let dx = bx - ax;
          let dy = by - ay;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 1) {
            // Coincident — pick a random radial direction
            const angle = Math.random() * Math.PI * 2;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
          } else {
            dx /= dist;
            dy /= dist;
          }

          // Push magnitude: the penetration depth along this direction
          // Use the minimum overlap axis as the push distance, plus extra gap
          const push = Math.min(overlapX, overlapY) * 0.55 + 8;

          // Each item moves half the push distance along the direction vector
          oa.dx -= dx * push;
          oa.dy -= dy * push;
          ob.dx += dx * push;
          ob.dy += dy * push;
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
