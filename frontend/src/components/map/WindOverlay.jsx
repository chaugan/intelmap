import { useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useWeatherStore } from '../../stores/useWeatherStore.js';

export default function WindOverlay() {
  const heatmapRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const mapMovingRef = useRef(false);
  const lastCenterRef = useRef(null);
  const mapRef = useMapStore((s) => s.mapRef);
  const bounds = useMapStore((s) => s.bounds);
  const lang = useMapStore((s) => s.lang);
  const windOpacity = useMapStore((s) => s.windOpacity);
  const windGrid = useWeatherStore((s) => s.windGrid);
  const setWindGrid = useWeatherStore((s) => s.setWindGrid);
  const setWindFetchedAt = useWeatherStore((s) => s.setWindFetchedAt);
  const setWindLoading = useWeatherStore((s) => s.setWindLoading);

  // Track map movement
  useEffect(() => {
    const map = mapRef;
    if (!map) return;
    const onMoveStart = () => { mapMovingRef.current = true; };
    const onMoveEnd = () => { mapMovingRef.current = false; };
    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);
    return () => {
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
    };
  }, [mapRef]);

  // Fetch wind grid when bounds change
  useEffect(() => {
    if (!bounds) return;
    let cancelled = false;

    const fetchGrid = async () => {
      setWindLoading(true);
      try {
        const res = await fetch(
          `/api/weather/wind-grid?north=${bounds.north}&south=${bounds.south}&east=${bounds.east}&west=${bounds.west}`
        );
        if (res.ok && !cancelled) {
          setWindGrid(await res.json());
          setWindFetchedAt(new Date());
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setWindLoading(false);
      }
    };

    const timer = setTimeout(fetchGrid, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bounds?.north, bounds?.south, bounds?.east, bounds?.west]);

  // Render heatmap — re-draw whenever windGrid changes or map moves
  const renderHeatmap = useCallback(() => {
    const heatCanvas = heatmapRef.current;
    const map = mapRef;
    if (!heatCanvas || !map || !windGrid?.data) return;

    const w = heatCanvas.clientWidth;
    const h = heatCanvas.clientHeight;
    heatCanvas.width = w;
    heatCanvas.height = h;

    const ctx = heatCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // Render at 1/4 resolution for performance, then scale up
    const scale = 4;
    const sw = Math.ceil(w / scale);
    const sh = Math.ceil(h / scale);
    const imageData = ctx.createImageData(sw, sh);
    const pixels = imageData.data;

    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        // Map screen pixel to lon/lat
        const screenX = px * scale;
        const screenY = py * scale;
        const lngLat = map.unproject([screenX, screenY]);
        const speed = getWindSpeed(windGrid, lngLat.lng, lngLat.lat);
        if (speed === null) continue;

        const color = speedToColorRgb(speed);
        const idx = (py * sw + px) * 4;
        pixels[idx] = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
        pixels[idx + 3] = 245; // near-opaque — covers busy topo map well
      }
    }

    // Draw low-res image then scale up with smoothing
    const offscreen = new OffscreenCanvas(sw, sh);
    const offCtx = offscreen.getContext('2d');
    offCtx.putImageData(imageData, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offscreen, 0, 0, sw, sh, 0, 0, w, h);
  }, [mapRef, windGrid]);

  // Re-render heatmap when data loads or map moves
  useEffect(() => {
    const map = mapRef;
    if (!map || !windGrid?.data) return;

    renderHeatmap();

    const onMove = () => renderHeatmap();
    map.on('move', onMove);
    return () => map.off('move', onMove);
  }, [mapRef, windGrid, renderHeatmap]);

  // Animate white particles
  useEffect(() => {
    const canvas = canvasRef.current;
    const map = mapRef;
    if (!canvas || !map || !windGrid?.data) return;

    const ctx = canvas.getContext('2d');
    const particles = [];
    const numParticles = 1200;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w !== sizeRef.current.w || h !== sizeRef.current.h) {
        canvas.width = w;
        canvas.height = h;
        sizeRef.current = { w, h };
      }
    };
    resize();

    for (let i = 0; i < numParticles; i++) {
      particles.push(randomParticle(windGrid.bounds));
    }

    function randomParticle(b) {
      return {
        lon: b.west + Math.random() * (b.east - b.west),
        lat: b.south + Math.random() * (b.north - b.south),
        age: Math.floor(Math.random() * 100),
        maxAge: 150 + Math.floor(Math.random() * 100),
      };
    }

    function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

    function draw() {
      resize();

      const zoom = map.getZoom();
      const activeCount = Math.round(numParticles * clamp(1.4 - zoom * 0.07, 0.3, 1.0));

      // Detect panning
      const center = map.getCenter();
      const prev = lastCenterRef.current;
      const panning = prev && (Math.abs(center.lng - prev.lng) > 0.0001 || Math.abs(center.lat - prev.lat) > 0.0001);
      lastCenterRef.current = { lng: center.lng, lat: center.lat };

      if (panning || mapMovingRef.current) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        const fadeRate = 0.03 + Math.max(0, zoom - 8) * 0.008;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0, 0, 0, ${fadeRate})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
      }

      for (let i = 0; i < activeCount; i++) {
        const p = particles[i];
        const wind = getWind(windGrid, p.lon, p.lat);
        if (!wind) {
          Object.assign(p, randomParticle(windGrid.bounds));
          continue;
        }

        const px = map.project([p.lon, p.lat]);

        // Move particle — low base so calm winds drift slowly, sqrt curve for higher speeds
        const moveScale = 0.00003 + Math.sqrt(wind.speed) * 0.00004;
        const newLon = p.lon + wind.u * moveScale;
        const newLat = p.lat + wind.v * moveScale;
        p.age++;

        if (p.age > p.maxAge) {
          Object.assign(p, randomParticle(windGrid.bounds));
          continue;
        }

        const px2 = map.project([newLon, newLat]);

        // Ensure minimum screen-space line length for visibility
        let dx = px2.x - px.x;
        let dy = px2.y - px.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const minLen = 3;
        let drawX = px2.x, drawY = px2.y;
        if (len > 0 && len < minLen) {
          drawX = px.x + (dx / len) * minLen;
          drawY = px.y + (dy / len) * minLen;
        }

        // White particles — uniform appearance
        ctx.beginPath();
        ctx.moveTo(px.x, px.y);
        ctx.lineTo(drawX, drawY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        p.lon = newLon;
        p.lat = newLat;
      }

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [mapRef, windGrid]);

  return (
    <div className="absolute inset-0 pointer-events-none z-[5]">
      {/* Heatmap canvas — opacity controlled by slider */}
      <canvas
        ref={heatmapRef}
        data-wind-heatmap
        className="absolute inset-0 w-full h-full"
        style={{ opacity: windOpacity }}
      />
      {/* Particle canvas — always visible on top */}
      <canvas
        ref={canvasRef}
        data-wind-particles
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}

