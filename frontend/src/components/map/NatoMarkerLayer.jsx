import { useCallback, useRef } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { generateSymbolSvg, getAffiliation } from '../../lib/milsymbol-utils.js';
import { getSymbolName } from '../../lib/symbol-lookup.js';
import { socket } from '../../lib/socket.js';

export default function NatoMarkerLayer() {
  const markers = useTacticalStore((s) => s.markers);
  const updateMarker = useTacticalStore((s) => s.updateMarker);
  const layers = useTacticalStore((s) => s.layers);
  const lang = useMapStore((s) => s.lang);
  const dragRef = useRef(null);
  const dragEndTimeRef = useRef(0);

  // Get visible layer IDs
  const visibleLayerIds = new Set(layers.filter(l => l.visible).map(l => l.id));

  const visibleMarkers = markers.filter(m =>
    !m.layerId || visibleLayerIds.has(m.layerId)
  );

  const onDragStart = useCallback((markerId) => {
    dragRef.current = markerId;
  }, []);

  const onDragEnd = useCallback((evt, markerId) => {
    const { lng, lat } = evt.lngLat;
    // Optimistic local update to prevent snap-back
    const marker = useTacticalStore.getState().markers.find(m => m.id === markerId);
    if (marker) {
      updateMarker({ ...marker, lat, lon: lng });
    }
    socket.emit('client:marker:update', { id: markerId, lat, lon: lng });
    // Delay clearing dragRef so onClick doesn't fire the label prompt
    dragEndTimeRef.current = Date.now();
    setTimeout(() => { dragRef.current = null; }, 300);
  }, [updateMarker]);

  const onDelete = useCallback((markerId) => {
    socket.emit('client:marker:delete', { id: markerId });
  }, []);

  const onClickLabel = useCallback((marker) => {
    // Skip if we just finished a drag (within 400ms)
    if (Date.now() - dragEndTimeRef.current < 400) return;
    const current = marker.customLabel || '';
    const label = prompt(
      lang === 'no' ? 'Skriv inn etikett for symbol:' : 'Enter label for symbol:',
      current
    );
    if (label !== null) {
      socket.emit('client:marker:update', { id: marker.id, customLabel: label });
    }
  }, [lang]);

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
            onDragEnd={(e) => onDragEnd(e, marker.id)}
          >
            <div
              className="nato-marker group relative cursor-pointer flex flex-col items-center"
              title={tooltip}
              onClick={(e) => {
                e.stopPropagation();
                if (!dragRef.current) onClickLabel(marker);
              }}
            >
              <div dangerouslySetInnerHTML={{ __html: sym.svg }} />
              {marker.customLabel && (
                <div className="text-[10px] text-center font-semibold text-white bg-slate-900/80 rounded px-1 -mt-1 whitespace-nowrap">
                  {marker.customLabel}
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(marker.id); }}
                className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 rounded-full text-white text-xs hidden group-hover:flex items-center justify-center hover:bg-red-500"
              >
                x
              </button>
            </div>
          </Marker>
        );
      })}
    </>
  );
}
