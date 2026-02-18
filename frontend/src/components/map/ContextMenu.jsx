import { useState, useEffect, useRef } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { useWeather } from '../../hooks/useWeather.js';
import { getWeatherLabel } from '../../lib/weather-symbols.js';
import { calcWindChill } from '../../lib/weather-utils.js';
import MoonPhaseIcon from './MoonPhaseIcon.jsx';

function toMGRS(lat, lon) {
  // Simplified UTM/MGRS conversion for Norway
  const zone = Math.floor((lon + 180) / 6) + 1;
  const band = lat >= 72 ? 'X' : lat >= 64 ? 'W' : lat >= 56 ? 'V' : 'U';
  const k0 = 0.9996;
  const a = 6378137;
  const e = 0.0818192;
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const lonOrigin = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const N = a / Math.sqrt(1 - e * e * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = (e * e / (1 - e * e)) * Math.cos(latRad) * Math.cos(latRad);
  const A = Math.cos(latRad) * (lonRad - lonOrigin);
  const M = a * ((1 - e*e/4 - 3*e*e*e*e/64) * latRad -
    (3*e*e/8 + 3*e*e*e*e/32) * Math.sin(2*latRad) +
    (15*e*e*e*e/256) * Math.sin(4*latRad));
  const easting = k0 * N * (A + (1-T+C)*A*A*A/6) + 500000;
  const northing = k0 * (M + N * Math.tan(latRad) * (A*A/2 + (5-T+9*C+4*C*C)*A*A*A*A/24));
  return `${zone}${band} ${Math.round(easting)} ${Math.round(northing)}`;
}

export default function ContextMenu({ lng, lat, x, y, onClose, pinned: externalPinned, onPin }) {
  const lang = useMapStore((s) => s.lang);
  const setActivePanel = useMapStore((s) => s.setActivePanel);
  const { fetchWeather } = useWeather();
  const [elevation, setElevation] = useState(null);
  const [weather, setWeather] = useState(null);
  const [placeName, setPlaceName] = useState(null);
  const [loadingEl, setLoadingEl] = useState(true);
  const [loadingWx, setLoadingWx] = useState(true);
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState(null);
  const [weatherSymbol, setWeatherSymbol] = useState(null);
  const [moonPhase, setMoonPhase] = useState(null);
  const pinned = externalPinned || false;
  const ref = useRef(null);

  const fetchWeatherData = () => {
    fetch(`/api/weather/forecast?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`)
      .then(r => r.json())
      .then(d => {
        const ts0 = d?.properties?.timeseries?.[0]?.data;
        const details = ts0?.instant?.details;
        if (details) {
          setWeather(details);
          setWeatherUpdatedAt(new Date());
        }
        const symCode = ts0?.next_1_hours?.summary?.symbol_code
          || ts0?.next_6_hours?.summary?.symbol_code;
        if (symCode) setWeatherSymbol(symCode);
      })
      .catch(() => {})
      .finally(() => setLoadingWx(false));
  };

  // Fetch elevation, weather, and place name on mount
  useEffect(() => {
    // Elevation
    fetch(`/api/tiles/elevation?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`)
      .then(r => r.json())
      .then(d => setElevation(d.elevation))
      .catch(() => setElevation(null))
      .finally(() => setLoadingEl(false));

    // Quick weather
    fetchWeatherData();

    // Reverse geocode
    fetch(`/api/search/reverse?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`)
      .then(r => r.json())
      .then(d => { if (d.name) setPlaceName(d.name); })
      .catch(() => {});

    // Moon phase
    fetch(`/api/weather/moon?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`)
      .then(r => r.json())
      .then(d => {
        if (d.properties?.moonphase !== undefined) {
          setMoonPhase(d.properties.moonphase);
        }
      })
      .catch(() => {});
  }, [lat, lng]);

  // Auto-refresh weather every 5 minutes when pinned
  useEffect(() => {
    if (!pinned) return;
    const interval = setInterval(() => {
      fetchWeatherData();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [pinned, lat, lng]);

  // Close on outside click (only when NOT pinned)
  useEffect(() => {
    if (pinned) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, pinned]);

  const handleTogglePin = () => {
    if (onPin) onPin(!pinned);
  };

  const mgrs = toMGRS(lat, lng);

  // Position: when x/y are 0 (wrapped in DraggablePopup), don't apply positioning
  const isWrapped = x === 0 && y === 0;
  const style = isWrapped ? {} : {
    position: 'absolute',
    left: Math.min(x, window.innerWidth - 280),
    top: Math.min(y, window.innerHeight - 350),
    zIndex: 50,
  };

  const handleWeatherPanel = () => {
    fetchWeather(lat.toFixed(4), lng.toFixed(4));
    setActivePanel('weather');
    if (!pinned) onClose();
  };

  return (
    <div ref={ref} style={style}
      className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl min-w-[240px] text-sm overflow-hidden"
    >
      {/* Header */}
      <div className="bg-slate-700 px-3 py-2 flex justify-between items-center gap-2 context-menu-header">
        <span className="text-emerald-400 font-semibold text-xs truncate flex-1">
          {placeName || (lang === 'no' ? 'Punktinfo' : 'Point Info')}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {/* Pin button */}
          <button
            onClick={handleTogglePin}
            className={`text-xs p-0.5 rounded transition-colors ${pinned ? 'text-emerald-400' : 'text-slate-400 hover:text-white'}`}
            title={lang === 'no' ? (pinned ? 'Løsne' : 'Fest') : (pinned ? 'Unpin' : 'Pin')}
          >
            <svg className="w-3.5 h-3.5" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {/* Coordinates */}
        <InfoRow label={lang === 'no' ? 'Breddegrad' : 'Latitude'} value={lat.toFixed(6) + '°'} />
        <InfoRow label={lang === 'no' ? 'Lengdegrad' : 'Longitude'} value={lng.toFixed(6) + '°'} />
        <InfoRow label="MGRS/UTM" value={mgrs} />

        {/* Elevation */}
        <InfoRow
          label={lang === 'no' ? 'Høyde' : 'Elevation'}
          value={loadingEl ? '...' : elevation != null ? (elevation < 0 ? (lang === 'no' ? 'Hav' : 'Sea') : `${Math.round(elevation)} m`) : 'N/A'}
        />

        {/* Divider */}
        <div className="border-t border-slate-600 my-1" />

        {/* Weather */}
        {loadingWx ? (
          <div className="text-slate-400 text-xs">{lang === 'no' ? 'Henter vær...' : 'Loading weather...'}</div>
        ) : weather ? (
          <>
            <InfoRow
              label={lang === 'no' ? 'Temperatur' : 'Temperature'}
              value={`${weather.air_temperature?.toFixed(1)}°C`}
            />
            <InfoRow
              label={lang === 'no' ? 'Vind' : 'Wind'}
              value={`${weather.wind_speed?.toFixed(1)} m/s (${getWindDir(weather.wind_from_direction)})`}
            />
            {weather.wind_speed_of_gust != null && (
              <InfoRow
                label={lang === 'no' ? 'Vindkast' : 'Gusts'}
                value={`${weather.wind_speed_of_gust?.toFixed(1)} m/s`}
              />
            )}
            {calcWindChill(weather.air_temperature, weather.wind_speed) != null && (
              <InfoRow
                label={lang === 'no' ? 'Vindavkjøling' : 'Wind Chill'}
                value={`${calcWindChill(weather.air_temperature, weather.wind_speed).toFixed(1)}°C`}
              />
            )}
            {weatherSymbol && (
              <InfoRow
                label={lang === 'no' ? 'Vær' : 'Weather'}
                value={getWeatherLabel(weatherSymbol, lang)}
              />
            )}
            {moonPhase != null && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-xs">{lang === 'no' ? 'Månefase' : 'Moon'}</span>
                <span className="text-slate-100 text-xs font-mono flex items-center gap-1">
                  <MoonPhaseIcon degree={moonPhase} size={14} />
                  {getMoonPhaseName(moonPhase, lang)}
                </span>
              </div>
            )}
            {weatherUpdatedAt && (
              <div className="text-[9px] text-slate-500 text-right mt-1">
                {lang === 'no' ? 'Oppdatert' : 'Updated'} {weatherUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </>
        ) : (
          <div className="text-slate-500 text-xs">{lang === 'no' ? 'Vær utilgjengelig' : 'Weather unavailable'}</div>
        )}

        {/* Actions */}
        <div className="border-t border-slate-600 my-1" />
        <button
          onClick={handleWeatherPanel}
          className="w-full text-left px-2 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          {lang === 'no' ? 'Vis full værmelding her' : 'Show full forecast here'}
        </button>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className="text-slate-100 text-xs font-mono">{value}</span>
    </div>
  );
}

function getWindDir(deg) {
  if (deg == null) return '?';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function getMoonPhaseName(deg, lang) {
  if (deg < 45) return lang === 'no' ? 'Nymåne' : 'New Moon';
  if (deg < 135) return lang === 'no' ? 'Første kvarter' : 'First Quarter';
  if (deg < 225) return lang === 'no' ? 'Fullmåne' : 'Full Moon';
  if (deg < 315) return lang === 'no' ? 'Siste kvarter' : 'Last Quarter';
  return lang === 'no' ? 'Nymåne' : 'New Moon';
}

