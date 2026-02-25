import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import SunCalc from 'suncalc';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import { OFM_SOURCE, BUILDING_MIN_ZOOM } from './BuildingsLayer.jsx';

// --- WebGL shader sources ---
const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SRC = `
precision mediump float;
varying vec2 v_uv;

uniform sampler2D u_dem;
uniform sampler2D u_buildings;
uniform float u_buildingsActive;
uniform vec2 u_buildingTexSize;
uniform float u_sunAzimuth;
uniform float u_sunAltitude;
uniform float u_opacity;
uniform vec2 u_viewOrigin;
uniform vec2 u_viewDx;
uniform vec2 u_viewDy;
uniform vec2 u_demBoundsMin;
uniform vec2 u_demBoundsMax;
uniform vec2 u_texSize;
uniform float u_metersPerTexel;
uniform float u_buildingMetersPerTexel;

float decodeElevation(vec4 color) {
  return color.r * 256.0 * 256.0 + color.g * 256.0 + color.b * 256.0 / 256.0 - 32768.0;
}

float decodeBuildingHeight(vec4 color) {
  return color.r * 256.0 + color.g;
}

vec2 mercToUV(vec2 merc) {
  return (merc - u_demBoundsMin) / (u_demBoundsMax - u_demBoundsMin);
}

void main() {
  // Map screen UV to Mercator coordinates (bearing-aware via corner interpolation)
  vec2 merc = u_viewOrigin + v_uv.x * u_viewDx + v_uv.y * u_viewDy;

  // Map to DEM texture UV
  vec2 uv = mercToUV(merc);

  // Out of DEM bounds — transparent
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float elev = decodeElevation(texture2D(u_dem, uv));

  // If this pixel is on a building, ray starts from building top
  float selfBuildingH = 0.0;
  if (u_buildingsActive > 0.5) {
    vec4 selfBldg = texture2D(u_buildings, uv);
    if (selfBldg.a > 0.5) selfBuildingH = decodeBuildingHeight(selfBldg);
  }

  // Sun direction as 2D step in texture space
  // azimuth: 0=north (negative Y in texture), clockwise
  vec2 sunDir = vec2(sin(u_sunAzimuth), -cos(u_sunAzimuth));
  float tanAlt = tan(u_sunAltitude);

  // Step size: use finer building resolution when active
  float stepSize = (u_buildingsActive > 0.5)
    ? 1.0 / u_buildingTexSize.x
    : 1.0 / u_texSize.x;
  float mpt = (u_buildingsActive > 0.5)
    ? u_buildingMetersPerTexel
    : u_metersPerTexel;
  int maxSteps = (u_buildingsActive > 0.5) ? 256 : 128;

  // Ray march toward sun
  float shadow = 0.0;

  for (int i = 1; i <= 256; i++) {
    if (i > maxSteps) break;
    vec2 sampleUV = uv + sunDir * stepSize * float(i);
    if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) break;

    float sampleElev = decodeElevation(texture2D(u_dem, sampleUV));
    if (u_buildingsActive > 0.5) {
      vec4 bldg = texture2D(u_buildings, sampleUV);
      if (bldg.a > 0.5) sampleElev += decodeBuildingHeight(bldg);
    }
    float dist = float(i) * mpt;
    float rayHeight = (elev + selfBuildingH) + dist * tanAlt;

    if (sampleElev > rayHeight) {
      shadow = 1.0;
      break;
    }
  }

  gl_FragColor = vec4(0.0, 0.0, 0.0, shadow * u_opacity);
}`;

// --- Building shadow constants ---
const BUILDING_TEX_MAX = 2048;

// --- Tile math helpers ---
function lon2tile(lon, zoom) {
  return ((lon + 180) / 360) * Math.pow(2, zoom);
}

function lat2tile(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom);
}

function tile2lon(x, zoom) {
  return (x / Math.pow(2, zoom)) * 360 - 180;
}

function tile2lat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

// Mercator projection (lon/lat to meters-like)
function lonToMerc(lon) {
  return (lon + 180) / 360;
}

function latToMerc(lat) {
  const latRad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
}

// Meters per pixel at a given latitude and zoom
function metersPerPixelAtLat(lat, zoom) {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom + 8);
}

