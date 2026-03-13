import { useState, useEffect, useCallback } from 'react';
import { useMapStore, getThemeState } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { useProjectStore } from '../../stores/useProjectStore.js';
import { t } from '../../lib/i18n.js';
import { socket } from '../../lib/socket.js';
import { getSymbolName } from '../../lib/symbol-lookup.js';
import { generateSymbolSvg } from '../../lib/milsymbol-utils.js';
import QRCodeOverlay from '../common/QRCodeOverlay.jsx';
import { InfrastructureLegend } from './InfrastructureLayer.jsx';
import { useInfrastructure } from '../../hooks/useInfrastructure.js';

const OVERLAYS = [
  { id: 'aurora', toggleKey: 'toggleAurora', visibleKey: 'auroraVisible', opacityKey: 'auroraOpacity', setOpacityKey: 'setAuroraOpacity', accent: 'accent-green-500', shortcut: 'N' },
  { id: 'sunlight', toggleKey: 'toggleSunlight', visibleKey: 'sunlightVisible', opacityKey: 'sunlightOpacity', setOpacityKey: 'setSunlightOpacity', accent: 'accent-yellow-500', shortcut: 'H' },
  { id: 'wind', toggleKey: 'toggleWind', visibleKey: 'windVisible', opacityKey: 'windOpacity', setOpacityKey: 'setWindOpacity', accent: 'accent-emerald-500', shortcut: 'W' },
  { id: 'webcams', toggleKey: 'toggleWebcams', visibleKey: 'webcamsVisible', opacityKey: null, setOpacityKey: null, accent: null, shortcut: 'C' },
  { id: 'trafficFlow', toggleKey: 'toggleTrafficFlow', visibleKey: 'trafficFlowVisible', opacityKey: 'trafficFlowOpacity', setOpacityKey: 'setTrafficFlowOpacity', accent: 'accent-green-500', shortcut: 'Q' },
  { id: 'trafficInfo', toggleKey: 'toggleTrafficInfo', visibleKey: 'trafficInfoVisible', opacityKey: 'trafficInfoOpacity', setOpacityKey: 'setTrafficInfoOpacity', accent: 'accent-orange-500', shortcut: 'R' },
  { id: 'avalanche', toggleKey: 'toggleAvalanche', visibleKey: 'avalancheVisible', opacityKey: null, setOpacityKey: null, accent: null, shortcut: 'A' },
  { id: 'avalancheWarnings', toggleKey: 'toggleAvalancheWarnings', visibleKey: 'avalancheWarningsVisible', opacityKey: 'avalancheWarningsOpacity', setOpacityKey: 'setAvalancheWarningsOpacity', accent: 'accent-orange-500', shortcut: 'V' },
  { id: 'snowDepth', toggleKey: 'toggleSnowDepth', visibleKey: 'snowDepthVisible', opacityKey: 'snowDepthOpacity', setOpacityKey: 'setSnowDepthOpacity', accent: 'accent-blue-500', shortcut: 'S' },
  { id: 'aircraft', toggleKey: 'toggleAircraft', visibleKey: 'aircraftVisible', opacityKey: 'aircraftOpacity', setOpacityKey: 'setAircraftOpacity', accent: 'accent-amber-500', shortcut: 'F' },
  { id: 'vessels', toggleKey: 'toggleVessels', visibleKey: 'vesselsVisible', opacityKey: 'vesselsOpacity', setOpacityKey: 'setVesselsOpacity', accent: 'accent-cyan-500', shortcut: 'B' },
  { id: 'roadRestrictions', toggleKey: 'toggleRoadRestrictions', visibleKey: 'roadRestrictionsVisible', opacityKey: 'roadRestrictionsOpacity', setOpacityKey: 'setRoadRestrictionsOpacity', accent: 'accent-orange-500', shortcut: 'X' },
  { id: 'infra', toggleKey: 'toggleInfra', visibleKey: 'infraVisible', opacityKey: 'infraOpacity', setOpacityKey: 'setInfraOpacity', accent: 'accent-indigo-500', shortcut: 'K', requiresInfraview: true },
];

const OVERLAY_LABELS = {
  aurora: { no: 'Nordlys', en: 'Aurora' },
  sunlight: { no: 'Sollys/Skygge', en: 'Sun/Shadow' },
  wind: { no: 'Vind', en: 'Wind' },
  webcams: { no: 'Webkameraer', en: 'Webcams' },
  trafficFlow: { no: 'Trafikkflyt', en: 'Traffic Flow' },
  trafficInfo: { no: 'Trafikkmeldinger', en: 'Traffic Info' },
  snowDepth: { no: 'Snødybde', en: 'Snow Depth' },
  avalanche: { no: 'Skredterreng', en: 'Aval. Terrain' },
  avalancheWarnings: { no: 'Skredvarsel', en: 'Aval. Warnings' },
  aircraft: { no: 'Luftfart', en: 'Aircraft' },
  vessels: { no: 'Fartøy', en: 'Vessels' },
  roadRestrictions: { no: 'Vegrestriksjoner', en: 'Road Restrictions' },
  infra: { no: 'Infrastruktur', en: 'Infrastructure' },
};