// Bilinear interpolation — returns { u, v, speed } or null
function getWind(windGrid, lon, lat) {
  const { bounds: b, data, gridSize } = windGrid;
  const x = ((lon - b.west) / (b.east - b.west)) * (gridSize - 1);
  const y = ((lat - b.south) / (b.north - b.south)) * (gridSize - 1);
  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || xi >= gridSize - 1 || yi < 0 || yi >= gridSize - 1) return null;

  const fx = x - xi, fy = y - yi;
  const i00 = yi * gridSize + xi;
  const i10 = yi * gridSize + xi + 1;
  const i01 = (yi + 1) * gridSize + xi;
  const i11 = (yi + 1) * gridSize + xi + 1;

  if (!data[i00] || !data[i10] || !data[i01] || !data[i11]) return null;

  const u = data[i00].u * (1 - fx) * (1 - fy)
          + data[i10].u * fx * (1 - fy)
          + data[i01].u * (1 - fx) * fy
          + data[i11].u * fx * fy;
  const v = data[i00].v * (1 - fx) * (1 - fy)
          + data[i10].v * fx * (1 - fy)
          + data[i01].v * (1 - fx) * fy
          + data[i11].v * fx * fy;
  const speed = Math.sqrt(u * u + v * v);

  return { u, v, speed };
}

// Speed-only lookup (for heatmap — no u/v needed)
function getWindSpeed(windGrid, lon, lat) {
  const result = getWind(windGrid, lon, lat);
  return result ? result.speed : null;
}

// yr.no Beaufort-scale color stops — matched to yr.no's wind speed visualization
const WIND_COLORS = [
  [0,    210, 240, 192],  // very pale green (calm)
  [2.5,  150, 220, 150],  // light green
  [5.4,  90,  200, 90],   // green (Bft 3)
  [8,    48,  176, 112],  // teal-green (Bft 4)
  [10.8, 32,  160, 160],  // teal (Bft 5)
  [13.9, 32,  144, 192],  // cyan (Bft 6)
  [17.2, 48,  112, 192],  // blue (Bft 7)
  [20.8, 64,  64,  176],  // dark blue (Bft 8)
  [24.5, 96,  48,  160],  // blue-purple (Bft 9)
  [28.5, 128, 32,  128],  // purple (Bft 10)
  [32.6, 110, 16,  96],   // deep purple (Bft 11)
];

function speedToColorRgb(speed) {
  if (speed <= WIND_COLORS[0][0]) {
    return [WIND_COLORS[0][1], WIND_COLORS[0][2], WIND_COLORS[0][3]];
  }
  for (let i = 1; i < WIND_COLORS.length; i++) {
    if (speed <= WIND_COLORS[i][0]) {
      const a = WIND_COLORS[i - 1];
      const b = WIND_COLORS[i];
      const t = (speed - a[0]) / (b[0] - a[0]);
      return [
        Math.round(a[1] + t * (b[1] - a[1])),
        Math.round(a[2] + t * (b[2] - a[2])),
        Math.round(a[3] + t * (b[3] - a[3])),
      ];
    }
  }
  const c = WIND_COLORS[WIND_COLORS.length - 1];
  return [c[1], c[2], c[3]];
}

export function WindLegend({ lang }) {
  // yr.no Beaufort-scale labels and colors
  const items = [
    { label: '<5.4',  color: 'rgb(150, 220, 150)' },
    { label: '5.5',   color: 'rgb(90, 200, 90)' },
    { label: '8',     color: 'rgb(48, 176, 112)' },
    { label: '10.8',  color: 'rgb(32, 160, 160)' },
    { label: '13.9',  color: 'rgb(32, 144, 192)' },
    { label: '17.2',  color: 'rgb(48, 112, 192)' },
    { label: '20.8',  color: 'rgb(64, 64, 176)' },
    { label: '24.5',  color: 'rgb(96, 48, 160)' },
    { label: '28.5',  color: 'rgb(128, 32, 128)' },
    { label: '>32.6', color: 'rgb(110, 16, 96)' },
  ];

  return (
    <div className="bg-slate-800/90 rounded px-2.5 py-2 text-xs pointer-events-auto min-w-[360px]">
      <div className="text-slate-400 mb-1.5 font-semibold text-[11px]">{lang === 'no' ? 'Vind (m/s)' : 'Wind (m/s)'}</div>
      <div className="flex gap-2">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col items-center flex-1 min-w-0">
            <div className="w-full h-3 rounded-sm" style={{ backgroundColor: item.color }} />
            <span className="text-slate-400 text-[10px] mt-0.5">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
