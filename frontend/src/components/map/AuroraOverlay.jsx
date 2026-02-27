import { useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

export default function AuroraOverlay() {
  const canvasRef = useRef(null);
  const mapRef = useMapStore((s) => s.mapRef);
  const auroraOpacity = useMapStore((s) => s.auroraOpacity);
  const auroraGrid = useMapStore((s) => s.auroraGrid);

  const renderAurora = useCallback(() => {
    const canvas = canvasRef.current;
    const map = mapRef;
    if (!canvas || !map || !auroraGrid?.data) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // Render at 1/4 resolution for performance
    const scale = 4;
    const sw = Math.ceil(w / scale);
    const sh = Math.ceil(h / scale);
    const imageData = ctx.createImageData(sw, sh);
    const pixels = imageData.data;

    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        const screenX = px * scale;
        const screenY = py * scale;
        const lngLat = map.transform.screenPointToLocation({ x: screenX, y: screenY });
        const intensity = getAuroraIntensity(auroraGrid, lngLat.lng, lngLat.lat);
        if (intensity === null || intensity < 3) continue;

        const color = intensityToColor(intensity);
        const idx = (py * sw + px) * 4;
        pixels[idx] = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
        pixels[idx + 3] = color[3];
      }
    }

    // Draw low-res then scale up with smoothing
    const offscreen = new OffscreenCanvas(sw, sh);
    const offCtx = offscreen.getContext('2d');
    offCtx.putImageData(imageData, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offscreen, 0, 0, sw, sh, 0, 0, w, h);
  }, [mapRef, auroraGrid]);

  // Re-render on map move
  useEffect(() => {
    const map = mapRef;
    if (!map || !auroraGrid?.data) return;
    renderAurora();
    const onMove = () => renderAurora();
    map.on('move', onMove);
    return () => map.off('move', onMove);
  }, [mapRef, auroraGrid, renderAurora]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-[5]"
      style={{ opacity: auroraOpacity }}
    />
  );
}

// Bilinear interpolation for smooth gradients
function getAuroraIntensity(grid, lon, lat) {
  const { bounds: b, gridSize, data } = grid;
  if (lat < b.south || lat > b.north) return null;

  // Normalize longitude to -180 to 180 range (MapLibre can return values outside this range when zoomed out)
  let normLon = ((lon % 360) + 540) % 360 - 180;

  // Normalize to grid coordinates
  const x = ((normLon - b.west) / (b.east - b.west)) * (gridSize.lon - 1);
  const y = ((lat - b.south) / (b.north - b.south)) * (gridSize.lat - 1);

  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || xi >= gridSize.lon - 1 || yi < 0 || yi >= gridSize.lat - 1) return null;

  const fx = x - xi, fy = y - yi;
  const i00 = data[yi * gridSize.lon + xi];
  const i10 = data[yi * gridSize.lon + xi + 1];
  const i01 = data[(yi + 1) * gridSize.lon + xi];
  const i11 = data[(yi + 1) * gridSize.lon + xi + 1];

  return i00 * (1 - fx) * (1 - fy)
       + i10 * fx * (1 - fy)
       + i01 * (1 - fx) * fy
       + i11 * fx * fy;
}

// Color ramp: transparent -> dark green -> #00D525
function intensityToColor(intensity) {
  const norm = Math.min(intensity / 25, 1.0);

  if (norm < 0.2) {
    // Transparent to dark green
    const t = norm / 0.2;
    return [0, Math.round(50 * t), Math.round(10 * t), Math.round(80 * t)];
  } else if (norm < 0.5) {
    // Dark green to medium green
    const t = (norm - 0.2) / 0.3;
    return [0, Math.round(50 + 100 * t), Math.round(10 + 10 * t), Math.round(80 + 100 * t)];
  } else {
    // Medium green to bright #00D525
    const t = (norm - 0.5) / 0.5;
    return [0, Math.round(150 + 63 * t), Math.round(20 + 17 * t), Math.round(180 + 60 * t)];
  }
}
