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

    // Get CSS dimensions (what screenPointToLocation expects)
    const mapCanvas = map.getCanvas();
    const cssWidth = mapCanvas.clientWidth;
    const cssHeight = mapCanvas.clientHeight;

    // Set canvas buffer size (may be scaled by DPR)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr); // Scale context to match DPR
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Render at reduced resolution for performance (in CSS pixels)
    const scale = 4;
    const sw = Math.ceil(cssWidth / scale);
    const sh = Math.ceil(cssHeight / scale);
    const imageData = ctx.createImageData(sw, sh);
    const pixels = imageData.data;

    const { bounds: b } = auroraGrid;

    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        // Use CSS pixel coordinates for screenPointToLocation
        const screenX = px * scale;
        const screenY = py * scale;
        const lngLat = map.transform.screenPointToLocation({ x: screenX, y: screenY });

        // Check if within aurora latitude zone (50-90°N)
        if (lngLat.lat < b.south || lngLat.lat > b.north) continue;

        const intensity = getAuroraIntensity(auroraGrid, lngLat.lng, lngLat.lat);
        const effectiveIntensity = intensity === null ? 0 : intensity;

        // Always draw something in the aurora zone - use minimum intensity of 2 for visibility
        const displayIntensity = Math.max(effectiveIntensity, 2);

        const color = intensityToColor(displayIntensity);
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
    ctx.drawImage(offscreen, 0, 0, sw, sh, 0, 0, cssWidth, cssHeight);
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

  // Clamp to valid grid range for interpolation
  const xi = Math.floor(x), yi = Math.floor(y);

  // Handle edge cases by clamping instead of returning null
  const xi0 = Math.max(0, Math.min(xi, gridSize.lon - 2));
  const yi0 = Math.max(0, Math.min(yi, gridSize.lat - 2));
  const xi1 = xi0 + 1;
  const yi1 = yi0 + 1;

  // Fractional parts (clamped for edge pixels)
  const fx = Math.max(0, Math.min(1, x - xi0));
  const fy = Math.max(0, Math.min(1, y - yi0));

  const i00 = data[yi0 * gridSize.lon + xi0] || 0;
  const i10 = data[yi0 * gridSize.lon + xi1] || 0;
  const i01 = data[yi1 * gridSize.lon + xi0] || 0;
  const i11 = data[yi1 * gridSize.lon + xi1] || 0;

  return i00 * (1 - fx) * (1 - fy)
       + i10 * fx * (1 - fy)
       + i01 * (1 - fx) * fy
       + i11 * fx * fy;
}

// Color ramp: very faint -> dark green -> bright #00D525
function intensityToColor(intensity) {
  // Ensure minimum visibility for any non-zero intensity
  const norm = Math.min(Math.max(intensity, 0) / 25, 1.0);

  if (norm < 0.12) {
    // Very low: faint dark green base (ensures smooth edges)
    const t = norm / 0.12;
    return [0, Math.round(30 + 20 * t), Math.round(15 * t), Math.round(30 + 50 * t)];
  } else if (norm < 0.3) {
    // Low to dark green
    const t = (norm - 0.12) / 0.18;
    return [0, Math.round(50 + 50 * t), Math.round(15 + 10 * t), Math.round(80 + 70 * t)];
  } else if (norm < 0.6) {
    // Dark green to medium green
    const t = (norm - 0.3) / 0.3;
    return [0, Math.round(100 + 80 * t), Math.round(25 + 10 * t), Math.round(150 + 50 * t)];
  } else {
    // Medium green to bright #00D525
    const t = (norm - 0.6) / 0.4;
    return [0, Math.round(180 + 33 * t), Math.round(35 + 2 * t), Math.round(200 + 40 * t)];
  }
}
