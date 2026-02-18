import { useEffect, useRef, useState } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useWeatherStore } from '../../stores/useWeatherStore.js';

export default function WindOverlay() {
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
  const [loading, setLoading] = useState(false);

  // Track map movement to clear canvas on pan
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
      setLoading(true);
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
        if (!cancelled) setLoading(false);
      }
    };

    const timer = setTimeout(fetchGrid, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bounds?.north, bounds?.south, bounds?.east, bounds?.west]);

  // Draw particles
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
        maxAge: 60 + Math.floor(Math.random() * 60),
      };
    }

    // Bilinear interpolation for wind at any point
    function getWind(lon, lat) {
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

    function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

    function draw() {
      resize();

      const zoom = map.getZoom();
      const activeCount = Math.round(numParticles * clamp(1.4 - zoom * 0.07, 0.3, 1.0));

      // Detect if map center has changed (user is panning)
      const center = map.getCenter();
      const prev = lastCenterRef.current;
      const panning = prev && (Math.abs(center.lng - prev.lng) > 0.0001 || Math.abs(center.lat - prev.lat) > 0.0001);
      lastCenterRef.current = { lng: center.lng, lat: center.lat };

      if (panning || mapMovingRef.current) {
        // Full clear when map is moving — prevents ghost trails
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        // Fade out old particles to transparent (not to dark) using destination-out
        // Fade faster at high zoom so trails don't blanket the map
        const fadeRate = 0.06 + Math.max(0, zoom - 8) * 0.015;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0, 0, 0, ${fadeRate})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
      }

      const zoomWidthScale = clamp(1.6 - zoom * 0.07, 0.5, 1.0);

      for (let i = 0; i < activeCount; i++) {
        const p = particles[i];
        const wind = getWind(p.lon, p.lat);
        if (!wind) {
          Object.assign(p, randomParticle(windGrid.bounds));
          continue;
        }

        const px = map.project([p.lon, p.lat]);
        const speed = wind.speed;

        // Move particle — sqrt curve so mid/high winds are slower but still faster than calm
        const scale = 0.00003 + Math.sqrt(speed) * 0.00003;
        const newLon = p.lon + wind.u * scale;
        const newLat = p.lat + wind.v * scale;
        p.age++;

        if (p.age > p.maxAge) {
          Object.assign(p, randomParticle(windGrid.bounds));
          continue;
        }

        const px2 = map.project([newLon, newLat]);
        // Particles always at full brightness — not affected by slider
        // Cap at 0.85 so trails are never fully opaque, letting the map peek through
        const alpha = Math.min(0.9, speed / 8 + 0.55) * (1 - p.age / p.maxAge);

        // Color based on speed
        const color = speedToColor(speed);
        ctx.beginPath();
        ctx.moveTo(px.x, px.y);
        ctx.lineTo(px2.x, px2.y);
        ctx.strokeStyle = `rgba(${color}, ${alpha})`;
        ctx.lineWidth = (3.0 + speed / 3) * zoomWidthScale;
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
      {/* Dark background overlay — only this is controlled by the slider */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: '#060d1a', opacity: windOpacity * 0.88 }}
      />
      {/* Canvas with transparent background — particles always at full strength */}
      <canvas
        ref={canvasRef}
        className="w-full h-full relative"
      />
      {loading && (
        <div className="absolute top-16 left-4 text-xs text-cyan-400 bg-slate-800/80 px-2 py-1 rounded">
          {lang === 'no' ? 'Henter vinddata...' : 'Loading wind data...'}
        </div>
      )}
      <WindLegend lang={lang} />
    </div>
  );
}

// Windy.com-style color stops: [speed m/s, r, g, b]
const WIND_COLORS = [
  [0,   130, 150, 220],  // calm — visible blue
  [1,   80, 175, 235],   // light air — bright light blue
  [3,   75, 189, 171],   // light breeze — teal
  [5,   114, 206, 112],  // gentle breeze — green
  [8,   190, 220, 59],   // moderate — yellow-green
  [11,  241, 211, 45],   // fresh — yellow
  [14,  247, 151, 34],   // strong — orange
  [17,  237, 85, 28],    // near gale — red-orange
  [21,  209, 38, 41],    // gale — red
  [25,  179, 30, 118],   // strong gale — magenta
  [29,  128, 19, 155],   // storm — purple
  [34,  72, 11, 130],    // violent storm — dark purple
];

function speedToColor(speed) {
  if (speed <= WIND_COLORS[0][0]) {
    const c = WIND_COLORS[0];
    return `${c[1]}, ${c[2]}, ${c[3]}`;
  }
  for (let i = 1; i < WIND_COLORS.length; i++) {
    if (speed <= WIND_COLORS[i][0]) {
      const a = WIND_COLORS[i - 1];
      const b = WIND_COLORS[i];
      const t = (speed - a[0]) / (b[0] - a[0]);
      const r = Math.round(a[1] + t * (b[1] - a[1]));
      const g = Math.round(a[2] + t * (b[2] - a[2]));
      const bl = Math.round(a[3] + t * (b[3] - a[3]));
      return `${r}, ${g}, ${bl}`;
    }
  }
  const c = WIND_COLORS[WIND_COLORS.length - 1];
  return `${c[1]}, ${c[2]}, ${c[3]}`;
}

function WindLegend({ lang }) {
  const items = [
    { label: '1', color: 'rgb(57, 160, 221)' },
    { label: '3', color: 'rgb(75, 189, 171)' },
    { label: '5', color: 'rgb(114, 206, 112)' },
    { label: '8', color: 'rgb(190, 220, 59)' },
    { label: '11', color: 'rgb(241, 211, 45)' },
    { label: '14', color: 'rgb(247, 151, 34)' },
    { label: '17', color: 'rgb(237, 85, 28)' },
    { label: '21', color: 'rgb(209, 38, 41)' },
    { label: '25', color: 'rgb(179, 30, 118)' },
    { label: '29+', color: 'rgb(128, 19, 155)' },
  ];

  return (
    <div className="absolute bottom-4 right-40 bg-slate-800/90 rounded px-2 py-1.5 text-xs pointer-events-auto">
      <div className="text-slate-400 mb-1 font-semibold">{lang === 'no' ? 'Vind (m/s)' : 'Wind (m/s)'}</div>
      <div className="flex gap-0.5">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col items-center">
            <div className="w-4 h-2 rounded-sm" style={{ backgroundColor: item.color }} />
            <span className="text-slate-400 text-[8px] mt-0.5">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
