import { useCallback, useRef, useState } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { useTacticalStore, getAllVisibleMarkers } from '../../stores/useTacticalStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { generateSymbolSvg, getAffiliation } from '../../lib/milsymbol-utils.js';
import { getSymbolName } from '../../lib/symbol-lookup.js';
import { socket } from '../../lib/socket.js';
import ItemInfoPopup from './ItemInfoPopup.jsx';

export default function NatoMarkerLayer() {
  const state = useTacticalStore();
  const lang = useMapStore((s) => s.lang);
  const dragRef = useRef(null);
  const dragEndTimeRef = useRef(0);
  const [infoPopup, setInfoPopup] = useState(null);

  const visibleMarkers = getAllVisibleMarkers(state);

  const onDragStart = useCallback((markerId) => {
    dragRef.current = markerId;
  }, []);

  const onDragEnd = useCallback((evt, marker) => {
    const { lng, lat } = evt.lngLat;
    const projectId = marker._projectId || marker.projectId;
    // Optimistic local update
    useTacticalStore.getState().updateMarker(projectId, { ...marker, lat, lon: lng });
    socket.emit('client:marker:update', { projectId, id: marker.id, lat, lon: lng });
    dragEndTimeRef.current = Date.now();
    setTimeout(() => { dragRef.current = null; }, 300);
  }, []);

  const onDelete = useCallback((marker) => {
    const projectId = marker._projectId || marker.projectId;
    socket.emit('client:marker:delete', { projectId, id: marker.id });
  }, []);

  const onClickLabel = useCallback((marker) => {
    if (Date.now() - dragEndTimeRef.current < 400) return;
    const current = marker.customLabel || '';
    const label = prompt(
      lang === 'no' ? 'Skriv inn etikett for symbol:' : 'Enter label for symbol:',
      current
    );
    if (label !== null) {
      const projectId = marker._projectId || marker.projectId;
      socket.emit('client:marker:update', { projectId, id: marker.id, customLabel: label });
    }
  }, [lang]);

  const onContextMenu = useCallback((e, marker) => {
    e.preventDefault();
    e.stopPropagation();
    setInfoPopup({
      projectId: marker._projectId || marker.projectId,
      layerId: marker.layerId,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const affiliationLabels = {
    friendly: { en: 'Friendly', no: 'Vennlig' },
    hostile: { en: 'Hostile', no: 'Fiendtlig' },
    neutral: { en: 'Neutral', no: 'Nøytral' },
    unknown: { en: 'Unknown', no: 'Ukjent' },
  };

  return (
    <>
      {visibleMarkers.map((marker) => {
        const sym = generateSymbolSvg(marker.sidc, {
          designation: marker.designation,
          higherFormation: marker.higherFormation,
          additionalInfo: marker.additionalInfo,
        });

        const affiliation = getAffiliation(marker.sidc);
        const symName = getSymbolName(marker.sidc, lang);
        const affLabel = affiliationLabels[affiliation]?.[lang] || affiliationLabels[affiliation]?.en || affiliation;
        const tooltip = marker.designation
          ? `${marker.designation} — ${symName} (${affLabel})`
          : `${symName} (${affLabel})`;

        return (
          <Marker
            key={marker.id}
            longitude={marker.lon}
            latitude={marker.lat}
            anchor="center"
            draggable
            onDragStart={() => onDragStart(marker.id)}
            onDragEnd={(e) => onDragEnd(e, marker)}
          >
            <div
              className="nato-marker group relative cursor-pointer flex flex-col items-center"
              title={tooltip}
              onClick={(e) => {
                e.stopPropagation();
                if (!dragRef.current) onClickLabel(marker);
              }}
              onContextMenu={(e) => onContextMenu(e, marker)}
            >
              <div dangerouslySetInnerHTML={{ __html: sym.svg }} />
              {marker.customLabel && (
                <div className="text-[10px] text-center font-semibold text-white bg-slate-900/80 rounded px-1 -mt-1 whitespace-nowrap">
                  {marker.customLabel}
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(marker); }}
                className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 rounded-full text-white text-xs hidden group-hover:flex items-center justify-center hover:bg-red-500"
              >
                x
              </button>
            </div>
          </Marker>
        );
      })}
      {infoPopup && (
        <ItemInfoPopup
          projectId={infoPopup.projectId}
          layerId={infoPopup.layerId}
          x={infoPopup.x}
          y={infoPopup.y}
          onClose={() => setInfoPopup(null)}
        />
      )}
    </>
  );
}
