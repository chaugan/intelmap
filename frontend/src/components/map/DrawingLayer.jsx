import { useState, useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore, getAllVisibleDrawings } from '../../stores/useTacticalStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useProjectStore } from '../../stores/useProjectStore.js';
import { socket } from '../../lib/socket.js';
import { DRAW_COLORS } from '../../lib/constants.js';
import { t } from '../../lib/i18n.js';
import { screenDist, hitTestDrawing } from '../../lib/drawing-hit-test.js';

// Check if any coordinate of a drawing falls inside a geo bounding box
function drawingIntersectsBox(drawing, box) {
  const { minLng, maxLng, minLat, maxLat } = box;
  const geom = drawing.geometry;

  function pointInBox(coord) {
    const [lng, lat] = coord;
    return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
  }

  if (geom.type === 'Point') {
    return pointInBox(geom.coordinates);
  }
  if (geom.type === 'LineString') {
    return geom.coordinates.some(pointInBox);
  }
  if (geom.type === 'Polygon') {
    return geom.coordinates[0].some(pointInBox);
  }
  return false;
}

import { generateCirclePolygon, generateEllipsePolygon, getEllipseParams } from '../../lib/drawing-utils.js';
import CsvDrawingImportDialog from './CsvDrawingImportDialog.jsx';

