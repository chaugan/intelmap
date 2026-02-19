import { projectStore } from '../store/project-store.js';
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

export async function executeTool(name, args, io, projectId, viewport) {
  if (!projectId) {
    return { error: 'No active project. Ask the user to select a project first.' };
  }

  const room = `project:${projectId}`;

  switch (name) {
    case 'create_layer': {
      const layer = projectStore.addLayer(projectId, {
        name: args.name,
        description: args.description || '',
        source: 'ai',
        createdBy: 'ai',
      });
      io.to(room).emit(EVENTS.SERVER_LAYER_ADDED, layer);
      return { success: true, layerId: layer.id, message: `Layer "${args.name}" created` };
    }

    case 'place_marker': {
      const marker = projectStore.addMarker(projectId, {
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
      io.to(room).emit(EVENTS.SERVER_MARKER_ADDED, marker);
      return { success: true, markerId: marker.id, message: `Placed ${args.designation} at [${args.lat}, ${args.lon}]` };
    }

    case 'draw_line': {
      const drawing = projectStore.addDrawing(projectId, {
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
      io.to(room).emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
      return { success: true, drawingId: drawing.id, message: `Drew ${args.lineType || 'line'}: ${args.label || ''}` };
    }

    case 'draw_polygon': {
      const coords = [...args.coordinates];
      if (coords.length > 0 && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
        coords.push(coords[0]);
      }
      const drawing = projectStore.addDrawing(projectId, {
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
      io.to(room).emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
      return { success: true, drawingId: drawing.id, message: `Drew polygon: ${args.label || ''}` };
    }

    case 'draw_circle': {
      const coords = circleToPolygon(args.center, args.radiusKm);
      const drawing = projectStore.addDrawing(projectId, {
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
      io.to(room).emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
      return { success: true, drawingId: drawing.id, message: `Drew circle: ${args.label || ''} (${args.radiusKm}km radius)` };
    }

    case 'place_text': {
      const drawing = projectStore.addDrawing(projectId, {
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
      io.to(room).emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
      return { success: true, drawingId: drawing.id, message: `Placed text: "${args.text}"` };
    }

    case 'get_road_route': {
      const params = {
        from: `${args.from[1]},${args.from[0]}`,
        to: `${args.to[1]},${args.to[0]}`,
      };
      if (args.via?.length) {
        params.via = args.via.map(v => `${v[1]},${v[0]}`).join(';');
      }
      const routeData = await fetchRoute('road', params);
      const drawing = projectStore.addDrawing(projectId, {
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
      io.to(room).emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
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
        from: `${args.from[1]},${args.from[0]}`,
        to: `${args.to[1]},${args.to[0]}`,
      };
      if (args.via?.length) {
        params.via = args.via.map(v => `${v[1]},${v[0]}`).join(';');
      }
      const routeData = await fetchRoute('terrain', params);
      const drawing = projectStore.addDrawing(projectId, {
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
      io.to(room).emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
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

    case 'overpass_search': {
      let query = args.query;
      if (viewport?.bounds) {
        const { south, west, north, east } = viewport.bounds;
        query = query.replace(/\{\{bbox\}\}/g, `${south},${west},${north},${east}`);
      }

      const overpassUrl = 'https://overpass-api.de/api/interpreter';
      const overpassRes = await fetch(overpassUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!overpassRes.ok) throw new Error(`Overpass API error ${overpassRes.status}`);
      const data = await overpassRes.json();

      const elements = data.elements || [];
      const overpassResults = elements.slice(0, 50).map(el => {
        // Get coordinates: node has lat/lon directly, way/relation needs center or geometry
        let lat = el.lat ?? el.center?.lat;
        let lon = el.lon ?? el.center?.lon;
        // For ways with geometry (out geom;), compute centroid from bounds or first node
        if (lat == null && el.bounds) {
          lat = (el.bounds.minlat + el.bounds.maxlat) / 2;
          lon = (el.bounds.minlon + el.bounds.maxlon) / 2;
        }
        if (lat == null && el.geometry?.length) {
          lat = el.geometry[0].lat;
          lon = el.geometry[0].lon;
        }
        const name = el.tags?.name || el.tags?.ref || null;
        // Extract geometry coordinates for ways (for drawing lines/polygons)
        let geometry = null;
        if (el.geometry?.length) {
          geometry = el.geometry.map(p => [p.lon, p.lat]);
        }
        return {
          name,
          type: el.tags?.amenity || el.tags?.building || el.tags?.highway || el.tags?.power || el.type,
          lat,
          lon,
          tags: el.tags,
          ...(geometry && { geometry }),
        };
      }).filter(r => r.lat != null && r.lon != null);

      let message;
      if (overpassResults.length) {
        message = `Found ${elements.length} element(s), returning top ${overpassResults.length} with coordinates`;
      } else if (elements.length > 0) {
        message = `Found ${elements.length} element(s) but none had coordinates. For ways/relations, use "out center;" or "out geom;" instead of "out;" to get coordinates. Retry the query with "out center;" appended.`;
      } else {
        message = 'No results found. Try broadening the query area or adjusting tag filters.';
      }

      return {
        results: overpassResults,
        count: elements.length,
        message,
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
