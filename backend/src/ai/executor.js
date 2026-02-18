import { markers, drawings, layers, saveState } from '../store/index.js';
import { EVENTS } from '../socket/events.js';

const COLOR_MAP = {
  blue: '#3b82f6',
  red: '#ef4444',
  green: '#22c55e',
  black: '#1e293b',
  white: '#ffffff',
};

function circleToPolygon(center, radiusKm, points = 64) {
  const coords = [];
  const [lon, lat] = center;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusKm / 111.32) * Math.cos(angle);
    const dLon = (radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle);
    coords.push([lon + dLon, lat + dLat]);
  }
  return coords;
}

async function fetchRoute(endpoint, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `http://localhost:${process.env.PORT || 3001}/api/route/${endpoint}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Route API error ${res.status}`);
  }
  return res.json();
}

export async function executeTool(name, args, io) {
  switch (name) {
    case 'create_layer': {
      const layer = layers.add({
        name: args.name,
        description: args.description || '',
        source: 'ai',
        createdBy: 'ai',
      });
      io.emit(EVENTS.SERVER_LAYER_ADDED, layer);
      saveState();
      return { success: true, layerId: layer.id, message: `Layer "${args.name}" created` };
    }

    case 'place_marker': {
      const marker = markers.add({
        sidc: args.sidc,
        lat: args.lat,
        lon: args.lon,
        designation: args.designation,
        higherFormation: args.higherFormation || '',
        additionalInfo: args.additionalInfo || '',
        layerId: args.layerId || null,
        source: 'ai',
        createdBy: 'ai',
      });
      io.emit(EVENTS.SERVER_MARKER_ADDED, marker);
      saveState();
      return { success: true, markerId: marker.id, message: `Placed ${args.designation} at [${args.lat}, ${args.lon}]` };
    }

    case 'draw_line': {
      const drawing = drawings.add({
        drawingType: args.lineType === 'arrow' ? 'arrow' : 'line',
        geometry: {
          type: 'LineString',
          coordinates: args.coordinates,
        },
        properties: {
          color: COLOR_MAP[args.color] || args.color,
          label: args.label || '',
          lineType: args.lineType || 'solid',
        },
        layerId: args.layerId || null,
        source: 'ai',
        createdBy: 'ai',
      });
      io.emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
      saveState();
      return { success: true, drawingId: drawing.id, message: `Drew ${args.lineType || 'line'}: ${args.label || ''}` };
    }

    case 'draw_polygon': {
      const coords = [...args.coordinates];
      // Close polygon if not closed
      if (coords.length > 0 && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
        coords.push(coords[0]);
      }
      const drawing = drawings.add({
        drawingType: 'polygon',
        geometry: {
          type: 'Polygon',
          coordinates: [coords],
        },
        properties: {
          color: COLOR_MAP[args.color] || args.color,
          label: args.label || '',
          fillOpacity: args.fillOpacity ?? 0.2,
        },
        layerId: args.layerId || null,
        source: 'ai',
        createdBy: 'ai',
      });
      io.emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
      saveState();
      return { success: true, drawingId: drawing.id, message: `Drew polygon: ${args.label || ''}` };
    }

    case 'draw_circle': {
      const coords = circleToPolygon(args.center, args.radiusKm);
      const drawing = drawings.add({
        drawingType: 'circle',
        geometry: {
          type: 'Polygon',
          coordinates: [coords],
        },
        properties: {
          color: COLOR_MAP[args.color] || args.color,
          label: args.label || '',
          fillOpacity: args.fillOpacity ?? 0.15,
          center: args.center,
          radiusKm: args.radiusKm,
        },
        layerId: args.layerId || null,
        source: 'ai',
        createdBy: 'ai',
      });
      io.emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
      saveState();
      return { success: true, drawingId: drawing.id, message: `Drew circle: ${args.label || ''} (${args.radiusKm}km radius)` };
    }

    case 'place_text': {
      const drawing = drawings.add({
        drawingType: 'text',
        geometry: {
          type: 'Point',
          coordinates: [args.lon, args.lat],
        },
        properties: {
          text: args.text,
          color: COLOR_MAP[args.color] || COLOR_MAP.white,
          label: args.text,
        },
        layerId: args.layerId || null,
        source: 'ai',
        createdBy: 'ai',
      });
      io.emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
      saveState();
      return { success: true, drawingId: drawing.id, message: `Placed text: "${args.text}"` };
    }

    case 'get_road_route': {
      const params = {
        from: `${args.from[1]},${args.from[0]}`,   // [lat,lon] → "lon,lat"
        to: `${args.to[1]},${args.to[0]}`,
      };
      if (args.via?.length) {
        params.via = args.via.map(v => `${v[1]},${v[0]}`).join(';');
      }
      const routeData = await fetchRoute('road', params);
      const drawing = drawings.add({
        drawingType: args.lineType === 'arrow' ? 'arrow' : 'line',
        geometry: {
          type: 'LineString',
          coordinates: routeData.coordinates,
        },
        properties: {
          color: COLOR_MAP[args.color] || args.color,
          label: args.label || '',
          lineType: args.lineType || 'solid',
        },
        layerId: args.layerId || null,
        source: 'ai',
        createdBy: 'ai',
      });
      io.emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
      saveState();
      return {
        success: true,
        drawingId: drawing.id,
        distanceKm: routeData.distanceKm,
        durationMin: routeData.durationMin,
        message: `Road route drawn: ${args.label || ''} (${routeData.distanceKm} km, ~${routeData.durationMin} min)`,
      };
    }

    case 'plan_terrain_route': {
      const params = {
        from: `${args.from[1]},${args.from[0]}`,   // [lat,lon] → "lon,lat"
        to: `${args.to[1]},${args.to[0]}`,
      };
      if (args.via?.length) {
        params.via = args.via.map(v => `${v[1]},${v[0]}`).join(';');
      }
      const routeData = await fetchRoute('terrain', params);
      const drawing = drawings.add({
        drawingType: args.lineType === 'arrow' ? 'arrow' : 'line',
        geometry: {
          type: 'LineString',
          coordinates: routeData.coordinates,
        },
        properties: {
          color: COLOR_MAP[args.color] || args.color,
          label: args.label || '',
          lineType: args.lineType || 'solid',
        },
        layerId: args.layerId || null,
        source: 'ai',
        createdBy: 'ai',
      });
      io.emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
      saveState();
      const profile = routeData.elevationProfile || [];
      const maxElev = profile.reduce((m, p) => Math.max(m, p.elevation || 0), 0);
      const minElev = profile.reduce((m, p) => Math.min(m, p.elevation || Infinity), Infinity);
      return {
        success: true,
        drawingId: drawing.id,
        distanceKm: routeData.distanceKm,
        maxElevation: maxElev,
        minElevation: minElev === Infinity ? 0 : minElev,
        message: `Terrain route drawn: ${args.label || ''} (${routeData.distanceKm} km, elevation ${minElev === Infinity ? 0 : Math.round(minElev)}-${Math.round(maxElev)}m)`,
      };
    }

    case 'search_location': {
      if (!args.query?.trim()) {
        return { results: [], message: 'Empty search query' };
      }
      const url = `http://localhost:${process.env.PORT || 3001}/api/search?q=${encodeURIComponent(args.query.trim())}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Search API error ${res.status}`);
      }
      const results = await res.json();
      return {
        results: results.map(r => ({
          name: r.name, type: r.type, municipality: r.municipality, county: r.county,
          lat: r.lat, lon: r.lon,
        })),
        message: results.length ? `Found ${results.length} result(s) for "${args.query}"` : `No locations found for "${args.query}". Try different spelling.`,
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