export default function DrawingLayer() {
  const lang = useMapStore((s) => s.lang);
  const mapRefValue = useMapStore((s) => s.mapRef);
  const placementMode = useMapStore((s) => s.placementMode);
  const drawingToolsVisible = useMapStore((s) => s.drawingToolsVisible);
  const selectedDrawingId = useMapStore((s) => s.selectedDrawingId);
  const setSelectedDrawingId = useMapStore((s) => s.setSelectedDrawingId);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const tacticalState = useTacticalStore();
  const drawings = getAllVisibleDrawings(tacticalState);
  const user = useAuthStore((s) => s.user);
  const myProjects = useProjectStore((s) => s.myProjects);

  // Resolve active project/layer names for context banner
  const activeProjectName = activeProjectId ? myProjects.find(p => p.id === activeProjectId)?.name : null;
  const activeLayerName = activeProjectId && activeLayerId
    ? tacticalState.projects[activeProjectId]?.layers?.find(l => l.id === activeLayerId)?.name
    : null;

  const [localDrawings, setLocalDrawings] = useState([]);
  const [activeMode, setActiveMode] = useState(null);
  const [drawColor, setDrawColor] = useState('#3b82f6');
  const [drawPoints, setDrawPoints] = useState([]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [cursorPoint, setCursorPoint] = useState(null);
  const [drawStrokeWidth, setDrawStrokeWidth] = useState(3);
  const [drawFontSize, setDrawFontSize] = useState(18);
  const [, forceUpdate] = useState(0);
  const activeModeRef = useRef(activeMode);
  const drawColorRef = useRef(drawColor);
  const drawPointsRef = useRef(drawPoints);
  const drawStrokeWidthRef = useRef(drawStrokeWidth);
  const drawFontSizeRef = useRef(drawFontSize);

  // Selection state (rectangle batch select)
  const [selectMode, setSelectMode] = useState(false);
  const [selectionRect, setSelectionRect] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const isDraggingRef = useRef(false);

  // Drag state for move/resize
  const [dragState, setDragState] = useState(null);
  const dragStateRef = useRef(null);
  const movedRef = useRef(false);

  // Stable refs for values used inside drag handlers (avoids stale closure on re-render)
  const drawingsRef = useRef(drawings);
  const localDrawingsRef = useRef(localDrawings);
  const selectedDrawingIdRef = useRef(selectedDrawingId);

  // Keep refs in sync
  activeModeRef.current = activeMode;
  drawColorRef.current = drawColor;
  drawPointsRef.current = drawPoints;
  drawStrokeWidthRef.current = drawStrokeWidth;
  drawFontSizeRef.current = drawFontSize;
  dragStateRef.current = dragState;
  drawingsRef.current = drawings;
  localDrawingsRef.current = localDrawings;
  selectedDrawingIdRef.current = selectedDrawingId;

  // The selected drawing object
  const selectedDrawing = selectedDrawingId
    ? drawings.find(d => d.id === selectedDrawingId) || localDrawings.find(d => d.id === selectedDrawingId)
    : null;

  // Share active drawing mode with store so MeasuringTool can yield
  useEffect(() => {
    useMapStore.setState({ drawingActiveMode: activeMode });
    return () => useMapStore.setState({ drawingActiveMode: null });
  }, [activeMode]);

  const finishDrawing = useCallback(() => {
    const pts = drawPointsRef.current;
    const mode = activeModeRef.current;
    const color = drawColorRef.current;
    if (pts.length < 2 && mode !== 'text' && mode !== 'needle') return;

    const label = prompt(lang === 'no' ? 'Legg til etikett (valgfritt):' : 'Add label (optional):');

    let geometry, drawingType;
    if (mode === 'line' || mode === 'arrow') {
      geometry = { type: 'LineString', coordinates: pts };
      drawingType = mode;
    } else if (mode === 'polygon') {
      const closed = [...pts, pts[0]];
      geometry = { type: 'Polygon', coordinates: [closed] };
      drawingType = 'polygon';
    } else if (mode === 'circle' && pts.length >= 2) {
      const [c, edge] = pts;
      const R = 6371;
      const dLat = ((edge[1] - c[1]) * Math.PI) / 180;
      const dLon = ((edge[0] - c[0]) * Math.PI) / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(c[1]*Math.PI/180)*Math.cos(edge[1]*Math.PI/180)*Math.sin(dLon/2)**2;
      const radiusKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const coords = generateCirclePolygon(c, radiusKm);
      geometry = { type: 'Polygon', coordinates: [coords] };
      drawingType = 'circle';
    } else if (mode === 'ellipse' && pts.length >= 2) {
      const coords = generateEllipsePolygon(pts[0], pts[1]);
      geometry = { type: 'Polygon', coordinates: [coords] };
      drawingType = 'ellipse';
    }

    const currentState = useTacticalStore.getState();
    const currentProjectId = currentState.activeProjectId;
    const currentLayerId = currentState.activeLayerId;
    const currentUser = useAuthStore.getState().user;

    if (geometry) {
      const sw = drawStrokeWidthRef.current;
      const props = {
        color,
        lineType: mode === 'arrow' ? 'arrow' : 'solid',
        fillOpacity: 0.15,
        label: label || undefined,
        strokeWidth: sw,
        ...(mode === 'ellipse' ? { rotation: 0 } : {}),
      };
      if (currentProjectId) {
        socket.emit('client:drawing:add', {
          projectId: currentProjectId,
          drawingType,
          geometry,
          layerId: currentLayerId || null,
          properties: props,
          source: 'user',
          createdBy: socket.id,
        });
      } else if (!currentUser) {
        setLocalDrawings((prev) => [...prev, {
          id: `local-${Date.now()}`,
          drawingType,
          geometry,
          properties: props,
          _local: true,
        }]);
      }
    }

    setDrawPoints([]);
    setActiveMode(null);
  }, [lang]);

  // ── Click handler: draw mode OR select single drawing ──
  useEffect(() => {
    if (!mapRefValue) return;

    const handler = (e) => {
      // Ignore clicks during drag
      if (dragStateRef.current) return;
      if (selectMode || placementMode) return;

      const { lng, lat } = e.lngLat;

      // If we're in a drawing mode, handle drawing
      if (activeModeRef.current) {
        if (activeModeRef.current === 'text') {
          const text = prompt(lang === 'no' ? 'Skriv inn tekst:' : 'Enter text:');
          const textState = useTacticalStore.getState();
          const currentPid = textState.activeProjectId;
          const currentLid = textState.activeLayerId;
          const currentUser = useAuthStore.getState().user;
          if (text) {
            const fs = drawFontSizeRef.current;
            if (currentPid) {
              socket.emit('client:drawing:add', {
                projectId: currentPid,
                drawingType: 'text',
                geometry: { type: 'Point', coordinates: [lng, lat] },
                layerId: currentLid || null,
                properties: { text, color: drawColorRef.current, strokeWidth: 3, fontSize: fs },
                source: 'user',
                createdBy: socket.id,
              });
            } else if (!currentUser) {
              setLocalDrawings((prev) => [...prev, {
                id: `local-${Date.now()}`,
                drawingType: 'text',
                geometry: { type: 'Point', coordinates: [lng, lat] },
                properties: { text, color: drawColorRef.current, strokeWidth: 3, fontSize: fs },
                _local: true,
              }]);
            }
          }
          setActiveMode(null);
          return;
        }

        if (activeModeRef.current === 'needle') {
          const label = prompt(lang === 'no' ? 'Legg til etikett (valgfritt):' : 'Add label (optional):');
          const needleState = useTacticalStore.getState();
          const currentPid = needleState.activeProjectId;
          const currentLid = needleState.activeLayerId;
          const currentUser = useAuthStore.getState().user;
          const nsw = drawStrokeWidthRef.current;
          if (currentPid) {
            socket.emit('client:drawing:add', {
              projectId: currentPid,
              drawingType: 'needle',
              geometry: { type: 'Point', coordinates: [lng, lat] },
              layerId: currentLid || null,
              properties: { color: drawColorRef.current, label: label || undefined, strokeWidth: nsw },
              source: 'user',
              createdBy: socket.id,
            });
          } else if (!currentUser) {
            setLocalDrawings((prev) => [...prev, {
              id: `local-${Date.now()}`,
              drawingType: 'needle',
              geometry: { type: 'Point', coordinates: [lng, lat] },
              properties: { color: drawColorRef.current, label: label || undefined, strokeWidth: nsw },
              _local: true,
            }]);
          }
          setActiveMode(null);
          return;
        }

        if ((activeModeRef.current === 'circle' || activeModeRef.current === 'ellipse') && drawPointsRef.current.length === 1) {
          setDrawPoints(prev => [...prev, [lng, lat]]);
          setCursorPoint(null);
          setTimeout(() => finishDrawing(), 0);
          return;
        }

        setDrawPoints(prev => [...prev, [lng, lat]]);
        return;
      }

      // Not in drawing mode — try to select a drawing by click
      if (!drawingToolsVisible) return;
      const clickScreen = mapRefValue.project([lng, lat]);

      // Check server drawings first (topmost = last in array)
      const allDrawings = [...drawings, ...localDrawings];
      let found = null;
      for (let i = allDrawings.length - 1; i >= 0; i--) {
        if (hitTestDrawing(allDrawings[i], clickScreen, mapRefValue)) {
          found = allDrawings[i];
          break;
        }
      }

      if (found) {
        setSelectedDrawingId(found.id);
      } else {
        setSelectedDrawingId(null);
      }
    };

    mapRefValue.on('click', handler);
    return () => mapRefValue.off('click', handler);
  }, [mapRefValue, lang, placementMode, selectMode, finishDrawing, drawingToolsVisible, drawings, localDrawings, setSelectedDrawingId]);

  // ── Double-click to edit label ──
  useEffect(() => {
    if (!mapRefValue || !drawingToolsVisible) return;

    const handler = (e) => {
      if (activeModeRef.current || selectMode) return;
      const { lng, lat } = e.lngLat;
      const clickScreen = mapRefValue.project([lng, lat]);

      const allDrawings = [...drawings, ...localDrawings];
      let found = null;
      for (let i = allDrawings.length - 1; i >= 0; i--) {
        if (hitTestDrawing(allDrawings[i], clickScreen, mapRefValue)) {
          found = allDrawings[i];
          break;
        }
      }

      if (!found) return;
      e.preventDefault();

      if (found.drawingType === 'text') {
        const newText = prompt(lang === 'no' ? 'Rediger tekst:' : 'Edit text:', found.properties?.text || '');
        if (newText === null) return;
        if (found._local) {
          setLocalDrawings(prev => prev.map(d => d.id === found.id ? { ...d, properties: { ...d.properties, text: newText } } : d));
        } else {
          socket.emit('client:drawing:update', {
            projectId: found._projectId,
            id: found.id,
            properties: { ...found.properties, text: newText },
          });
        }
      } else {
        const newLabel = prompt(lang === 'no' ? 'Rediger etikett:' : 'Edit label:', found.properties?.label || '');
        if (newLabel === null) return;
        if (found._local) {
          setLocalDrawings(prev => prev.map(d => d.id === found.id ? { ...d, properties: { ...d.properties, label: newLabel || undefined } } : d));
        } else {
          socket.emit('client:drawing:update', {
            projectId: found._projectId,
            id: found.id,
            properties: { ...found.properties, label: newLabel || undefined },
          });
        }
      }
    };

    mapRefValue.on('dblclick', handler);
    return () => mapRefValue.off('dblclick', handler);
  }, [mapRefValue, drawingToolsVisible, selectMode, drawings, localDrawings, lang]);

  // ── Drag to move / resize ──
  useEffect(() => {
    if (!mapRefValue || !drawingToolsVisible) return;
    if (activeMode || selectMode) return;

    const canvas = mapRefValue.getCanvas();

    let touchHoldTimer = null;
    let touchHoldPending = null;

    const startBodyDrag = (e, drawing, clickScreen) => {
      e.preventDefault();
      e.stopPropagation();
      movedRef.current = false;
      const startLngLat = mapRefValue.unproject([clickScreen.x, clickScreen.y]);
      const ds = {
        type: 'move',
        drawingId: drawing.id,
        startLngLat: [startLngLat.lng, startLngLat.lat],
        originalGeometry: JSON.parse(JSON.stringify(drawing.geometry)),
        isLocal: !!drawing._local,
        projectId: drawing._projectId,
        drawingType: drawing.drawingType,
      };
      dragStateRef.current = ds;
      setDragState(ds);
      mapRefValue.dragPan.disable();
    };

    const cancelTouchHold = () => {
      if (touchHoldTimer) { clearTimeout(touchHoldTimer); touchHoldTimer = null; }
      touchHoldPending = null;
    };

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      const selId = selectedDrawingIdRef.current;
      if (!selId) return;

      const drawing = drawingsRef.current.find(d => d.id === selId) || localDrawingsRef.current.find(d => d.id === selId);
      if (!drawing) return;

      const rect = canvas.getBoundingClientRect();
      const clickScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const isTouch = e.pointerType === 'touch';

      // Check vertex handles first (resize) — immediate for both mouse and touch
      const vertices = getVertices(drawing);
      for (let i = 0; i < vertices.length; i++) {
        try {
          const vScreen = mapRefValue.project(vertices[i]);
          if (screenDist(clickScreen, vScreen) <= 10) {
            e.preventDefault();
            e.stopPropagation();
            movedRef.current = false;
            const startLngLat = mapRefValue.unproject([clickScreen.x, clickScreen.y]);
            const ds = {
              type: 'vertex',
              vertexIndex: i,
              drawingId: drawing.id,
              startLngLat: [startLngLat.lng, startLngLat.lat],
              originalGeometry: JSON.parse(JSON.stringify(drawing.geometry)),
              isLocal: !!drawing._local,
              projectId: drawing._projectId,
              drawingType: drawing.drawingType,
            };
            dragStateRef.current = ds;
            setDragState(ds);
            mapRefValue.dragPan.disable();
            return;
          }
        } catch {}
      }

      // Check if click is on the drawing body (move)
      if (hitTestDrawing(drawing, clickScreen, mapRefValue, 12)) {
        if (isTouch) {
          // On touch: delay move activation so the user can pan the map normally.
          // A brief hold (~250ms) without moving commits to drawing move.
          touchHoldPending = { drawing, clickScreen, event: e };
          touchHoldTimer = setTimeout(() => {
            if (touchHoldPending) {
              startBodyDrag(touchHoldPending.event, touchHoldPending.drawing, touchHoldPending.clickScreen);
              touchHoldPending = null;
            }
          }, 250);
        } else {
          startBodyDrag(e, drawing, clickScreen);
        }
      }
    };

    const onPointerMove = (e) => {
      // Cancel pending touch hold if the user starts moving (they want to pan)
      if (touchHoldPending) { cancelTouchHold(); return; }
      const ds = dragStateRef.current;
      if (!ds) return;
      movedRef.current = true;

      const rect = canvas.getBoundingClientRect();
      const cursorScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const cursorLngLat = mapRefValue.unproject([cursorScreen.x, cursorScreen.y]);

      if (ds.type === 'move') {
        const dLng = cursorLngLat.lng - ds.startLngLat[0];
        const dLat = cursorLngLat.lat - ds.startLngLat[1];
        const newGeom = JSON.parse(JSON.stringify(ds.originalGeometry));

        if (newGeom.type === 'Point') {
          newGeom.coordinates[0] += dLng;
          newGeom.coordinates[1] += dLat;
        } else if (newGeom.type === 'LineString') {
          newGeom.coordinates = newGeom.coordinates.map(c => [c[0] + dLng, c[1] + dLat]);
        } else if (newGeom.type === 'Polygon') {
          newGeom.coordinates[0] = newGeom.coordinates[0].map(c => [c[0] + dLng, c[1] + dLat]);
        }

        applyGeometryUpdate(ds, newGeom);
      } else if (ds.type === 'vertex') {
        const newGeom = JSON.parse(JSON.stringify(ds.originalGeometry));

        if (ds.drawingType === 'circle') {
          // For circles: recalculate radius from center to new handle position
          const ring = newGeom.coordinates[0];
          const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
          const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
          const R = 6371;
          const dLat2 = ((cursorLngLat.lat - cy) * Math.PI) / 180;
          const dLon2 = ((cursorLngLat.lng - cx) * Math.PI) / 180;
          const a = Math.sin(dLat2/2)**2 + Math.cos(cy*Math.PI/180)*Math.cos(cursorLngLat.lat*Math.PI/180)*Math.sin(dLon2/2)**2;
          const radiusKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          const coords = generateCirclePolygon([cx, cy], Math.max(0.01, radiusKm));
          newGeom.coordinates = [coords];
        } else if (ds.drawingType === 'ellipse') {
          // For ellipse: derive params from ring, adjust rx/ry accounting for rotation
          const ring = newGeom.coordinates[0];
          const params = getEllipseParams(ring);
          let { cx, cy, rx, ry, rotationDeg } = params;
          const rotRad = (rotationDeg * Math.PI) / 180;
          // Project cursor offset onto the rotated axes
          const cdx = cursorLngLat.lng - cx;
          const cdy = cursorLngLat.lat - cy;
          if (ds.vertexIndex === 0) {
            // Dragging rx handle: project onto major axis
            rx = Math.max(0.00001, Math.abs(cdx * Math.cos(rotRad) + cdy * Math.sin(rotRad)));
          } else {
            // Dragging ry handle: project onto minor axis
            ry = Math.max(0.00001, Math.abs(-cdx * Math.sin(rotRad) + cdy * Math.cos(rotRad)));
          }
          const edgePt = [cx + rx, cy + ry];
          const coords = generateEllipsePolygon([cx, cy], edgePt, rotationDeg);
          newGeom.coordinates = [coords];
        } else if (newGeom.type === 'LineString') {
          newGeom.coordinates[ds.vertexIndex] = [cursorLngLat.lng, cursorLngLat.lat];
        } else if (newGeom.type === 'Polygon') {
          newGeom.coordinates[0][ds.vertexIndex] = [cursorLngLat.lng, cursorLngLat.lat];
          // If first/last vertex, keep ring closed
          if (ds.vertexIndex === 0) {
            newGeom.coordinates[0][newGeom.coordinates[0].length - 1] = [cursorLngLat.lng, cursorLngLat.lat];
          } else if (ds.vertexIndex === newGeom.coordinates[0].length - 1) {
            newGeom.coordinates[0][0] = [cursorLngLat.lng, cursorLngLat.lat];
          }
        }

        applyGeometryUpdate(ds, newGeom);
      }
    };

    const onPointerUp = () => {
      // Cancel pending touch hold if the user lifts finger before the delay
      cancelTouchHold();
      const ds = dragStateRef.current;
      if (!ds) return;
      mapRefValue.dragPan.enable();

      if (movedRef.current && !ds.isLocal && lastDragGeomRef.current) {
        // Persist final geometry to server
        socket.emit('client:drawing:update', {
          projectId: ds.projectId,
          id: ds.drawingId,
          geometry: lastDragGeomRef.current,
        });
      }
      lastDragGeomRef.current = null;
      useMapStore.setState({ dragPreview: null });

      setDragState(null);
      // Brief timeout so the click handler doesn't fire
      setTimeout(() => { movedRef.current = false; }, 50);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      cancelTouchHold();
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (dragStateRef.current) mapRefValue.dragPan.enable();
    };
  }, [mapRefValue, drawingToolsVisible, activeMode, selectMode]);

  // Track the latest geometry during drag for use in onPointerUp
  const lastDragGeomRef = useRef(null);

  function applyGeometryUpdate(ds, newGeom) {
    lastDragGeomRef.current = newGeom;
    if (ds.isLocal) {
      setLocalDrawings(prev => prev.map(d => d.id === ds.drawingId ? { ...d, geometry: newGeom } : d));
    } else {
      // Set drag preview in store so TacticalMap renders the updated geometry live
      useMapStore.setState({ dragPreview: { drawingId: ds.drawingId, geometry: newGeom } });
      forceUpdate(n => n + 1);
    }
  }

  function getVertices(drawing) {
    if (!drawing) return [];
    if (drawing.drawingType === 'circle' && drawing.geometry.type === 'Polygon') {
      // Show one handle at the "east" point (index 16 out of 65 = 0° = east)
      const ring = drawing.geometry.coordinates[0];
      if (ring.length > 16) return [ring[16]];
      return [ring[0]];
    }
    if (drawing.drawingType === 'ellipse' && drawing.geometry.type === 'Polygon') {
      // Show two handles: east (index 0 = 0°) and north (index 16 = 90°)
      const ring = drawing.geometry.coordinates[0];
      const handles = [];
      if (ring.length > 0) handles.push(ring[0]);   // east (rx)
      if (ring.length > 16) handles.push(ring[16]);  // north (ry)
      return handles;
    }
    if (drawing.geometry.type === 'LineString') {
      return drawing.geometry.coordinates;
    }
    if (drawing.geometry.type === 'Polygon') {
      // Exclude last point (duplicate of first for closure)
      return drawing.geometry.coordinates[0].slice(0, -1);
    }
    if (drawing.geometry.type === 'Point') {
      return [drawing.geometry.coordinates];
    }
    return [];
  }

  // Preview: follow cursor for circle (after center), line/arrow/polygon (after first point)
  useEffect(() => {
    if (!mapRefValue) return;
    const handler = (e) => {
      const mode = activeModeRef.current;
      if (!mode) return;
      const pts = drawPointsRef.current;
      const { lng, lat } = e.lngLat;
      if ((mode === 'circle' || mode === 'ellipse') && pts.length === 1) {
        setCursorPoint([lng, lat]);
      } else if ((mode === 'line' || mode === 'arrow' || mode === 'polygon') && pts.length > 0) {
        setCursorPoint([lng, lat]);
      }
    };
    mapRefValue.on('mousemove', handler);
    return () => mapRefValue.off('mousemove', handler);
  }, [mapRefValue]);

  // Set crosshair cursor when in drawing mode
  useEffect(() => {
    if (!mapRefValue) return;
    if (activeMode) {
      mapRefValue.getCanvas().style.cursor = 'crosshair';
      return () => { mapRefValue.getCanvas().style.cursor = ''; };
    }
  }, [mapRefValue, activeMode]);

  // Rectangle selection drag handlers
  useEffect(() => {
    if (!selectMode || !mapRefValue) return;

    const canvas = mapRefValue.getCanvas();
    canvas.style.touchAction = 'none';

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setSelectionRect({ startX: x, startY: y, endX: x, endY: y });
      mapRefValue.dragPan.disable();
    };

    const onPointerMove = (e) => {
      if (!isDraggingRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setSelectionRect(prev => prev ? { ...prev, endX: x, endY: y } : null);
    };

    const onPointerUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      mapRefValue.dragPan.enable();

      setSelectionRect(prev => {
        if (!prev) return null;
        const { startX, startY, endX, endY } = prev;
        const minX = Math.min(startX, endX);
        const maxX = Math.max(startX, endX);
        const minY = Math.min(startY, endY);
        const maxY = Math.max(startY, endY);

        if (maxX - minX < 5 || maxY - minY < 5) {
          setSelectedIds(new Set());
          return null;
        }

        const sw = mapRefValue.unproject([minX, maxY]);
        const ne = mapRefValue.unproject([maxX, minY]);
        const box = {
          minLng: sw.lng,
          maxLng: ne.lng,
          minLat: sw.lat,
          maxLat: ne.lat,
        };

        const state = useTacticalStore.getState();
        const allDrawings = getAllVisibleDrawings(state);
        const ids = new Set();
        for (const d of allDrawings) {
          if (drawingIntersectsBox(d, box)) {
            ids.add(d.id);
          }
        }
        setSelectedIds(ids);
        return null;
      });
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.style.touchAction = '';
      mapRefValue.dragPan.enable();
    };
  }, [selectMode, mapRefValue]);

  // Exit select mode resets selection
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setSelectionRect(null);
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0 || !activeProjectId) return;
    socket.emit('client:drawing:delete-batch', { projectId: activeProjectId, ids: Array.from(selectedIds) });
    setSelectedIds(new Set());
  }, [selectedIds, activeProjectId]);

  const deleteAll = useCallback(() => {
    if (!activeProjectId) return;
    const ok = confirm(t('draw.confirmDeleteAll', lang));
    if (!ok) return;
    const allIds = drawings.map(d => d.id);
    if (allIds.length > 0) {
      socket.emit('client:drawing:delete-batch', { projectId: activeProjectId, ids: allIds });
    }
    exitSelectMode();
  }, [lang, exitSelectMode, activeProjectId, drawings]);

  // Delete single selected drawing
  const deleteSingleSelected = useCallback(() => {
    if (!selectedDrawingId) return;
    const drawing = drawings.find(d => d.id === selectedDrawingId);
    if (drawing && drawing._projectId) {
      socket.emit('client:drawing:delete-batch', { projectId: drawing._projectId, ids: [selectedDrawingId] });
    }
    const localD = localDrawings.find(d => d.id === selectedDrawingId);
    if (localD) {
      setLocalDrawings(prev => prev.filter(d => d.id !== selectedDrawingId));
    }
    setSelectedDrawingId(null);
  }, [selectedDrawingId, drawings, localDrawings, setSelectedDrawingId]);

  // Adjust line width of selected drawing or draw-mode default
  const adjustLineWidth = useCallback((delta) => {
    if (selectedDrawing && !activeMode) {
      const current = selectedDrawing.properties?.strokeWidth || 3;
      const newWidth = Math.max(1, Math.min(20, current + delta));
      if (selectedDrawing._local) {
        setLocalDrawings(prev => prev.map(d => d.id === selectedDrawing.id
          ? { ...d, properties: { ...d.properties, strokeWidth: newWidth } }
          : d
        ));
      } else {
        socket.emit('client:drawing:update', {
          projectId: selectedDrawing._projectId,
          id: selectedDrawing.id,
          properties: { ...selectedDrawing.properties, strokeWidth: newWidth },
        });
      }
    } else {
      setDrawStrokeWidth(prev => Math.max(1, Math.min(20, prev + delta)));
    }
  }, [selectedDrawing, activeMode]);

  // Adjust font size of selected drawing (text or any with label) or draw-mode default
  const adjustFontSize = useCallback((delta) => {
    if (selectedDrawing && !activeMode && (selectedDrawing.drawingType === 'text' || selectedDrawing.properties?.label)) {
      const defaultSize = selectedDrawing.drawingType === 'text' ? 18 : selectedDrawing.drawingType === 'needle' ? 13 : 16;
      const current = selectedDrawing.properties?.fontSize || defaultSize;
      const newSize = Math.max(10, Math.min(40, current + delta));
      if (selectedDrawing._local) {
        setLocalDrawings(prev => prev.map(d => d.id === selectedDrawing.id
          ? { ...d, properties: { ...d.properties, fontSize: newSize } }
          : d
        ));
      } else {
        socket.emit('client:drawing:update', {
          projectId: selectedDrawing._projectId,
          id: selectedDrawing.id,
          properties: { ...selectedDrawing.properties, fontSize: newSize },
        });
      }
    } else {
      setDrawFontSize(prev => Math.max(10, Math.min(40, prev + delta)));
    }
  }, [selectedDrawing, activeMode]);

  // Rotate selected ellipse by delta degrees
  const adjustRotation = useCallback((delta) => {
    if (!selectedDrawing || selectedDrawing.drawingType !== 'ellipse') return;
    const ring = selectedDrawing.geometry.coordinates[0];
    const params = getEllipseParams(ring);
    const newRotation = params.rotationDeg + delta;
    const edgePt = [params.cx + params.rx, params.cy + params.ry];
    const coords = generateEllipsePolygon([params.cx, params.cy], edgePt, newRotation);
    const newGeometry = { type: 'Polygon', coordinates: [coords] };
    const newProps = { ...selectedDrawing.properties, rotation: Math.round(newRotation % 360) };
    if (selectedDrawing._local) {
      setLocalDrawings(prev => prev.map(d => d.id === selectedDrawing.id
        ? { ...d, geometry: newGeometry, properties: newProps }
        : d
      ));
    } else {
      socket.emit('client:drawing:update', {
        projectId: selectedDrawing._projectId,
        id: selectedDrawing.id,
        geometry: newGeometry,
        properties: newProps,
      });
    }
  }, [selectedDrawing]);

  // Force re-render on map move so preview SVG stays in sync with map
  useEffect(() => {
    if (!mapRefValue) return;
    const needsSync = drawPoints.length > 0 || selectedDrawingId || dragState;
    if (!needsSync) return;
    const onMove = () => forceUpdate((n) => n + 1);
    mapRefValue.on('move', onMove);
    return () => mapRefValue.off('move', onMove);
  }, [mapRefValue, drawPoints.length > 0, selectedDrawingId, !!dragState]);

  // Project draw points to screen coordinates for SVG preview
  const screenPoints = [];
  if (mapRefValue && drawPoints.length > 0) {
    for (const pt of drawPoints) {
      try {
        const sp = mapRefValue.project(pt);
        screenPoints.push({ x: sp.x, y: sp.y });
      } catch {
        screenPoints.push({ x: 0, y: 0 });
      }
    }
  }

  // Cancel in-progress drawing when tools are hidden
  useEffect(() => {
    if (!drawingToolsVisible) {
      setActiveMode(null);
      setDrawPoints([]);
      setCursorPoint(null);
      setSelectedDrawingId(null);
      if (selectMode) exitSelectMode();
    }
  }, [drawingToolsVisible]);

  // Keyboard shortcuts: Enter to finish, Escape to cancel/deselect, Delete to remove selected
  useEffect(() => {
    if (!drawingToolsVisible) return;
    const onKeyDown = (e) => {
      // Delete/Backspace deletes selected drawing
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId && !activeMode) {
        // Don't delete if user is in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        deleteSingleSelected();
        return;
      }

      if (activeMode) {
        if (e.key === 'Enter' && activeModeRef.current && activeModeRef.current !== 'text' && activeModeRef.current !== 'needle' && drawPointsRef.current.length >= 2) {
          e.preventDefault();
          finishDrawing();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setActiveMode(null);
          setDrawPoints([]);
        }
      } else if (e.key === 'Escape' && selectedDrawingId) {
        e.preventDefault();
        setSelectedDrawingId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawingToolsVisible, activeMode, selectedDrawingId, deleteSingleSelected, setSelectedDrawingId]);

  const tools = [
    { id: 'line', icon: '/', shortcut: 'L' },
    { id: 'polygon', icon: '\u2B21', shortcut: 'P' },
    { id: 'circle', icon: '\u25EF', shortcut: 'O' },
    { id: 'ellipse', icon: '\u2B2D', shortcut: 'E' },
    { id: 'arrow', icon: '\u2192', shortcut: 'A' },
    { id: 'text', icon: 'T', shortcut: 'T' },
    { id: 'needle', icon: '\uD83D\uDCCD', shortcut: 'N' },
  ];

  // No-project warning for logged-in users
  const noProjectWarning = drawingToolsVisible && user && !activeProjectId;

  return (
    <>
      {/* Drawing tools panel */}
      {drawingToolsVisible && <div className="absolute top-[120px] left-2 z-10 flex flex-col gap-1">
        {/* No project warning banner */}
        {noProjectWarning && (
          <div className="bg-amber-600/90 rounded px-2 py-1.5 mb-1 text-[11px] text-white max-w-[140px] text-center leading-tight">
            <div className="font-bold">{t('draw.noProject', lang)}</div>
            <div className="mt-0.5 opacity-80">{t('draw.noProjectHint', lang)}</div>
          </div>
        )}

        {/* Context banner moved to centered position below */}

        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => {
              if (noProjectWarning) return;
              if (selectMode) exitSelectMode();
              setSelectedDrawingId(null);
              if (activeMode === tool.id) {
                finishDrawing();
              } else {
                setDrawPoints([]);
                setCursorPoint(null);
                setActiveMode(tool.id);
              }
            }}
            className={`w-10 h-10 flex items-center justify-center rounded text-lg font-bold transition-colors shadow-lg ${
              noProjectWarning
                ? 'bg-slate-800 text-slate-600 opacity-40 cursor-not-allowed'
                : activeMode === tool.id
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title={`${t(`draw.${tool.id}`, lang)} (${tool.shortcut})`}
            disabled={noProjectWarning}
          >
            {tool.icon}
          </button>
        ))}

        {/* Finish / Cancel buttons */}
        {activeMode && (
          <div className="flex flex-col gap-3 mt-2">
            {activeMode !== 'text' && activeMode !== 'needle' && drawPoints.length >= 2 && (
              <button
                onClick={finishDrawing}
                className="w-10 h-10 flex items-center justify-center rounded bg-emerald-600 text-white text-sm font-bold shadow-lg hover:bg-emerald-500"
                title="Finish (Enter)"
              >
                {'\u2713'}
              </button>
            )}
            <button
              onClick={() => { setActiveMode(null); setDrawPoints([]); }}
              className="w-10 h-10 flex items-center justify-center rounded bg-red-800 text-white text-sm font-bold shadow-lg hover:bg-red-700"
              title="Cancel (Esc)"
            >
              {'\u2715'}
            </button>
          </div>
        )}

        {/* Line width controls during draw mode */}
        {activeMode && activeMode !== 'text' && activeMode !== 'needle' && (
          <div className="flex flex-col items-center gap-0.5 mt-1 bg-slate-800 rounded px-1.5 py-1 shadow-lg">
            <span className="text-[9px] text-slate-300 font-medium">{t('draw.lineWidth', lang)}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => adjustLineWidth(-1)}
                className="w-6 h-6 flex items-center justify-center rounded bg-slate-600 text-white text-sm font-bold hover:bg-slate-500"
              >
                −
              </button>
              <span className="text-[12px] text-white w-5 text-center font-bold">{drawStrokeWidth}</span>
              <button
                onClick={() => adjustLineWidth(1)}
                className="w-6 h-6 flex items-center justify-center rounded bg-slate-600 text-white text-sm font-bold hover:bg-slate-500"
              >
                +
              </button>
            </div>
          </div>
        )}

        {/* Font size controls during text draw mode */}
        {activeMode === 'text' && (
          <div className="flex flex-col items-center gap-0.5 mt-1 bg-slate-800 rounded px-1.5 py-1 shadow-lg">
            <span className="text-[9px] text-slate-300 font-medium">{t('draw.fontSize', lang)}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => adjustFontSize(-2)}
                className="w-6 h-6 flex items-center justify-center rounded bg-slate-600 text-white text-sm font-bold hover:bg-slate-500"
              >
                −
              </button>
              <span className="text-[12px] text-white w-5 text-center font-bold">{drawFontSize}</span>
              <button
                onClick={() => adjustFontSize(2)}
                className="w-6 h-6 flex items-center justify-center rounded bg-slate-600 text-white text-sm font-bold hover:bg-slate-500"
              >
                +
              </button>
            </div>
          </div>
        )}

        {/* Separator */}
        <div className="border-t border-slate-600 my-1" />

        {/* Select/delete mode button */}
        <button
          onClick={() => {
            if (noProjectWarning) return;
            setSelectedDrawingId(null);
            if (selectMode) {
              exitSelectMode();
            } else {
              setActiveMode(null);
              setDrawPoints([]);
              setSelectMode(true);
            }
          }}
          className={`w-10 h-10 flex items-center justify-center rounded text-sm font-bold transition-colors shadow-lg ${
            noProjectWarning
              ? 'bg-slate-800 text-slate-600 opacity-40 cursor-not-allowed'
              : selectMode
                ? 'bg-amber-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
          title={t('draw.select', lang)}
          disabled={noProjectWarning}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
          </svg>
        </button>

        {/* Delete all button (server drawings) */}
        {drawings.length > 0 && !noProjectWarning && (
          <button
            onClick={deleteAll}
            className="w-10 h-10 flex items-center justify-center rounded bg-slate-800 text-red-400 hover:bg-red-800 hover:text-white text-sm font-bold transition-colors shadow-lg"
            title={t('draw.deleteAll', lang)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}

        {/* Clear local drawings button */}
        {localDrawings.length > 0 && (
          <button
            onClick={() => {
              const ok = confirm(lang === 'no' ? 'Slett alle lokale tegninger?' : 'Delete all local drawings?');
              if (ok) setLocalDrawings([]);
            }}
            className="w-10 h-10 flex items-center justify-center rounded bg-amber-700 text-white hover:bg-amber-600 text-sm font-bold transition-colors shadow-lg"
            title={lang === 'no' ? 'Slett lokale tegninger' : 'Clear local drawings'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}

        {/* Delete selected (batch) button */}
        {selectedIds.size > 0 && (
          <button
            onClick={deleteSelected}
            className="w-10 h-10 flex items-center justify-center rounded bg-red-700 text-white text-xs font-bold shadow-lg hover:bg-red-600 animate-pulse"
            title={t('draw.deleteSelected', lang)}
          >
            <div className="flex flex-col items-center leading-tight">
              <span>{selectedIds.size}</span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
          </button>
        )}

        {/* ── Selected drawing controls: delete, line width ── */}
        {selectedDrawing && !activeMode && !selectMode && (
          <div className="flex flex-col gap-1 mt-1">
            {/* Delete single selected */}
            <button
              onClick={deleteSingleSelected}
              className="w-10 h-10 flex items-center justify-center rounded bg-red-700 text-white text-sm font-bold shadow-lg hover:bg-red-600"
              title={t('draw.deleteDrawing', lang)}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>

            {/* Line width controls */}
            {selectedDrawing.geometry.type !== 'Point' && (
              <div className="flex flex-col items-center gap-0.5 bg-slate-800 rounded px-1.5 py-1 shadow-lg">
                <span className="text-[9px] text-slate-300 font-medium">{t('draw.lineWidth', lang)}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => adjustLineWidth(-1)}
                    className="w-6 h-6 flex items-center justify-center rounded bg-slate-600 text-white text-sm font-bold hover:bg-slate-500"
                  >
                    −
                  </button>
                  <span className="text-[12px] text-white w-5 text-center font-bold">{selectedDrawing.properties?.strokeWidth || 3}</span>
                  <button
                    onClick={() => adjustLineWidth(1)}
                    className="w-6 h-6 flex items-center justify-center rounded bg-slate-600 text-white text-sm font-bold hover:bg-slate-500"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* Font size controls for selected text or any drawing with a label */}
            {(selectedDrawing.drawingType === 'text' || selectedDrawing.properties?.label) && (
              <div className="flex flex-col items-center gap-0.5 bg-slate-800 rounded px-1.5 py-1 shadow-lg">
                <span className="text-[9px] text-slate-300 font-medium">{t('draw.fontSize', lang)}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => adjustFontSize(-2)}
                    className="w-6 h-6 flex items-center justify-center rounded bg-slate-600 text-white text-sm font-bold hover:bg-slate-500"
                  >
                    −
                  </button>
                  <span className="text-[12px] text-white w-5 text-center font-bold">{selectedDrawing.properties?.fontSize || (selectedDrawing.drawingType === 'text' ? 18 : selectedDrawing.drawingType === 'needle' ? 13 : 16)}</span>
                  <button
                    onClick={() => adjustFontSize(2)}
                    className="w-6 h-6 flex items-center justify-center rounded bg-slate-600 text-white text-sm font-bold hover:bg-slate-500"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* Rotation controls for selected ellipse */}
            {selectedDrawing.drawingType === 'ellipse' && (
              <div className="flex flex-col items-center gap-0.5 bg-slate-800 rounded px-1.5 py-1 shadow-lg">
                <span className="text-[9px] text-slate-300 font-medium">{t('draw.rotation', lang)}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => adjustRotation(-15)}
                    className="w-6 h-6 flex items-center justify-center rounded bg-slate-600 text-white text-sm font-bold hover:bg-slate-500"
                    title="-15°"
                  >
                    ↺
                  </button>
                  <span className="text-[11px] text-white w-7 text-center font-bold">{Math.round(selectedDrawing.properties?.rotation || 0)}°</span>
                  <button
                    onClick={() => adjustRotation(15)}
                    className="w-6 h-6 flex items-center justify-center rounded bg-slate-600 text-white text-sm font-bold hover:bg-slate-500"
                    title="+15°"
                  >
                    ↻
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Color picker */}
        {!selectMode && (
          <div className="relative">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className={`w-10 h-10 flex items-center justify-center rounded bg-slate-800 shadow-lg hover:bg-slate-700 ${noProjectWarning ? 'opacity-40 cursor-not-allowed' : ''}`}
              title={t('draw.color', lang)}
              disabled={noProjectWarning}
            >
              <div className="w-6 h-6 rounded" style={{ backgroundColor: drawColor }} />
            </button>
            {showColorPicker && !noProjectWarning && (
              <div className="absolute left-12 top-0 bg-slate-800 p-3 rounded shadow-xl border border-slate-600 min-w-[240px]">
                <div className="grid grid-cols-5 gap-1.5 mb-2">
                  {DRAW_COLORS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setDrawColor(c.color); setShowColorPicker(false); }}
                      className={`w-10 h-10 rounded border-2 transition-transform hover:scale-110 ${drawColor === c.color ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c.color }}
                      title={lang === 'no' ? c.label : c.labelEn}
                    />
                  ))}
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="color"
                    value={drawColor}
                    onChange={(e) => { setDrawColor(e.target.value); }}
                    className="w-10 h-10 rounded border-0 cursor-pointer bg-transparent p-0"
                  />
                  <span className="text-xs text-slate-400">{lang === 'no' ? 'Egendefinert' : 'Custom'}</span>
                </label>
              </div>
            )}
          </div>
        )}

        {/* Import CSV button */}
        {!selectMode && (
          <button
            onClick={() => setCsvImportOpen(true)}
            className={`w-10 h-10 flex items-center justify-center rounded bg-slate-800 text-slate-300 hover:bg-slate-700 shadow-lg ${noProjectWarning ? 'opacity-40 cursor-not-allowed' : ''}`}
            title={t('draw.importCsv', lang)}
            disabled={noProjectWarning}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </button>
        )}

        {/* Point count indicator */}
        {activeMode && drawPoints.length > 0 && (
          <div className="text-[10px] text-center text-emerald-400 mt-1">
            {drawPoints.length} pts
          </div>
        )}

        {/* Active mode hint */}
        {activeMode && (
          <div className="bg-slate-800/90 rounded px-2 py-1 mt-1 text-[10px] text-slate-300 max-w-[120px]">
            {activeMode === 'text'
              ? (lang === 'no' ? 'Klikk for tekst' : 'Click to place text')
              : activeMode === 'needle'
              ? (lang === 'no' ? 'Klikk for å plassere nål' : 'Click to place needle')
              : (lang === 'no' ? 'Klikk for punkter, \u2713 for \u00e5 fullf\u00f8re' : 'Click to add points, \u2713 to finish')
            }
          </div>
        )}

        {/* Select mode hint */}
        {selectMode && (
          <div className="bg-slate-800/90 rounded px-2 py-1 mt-1 text-[10px] text-slate-300 max-w-[120px]">
            {selectedIds.size > 0
              ? `${selectedIds.size} ${t('draw.selected', lang)}`
              : t('draw.selectArea', lang)
            }
          </div>
        )}

        {/* Selected drawing hint */}
        {selectedDrawing && !activeMode && !selectMode && (
          <div className="bg-cyan-800/90 rounded px-2 py-1 mt-1 text-[10px] text-cyan-200 max-w-[140px] leading-tight">
            {lang === 'no' ? 'Dra for å flytte. Dra hjørner for å endre. Dobbeltklikk for etikett.' : 'Drag to move. Drag handles to resize. Double-click to edit label.'}
          </div>
        )}

        {/* Not logged in warning */}
        {!user && !activeProjectId && (
          <div className="bg-amber-600/90 rounded px-2 py-1 mt-2 text-[10px] text-white max-w-[120px] text-center">
            {lang === 'no' ? 'Ikke lagret (ikke innlogget)' : 'Not saved (not logged in)'}
          </div>
        )}

        {/* Local drawings count */}
        {localDrawings.length > 0 && (
          <div className="text-[10px] text-center text-amber-400 mt-1">
            {localDrawings.length} {lang === 'no' ? 'lokal' : 'local'}
          </div>
        )}
      </div>}

      {/* Centered no-project warning — below toolbar */}
      {noProjectWarning && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 bg-amber-600/95 backdrop-blur-sm rounded-lg px-5 py-2.5 text-sm text-white leading-snug border border-amber-400/50 shadow-xl text-center pointer-events-none">
          <div className="font-bold">{t('draw.noProject', lang)}</div>
          <div className="mt-0.5 opacity-80 text-xs">{t('draw.noProjectHint', lang)}</div>
        </div>
      )}


      {/* Drawing preview — SVG overlay on top of the map */}
      {(screenPoints.length > 0 || ((activeMode === 'circle' || activeMode === 'ellipse' || activeMode === 'line' || activeMode === 'arrow' || activeMode === 'polygon') && drawPoints.length >= 1 && cursorPoint)) && (
        <svg className="absolute inset-0 pointer-events-none z-[6]" style={{ width: '100%', height: '100%' }}>
          {/* Circle preview — follows cursor after center is placed */}
          {activeMode === 'circle' && screenPoints.length >= 1 && (() => {
            const cx = screenPoints[0].x;
            const cy = screenPoints[0].y;
            let ep = screenPoints.length >= 2 ? screenPoints[screenPoints.length - 1] : null;
            if (!ep && cursorPoint && mapRefValue) {
              try { const p = mapRefValue.project(cursorPoint); ep = { x: p.x, y: p.y }; } catch {}
            }
            if (!ep) return null;
            const r = Math.sqrt((ep.x - cx) ** 2 + (ep.y - cy) ** 2);
            return (
              <>
                <circle cx={cx} cy={cy} r={r} fill={drawColor} fillOpacity="0.12" stroke={drawColor} strokeWidth={drawStrokeWidth} strokeDasharray="8 4" opacity="0.8" />
                <line x1={cx} y1={cy} x2={ep.x} y2={ep.y} stroke={drawColor} strokeWidth="2" strokeDasharray="4 3" opacity="0.5" />
              </>
            );
          })()}
          {/* Ellipse preview — follows cursor after center is placed */}
          {activeMode === 'ellipse' && screenPoints.length >= 1 && (() => {
            const cx = screenPoints[0].x;
            const cy = screenPoints[0].y;
            let ep = screenPoints.length >= 2 ? screenPoints[1] : null;
            if (!ep && cursorPoint && mapRefValue) {
              try { const p = mapRefValue.project(cursorPoint); ep = { x: p.x, y: p.y }; } catch {}
            }
            if (!ep) return null;
            const rx = Math.abs(ep.x - cx);
            const ry = Math.abs(ep.y - cy);
            return (
              <>
                <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={drawColor} fillOpacity="0.12" stroke={drawColor} strokeWidth={drawStrokeWidth} strokeDasharray="8 4" opacity="0.8" />
                <line x1={cx} y1={cy} x2={ep.x} y2={ep.y} stroke={drawColor} strokeWidth="2" strokeDasharray="4 3" opacity="0.5" />
              </>
            );
          })()}
          {/* Polygon preview */}
          {activeMode === 'polygon' && screenPoints.length >= 2 && (
            <polygon
              points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
              fill={drawColor}
              fillOpacity="0.12"
              stroke={drawColor}
              strokeWidth={drawStrokeWidth}
              strokeDasharray="8 4"
              opacity="0.8"
            />
          )}
          {/* Line / arrow preview */}
          {(activeMode === 'line' || activeMode === 'arrow') && screenPoints.length >= 2 && (
            <>
              <polyline
                points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={drawColor}
                strokeWidth={drawStrokeWidth}
                strokeDasharray="8 4"
                opacity="0.8"
              />
              {activeMode === 'arrow' && (() => {
                const p1 = screenPoints[screenPoints.length - 2];
                const p2 = screenPoints[screenPoints.length - 1];
                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                const arrowScale = Math.max(1, drawStrokeWidth / 3);
                const size = 18 * arrowScale;
                const halfW = 10 * arrowScale;
                const tip = p2;
                const leftX = tip.x - size * Math.cos(angle) + halfW * Math.sin(angle);
                const leftY = tip.y - size * Math.sin(angle) - halfW * Math.cos(angle);
                const rightX = tip.x - size * Math.cos(angle) - halfW * Math.sin(angle);
                const rightY = tip.y - size * Math.sin(angle) + halfW * Math.cos(angle);
                return (
                  <polygon
                    points={`${tip.x},${tip.y} ${leftX},${leftY} ${rightX},${rightY}`}
                    fill={drawColor}
                    opacity="0.8"
                  />
                );
              })()}
            </>
          )}
          {/* Cursor preview line: dashed line from last point to cursor */}
          {cursorPoint && mapRefValue && screenPoints.length >= 1 && (activeMode === 'line' || activeMode === 'arrow' || activeMode === 'polygon') && (() => {
            try {
              const cp = mapRefValue.project(cursorPoint);
              const lastPt = screenPoints[screenPoints.length - 1];
              const firstPt = screenPoints[0];
              return (
                <>
                  <line x1={lastPt.x} y1={lastPt.y} x2={cp.x} y2={cp.y}
                    stroke={drawColor} strokeWidth="2" strokeDasharray="6 4" opacity="0.6" />
                  {activeMode === 'polygon' && screenPoints.length >= 2 && (
                    <line x1={cp.x} y1={cp.y} x2={firstPt.x} y2={firstPt.y}
                      stroke={drawColor} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.4" />
                  )}
                </>
              );
            } catch { return null; }
          })()}
          {/* Preview points */}
          {screenPoints.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="5"
              fill={drawColor}
              stroke="white"
              strokeWidth="2"
            />
          ))}
        </svg>
      )}

      {/* Selection rectangle overlay */}
      {selectionRect && (
        <svg className="absolute inset-0 pointer-events-none z-[7]" style={{ width: '100%', height: '100%' }}>
          <rect
            x={Math.min(selectionRect.startX, selectionRect.endX)}
            y={Math.min(selectionRect.startY, selectionRect.endY)}
            width={Math.abs(selectionRect.endX - selectionRect.startX)}
            height={Math.abs(selectionRect.endY - selectionRect.startY)}
            fill="#fbbf24"
            fillOpacity="0.15"
            stroke="#fbbf24"
            strokeWidth="2"
            strokeDasharray="6 3"
          />
        </svg>
      )}

      {/* Vertex handles overlay for selected drawing */}
      {mapRefValue && selectedDrawing && !activeMode && !selectMode && (
        <svg className="absolute inset-0 z-[8]" style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
          {getVertices(selectedDrawing).map((coord, i) => {
            try {
              const pt = mapRefValue.project(coord);
              return (
                <circle
                  key={i}
                  cx={pt.x}
                  cy={pt.y}
                  r="8"
                  fill="white"
                  stroke="#06b6d4"
                  strokeWidth="2.5"
                  style={{ cursor: 'grab', pointerEvents: 'auto' }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const startLngLat = mapRefValue.unproject([pt.x, pt.y]);
                    const ds = {
                      type: 'vertex',
                      vertexIndex: i,
                      drawingId: selectedDrawing.id,
                      startLngLat: [startLngLat.lng, startLngLat.lat],
                      originalGeometry: JSON.parse(JSON.stringify(selectedDrawing.geometry)),
                      isLocal: !!selectedDrawing._local,
                      projectId: selectedDrawing._projectId,
                      drawingType: selectedDrawing.drawingType,
                    };
                    dragStateRef.current = ds;
                    setDragState(ds);
                    mapRefValue.dragPan.disable();
                  }}
                />
              );
            } catch { return null; }
          })}
        </svg>
      )}

      {/* Local drawings SVG overlay (not saved - non-logged-in users) */}
      {mapRefValue && localDrawings.length > 0 && (
        <svg className="absolute inset-0 z-[5]" style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
          {localDrawings.map(d => {
            const color = d.properties?.color || '#3b82f6';
            const sw = d.properties?.strokeWidth || 3;
            const key = d.id;
            const isSelected = selectedDrawingId === d.id;

            const projectCoord = (coord) => {
              try { const p = mapRefValue.project(coord); return { x: p.x, y: p.y }; }
              catch { return null; }
            };

            const projectCoordsLocal = (coords) => coords.map(c => projectCoord(c)).filter(Boolean);

            if (d.geometry.type === 'LineString') {
              const pts = projectCoordsLocal(d.geometry.coordinates);
              if (pts.length < 2) return null;
              const midPt = pts[Math.floor(pts.length / 2)];
              return (
                <g key={key}>
                  {/* Local indicator dot */}
                  <circle cx={pts[0].x} cy={pts[0].y} r="6" fill="#f59e0b" stroke="white" strokeWidth="2" />
                  {/* Selection highlight */}
                  {isSelected && (
                    <polyline
                      points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke="#06b6d4"
                      strokeWidth={sw + 6}
                      strokeDasharray="6 4"
                      opacity="0.6"
                    />
                  )}
                  {/* Invisible wider stroke for easier clicking */}
                  <polyline
                    points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="12"
                  />
                  <polyline
                    points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth={sw}
                    strokeDasharray={d.properties?.lineType === 'dashed' ? '8 4' : 'none'}
                  />
                  {(d.properties?.lineType === 'arrow' || d.drawingType === 'arrow') && (() => {
                    const p1 = pts[pts.length - 2];
                    const p2 = pts[pts.length - 1];
                    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    const arrowScale = Math.max(1, sw / 3);
                    const size = 18 * arrowScale, halfW = 10 * arrowScale;
                    return (
                      <polygon
                        points={`${p2.x},${p2.y} ${p2.x - size * Math.cos(angle) + halfW * Math.sin(angle)},${p2.y - size * Math.sin(angle) - halfW * Math.cos(angle)} ${p2.x - size * Math.cos(angle) - halfW * Math.sin(angle)},${p2.y - size * Math.sin(angle) + halfW * Math.cos(angle)}`}
                        fill={color}
                      />
                    );
                  })()}
                  {d.properties?.label && (
                    <text x={midPt.x} y={midPt.y - 10} textAnchor="middle" fill="#ffffff" fontSize={d.properties?.fontSize || 16} fontWeight="700"
                      stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties.label}</text>
                  )}
                </g>
              );
            }

            if (d.geometry.type === 'Polygon') {
              const ring = d.geometry.coordinates[0];
              const pts = projectCoordsLocal(ring);
              if (pts.length < 3) return null;
              const centroid = {
                x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
                y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
              };
              return (
                <g key={key}>
                  {/* Local indicator dot */}
                  <circle cx={pts[0].x} cy={pts[0].y} r="6" fill="#f59e0b" stroke="white" strokeWidth="2" />
                  {/* Selection highlight */}
                  {isSelected && (
                    <polygon
                      points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke="#06b6d4"
                      strokeWidth={sw + 4}
                      strokeDasharray="6 4"
                      opacity="0.6"
                    />
                  )}
                  <polygon
                    points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                    fill={color}
                    fillOpacity={d.properties?.fillOpacity ?? 0.15}
                    stroke={color}
                    strokeWidth={sw}
                  />
                  {d.properties?.label && (
                    <text x={centroid.x} y={centroid.y} textAnchor="middle" dominantBaseline="central"
                      fill="#ffffff" fontSize={d.properties?.fontSize || 16} fontWeight="700"
                      stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties.label}</text>
                  )}
                </g>
              );
            }

            if (d.geometry.type === 'Point' && d.drawingType === 'text') {
              const pt = projectCoord(d.geometry.coordinates);
              if (!pt) return null;
              return (
                <g key={key}>
                  {/* Local indicator dot */}
                  <circle cx={pt.x - 10} cy={pt.y - 10} r="6" fill="#f59e0b" stroke="white" strokeWidth="2" />
                  {isSelected && (
                    <rect x={pt.x - 30} y={pt.y - 14} width="60" height="28" fill="#06b6d4" fillOpacity="0.2" stroke="#06b6d4" strokeWidth="2" strokeDasharray="4 3" rx="3" />
                  )}
                  <text x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="central"
                    fill="#ffffff" fontSize={d.properties?.fontSize || 18} fontWeight="700"
                    stroke="#000000" strokeWidth="4" paintOrder="stroke">{d.properties?.text || ''}</text>
                </g>
              );
            }

            return null;
          })}
        </svg>
      )}

      {/* CSV Import Dialog */}
      {csvImportOpen && (
        <CsvDrawingImportDialog
          open={csvImportOpen}
          onClose={() => setCsvImportOpen(false)}
          onImport={(items) => {
            const { activeProjectId: projId, activeLayerId: layId } = useTacticalStore.getState();
            const currentUser = useAuthStore.getState().user;
            for (const d of items) {
              if (projId) {
                socket.emit('client:drawing:add', {
                  projectId: projId,
                  drawingType: d.drawingType,
                  geometry: d.geometry,
                  layerId: layId || null,
                  properties: d.properties,
                  source: 'csv-import',
                  createdBy: socket.id,
                });
              } else if (!currentUser) {
                setLocalDrawings((prev) => [...prev, {
                  id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  ...d,
                  _local: true,
                }]);
              }
            }
            setCsvImportOpen(false);
          }}
          defaultColor={drawColor}
          lang={lang}
          mapCenter={mapRefValue?.getCenter() || { lng: 15, lat: 65 }}
        />
      )}
    </>
  );
}