// --- Main component ---
export default function SunlightOverlay() {
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const programRef = useRef(null);
  const uniformsRef = useRef({});
  const texRef = useRef(null);
  const buildingTexRef = useRef(null);
  const buildingTexSizeRef = useRef({ w: 0, h: 0 });
  const buildingsActiveRef = useRef(false);
  const buildingMptRef = useRef(0);
  const [buildingsVisible, setBuildingsVisible] = useState(false);
  const bufRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastLoadRef = useRef(null);
  const debounceRef = useRef(null);
  const demBoundsRef = useRef(null);
  const texSizeRef = useRef({ w: 0, h: 0 });

  const mapRef = useMapStore((s) => s.mapRef);
  const bounds = useMapStore((s) => s.bounds);
  const sunlightOpacity = useMapStore((s) => s.sunlightOpacity);
  const sunlightDate = useMapStore((s) => s.sunlightDate);
  const sunlightTime = useMapStore((s) => s.sunlightTime);
  const sunlightAnimating = useMapStore((s) => s.sunlightAnimating);
  const sunlightAnimationSpeed = useMapStore((s) => s.sunlightAnimationSpeed);

  // Compute sun position from store date/time and map center
  const sunPos = useMemo(() => {
    if (!bounds) return null;
    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLon = (bounds.east + bounds.west) / 2;
    const hours = Math.floor(sunlightTime / 60);
    const mins = sunlightTime % 60;
    const date = new Date(`${sunlightDate}T${String(hours).padStart(2, '0')}:${String(Math.floor(mins)).padStart(2, '0')}:00`);
    const pos = SunCalc.getPosition(date, centerLat, centerLon);
    // suncalc azimuth: 0=south, clockwise. Convert to 0=north, clockwise
    const azimuth = pos.azimuth + Math.PI;
    return { azimuth, altitude: pos.altitude, date };
  }, [bounds, sunlightDate, sunlightTime]);

  // --- WebGL init ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: true });
    if (!gl) return;
    glRef.current = gl;

    // Compile shaders
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VERT_SRC);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, FRAG_SRC);
    gl.compileShader(fs);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    programRef.current = program;

    // Cache uniform locations
    uniformsRef.current = {
      u_dem: gl.getUniformLocation(program, 'u_dem'),
      u_buildings: gl.getUniformLocation(program, 'u_buildings'),
      u_buildingsActive: gl.getUniformLocation(program, 'u_buildingsActive'),
      u_buildingTexSize: gl.getUniformLocation(program, 'u_buildingTexSize'),
      u_buildingMetersPerTexel: gl.getUniformLocation(program, 'u_buildingMetersPerTexel'),
      u_sunAzimuth: gl.getUniformLocation(program, 'u_sunAzimuth'),
      u_sunAltitude: gl.getUniformLocation(program, 'u_sunAltitude'),
      u_opacity: gl.getUniformLocation(program, 'u_opacity'),
      u_viewOrigin: gl.getUniformLocation(program, 'u_viewOrigin'),
      u_viewDx: gl.getUniformLocation(program, 'u_viewDx'),
      u_viewDy: gl.getUniformLocation(program, 'u_viewDy'),
      u_demBoundsMin: gl.getUniformLocation(program, 'u_demBoundsMin'),
      u_demBoundsMax: gl.getUniformLocation(program, 'u_demBoundsMax'),
      u_texSize: gl.getUniformLocation(program, 'u_texSize'),
      u_metersPerTexel: gl.getUniformLocation(program, 'u_metersPerTexel'),
    };

    // Fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    bufRef.current = buf;

    // Create DEM texture
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    texRef.current = tex;

    // Create building height texture (TEXTURE1) — NEAREST for sharp edges
    const bTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Initialize with 1x1 transparent pixel
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));
    gl.activeTexture(gl.TEXTURE0);
    buildingTexRef.current = bTex;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return () => {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      gl.deleteTexture(tex);
      gl.deleteTexture(bTex);
      buildingTexRef.current = null;
      glRef.current = null;
    };
  }, []);

  // --- Resize canvas to match map ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapRef) return;
    const mapCanvas = mapRef.getCanvas();
    const dpr = window.devicePixelRatio || 1;
    // Use a lower resolution for performance (1/2 scale)
    const w = Math.floor(mapCanvas.width / (dpr * 2));
    const h = Math.floor(mapCanvas.height / (dpr * 2));
    canvas.width = w;
    canvas.height = h;
    if (glRef.current) glRef.current.viewport(0, 0, w, h);
  }, [mapRef, bounds]);

  // --- Load DEM tiles for viewport ---
  const loadDemTiles = useCallback(() => {
    if (!bounds || !glRef.current) return;

    const zoom = Math.min(12, Math.max(1, Math.round(
      Math.log2(360 / (bounds.east - bounds.west))
    )));

    // Tile range + 1 buffer
    const xMin = Math.floor(lon2tile(bounds.west, zoom)) - 1;
    const xMax = Math.floor(lon2tile(bounds.east, zoom)) + 1;
    const yMin = Math.floor(lat2tile(bounds.north, zoom)) - 1;
    const yMax = Math.floor(lat2tile(bounds.south, zoom)) + 1;

    const key = `${zoom}/${xMin}/${yMin}/${xMax}/${yMax}`;
    if (lastLoadRef.current === key) return;
    lastLoadRef.current = key;

    const cols = xMax - xMin + 1;
    const rows = yMax - yMin + 1;
    const tileSize = 256;
    const totalW = cols * tileSize;
    const totalH = rows * tileSize;

    // Mercator bounds of the composite texture
    const demBounds = {
      minX: lonToMerc(tile2lon(xMin, zoom)),
      maxX: lonToMerc(tile2lon(xMax + 1, zoom)),
      minY: latToMerc(tile2lat(yMin, zoom)),
      maxY: latToMerc(tile2lat(yMax + 1, zoom)),
    };
    demBoundsRef.current = demBounds;
    texSizeRef.current = { w: totalW, h: totalH };

    // Offscreen canvas for compositing
    const offscreen = document.createElement('canvas');
    offscreen.width = totalW;
    offscreen.height = totalH;
    const ctx = offscreen.getContext('2d');

    let loaded = 0;
    const total = cols * rows;

    for (let ty = yMin; ty <= yMax; ty++) {
      for (let tx = xMin; tx <= xMax; tx++) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const dx = (tx - xMin) * tileSize;
          const dy = (ty - yMin) * tileSize;
          ctx.drawImage(img, dx, dy, tileSize, tileSize);
          loaded++;
          if (loaded === total) {
            uploadTexture(offscreen);
          }
        };
        img.onerror = () => {
          loaded++;
          if (loaded === total) {
            uploadTexture(offscreen);
          }
        };
        img.src = `/api/tiles/dem/${zoom}/${tx}/${ty}.png`;
      }
    }
  }, [bounds]);

  const uploadTexture = useCallback((offscreen) => {
    const gl = glRef.current;
    if (!gl || !texRef.current) return;
    gl.bindTexture(gl.TEXTURE_2D, texRef.current);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);
    renderShadow();
  }, []);

  // --- Render shadow ---
  const renderShadow = useCallback(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const u = uniformsRef.current;
    const demB = demBoundsRef.current;
    if (!gl || !program || !demB || !bounds || !sunPos || !mapRef) return;

    gl.useProgram(program);

    // Bind DEM texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texRef.current);
    gl.uniform1i(u.u_dem, 0);

    // Bind building texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, buildingTexRef.current);
    gl.uniform1i(u.u_buildings, 1);
    gl.uniform1f(u.u_buildingsActive, buildingsActiveRef.current ? 1.0 : 0.0);
    gl.uniform2f(u.u_buildingTexSize, buildingTexSizeRef.current.w, buildingTexSizeRef.current.h);

    // Sun uniforms
    gl.uniform1f(u.u_sunAzimuth, sunPos.azimuth);
    gl.uniform1f(u.u_sunAltitude, sunPos.altitude);
    gl.uniform1f(u.u_opacity, sunlightOpacity);

    // View corners in Mercator (bearing-aware via unproject)
    const mapCanvas = mapRef.getCanvas();
    const cw = mapCanvas.clientWidth;
    const ch = mapCanvas.clientHeight;
    const bl = mapRef.unproject([0, ch]);
    const br = mapRef.unproject([cw, ch]);
    const tl = mapRef.unproject([0, 0]);
    const blM = [lonToMerc(bl.lng), latToMerc(bl.lat)];
    const brM = [lonToMerc(br.lng), latToMerc(br.lat)];
    const tlM = [lonToMerc(tl.lng), latToMerc(tl.lat)];
    gl.uniform2f(u.u_viewOrigin, blM[0], blM[1]);
    gl.uniform2f(u.u_viewDx, brM[0] - blM[0], brM[1] - blM[1]);
    gl.uniform2f(u.u_viewDy, tlM[0] - blM[0], tlM[1] - blM[1]);

    // DEM bounds in Mercator
    gl.uniform2f(u.u_demBoundsMin, demB.minX, demB.minY);
    gl.uniform2f(u.u_demBoundsMax, demB.maxX, demB.maxY);

    // Texture size
    gl.uniform2f(u.u_texSize, texSizeRef.current.w, texSizeRef.current.h);

    // Approximate meters per texel
    const center = mapRef.getCenter();
    const zoom = Math.min(12, Math.max(1, Math.round(
      Math.log2(360 / (bounds.east - bounds.west))
    )));
    const mpt = metersPerPixelAtLat(center.lat, zoom);
    gl.uniform1f(u.u_metersPerTexel, mpt);
    gl.uniform1f(u.u_buildingMetersPerTexel, buildingMptRef.current || mpt);

    // Draw
    const posLoc = gl.getAttribLocation(program, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, bufRef.current);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, [bounds, sunPos, sunlightOpacity, mapRef]);

  // --- Rasterize OSM building footprints to height texture ---
  const rasterizeBuildings = useCallback(() => {
    const map = mapRef;
    const gl = glRef.current;
    const demB = demBoundsRef.current;
    if (!map || !gl || !demB || !buildingTexRef.current) return;

    if (!map.getSource(OFM_SOURCE)) {
      buildingsActiveRef.current = false;
      setBuildingsVisible(false);
      return;
    }

    const features = map.querySourceFeatures(OFM_SOURCE, { sourceLayer: 'building' });
    if (!features.length) {
      buildingsActiveRef.current = false;
      setBuildingsVisible(false);
      return;
    }

    // Deduplicate by feature ID
    const seen = new Set();
    const unique = [];
    for (const f of features) {
      const id = f.id;
      if (id != null && seen.has(id)) continue;
      if (id != null) seen.add(id);
      unique.push(f);
    }

    // Sort by render_height ascending (taller overwrites shorter)
    unique.sort((a, b) => (a.properties.render_height || 10) - (b.properties.render_height || 10));

    // Compute canvas size — fit DEM extent capped at BUILDING_TEX_MAX
    const demW = demB.maxX - demB.minX;
    const demH = demB.maxY - demB.minY;
    const aspect = demW / demH;
    let cw, ch;
    if (aspect >= 1) {
      cw = BUILDING_TEX_MAX;
      ch = Math.max(1, Math.round(BUILDING_TEX_MAX / aspect));
    } else {
      ch = BUILDING_TEX_MAX;
      cw = Math.max(1, Math.round(BUILDING_TEX_MAX * aspect));
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = cw;
    offscreen.height = ch;
    const ctx = offscreen.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);

    const drawPolygon = (coords, fillStyle) => {
      ctx.fillStyle = fillStyle;
      ctx.beginPath();
      for (const ring of coords) {
        for (let i = 0; i < ring.length; i++) {
          const [lng, lat] = ring[i];
          const mx = lonToMerc(lng);
          const my = latToMerc(lat);
          const px = ((mx - demB.minX) / demW) * cw;
          const py = ((my - demB.minY) / demH) * ch;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
      ctx.fill('evenodd');
    };

    for (const f of unique) {
      const height = Math.round(Math.max(1, f.properties.render_height || 10));
      const r = Math.floor(height / 256);
      const g = height % 256;
      const fillStyle = `rgba(${r},${g},0,1)`;
      const geom = f.geometry;
      if (!geom) continue;

      if (geom.type === 'Polygon') {
        drawPolygon(geom.coordinates, fillStyle);
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) drawPolygon(poly, fillStyle);
      }
    }

    // Upload to building texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, buildingTexRef.current);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);
    gl.activeTexture(gl.TEXTURE0);
    buildingTexSizeRef.current = { w: cw, h: ch };
    buildingsActiveRef.current = true;
    setBuildingsVisible(true);

    // Compute building meters per texel
    const center = map.getCenter();
    const earthCircumAtLat = 40075016.686 * Math.cos(center.lat * Math.PI / 180);
    buildingMptRef.current = (demW * earthCircumAtLat) / cw;

    renderShadow();
  }, [mapRef, renderShadow]);

  // --- Listen for building source data from BuildingsLayer ---
  useEffect(() => {
    const map = mapRef;
    if (!map) return;

    let rasterizeTimer = null;

    const onSourceData = (e) => {
      if (e.sourceId !== OFM_SOURCE || !e.isSourceLoaded) return;
      if (rasterizeTimer) clearTimeout(rasterizeTimer);
      rasterizeTimer = setTimeout(() => rasterizeBuildings(), 300);
    };

    const onMoveEnd = () => {
      if (map.getZoom() >= BUILDING_MIN_ZOOM && map.getSource(OFM_SOURCE)) {
        if (rasterizeTimer) clearTimeout(rasterizeTimer);
        rasterizeTimer = setTimeout(() => rasterizeBuildings(), 300);
      }
    };

    const onZoomEnd = () => {
      if (map.getZoom() < BUILDING_MIN_ZOOM) {
        buildingsActiveRef.current = false;
        setBuildingsVisible(false);
      }
    };

    map.on('sourcedata', onSourceData);
    map.on('moveend', onMoveEnd);
    map.on('zoomend', onZoomEnd);

    // Initial rasterization if source already loaded
    if (map.getZoom() >= BUILDING_MIN_ZOOM && map.getSource(OFM_SOURCE)) {
      rasterizeTimer = setTimeout(() => rasterizeBuildings(), 500);
    }

    return () => {
      map.off('sourcedata', onSourceData);
      map.off('moveend', onMoveEnd);
      map.off('zoomend', onZoomEnd);
      if (rasterizeTimer) clearTimeout(rasterizeTimer);
      buildingsActiveRef.current = false;
    };
  }, [mapRef, rasterizeBuildings]);

  // Load DEM tiles on viewport change (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadDemTiles();
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [bounds, loadDemTiles]);

  // Re-render when sun position or opacity changes (instant — just uniform update)
  useEffect(() => {
    if (demBoundsRef.current) renderShadow();
  }, [sunPos, sunlightOpacity, renderShadow]);

  // Re-render on map rotation so shadows track the rotated viewport
  useEffect(() => {
    if (!mapRef) return;
    const onRotate = () => {
      if (demBoundsRef.current) renderShadow();
    };
    mapRef.on('rotate', onRotate);
    return () => mapRef.off('rotate', onRotate);
  }, [mapRef, renderShadow]);

  // --- Animation loop ---
  useEffect(() => {
    if (!sunlightAnimating) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    let lastTime = performance.now();
    const setSunlightTime = useMapStore.getState().setSunlightTime;

    function tick(now) {
      const deltaMs = now - lastTime;
      lastTime = now;
      const deltaMins = (deltaMs / 1000) * sunlightAnimationSpeed;
      const current = useMapStore.getState().sunlightTime;
      let next = current + deltaMins;
      if (next >= 1440) next -= 1440;
      if (next < 0) next += 1440;
      setSunlightTime(next);
      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [sunlightAnimating, sunlightAnimationSpeed]);

  // Night overlay
  const nightOpacity = useMemo(() => {
    if (!sunPos || sunPos.altitude >= 0) return 0;
    // Scale from 0 at horizon to max at -18 degrees (astronomical twilight)
    const deg = (sunPos.altitude * 180) / Math.PI;
    return Math.min(1, Math.abs(deg) / 18) * 0.7;
  }, [sunPos]);

  return (
    <>
      <div className="absolute inset-0 pointer-events-none z-[3]">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      {nightOpacity > 0 && (
        <div
          className="absolute inset-0 pointer-events-none z-[3] transition-opacity duration-300"
          style={{ backgroundColor: `rgba(10, 15, 40, ${nightOpacity})` }}
        />
      )}
    </>
  );
}

// --- Legend component ---
export function SunlightLegend({ lang }) {
  const mapRef = useMapStore((s) => s.mapRef);
  const bounds = useMapStore((s) => s.bounds);
  const sunlightDate = useMapStore((s) => s.sunlightDate);
  const sunlightTime = useMapStore((s) => s.sunlightTime);
  const buildingShadows = mapRef ? mapRef.getZoom() >= BUILDING_MIN_ZOOM : false;

  const info = useMemo(() => {
    if (!bounds) return null;
    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLon = (bounds.east + bounds.west) / 2;
    const hours = Math.floor(sunlightTime / 60);
    const mins = sunlightTime % 60;
    const date = new Date(`${sunlightDate}T${String(hours).padStart(2, '0')}:${String(Math.floor(mins)).padStart(2, '0')}:00`);
    const pos = SunCalc.getPosition(date, centerLat, centerLon);
    const times = SunCalc.getTimes(new Date(sunlightDate + 'T12:00:00'), centerLat, centerLon);

    const azDeg = ((pos.azimuth * 180 / Math.PI) + 180) % 360;
    const altDeg = pos.altitude * 180 / Math.PI;

    const fmt = (d) => {
      if (!d || isNaN(d.getTime())) return '--:--';
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const h = Math.floor(sunlightTime / 60);
    const m = Math.floor(sunlightTime % 60);
    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    return {
      date: sunlightDate,
      time: timeStr,
      azimuth: azDeg.toFixed(0),
      elevation: altDeg.toFixed(1),
      azDeg,
      altDeg,
      sunrise: fmt(times.sunrise),
      sunset: fmt(times.sunset),
    };
  }, [bounds, sunlightDate, sunlightTime]);

  if (!info) return null;

  // Sun position on polar compass (sky dome viewed from above)
  const compassR = 30;
  const compassCx = 40, compassCy = 40;
  const altForDist = Math.max(0, info.altDeg);
  const sunDist = ((90 - altForDist) / 90) * compassR;
  const azRad = info.azDeg * Math.PI / 180;
  const sunX = compassCx + sunDist * Math.sin(azRad);
  const sunY = compassCy - sunDist * Math.cos(azRad);
  const belowHorizon = info.altDeg < 0;

  return (
    <div className="bg-slate-800/90 rounded px-2.5 py-1.5 text-[10px] text-slate-300 min-w-[140px]">
      <div className="text-yellow-400 font-semibold mb-0.5">{t('sunlight', lang)}</div>
      {/* Sun position compass */}
      <div className="flex justify-center my-1">
        <svg width="80" height="80" viewBox="0 0 80 80">
          {/* Horizon circle */}
          <circle cx={compassCx} cy={compassCy} r={compassR} fill="rgba(15,23,42,0.6)" stroke="rgba(100,116,139,0.4)" strokeWidth="1" />
          {/* Crosshairs */}
          <line x1={compassCx} y1={compassCy - compassR} x2={compassCx} y2={compassCy + compassR} stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
          <line x1={compassCx - compassR} y1={compassCy} x2={compassCx + compassR} y2={compassCy} stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
          {/* Cardinal labels */}
          <text x={compassCx} y={compassCy - compassR - 2} textAnchor="middle" fill="#94a3b8" fontSize="7" fontWeight="bold">N</text>
          <text x={compassCx + compassR + 6} y={compassCy + 2} textAnchor="middle" fill="#64748b" fontSize="6">E</text>
          <text x={compassCx} y={compassCy + compassR + 8} textAnchor="middle" fill="#64748b" fontSize="6">S</text>
          <text x={compassCx - compassR - 6} y={compassCy + 2} textAnchor="middle" fill="#64748b" fontSize="6">W</text>
          {/* Sun direction line */}
          <line x1={compassCx} y1={compassCy} x2={sunX} y2={sunY}
            stroke="#fbbf24" strokeWidth="1" opacity={belowHorizon ? 0.2 : 0.5} />
          {/* Sun dot + glow */}
          {belowHorizon ? (
            <circle cx={sunX} cy={sunY} r="3" fill="#64748b" opacity="0.4" />
          ) : (
            <>
              <circle cx={sunX} cy={sunY} r="4" fill="#fbbf24" />
              <circle cx={sunX} cy={sunY} r="7" fill="none" stroke="#fbbf24" strokeWidth="0.5" opacity="0.3" />
            </>
          )}
        </svg>
      </div>
      <div className="flex justify-between gap-3">
        <span>{t('sunlight.date', lang)}</span>
        <span className="text-white font-mono">{info.date}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span>{t('sunlight.time', lang)}</span>
        <span className="text-white font-mono">{info.time}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span>{t('sunlight.azimuth', lang)}</span>
        <span className="text-white">{info.azimuth}°</span>
      </div>
      <div className="flex justify-between gap-3">
        <span>{t('sunlight.elevation', lang)}</span>
        <span className="text-white">{info.elevation}°</span>
      </div>
      <div className="flex justify-between gap-3">
        <span>{t('weather.sunrise', lang)}</span>
        <span className="text-white">{info.sunrise}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span>{t('weather.sunset', lang)}</span>
        <span className="text-white">{info.sunset}</span>
      </div>
      {buildingShadows && (
        <div className="flex justify-between gap-3 mt-0.5 pt-0.5 border-t border-slate-700">
          <span>{t('sunlight.buildings', lang)}</span>
          <span className="text-green-400">ON</span>
        </div>
      )}
    </div>
  );
}
