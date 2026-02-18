export const tools = [
  {
    name: 'search_location',
    description: 'Search for a Norwegian location/place name and get its coordinates. ALWAYS use this tool FIRST to look up coordinates for any named location before calling route, marker, or drawing tools.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Place name to search for (e.g., "Storsteinnes", "Oteren", "Bardufoss")',
        },
      },
    },
  },
  {
    name: 'create_layer',
    description: 'Create a named layer to group tactical objects together',
    input_schema: {
      type: 'object',
      required: ['name', 'description'],
      properties: {
        name: { type: 'string', description: 'Layer name (e.g., "OPFOR Disposition", "Phase 1 Objectives")' },
        description: { type: 'string', description: 'Brief description of the layer contents' },
      },
    },
  },
  {
    name: 'place_marker',
    description: 'Place a NATO military symbol on the map',
    input_schema: {
      type: 'object',
      required: ['sidc', 'lat', 'lon', 'designation', 'higherFormation', 'additionalInfo', 'layerId'],
      properties: {
        sidc: { type: 'string', description: '15-character SIDC code (MIL-STD-2525C)' },
        lat: { type: 'number', description: 'Latitude' },
        lon: { type: 'number', description: 'Longitude' },
        designation: { type: 'string', description: 'Unit designation (e.g., "1/Bn Nord", "2. Kompani")' },
        higherFormation: { type: 'string', description: 'Higher formation name (empty string if none)' },
        additionalInfo: { type: 'string', description: 'Additional information (empty string if none)' },
        layerId: { type: ['string', 'null'], description: 'Layer ID to place marker in (null if no specific layer)' },
      },
    },
  },
  {
    name: 'draw_line',
    description: 'Draw a line or arrow on the map (route, phase line, axis of advance). You can draw directly without creating a layer first by passing layerId as null.',
    input_schema: {
      type: 'object',
      required: ['coordinates', 'color', 'label', 'lineType', 'layerId'],
      properties: {
        coordinates: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
          description: 'Array of [lon, lat] coordinate pairs',
        },
        color: { type: 'string', enum: ['blue', 'red', 'green', 'black'], description: 'Line color' },
        label: { type: 'string', description: 'Label for the line (empty string if none)' },
        lineType: { type: 'string', enum: ['solid', 'dashed', 'arrow'], description: 'Line style' },
        layerId: { type: ['string', 'null'], description: 'Layer ID (null if no specific layer)' },
      },
    },
  },
  {
    name: 'draw_polygon',
    description: 'Draw a polygon area on the map (objective, assembly area, engagement area). You can draw directly without creating a layer first by passing layerId as null.',
    input_schema: {
      type: 'object',
      required: ['coordinates', 'color', 'label', 'fillOpacity', 'layerId'],
      properties: {
        coordinates: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
          description: 'Array of [lon, lat] coordinate pairs forming the polygon',
        },
        color: { type: 'string', enum: ['blue', 'red', 'green', 'black'], description: 'Fill color' },
        label: { type: 'string', description: 'Label for the area (empty string if none)' },
        fillOpacity: { type: 'number', description: 'Fill opacity 0-1' },
        layerId: { type: ['string', 'null'], description: 'Layer ID (null if no specific layer)' },
      },
    },
  },
  {
    name: 'draw_circle',
    description: 'Draw a circle on the map (range ring, defense zone, area of influence). You can draw directly without creating a layer first by passing layerId as null.',
    input_schema: {
      type: 'object',
      required: ['center', 'radiusKm', 'color', 'label', 'fillOpacity', 'layerId'],
      properties: {
        center: {
          type: 'array',
          items: { type: 'number' },
          description: '[lon, lat] center point',
        },
        radiusKm: { type: 'number', description: 'Radius in kilometers' },
        color: { type: 'string', enum: ['blue', 'red', 'green', 'black'], description: 'Circle color' },
        label: { type: 'string', description: 'Label for the circle (empty string if none)' },
        fillOpacity: { type: 'number', description: 'Fill opacity 0-1' },
        layerId: { type: ['string', 'null'], description: 'Layer ID (null if no specific layer)' },
      },
    },
  },
  {
    name: 'place_text',
    description: 'Place a text label on the map',
    input_schema: {
      type: 'object',
      required: ['text', 'lat', 'lon', 'color', 'layerId'],
      properties: {
        text: { type: 'string', description: 'Text content' },
        lat: { type: 'number', description: 'Latitude' },
        lon: { type: 'number', description: 'Longitude' },
        color: { type: 'string', enum: ['blue', 'red', 'green', 'black', 'white'], description: 'Text color' },
        layerId: { type: ['string', 'null'], description: 'Layer ID (null if no specific layer)' },
      },
    },
  },
  {
    name: 'get_road_route',
    description: 'Get an accurate road route between locations using real road data. Returns actual road geometry that follows highways and roads. Use this for any vehicle/logistics route, supply line, or movement along roads. The route is automatically drawn on the map.',
    input_schema: {
      type: 'object',
      required: ['from', 'to', 'color', 'label', 'lineType', 'layerId'],
      properties: {
        from: { type: 'array', items: { type: 'number' }, description: '[lat, lon] start point' },
        to: { type: 'array', items: { type: 'number' }, description: '[lat, lon] end point' },
        via: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Optional waypoints [[lat,lon], ...]' },
        color: { type: 'string', enum: ['blue', 'red', 'green', 'black'], description: 'Route color' },
        label: { type: 'string', description: 'Label for the route' },
        lineType: { type: 'string', enum: ['solid', 'dashed', 'arrow'], description: 'Line style' },
        layerId: { type: ['string', 'null'], description: 'Layer ID (null if no specific layer)' },
      },
    },
  },
  {
    name: 'plan_terrain_route',
    description: 'Plan a cross-country route that considers terrain and elevation. Uses elevation data to find passable paths that avoid steep mountains and prefer valleys. Use this for enemy approach routes, infantry movement off-road, flanking maneuvers, or any movement that does not follow roads. The route is automatically drawn on the map.',
    input_schema: {
      type: 'object',
      required: ['from', 'to', 'color', 'label', 'lineType', 'layerId'],
      properties: {
        from: { type: 'array', items: { type: 'number' }, description: '[lat, lon] start point' },
        to: { type: 'array', items: { type: 'number' }, description: '[lat, lon] end point' },
        via: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Optional waypoints to route through [[lat,lon], ...]' },
        color: { type: 'string', enum: ['blue', 'red', 'green', 'black'], description: 'Route color' },
        label: { type: 'string', description: 'Label for the route' },
        lineType: { type: 'string', enum: ['solid', 'dashed', 'arrow'], description: 'Line style' },
        layerId: { type: ['string', 'null'], description: 'Layer ID (null if no specific layer)' },
      },
    },
  },
];
