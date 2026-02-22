import { useState, useEffect } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useWeatherStore } from '../../stores/useWeatherStore.js';

function formatDateTime(date) {
  const d = date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  const t = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${d} ${t}`;
}

export default function DataFreshness() {
  const lang = useMapStore((s) => s.lang);
  const windVisible = useMapStore((s) => s.windVisible);
  const avalancheVisible = useMapStore((s) => s.avalancheVisible);
  const avalancheWarningsVisible = useMapStore((s) => s.avalancheWarningsVisible);
  const avalancheWarningsFetchedAt = useMapStore((s) => s.avalancheWarningsFetchedAt);
  const aircraftVisible = useMapStore((s) => s.aircraftVisible);
  const aircraftFetchedAt = useMapStore((s) => s.aircraftFetchedAt);
  const snowDepthVisible = useMapStore((s) => s.snowDepthVisible);
  const windFetchedAt = useWeatherStore((s) => s.windFetchedAt);
  const [avalancheLoadedAt, setAvalancheLoadedAt] = useState(null);
  const [snowDepthDate, setSnowDepthDate] = useState(null);

  useEffect(() => {
    if (avalancheVisible) {
      setAvalancheLoadedAt(new Date());
    } else {
      setAvalancheLoadedAt(null);
    }
  }, [avalancheVisible]);

  useEffect(() => {
    if (snowDepthVisible) {
      fetch('/api/tiles/snowdepth-date')
        .then((r) => r.json())
        .then((d) => setSnowDepthDate(d.date))
        .catch(() => setSnowDepthDate(null));
    } else {
      setSnowDepthDate(null);
    }
  }, [snowDepthVisible]);

  const items = [];

  if (windVisible && windFetchedAt) {
    items.push({
      label: lang === 'no' ? 'Vinddata' : 'Wind data',
      value: formatDateTime(windFetchedAt),
      color: 'text-cyan-400',
    });
  }

  if (avalancheVisible && avalancheLoadedAt) {
    items.push({
      label: lang === 'no' ? 'Skredterreng' : 'Avalanche terrain',
      value: formatDateTime(avalancheLoadedAt),
      sub: 'NVE / NGU',
      color: 'text-red-400',
    });
  }

  if (avalancheWarningsVisible && avalancheWarningsFetchedAt) {
    items.push({
      label: lang === 'no' ? 'Skredvarsel' : 'Avalanche warnings',
      value: formatDateTime(avalancheWarningsFetchedAt),
      sub: 'varsom.no / NVE',
      color: 'text-orange-400',
    });
  }

  if (aircraftVisible && aircraftFetchedAt) {
    items.push({
      label: lang === 'no' ? 'Luftfart' : 'Aircraft',
      value: formatDateTime(aircraftFetchedAt),
      sub: 'airplanes.live / ADS-B',
      color: 'text-amber-400',
    });
  }

  if (snowDepthVisible && snowDepthDate) {
    items.push({
      label: lang === 'no' ? 'Snødybde' : 'Snow Depth',
      value: snowDepthDate,
      sub: 'NVE / seNorge',
      color: 'text-blue-400',
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 z-[6] bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 text-xs pointer-events-none space-y-1.5">
      <div className="text-slate-500 font-semibold text-[10px] uppercase tracking-wide">
        {lang === 'no' ? 'Datakilder' : 'Data Sources'}
      </div>
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className={`${item.color} font-medium`}>{item.label}</span>
          <span className="text-slate-300 font-mono">{item.value}</span>
          {item.sub && <span className="text-slate-600 text-[9px]">{item.sub}</span>}
        </div>
      ))}
    </div>
  );
}
