import { useState, useEffect, useRef } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';

const ESRI_QUERY_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/0/query';

function formatDate(yyyymmdd) {
  const s = String(yyyymmdd);
  if (s.length !== 8) return s;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export default function SatelliteInfo({ map }) {
  const baseLayer = useMapStore((s) => s.baseLayer);
  const lang = useMapStore((s) => s.lang);
  const [info, setInfo] = useState(null);
  const abortRef = useRef(null);
  const timerRef = useRef(null);

  const isSatellite = baseLayer?.startsWith('satellite');

  useEffect(() => {
    if (!isSatellite || !map) {
      setInfo(null);
      return;
    }

    const fetchInfo = () => {
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const center = map.getCenter();
      const url = `${ESRI_QUERY_URL}?geometry=${center.lng},${center.lat}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=SRC_DATE,SRC_RES,SRC_DESC,NICE_NAME&returnGeometry=false&f=json&inSR=4326`;

      fetch(url, { signal: ac.signal })
        .then((r) => r.json())
        .then((data) => {
          const attrs = data.features?.[0]?.attributes;
          if (attrs) {
            setInfo({
              date: formatDate(attrs.SRC_DATE),
              resolution: attrs.SRC_RES,
              sensor: attrs.SRC_DESC,
              source: attrs.NICE_NAME,
            });
          } else {
            setInfo(null);
          }
        })
        .catch(() => {});
    };

    // Debounced fetch on map move
    const onMoveEnd = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fetchInfo, 600);
    };

    fetchInfo();
    map.on('moveend', onMoveEnd);
    return () => {
      map.off('moveend', onMoveEnd);
      clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [isSatellite, map]);

  if (!isSatellite || !info) return null;

  return (
    <div className="bg-black/60 backdrop-blur-sm text-white text-[10px] px-2.5 py-1 rounded-full flex items-center gap-2 pointer-events-none whitespace-nowrap">
      <span className="font-semibold">{info.date}</span>
      <span className="text-slate-400">|</span>
      <span>{info.resolution}m</span>
      <span className="text-slate-400">|</span>
      <span>{info.sensor}</span>
      {info.source && (
        <>
          <span className="text-slate-400">|</span>
          <span className="text-slate-300">{info.source}</span>
        </>
      )}
    </div>
  );
}
