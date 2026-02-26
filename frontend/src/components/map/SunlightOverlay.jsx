import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import SunCalc from 'suncalc';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import { OFM_SOURCE, OFM_EXTRUSION_LAYER, OFM_QUERY_LAYER, BUILDING_MIN_ZOOM } from './BuildingsLayer.jsx';

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
uniform mat3 u_screenToMerc;
uniform vec2 u_demBoundsMin;
uniform vec2 u_demBoundsMax;
uniform vec2 u_texSize;
uniform float u_metersPerTexel;
uniform float u_buildingMetersPerTexel;

float decodeElevation(vec4 color) {
  return color.r * 256.0 * 256.0 + color.g * 256.0 + color.b * 256.0 / 256.0 - 32768.0;
}

float decodeBuildingHeight(vec4 color) {
  float r = floor(color.r * 255.0 + 0.5);
  float g = floor(color.g * 255.0 + 0.5);
  return r * 256.0 + g;
}

vec2 mercToUV(vec2 merc) {
  return (merc - u_demBoundsMin) / (u_demBoundsMax - u_demBoundsMin);
}

void main() {
  vec3 h = u_screenToMerc * vec3(v_uv, 1.0);
  vec2 merc = h.xy / h.z;
  vec2 uv = mercToUV(merc);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float elev = decodeElevation(texture2D(u_dem, uv));

  float selfBuildingH = 0.0;
  if (u_buildingsActive > 0.5) {
    vec4 selfBldg = texture2D(u_buildings, uv);
    if (selfBldg.a > 0.5) selfBuildingH = decodeBuildingHeight(selfBldg);
  }

  vec2 sunDir = vec2(sin(u_sunAzimuth), -cos(u_sunAzimuth));
  float tanAlt = tan(u_sunAltitude);

  float stepSize = (u_buildingsActive > 0.5)
    ? 1.0 / u_buildingTexSize.x
    : 1.0 / u_texSize.x;
  float mpt = (u_buildingsActive > 0.5)
    ? u_buildingMetersPerTexel
    : u_metersPerTexel;
  int maxSteps = (u_buildingsActive > 0.5) ? 256 : 128;

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
const SHADOW_LAYER_ID = 'sunlight-shadow';
const SHADOW_SCALE = 0.5; // Render shadow at half resolution for performance

const BLIT_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() {
  gl_FragColor = texture2D(u_tex, v_uv);
}`;

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

function lonToMerc(lon) {
  return (lon + 180) / 360;
}

function latToMerc(lat) {
  const latRad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
}

function metersPerPixelAtLat(lat, zoom) {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom + 8);
}

function computeHomography(bl, br, tl, tr) {
  const x0 = bl[0], y0 = bl[1];
  const x1 = br[0], y1 = br[1];
  const x2 = tr[0], y2 = tr[1];
  const x3 = tl[0], y3 = tl[1];

  const dx1 = x1 - x2, dy1 = y1 - y2;
  const dx2 = x3 - x2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;

  const denom = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / denom;
  const hh = (dx1 * sy - sx * dy1) / denom;

  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  const f = y0;

  return new Float32Array([
    a, d, g,
    b, e, hh,
    c, f, 1,
  ]);
}

// Save/restore GL texture state around external texture uploads
function withTexState(gl, fn) {
  const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.activeTexture(gl.TEXTURE0);
  const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
  gl.activeTexture(gl.TEXTURE1);
  const prevTex1 = gl.getParameter(gl.TEXTURE_BINDING_2D);
  fn();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, prevTex0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, prevTex1);
  gl.activeTexture(prevActive);
}

// --- Main component ---
export default function SunlightOverlay() {
  // GL resources (created in MapLibre's GL context via custom layer)
  const glRef = useRef(null);
  const programRef = useRef(null);
  const uniformsRef = useRef({});
  const bufRef = useRef(null);
  const demTexRef = useRef(null);
  const buildingTexRef = useRef(null);
  const buildingTexSizeRef = useRef({ w: 0, h: 0 });
  const buildingMptRef = useRef(0);
  const demBoundsRef = useRef(null);
  const texSizeRef = useRef({ w: 0, h: 0 });
  const lastLoadRef = useRef(null);
  const debounceRef = useRef(null);
  const animFrameRef = useRef(null);
  const layerAddedRef = useRef(false);
  const fboRef = useRef(null);
  const fboTexRef = useRef(null);
  const fboSizeRef = useRef({ w: 0, h: 0 });
  const blitProgramRef = useRef(null);
  const rasterizeBuildingsRef = useRef(null);
  const [buildingsVisible, setBuildingsVisible] = useState(false);

  // Refs for render callback to access latest values without re-creating the layer
  const sunPosRef = useRef(null);
  const boundsRef = useRef(null);
  const opacityRef = useRef(0.5);
  const mapStoreRef = useRef(null);

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
    const azimuth = pos.azimuth + Math.PI;
    return { azimuth, altitude: pos.altitude, date };
  }, [bounds, sunlightDate, sunlightTime]);

  // Keep refs in sync for the render callback
  sunPosRef.current = sunPos;
  boundsRef.current = bounds;
  opacityRef.current = sunlightOpacity;
  mapStoreRef.current = mapRef;

  // --- Add MapLibre custom layer ---
  useEffect(() => {
    const map = mapRef;
    if (!map) return;

    const layer = {
      id: SHADOW_LAYER_ID,
      type: 'custom',
      renderingMode: '2d',

      onAdd(_map, gl) {
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

        uniformsRef.current = {
          u_dem: gl.getUniformLocation(program, 'u_dem'),
          u_buildings: gl.getUniformLocation(program, 'u_buildings'),
          u_buildingsActive: gl.getUniformLocation(program, 'u_buildingsActive'),
          u_buildingTexSize: gl.getUniformLocation(program, 'u_buildingTexSize'),
          u_buildingMetersPerTexel: gl.getUniformLocation(program, 'u_buildingMetersPerTexel'),
          u_sunAzimuth: gl.getUniformLocation(program, 'u_sunAzimuth'),
          u_sunAltitude: gl.getUniformLocation(program, 'u_sunAltitude'),
          u_opacity: gl.getUniformLocation(program, 'u_opacity'),
          u_screenToMerc: gl.getUniformLocation(program, 'u_screenToMerc'),
          u_demBoundsMin: gl.getUniformLocation(program, 'u_demBoundsMin'),
          u_demBoundsMax: gl.getUniformLocation(program, 'u_demBoundsMax'),
          u_texSize: gl.getUniformLocation(program, 'u_texSize'),
          u_metersPerTexel: gl.getUniformLocation(program, 'u_metersPerTexel'),
        };

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        bufRef.current = buf;

        // DEM texture (LINEAR for smooth terrain)
        const demTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, demTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        demTexRef.current = demTex;

        // Building height texture (NEAREST for sharp edges)
        const bTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, bTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        gl.activeTexture(gl.TEXTURE0);
        buildingTexRef.current = bTex;

        // Create FBO for half-resolution shadow rendering
        const fbo = gl.createFramebuffer();
        const fboTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, fboTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        fboRef.current = fbo;
        fboTexRef.current = fboTex;
        fboSizeRef.current = { w: 0, h: 0 };

        // Compile blit shader (reuses vertex shader)
        const blitVs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(blitVs, VERT_SRC);
        gl.compileShader(blitVs);
        const blitFs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(blitFs, BLIT_FRAG);
        gl.compileShader(blitFs);
        const blitProg = gl.createProgram();
        gl.attachShader(blitProg, blitVs);
        gl.attachShader(blitProg, blitFs);
        gl.linkProgram(blitProg);
        blitProgramRef.current = blitProg;

        // Force DEM reload since textures are fresh
        lastLoadRef.current = null;
      },

      render(gl) {
        const program = programRef.current;
        const u = uniformsRef.current;
        const demB = demBoundsRef.current;
        const sp = sunPosRef.current;
        const b = boundsRef.current;
        const op = opacityRef.current;
        const m = mapStoreRef.current;
        if (!program || !demB || !sp || !b || !m || !fboRef.current) return;

        const canvas = gl.canvas;
        const fbW = Math.max(1, Math.floor(canvas.width * SHADOW_SCALE));
        const fbH = Math.max(1, Math.floor(canvas.height * SHADOW_SCALE));

        // Resize FBO texture if canvas size changed
        if (fboSizeRef.current.w !== fbW || fboSizeRef.current.h !== fbH) {
          withTexState(gl, () => {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fboTexRef.current);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fbW, fbH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          });
          fboSizeRef.current = { w: fbW, h: fbH };
        }

        // Save MapLibre's framebuffer and viewport
        const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const prevViewport = gl.getParameter(gl.VIEWPORT);

        // --- Pass 1: Render ray-march shadow to FBO at half resolution ---
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboRef.current);
        gl.viewport(0, 0, fbW, fbH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(program);
        gl.disable(gl.DEPTH_TEST);

        // Bind DEM texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, demTexRef.current);
        gl.uniform1i(u.u_dem, 0);

        // Bind building texture
        const bActive = buildingTexSizeRef.current.w > 1 && m.getZoom() >= BUILDING_MIN_ZOOM
          && useMapStore.getState().buildingOpacity > 0;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, buildingTexRef.current);
        gl.uniform1i(u.u_buildings, 1);
        gl.uniform1f(u.u_buildingsActive, bActive ? 1.0 : 0.0);
        gl.uniform2f(u.u_buildingTexSize, buildingTexSizeRef.current.w, buildingTexSizeRef.current.h);

        // Sun uniforms
        gl.uniform1f(u.u_sunAzimuth, sp.azimuth);
        gl.uniform1f(u.u_sunAltitude, sp.altitude);
        gl.uniform1f(u.u_opacity, op);

        // Compute homography (screen UV -> Mercator, handles pitch + rotation)
        // Use flat 2D projection (bypass terrain) since the shadow shader
        // operates in flat Mercator space with its own DEM data.
        const mapCanvas = m.getCanvas();
        const cw = mapCanvas.clientWidth;
        const ch = mapCanvas.clientHeight;
        const flatUnproj = (x, y) => m.transform.pointLocation({ x, y });
        const bl = flatUnproj(0, ch);
        const br = flatUnproj(cw, ch);
        const tl = flatUnproj(0, 0);
        const tr = flatUnproj(cw, 0);
        const blM = [lonToMerc(bl.lng), latToMerc(bl.lat)];
        const brM = [lonToMerc(br.lng), latToMerc(br.lat)];
        const tlM = [lonToMerc(tl.lng), latToMerc(tl.lat)];
        const trM = [lonToMerc(tr.lng), latToMerc(tr.lat)];
        const H = computeHomography(blM, brM, tlM, trM);
        gl.uniformMatrix3fv(u.u_screenToMerc, false, H);

        // DEM bounds
        gl.uniform2f(u.u_demBoundsMin, demB.minX, demB.minY);
        gl.uniform2f(u.u_demBoundsMax, demB.maxX, demB.maxY);
        gl.uniform2f(u.u_texSize, texSizeRef.current.w, texSizeRef.current.h);

        // Meters per texel
        const center = m.getCenter();
        const zoom = Math.min(12, Math.max(1, Math.round(
          Math.log2(360 / (b.east - b.west))
        )));
        const mpt = metersPerPixelAtLat(center.lat, zoom);
        gl.uniform1f(u.u_metersPerTexel, mpt);
        gl.uniform1f(u.u_buildingMetersPerTexel, buildingMptRef.current || mpt);

        // Draw full-screen quad to FBO
        const posLoc = gl.getAttribLocation(program, 'a_pos');
        gl.bindBuffer(gl.ARRAY_BUFFER, bufRef.current);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(posLoc);

        // --- Pass 2: Blit FBO to MapLibre's framebuffer ---
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
        gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);

        gl.useProgram(blitProgramRef.current);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboTexRef.current);
        gl.uniform1i(gl.getUniformLocation(blitProgramRef.current, 'u_tex'), 0);

        const blitPosLoc = gl.getAttribLocation(blitProgramRef.current, 'a_pos');
        gl.bindBuffer(gl.ARRAY_BUFFER, bufRef.current);
        gl.enableVertexAttribArray(blitPosLoc);
        gl.vertexAttribPointer(blitPosLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(blitPosLoc);
      },

      onRemove(_map, gl) {
        if (programRef.current) gl.deleteProgram(programRef.current);
        if (blitProgramRef.current) gl.deleteProgram(blitProgramRef.current);
        if (bufRef.current) gl.deleteBuffer(bufRef.current);
        if (demTexRef.current) gl.deleteTexture(demTexRef.current);
        if (buildingTexRef.current) gl.deleteTexture(buildingTexRef.current);
        if (fboTexRef.current) gl.deleteTexture(fboTexRef.current);
        if (fboRef.current) gl.deleteFramebuffer(fboRef.current);
        programRef.current = null;
        blitProgramRef.current = null;
        bufRef.current = null;
        demTexRef.current = null;
        buildingTexRef.current = null;
        fboRef.current = null;
        fboTexRef.current = null;
        fboSizeRef.current = { w: 0, h: 0 };
        glRef.current = null;
        buildingTexSizeRef.current = { w: 0, h: 0 };
      },
    };

    const addShadowLayer = () => {
      if (map.getLayer(SHADOW_LAYER_ID)) return;
      // Insert below building layers so fill-extrusion renders on top (occludes shadow)
      const beforeId = map.getLayer(OFM_QUERY_LAYER) ? OFM_QUERY_LAYER
        : map.getLayer(OFM_EXTRUSION_LAYER) ? OFM_EXTRUSION_LAYER
        : undefined;
      map.addLayer(layer, beforeId);
      layerAddedRef.current = true;
    };

    addShadowLayer();

    // Re-add after style swaps (which wipe all layers)
    const onStyleData = () => {
      if (!map.getLayer(SHADOW_LAYER_ID)) {
        addShadowLayer();
        lastLoadRef.current = null; // force DEM reload
      }
    };
    map.on('styledata', onStyleData);

    return () => {
      map.off('styledata', onStyleData);
      try { if (map.getLayer(SHADOW_LAYER_ID)) map.removeLayer(SHADOW_LAYER_ID); } catch {}
      layerAddedRef.current = false;
    };
  }, [mapRef]);

  // --- Load DEM tiles for viewport ---
  const loadDemTiles = useCallback(() => {
    if (!bounds || !glRef.current) return;

    const zoom = Math.min(12, Math.max(1, Math.round(
      Math.log2(360 / (bounds.east - bounds.west))
    )));

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

    const demBounds = {
      minX: lonToMerc(tile2lon(xMin, zoom)),
      maxX: lonToMerc(tile2lon(xMax + 1, zoom)),
      minY: latToMerc(tile2lat(yMin, zoom)),
      maxY: latToMerc(tile2lat(yMax + 1, zoom)),
    };
    demBoundsRef.current = demBounds;
    texSizeRef.current = { w: totalW, h: totalH };

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
          if (loaded === total) uploadTexture(offscreen);
        };
        img.onerror = () => {
          loaded++;
          if (loaded === total) uploadTexture(offscreen);
        };
        img.src = `/api/tiles/dem/${zoom}/${tx}/${ty}.png`;
      }
    }
  }, [bounds]);

  const uploadTexture = useCallback((offscreen) => {
    const gl = glRef.current;
    if (!gl || !demTexRef.current) return;
    withTexState(gl, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, demTexRef.current);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);
    });
    const map = useMapStore.getState().mapRef;
    if (map) {
      map.triggerRepaint();
      // Rasterize buildings now that DEM bounds are ready
      if (rasterizeBuildingsRef.current) rasterizeBuildingsRef.current();
    }
  }, []);

  // --- Rasterize OSM building footprints to height texture ---
  const rasterizeBuildings = useCallback(() => {
    const map = mapRef;
    const gl = glRef.current;
    const demB = demBoundsRef.current;
    if (!map || !gl || !demB || !buildingTexRef.current) return;

    if (!map.getSource(OFM_SOURCE)) {
      buildingTexSizeRef.current = { w: 0, h: 0 };
      setBuildingsVisible(false);
      return;
    }

    const features = map.querySourceFeatures(OFM_SOURCE, { sourceLayer: 'building' });
    if (!features.length) {
      buildingTexSizeRef.current = { w: 0, h: 0 };
      setBuildingsVisible(false);
      return;
    }

    const seen = new Set();
    const unique = [];
    for (const f of features) {
      const id = f.id;
      if (id != null && seen.has(id)) continue;
      if (id != null) seen.add(id);
      unique.push(f);
    }

    unique.sort((a, b) => (a.properties.render_height || 10) - (b.properties.render_height || 10));

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

    // Upload to building texture (save/restore MapLibre's GL state)
    withTexState(gl, () => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, buildingTexRef.current);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);
    });
    buildingTexSizeRef.current = { w: cw, h: ch };
    setBuildingsVisible(true);

    const center = map.getCenter();
    const earthCircumAtLat = 40075016.686 * Math.cos(center.lat * Math.PI / 180);
    buildingMptRef.current = (demW * earthCircumAtLat) / cw;

    map.triggerRepaint();
  }, [mapRef]);

  rasterizeBuildingsRef.current = rasterizeBuildings;

  // --- Listen for building source data from BuildingsLayer ---
  useEffect(() => {
    const map = mapRef;
    if (!map) return;

    let rasterizeTimer = null;

    const onSourceData = (e) => {
      if (e.sourceId !== OFM_SOURCE) return;
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
        buildingTexSizeRef.current = { w: 0, h: 0 };
        setBuildingsVisible(false);
      }
    };

    map.on('sourcedata', onSourceData);
    map.on('moveend', onMoveEnd);
    map.on('zoomend', onZoomEnd);

    if (map.getZoom() >= BUILDING_MIN_ZOOM && map.getSource(OFM_SOURCE)) {
      rasterizeTimer = setTimeout(() => rasterizeBuildings(), 500);
    }

    return () => {
      map.off('sourcedata', onSourceData);
      map.off('moveend', onMoveEnd);
      map.off('zoomend', onZoomEnd);
      if (rasterizeTimer) clearTimeout(rasterizeTimer);
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

  // Trigger MapLibre repaint when sun position or opacity changes
  useEffect(() => {
    if (mapRef && layerAddedRef.current) mapRef.triggerRepaint();
  }, [sunPos, sunlightOpacity, mapRef]);

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
    const deg = (sunPos.altitude * 180) / Math.PI;
    return Math.min(1, Math.abs(deg) / 18) * 0.7;
  }, [sunPos]);

  return (
    <>
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
  const setSunlightTime = useMapStore((s) => s.setSunlightTime);

  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const currentTimeRef = useRef(sunlightTime);
  currentTimeRef.current = sunlightTime;

  // Pre-compute sun azimuth for every minute (used to reverse-map drag angle → time)
  const azimuthTable = useMemo(() => {
    if (!bounds) return null;
    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLon = (bounds.east + bounds.west) / 2;
    const table = new Float32Array(1440);
    for (let m = 0; m < 1440; m++) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      const d = new Date(`${sunlightDate}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`);
      const pos = SunCalc.getPosition(d, centerLat, centerLon);
      table[m] = ((pos.azimuth * 180 / Math.PI) + 180) % 360;
    }
    return table;
  }, [bounds, sunlightDate]);

  const getAngleFromPointer = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    let angle = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    return angle;
  }, []);

  const findTimeForAngle = useCallback((angle) => {
    if (!azimuthTable) return;
    const current = Math.floor(currentTimeRef.current);
    let bestMin = current;
    let bestDist = Infinity;
    for (let m = 0; m < 1440; m++) {
      let azDiff = Math.abs(azimuthTable[m] - angle);
      if (azDiff > 180) azDiff = 360 - azDiff;
      // Time proximity resolves morning/evening ambiguity (same azimuth, 12h apart)
      let timeDiff = Math.abs(m - current);
      if (timeDiff > 720) timeDiff = 1440 - timeDiff;
      const totalDist = azDiff + timeDiff * 0.02;
      if (totalDist < bestDist) {
        bestDist = totalDist;
        bestMin = m;
      }
    }
    setSunlightTime(bestMin);
  }, [azimuthTable, setSunlightTime]);

  // Window-level pointer tracking during drag (works for mouse + touch via pointer events)
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      e.preventDefault();
      const angle = getAngleFromPointer(e);
      if (angle !== null) findTimeForAngle(angle);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, getAngleFromPointer, findTimeForAngle]);

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
      <div className="flex justify-center my-1" style={{ touchAction: 'none' }}>
        <svg ref={svgRef} width="80" height="80" viewBox="0 0 80 80">
          <circle cx={compassCx} cy={compassCy} r={compassR} fill="rgba(15,23,42,0.6)" stroke="rgba(100,116,139,0.4)" strokeWidth="1" />
          <line x1={compassCx} y1={compassCy - compassR} x2={compassCx} y2={compassCy + compassR} stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
          <line x1={compassCx - compassR} y1={compassCy} x2={compassCx + compassR} y2={compassCy} stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
          <text x={compassCx} y={compassCy - compassR - 2} textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="bold">N</text>
          <text x={compassCx + compassR + 6} y={compassCy + 2} textAnchor="middle" fill="#64748b" fontSize="6">E</text>
          <text x={compassCx} y={compassCy + compassR + 8} textAnchor="middle" fill="#64748b" fontSize="6">S</text>
          <text x={compassCx - compassR - 6} y={compassCy + 2} textAnchor="middle" fill="#64748b" fontSize="6">W</text>
          <g
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging(true);
            }}
            style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          >
            {/* Invisible larger hit area for easy grab on touch */}
            <circle cx={sunX} cy={sunY} r="12" fill="transparent" />
            <line x1={compassCx} y1={compassCy} x2={sunX} y2={sunY}
              stroke="#fbbf24" strokeWidth="1" opacity={belowHorizon ? 0.2 : 0.5} />
            {belowHorizon ? (
              <circle cx={sunX} cy={sunY} r="3" fill="#64748b" opacity="0.4" />
            ) : (
              <>
                <circle cx={sunX} cy={sunY} r="4" fill="#fbbf24" />
                <circle cx={sunX} cy={sunY} r="7" fill="none" stroke="#fbbf24" strokeWidth="0.5" opacity="0.3" />
              </>
            )}
          </g>
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
        <span className="text-white">{info.azimuth}&deg;</span>
      </div>
      <div className="flex justify-between gap-3">
        <span>{t('sunlight.elevation', lang)}</span>
        <span className="text-white">{info.elevation}&deg;</span>
      </div>
      <div className="flex justify-between gap-3">
        <span>{t('weather.sunrise', lang)}</span>
        <span className="text-white">{info.sunrise}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span>{t('weather.sunset', lang)}</span>
        <span className="text-white">{info.sunset}</span>
      </div>
    </div>
  );
}