// Drawing type icons for the tactical item list
const DRAWING_ICONS = {
  line: '/',
  arrow: '\u2192',
  polygon: '\u2B21',
  circle: '\u25EF',
  ellipse: '\u2B2D',
  text: 'T',
  needle: '\uD83D\uDCCD',
  note: '\uD83D\uDCDD',
};

function getDrawingLabel(d, lang) {
  if (d.drawingType === 'text' && d.properties?.text) return d.properties.text;
  if (d.properties?.label) return d.properties.label;
  if (d.drawingType === 'note' && d.properties?.markdown) {
    const preview = d.properties.markdown.replace(/[#*_~`>\-|]/g, '').trim();
    return preview.length > 30 ? preview.slice(0, 30) + '…' : preview;
  }
  const typeLabels = {
    line: { en: 'Line', no: 'Linje' },
    arrow: { en: 'Arrow', no: 'Pil' },
    polygon: { en: 'Polygon', no: 'Polygon' },
    circle: { en: 'Circle', no: 'Sirkel' },
    ellipse: { en: 'Ellipse', no: 'Ellipse' },
    text: { en: 'Text', no: 'Tekst' },
    needle: { en: 'Pin', no: 'Nål' },
    note: { en: 'Note', no: 'Notat' },
  };
  return typeLabels[d.drawingType]?.[lang] || d.drawingType || 'Drawing';
}

function getDrawingCenter(d) {
  if (d.geometry.type === 'Point') return d.geometry.coordinates;
  if (d.geometry.type === 'LineString') {
    return d.geometry.coordinates[Math.floor(d.geometry.coordinates.length / 2)];
  }
  if (d.geometry.type === 'Polygon') {
    const ring = d.geometry.coordinates[0];
    const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    return [lng, lat];
  }
  return null;
}

function TacticalSection({ lang }) {
  const projects = useTacticalStore((s) => s.projects);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const setActiveLayer = useTacticalStore((s) => s.setActiveLayer);
  const layerVisibility = useTacticalStore((s) => s.layerVisibility);
  const toggleLayerVisibility = useTacticalStore((s) => s.toggleLayerVisibility);
  const myProjects = useProjectStore((s) => s.myProjects);
  const mapRef = useMapStore((s) => s.mapRef);

  const [expandedProject, setExpandedProject] = useState(null);
  const [expandedLayerId, setExpandedLayerId] = useState(null);
  const [expandedUnassigned, setExpandedUnassigned] = useState(null);
  const [copyingMarkerId, setCopyingMarkerId] = useState(null);

  const copyTargets = myProjects
    .filter((p) => visibleProjectIds.includes(p.id) && (p.role === 'admin' || p.role === 'editor'))
    .map((p) => ({
      projectId: p.id,
      projectName: p.name,
      layers: projects[p.id]?.layers || [],
    }));

  const handleCopyMarker = useCallback((marker, targetProjectId, targetLayerId) => {
    socket.emit('client:marker:add', {
      projectId: targetProjectId,
      layerId: targetLayerId || null,
      sidc: marker.sidc,
      lat: marker.lat,
      lon: marker.lon,
      designation: marker.designation || '',
      higherFormation: marker.higherFormation || '',
      additionalInfo: marker.additionalInfo || '',
      customLabel: marker.customLabel || '',
    });
    setCopyingMarkerId(null);
  }, []);

  const flyTo = (coords) => {
    if (!mapRef || !coords) return;
    mapRef.flyTo({ center: coords, zoom: Math.max(mapRef.getZoom(), 14), duration: 1200 });
  };

  const visibleProjects = visibleProjectIds
    .map((id) => ({ id, meta: myProjects.find((p) => p.id === id), data: projects[id] }))
    .filter((p) => p.data);

  if (visibleProjects.length === 0) return null;

  return (
    <div className="px-3 py-2.5 border-b border-slate-700">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2 font-semibold">
        {lang === 'no' ? 'Taktiske lag' : 'Tactical Layers'}
      </div>
      <div className="space-y-1">
        {visibleProjects.map(({ id: pId, meta, data }) => {
          const expanded = expandedProject === pId;
          const isActive = activeProjectId === pId;
          return (
            <div key={pId}>
              <div
                className={`flex items-center gap-1.5 text-xs rounded px-1.5 py-1 cursor-pointer hover:bg-slate-700/40 transition-colors ${isActive ? 'bg-emerald-900/20' : ''}`}
                onClick={() => setExpandedProject(expanded ? null : pId)}
              >
                <svg className={`w-2.5 h-2.5 transition-transform flex-shrink-0 text-slate-500 ${expanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6 4l8 6-8 6V4z" />
                </svg>
                <span className={`flex-1 truncate ${isActive ? 'text-emerald-300 font-medium' : 'text-slate-300'}`}>
                  {meta?.name || pId.slice(0, 8)}
                </span>
                <span className="text-[10px] text-slate-600">
                  {data.markers.length}m {data.drawings.length}d
                </span>
              </div>
              {expanded && (
                <div className="ml-3 mt-0.5 space-y-0.5">
                  {data.layers.map((layer) => {
                    const vis = layerVisibility[layer.id] !== false;
                    const isActiveLayer = isActive && activeLayerId === layer.id;
                    const layerMarkers = data.markers.filter((m) => m.layerId === layer.id);
                    const layerDrawings = data.drawings.filter((d) => d.layerId === layer.id);
                    const mCount = layerMarkers.length;
                    const dCount = layerDrawings.length;
                    const isLayerExpanded = expandedLayerId === layer.id;
                    const hasItems = mCount + dCount > 0;
                    return (
                      <div key={layer.id}>
                        <div className={`flex items-center gap-1.5 text-[11px] rounded px-1 py-0.5 ${isActiveLayer ? 'bg-emerald-900/30 ring-1 ring-emerald-500/40' : ''}`}>
                          <input
                            type="checkbox"
                            checked={vis}
                            onChange={() => toggleLayerVisibility(layer.id)}
                            className="accent-emerald-500 w-3 h-3"
                          />
                          {hasItems ? (
                            <button
                              onClick={() => setExpandedLayerId(isLayerExpanded ? null : layer.id)}
                              className="w-3 h-3 flex-shrink-0 flex items-center justify-center text-slate-500 hover:text-slate-300"
                            >
                              <svg className={`w-2.5 h-2.5 transition-transform ${isLayerExpanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                                <path d="M6 4l8 6-8 6V4z" />
                              </svg>
                            </button>
                          ) : (
                            <span className="w-3 h-3 flex-shrink-0" />
                          )}
                          <span
                            className={`flex-1 truncate cursor-pointer ${isActiveLayer ? 'text-emerald-300 font-medium' : 'text-slate-300 hover:text-white'}`}
                            onClick={() => { if (isActive) setActiveLayer(isActiveLayer ? null : layer.id); }}
                          >
                            {isActiveLayer && '\u25B8 '}{layer.name}
                          </span>
                          <span
                            className={`text-slate-500 cursor-pointer hover:text-slate-300 ${hasItems ? '' : 'opacity-50'}`}
                            onClick={() => hasItems && setExpandedLayerId(isLayerExpanded ? null : layer.id)}
                          >
                            {mCount}m {dCount}d
                          </span>
                        </div>
                        {isLayerExpanded && (
                          <div className="ml-5 mt-0.5 mb-1 border-l border-slate-700 pl-1.5">
                            <TacticalItemList
                              markers={layerMarkers}
                              drawings={layerDrawings}
                              lang={lang}
                              projectId={pId}
                              flyTo={flyTo}
                              copyTargets={copyTargets}
                              copyingMarkerId={copyingMarkerId}
                              setCopyingMarkerId={setCopyingMarkerId}
                              onCopyMarker={handleCopyMarker}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Unassigned items */}
                  {(() => {
                    const unMarkers = data.markers.filter((m) => !m.layerId);
                    const unDrawings = data.drawings.filter((d) => !d.layerId);
                    if (unMarkers.length + unDrawings.length === 0) return null;
                    const isUnExpanded = expandedUnassigned === pId;
                    return (
                      <div>
                        <div
                          className="flex items-center gap-1.5 text-[11px] text-slate-500 italic px-1 cursor-pointer hover:text-slate-400"
                          onClick={() => setExpandedUnassigned(isUnExpanded ? null : pId)}
                        >
                          <svg className={`w-2.5 h-2.5 transition-transform flex-shrink-0 ${isUnExpanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                            <path d="M6 4l8 6-8 6V4z" />
                          </svg>
                          {lang === 'no' ? 'Uten lag' : 'Unassigned'}: {unMarkers.length}m {unDrawings.length}d
                        </div>
                        {isUnExpanded && (
                          <div className="ml-5 mt-0.5 mb-1 border-l border-slate-700 pl-1.5">
                            <TacticalItemList
                              markers={unMarkers}
                              drawings={unDrawings}
                              lang={lang}
                              projectId={pId}
                              flyTo={flyTo}
                              copyTargets={copyTargets}
                              copyingMarkerId={copyingMarkerId}
                              setCopyingMarkerId={setCopyingMarkerId}
                              onCopyMarker={handleCopyMarker}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TacticalItemList({ markers, drawings, lang, projectId, flyTo, copyTargets, copyingMarkerId, setCopyingMarkerId, onCopyMarker }) {
  if (markers.length === 0 && drawings.length === 0) {
    return <div className="text-[10px] text-slate-600 italic pl-2 py-0.5">{lang === 'no' ? 'Tomt' : 'Empty'}</div>;
  }

  return (
    <div className="space-y-px pl-1.5 max-h-48 overflow-y-auto">
      {markers.map((m) => {
        const name = m.designation || m.customLabel || getSymbolName(m.sidc, lang);
        const sym = generateSymbolSvg(m.sidc, { size: 16 });
        const isCopying = copyingMarkerId === m.id;
        return (
          <div key={m.id} className="relative">
            <div className="flex items-center gap-1.5 text-[11px] group/item rounded px-1 py-0.5 hover:bg-slate-700/50">
              <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center" dangerouslySetInnerHTML={{ __html: sym.svg }} />
              <span
                className="flex-1 truncate text-slate-300 cursor-pointer hover:text-white"
                onClick={() => flyTo([m.lon, m.lat])}
                title={name}
              >
                {name}
              </span>
              <button
                onClick={() => flyTo([m.lon, m.lat])}
                className="shrink-0 text-slate-600 hover:text-cyan-400 transition-colors"
                title={lang === 'no' ? 'Fly til' : 'Fly to'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
              {copyTargets && onCopyMarker && (
                <button
                  onClick={(e) => { e.stopPropagation(); setCopyingMarkerId(isCopying ? null : m.id); }}
                  className="shrink-0 text-slate-600 hover:text-amber-400 transition-colors"
                  title={lang === 'no' ? 'Kopier til lag' : 'Copy to layer'}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => socket.emit('client:marker:delete', { projectId, id: m.id })}
                className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"
                title={lang === 'no' ? 'Slett' : 'Delete'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {isCopying && copyTargets && (
              <div className="absolute right-0 top-5 z-50 bg-slate-800 border border-slate-600 rounded shadow-xl py-1 min-w-[160px] text-[11px] max-h-48 overflow-y-auto">
                {copyTargets.map((ct) => (
                  <div key={ct.projectId}>
                    <div className="px-2 py-0.5 text-slate-500 font-medium truncate">{ct.projectName}</div>
                    <button
                      onClick={() => onCopyMarker(m, ct.projectId, null)}
                      className="w-full text-left px-3 py-0.5 hover:bg-slate-700 text-slate-400 italic"
                    >
                      {lang === 'no' ? '(Intet lag)' : '(No layer)'}
                    </button>
                    {ct.layers.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => onCopyMarker(m, ct.projectId, l.id)}
                        className="w-full text-left px-3 py-0.5 hover:bg-slate-700 text-slate-300 truncate"
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {drawings.map((d) => {
        const label = getDrawingLabel(d, lang);
        const icon = DRAWING_ICONS[d.drawingType] || '?';
        const center = getDrawingCenter(d);
        const color = d.properties?.color || '#3b82f6';
        return (
          <div key={d.id} className="flex items-center gap-1.5 text-[11px] group/item rounded px-1 py-0.5 hover:bg-slate-700/50">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-xs font-bold rounded" style={{ color }}>{icon}</span>
            <span
              className="flex-1 truncate text-slate-300 cursor-pointer hover:text-white"
              onClick={() => flyTo(center)}
              title={label}
            >
              {label}
            </span>
            <button
              onClick={() => flyTo(center)}
              className="shrink-0 text-slate-600 hover:text-cyan-400 transition-colors"
              title={lang === 'no' ? 'Fly til' : 'Fly to'}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
            <button
              onClick={() => socket.emit('client:drawing:delete-batch', { projectId, ids: [d.id] })}
              className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"
              title={lang === 'no' ? 'Slett' : 'Delete'}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SunlightControls({ lang }) {
  const sunlightDate = useMapStore((s) => s.sunlightDate);
  const sunlightTime = useMapStore((s) => s.sunlightTime);
  const sunlightAnimating = useMapStore((s) => s.sunlightAnimating);
  const sunlightAnimationSpeed = useMapStore((s) => s.sunlightAnimationSpeed);
  const setSunlightDate = useMapStore((s) => s.setSunlightDate);
  const setSunlightTime = useMapStore((s) => s.setSunlightTime);
  const toggleSunlightAnimation = useMapStore((s) => s.toggleSunlightAnimation);
  const setSunlightAnimationSpeed = useMapStore((s) => s.setSunlightAnimationSpeed);

  const hours = Math.floor(sunlightTime / 60);
  const mins = Math.floor(sunlightTime % 60);
  const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

  return (
    <div className="ml-8 mt-1 space-y-1.5">
      {/* Date */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-400 w-8">{lang === 'no' ? 'Dato' : 'Date'}</span>
        <input
          type="date"
          value={sunlightDate}
          onChange={(e) => setSunlightDate(e.target.value)}
          className="flex-1 px-1.5 py-0.5 bg-slate-900 border border-slate-600 rounded text-[11px] text-white focus:outline-none focus:border-yellow-500 [color-scheme:dark]"
        />
      </div>
      {/* Time slider */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-400 w-8">{lang === 'no' ? 'Tid' : 'Time'}</span>
        <input
          type="range"
          min="0"
          max="1439"
          step="1"
          value={Math.floor(sunlightTime)}
          onChange={(e) => setSunlightTime(parseInt(e.target.value))}
          className="flex-1 h-1 accent-yellow-500"
        />
        <span className="text-[10px] text-white w-10 text-right font-mono">{timeStr}</span>
      </div>
      {/* Play/pause + speed */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSunlightAnimation}
          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
            sunlightAnimating ? 'bg-yellow-600 text-white' : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
          }`}
        >
          {sunlightAnimating ? '⏸' : '▶'}
        </button>
        {[1, 10, 60].map((spd) => (
          <button
            key={spd}
            onClick={() => setSunlightAnimationSpeed(spd)}
            className={`px-1.5 py-0.5 rounded text-[10px] ${
              sunlightAnimationSpeed === spd
                ? 'bg-yellow-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
          >
            {spd}x
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DataLayersDrawer() {
  const lang = useMapStore((s) => s.lang);
  const toggleDataLayersDrawer = useMapStore((s) => s.toggleDataLayersDrawer);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const canInfra = user?.infraviewEnabled || isAdmin;

  // Filter overlays based on permissions
  const visibleOverlays = OVERLAYS.filter(o => !o.requiresInfraview || canInfra);

  // Infra layer list for legend
  const infraVisible = useMapStore((s) => s.infraVisible);
  const { layerList: infraLayerList } = useInfrastructure(infraVisible && canInfra);

  // Overlay state
  const store = useMapStore();
  const overlayOrder = useMapStore((s) => s.overlayOrder);
  const moveOverlayUp = useMapStore((s) => s.moveOverlayUp);
  const moveOverlayDown = useMapStore((s) => s.moveOverlayDown);
  const applyTheme = useMapStore((s) => s.applyTheme);

  // Theme state
  const [themes, setThemes] = useState([]);
  const [themeName, setThemeName] = useState('');
  const [themeLoading, setThemeLoading] = useState(false);
  const [includePosition, setIncludePosition] = useState(false);
  const [sharingThemeId, setSharingThemeId] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [userGroups, setUserGroups] = useState([]);
  const [qrOverlayTheme, setQrOverlayTheme] = useState(null);

  // Fetch themes on mount (always - public themes visible to all)
  // Fetch groups only when logged in
  useEffect(() => {
    fetchThemes();
    if (user) fetchUserGroups();
  }, [user]);

  const fetchThemes = async () => {
    try {
      const res = await fetch('/api/themes', { credentials: 'include' });
      if (res.ok) setThemes(await res.json());
    } catch { /* ignore */ }
  };

  const fetchUserGroups = async () => {
    try {
      const res = await fetch('/api/groups', { credentials: 'include' });
      if (res.ok) setUserGroups(await res.json());
    } catch { /* ignore */ }
  };

  const handleSaveTheme = async () => {
    if (!themeName.trim()) return;
    setThemeLoading(true);
    try {
      const res = await fetch('/api/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: themeName.trim(), state: getThemeState(includePosition) }),
      });
      if (res.ok) {
        setThemeName('');
        setIncludePosition(false);
        await fetchThemes();
      }
    } catch { /* ignore */ }
    setThemeLoading(false);
  };

  // Toggle position on an existing theme
  const handleToggleThemePosition = async (theme) => {
    const hasPosition = !!theme.state?.position;
    const newState = { ...theme.state };
    if (hasPosition) {
      delete newState.position;
    } else {
      const s = useMapStore.getState();
      const map = s.mapRef;
      newState.position = {
        longitude: s.longitude,
        latitude: s.latitude,
        zoom: s.zoom,
        pitch: map?.getPitch() || 0,
        bearing: map?.getBearing() || 0,
      };
    }
    try {
      const res = await fetch(`/api/themes/${theme.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ state: newState }),
      });
      if (res.ok) {
        await fetchThemes();
      }
    } catch { /* ignore */ }
  };

  // Update/overwrite theme with current map state
  const handleUpdateTheme = async (theme) => {
    const hasPosition = !!theme.state?.position;
    const newState = getThemeState(hasPosition);
    try {
      const res = await fetch(`/api/themes/${theme.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ state: newState }),
      });
      if (res.ok) {
        await fetchThemes();
      }
    } catch { /* ignore */ }
  };

  const handleShareTheme = async (themeId) => {
    if (!selectedGroupId) return;

    // Handle "Anyone" (public) sharing
    if (selectedGroupId === '__anyone__') {
      try {
        const res = await fetch(`/api/themes/${themeId}/public`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ isPublic: true }),
        });
        if (res.ok) {
          setSharingThemeId(null);
          setSelectedGroupId('');
          await fetchThemes();
        }
      } catch { /* ignore */ }
      return;
    }

    // Regular group sharing
    try {
      const res = await fetch(`/api/themes/${themeId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ groupId: selectedGroupId }),
      });
      if (res.ok) {
        setSharingThemeId(null);
        setSelectedGroupId('');
        await fetchThemes();
      }
    } catch { /* ignore */ }
  };

  const handleUnshareTheme = async (themeId, groupId) => {
    try {
      const res = await fetch(`/api/themes/${themeId}/share/${groupId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) await fetchThemes();
    } catch { /* ignore */ }
  };

  const handleRemovePublic = async (themeId) => {
    try {
      const res = await fetch(`/api/themes/${themeId}/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isPublic: false }),
      });
      if (res.ok) await fetchThemes();
    } catch { /* ignore */ }
  };

  const handleDeleteTheme = async (id) => {
    try {
      const res = await fetch(`/api/themes/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) setThemes((prev) => prev.filter((t) => t.id !== id));
    } catch { /* ignore */ }
  };

  const handleApplyTheme = (theme) => {
    applyTheme(theme.state);
  };

  // Active overlays for z-order
  const activeOverlayIds = visibleOverlays.filter((o) => store[o.visibleKey]).map((o) => o.id);

  // Show themes section if logged in OR there are public themes
  const showThemesSection = user || themes.some(t => t.isPublic);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-slate-700 shrink-0 flex items-center justify-between">
        <h2 className="text-base font-semibold text-emerald-400">
          {t('dataLayers.title', lang)}
        </h2>
        <button
          onClick={toggleDataLayersDrawer}
          className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-white rounded hover:bg-slate-700 transition-colors"
          title={t('general.close', lang)}
        >
          &times;
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Overlays section */}
        <div className="px-3 py-2.5 border-b border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">
              {t('dataLayers.overlays', lang)}
            </span>
            {/* Hide all data layers button */}
            {visibleOverlays.some((o) => store[o.visibleKey]) && (
              <button
                onClick={store.hideAllDataLayers}
                className="text-[10px] text-slate-500 hover:text-red-400 transition-colors"
                title={lang === 'no' ? 'Skjul alle' : 'Hide all'}
              >
                {lang === 'no' ? 'Skjul alle' : 'Hide all'}
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {visibleOverlays.map((overlay) => {
              const visible = store[overlay.visibleKey];
              const toggle = store[overlay.toggleKey];
              const opacity = overlay.opacityKey ? store[overlay.opacityKey] : null;
              const setOpacity = overlay.setOpacityKey ? store[overlay.setOpacityKey] : null;

              return (
                <div key={overlay.id}>
                  <div className="flex items-center gap-2">
                    {/* Eye toggle */}
                    <button
                      onClick={toggle}
                      title={overlay.shortcut}
                      className={`w-6 h-6 flex items-center justify-center rounded cursor-pointer ${visible ? 'text-emerald-400' : 'text-slate-600'}`}
                    >
                      {visible ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                          <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                        </svg>
                      )}
                    </button>
                    <button onClick={toggle} className={`text-sm flex-1 text-left cursor-pointer ${visible ? 'text-slate-200' : 'text-slate-500'}`}>
                      {OVERLAY_LABELS[overlay.id]?.[lang] || overlay.id}
                    </button>
                  </div>
                  {/* Opacity slider (when visible and has opacity) */}
                  {visible && setOpacity && (
                    <div className="flex items-center gap-2 ml-8 mt-0.5">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={opacity}
                        onChange={(e) => setOpacity(parseFloat(e.target.value))}
                        className={`flex-1 h-1 ${overlay.accent}`}
                      />
                      <span className="text-[10px] text-slate-500 w-7 text-right">{Math.round(opacity * 100)}%</span>
                    </div>
                  )}
                  {/* Sunlight expanded controls */}
                  {overlay.id === 'sunlight' && visible && (
                    <SunlightControls lang={lang} />
                  )}
                  {/* Infrastructure sublayer legend */}
                  {overlay.id === 'infra' && visible && infraLayerList.length > 0 && (
                    <div className="ml-6">
                      <InfrastructureLegend layerList={infraLayerList} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Terrain section */}
        <div className="px-3 py-2.5 border-b border-slate-700">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2 font-semibold">
            {t('terrain.section', lang)}
          </div>
          <div className="space-y-1.5">
            {/* Hillshade */}
            <div>
              <div className="flex items-center gap-2">
                <button
                  onClick={store.toggleHillshade}
                  title="G"
                  className={`w-6 h-6 flex items-center justify-center rounded cursor-pointer ${store.hillshadeVisible ? 'text-emerald-400' : 'text-slate-600'}`}
                >
                  {store.hillshadeVisible ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                      <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                    </svg>
                  )}
                </button>
                <button onClick={store.toggleHillshade} className={`text-sm flex-1 text-left cursor-pointer ${store.hillshadeVisible ? 'text-slate-200' : 'text-slate-500'}`}>
                  {t('terrain.hillshade', lang)}
                </button>
              </div>
              {store.hillshadeVisible && (
                <div className="flex items-center gap-2 ml-8 mt-0.5">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={store.hillshadeOpacity}
                    onChange={(e) => store.setHillshadeOpacity(parseFloat(e.target.value))}
                    className="flex-1 h-1 accent-stone-500"
                  />
                  <span className="text-[10px] text-slate-500 w-7 text-right">{Math.round(store.hillshadeOpacity * 100)}%</span>
                </div>
              )}
            </div>
            {/* 3D Terrain */}
            <div>
              <div className="flex items-center gap-2">
                <button
                  onClick={store.toggleTerrain}
                  title="T"
                  className={`w-6 h-6 flex items-center justify-center rounded cursor-pointer ${store.terrainVisible ? 'text-emerald-400' : 'text-slate-600'}`}
                >
                  {store.terrainVisible ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                      <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                    </svg>
                  )}
                </button>
                <button onClick={store.toggleTerrain} className={`text-sm flex-1 text-left cursor-pointer ${store.terrainVisible ? 'text-slate-200' : 'text-slate-500'}`}>
                  {t('terrain.3d', lang)}
                </button>
              </div>
              {store.terrainVisible && (
                <div className="flex items-center gap-2 ml-8 mt-0.5">
                  <input
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.1"
                    value={store.terrainExaggeration}
                    onChange={(e) => store.setTerrainExaggeration(parseFloat(e.target.value))}
                    className="flex-1 h-1 accent-stone-500"
                  />
                  <span className="text-[10px] text-slate-500 w-7 text-right">{store.terrainExaggeration.toFixed(1)}x</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Z-Order section (only when 2+ overlays active) */}
        {activeOverlayIds.length >= 2 && (
          <div className="px-3 py-2.5 border-b border-slate-700">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2 font-semibold">
              {lang === 'no' ? 'Lag-rekkefølge (øverst → nederst)' : 'Layer order (top → bottom)'}
            </div>
            {[...overlayOrder].reverse()
              .filter((id) => activeOverlayIds.includes(id))
              .map((id, i, arr) => (
                <div key={id} className="flex items-center justify-between py-1">
                  <span className="text-xs text-slate-200">{OVERLAY_LABELS[id]?.[lang] || id}</span>
                  <div className="flex gap-0.5">
                    <button
                      onClick={() => moveOverlayUp(id)}
                      disabled={i === 0}
                      className="px-1 py-0.5 rounded text-[10px] bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-default"
                      title={lang === 'no' ? 'Flytt opp' : 'Move up'}
                    >▲</button>
                    <button
                      onClick={() => moveOverlayDown(id)}
                      disabled={i === arr.length - 1}
                      className="px-1 py-0.5 rounded text-[10px] bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-default"
                      title={lang === 'no' ? 'Flytt ned' : 'Move down'}
                    >▼</button>
                  </div>
                </div>
              ))}
            {store.windVisible && (
              <div className="text-[9px] text-slate-500 mt-1 border-t border-slate-600 pt-1">
                {lang === 'no' ? 'Vind vises alltid over kartlag' : 'Wind always renders above map layers'}
              </div>
            )}
          </div>
        )}

        {/* Tactical Layers section */}
        <TacticalSection lang={lang} />

        {/* Map Themes section (when logged in OR public themes exist) */}
        {showThemesSection && (
        <div className="px-3 py-2.5">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2 font-semibold">
            {t('dataLayers.themes', lang)}
          </div>

          {/* Save new theme (only when logged in) */}
          {user && (
            <div className="flex gap-1.5 mb-2">
              <input
                value={themeName}
                onChange={(e) => setThemeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveTheme()}
                placeholder={lang === 'no' ? 'Temanavn...' : 'Theme name...'}
                className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={() => setIncludePosition(!includePosition)}
                className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${includePosition ? 'bg-emerald-700 text-white' : 'bg-slate-700 text-slate-500 hover:text-slate-300'}`}
                title={lang === 'no' ? (includePosition ? 'Posisjon inkludert' : 'Inkluder posisjon') : (includePosition ? 'Position included' : 'Include position')}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                onClick={handleSaveTheme}
                disabled={!themeName.trim() || themeLoading}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
              >
                {t('general.save', lang)}
              </button>
            </div>
          )}

          {/* Theme list */}
          {themes.length === 0 && (
            <p className="text-slate-500 text-xs">{t('dataLayers.noThemes', lang)}</p>
          )}
          <div className="space-y-1.5">
            {themes.map((theme) => {
              const hasPosition = !!theme.state?.position;
              const canManage = user && (theme.isOwner || isAdmin); // Owner/admin: can manage sharing
              const canUpdate = user && (theme.isOwner || isAdmin || theme.userGroupRole === 'editor' || theme.userGroupRole === 'admin');
              const canDelete = canUpdate;
              const canShowQr = user && (theme.isOwner || isAdmin || !!theme.userGroupRole); // Any group member can view QR
              const availableGroups = userGroups.filter((g) => !theme.sharedGroups?.some((sg) => sg.id === g.id));
              const canAddSharing = canManage && (availableGroups.length > 0 || !theme.isPublic);

              return (
                <div key={theme.id} className="group bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/50 hover:border-slate-500/50 rounded-lg p-2 transition-all">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleApplyTheme(theme)}
                      className="flex-1 text-left text-sm text-slate-300 hover:text-emerald-300 px-1 py-0.5 rounded transition-colors truncate"
                    >
                      {theme.name}
                      {!theme.isOwner && theme.created_by_name && <span className="text-slate-500 text-xs ml-1">({theme.created_by_name})</span>}
                    </button>
                    {/* Public badge */}
                    {theme.isPublic && (
                      <span className="text-[9px] bg-emerald-700 text-emerald-100 px-1 py-0.5 rounded shrink-0">
                        {t('themes.public', lang)}
                      </span>
                    )}
                    {/* Position toggle (editable) */}
                    {canUpdate && (
                      <button
                        onClick={() => handleToggleThemePosition(theme)}
                        className={`w-6 h-6 flex items-center justify-center rounded transition-all shrink-0 ${
                          hasPosition
                            ? 'text-emerald-400 hover:text-emerald-300'
                            : 'text-slate-500 opacity-30 hover:opacity-100 hover:text-slate-300'
                        }`}
                        title={lang === 'no'
                          ? (hasPosition ? 'Fjern posisjon' : 'Lagre nåværende posisjon')
                          : (hasPosition ? 'Remove position' : 'Save current position')
                        }
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                        </svg>
                      </button>
                    )}
                    {/* Position indicator (non-editable) */}
                    {!canUpdate && hasPosition && (
                      <span className="w-6 h-6 flex items-center justify-center text-emerald-400 shrink-0" title={lang === 'no' ? 'Har lagret posisjon' : 'Has saved position'}>
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                        </svg>
                      </span>
                    )}
                    {/* Update/save theme button */}
                    {canUpdate && (
                      <button
                        onClick={() => handleUpdateTheme(theme)}
                        className="w-6 h-6 flex items-center justify-center text-slate-500 opacity-50 hover:opacity-100 hover:text-blue-400 transition-all shrink-0"
                        title={t('themes.update', lang)}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                        </svg>
                      </button>
                    )}
                    {/* QR code button - always visible */}
                    {canShowQr && (
                      <button
                        onClick={() => setQrOverlayTheme(theme)}
                        className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-slate-200 transition-colors shrink-0"
                        title={t('themes.generateQr', lang)}
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 2V5h1v1H5zm-2 7a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zm2 2v-1h1v1H5zm8-12a1 1 0 00-1 1v3a1 1 0 001 1h3a1 1 0 001-1V4a1 1 0 00-1-1h-3zm1 2v1h1V5h-1z" clipRule="evenodd" />
                          <path d="M11 4a1 1 0 10-2 0v1a1 1 0 002 0V4zm3 0a1 1 0 00-2 0v1a1 1 0 002 0V4zm-3 7a1 1 0 112 0 1 1 0 01-2 0zm5-1a1 1 0 100 2h1a1 1 0 100-2h-1zm-1 3a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zm-2-1a1 1 0 100 2 1 1 0 000-2zm-4 3a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zm5 1a1 1 0 100 2h1a1 1 0 100-2h-1z" />
                        </svg>
                      </button>
                    )}
                    {/* Delete button - hidden until hover */}
                    {canDelete && (
                      <button
                        onClick={() => handleDeleteTheme(theme.id)}
                        className="w-6 h-6 flex items-center justify-center text-red-500/50 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        title={t('general.delete', lang)}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Sharing controls (owner/admin only) */}
                  {canManage && (
                    <div className="mt-1.5 pt-1.5 border-t border-slate-600/30 space-y-1">
                      {/* Show public badge (removable) */}
                      {theme.isPublic && (
                        <div className="flex flex-wrap gap-1">
                          <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-800 text-emerald-200 px-1.5 py-0.5 rounded">
                            {t('themes.anyone', lang)}
                            <button
                              onClick={() => handleRemovePublic(theme.id)}
                              className="text-red-400 hover:text-red-300"
                              title={lang === 'no' ? 'Fjern offentlig deling' : 'Remove public sharing'}
                            >
                              ✕
                            </button>
                          </span>
                        </div>
                      )}
                      {/* Show shared groups */}
                      {theme.sharedGroups?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {theme.sharedGroups.map((sg) => (
                            <span key={sg.id} className="inline-flex items-center gap-1 text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                              {sg.name}
                              <button
                                onClick={() => handleUnshareTheme(theme.id, sg.id)}
                                className="text-red-400 hover:text-red-300"
                                title={lang === 'no' ? 'Fjern deling' : 'Remove sharing'}
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Share with group button/dropdown */}
                      {sharingThemeId === theme.id ? (
                        <div className="flex gap-1 items-center">
                          <select
                            value={selectedGroupId}
                            onChange={(e) => setSelectedGroupId(e.target.value)}
                            className="flex-1 px-1.5 py-0.5 bg-slate-900 border border-slate-600 rounded text-[11px] text-white"
                          >
                            <option value="">{lang === 'no' ? 'Velg...' : 'Select...'}</option>
                            {!theme.isPublic && (
                              <option value="__anyone__">{t('themes.anyone', lang)}</option>
                            )}
                            {availableGroups.map((g) => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleShareTheme(theme.id)}
                            disabled={!selectedGroupId}
                            className="px-1.5 py-0.5 bg-emerald-700 hover:bg-emerald-600 rounded text-[10px] disabled:opacity-50"
                          >
                            OK
                          </button>
                          <button
                            onClick={() => { setSharingThemeId(null); setSelectedGroupId(''); }}
                            className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-[10px]"
                          >
                            {t('general.cancel', lang)}
                          </button>
                        </div>
                      ) : canAddSharing && (
                        <button
                          onClick={() => setSharingThemeId(theme.id)}
                          className="text-[10px] text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          + {lang === 'no' ? 'Del' : 'Share'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}
      </div>

      {/* QR Code Overlay */}
      {qrOverlayTheme && (
        <QRCodeOverlay
          resourceType="theme"
          resourceId={qrOverlayTheme.id}
          resourceName={qrOverlayTheme.name}
          onClose={() => setQrOverlayTheme(null)}
        />
      )}
    </div>
  );
}
