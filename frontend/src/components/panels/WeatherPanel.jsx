import { useEffect, useState } from 'react';
import { useWeatherStore } from '../../stores/useWeatherStore.js';
import { useWeather } from '../../hooks/useWeather.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import { getWeatherLabel } from '../../lib/weather-symbols.js';
import { calcWindChill } from '../../lib/weather-utils.js';
import WeatherIcon from './WeatherIcon.jsx';
import MoonPhaseIcon from '../map/MoonPhaseIcon.jsx';

export default function WeatherPanel() {
  const lang = useMapStore((s) => s.lang);
  const latitude = useMapStore((s) => s.latitude);
  const longitude = useMapStore((s) => s.longitude);
  const forecast = useWeatherStore((s) => s.forecast);
  const sun = useWeatherStore((s) => s.sun);
  const moon = useWeatherStore((s) => s.moon);
  const loading = useWeatherStore((s) => s.loading);
  const location = useWeatherStore((s) => s.location);
  const [snowDepth, setSnowDepth] = useState(null);
  const { fetchWeather } = useWeather();

  useEffect(() => {
    if (!forecast) {
      fetchWeather(latitude.toFixed(4), longitude.toFixed(4));
    }
  }, []);

  // Fetch snow depth for current location
  useEffect(() => {
    const lat = location?.lat || latitude;
    const lon = location?.lon || longitude;
    fetch(`/api/tiles/snowdepth-at?lat=${parseFloat(lat).toFixed(4)}&lon=${parseFloat(lon).toFixed(4)}`)
      .then(r => r.json())
      .then(d => setSnowDepth(d.depth ? d : null))
      .catch(() => setSnowDepth(null));
  }, [location?.lat, location?.lon, latitude, longitude]);

  if (loading) {
    return (
      <div className="p-3 text-sm text-slate-400">
        {t('weather.loading', lang)}
      </div>
    );
  }

  const current = forecast?.properties?.timeseries?.[0]?.data;
  const details = current?.instant?.details || {};
  const next1h = current?.next_1_hours;
  const currentSymbol = next1h?.summary?.symbol_code
    || current?.next_6_hours?.summary?.symbol_code;

  const windChill = calcWindChill(details.air_temperature, details.wind_speed);

  // 48h forecast (every 3h)
  const timeseries = forecast?.properties?.timeseries || [];
  const forecast48h = timeseries.filter((_, i) => i > 0 && i <= 48 && i % 3 === 0).slice(0, 16);

  return (
    <div className="flex flex-col h-full p-3 overflow-y-auto">
      <h2 className="text-sm font-semibold text-emerald-400 mb-3">
        {t('weather.title', lang)}
      </h2>

      {/* Location info */}
      {location && (
        <div className="text-[10px] text-slate-400 mb-2">
          {lang === 'no' ? 'Posisjon' : 'Location'}: {parseFloat(location.lat).toFixed(4)}°N, {parseFloat(location.lon).toFixed(4)}°E
          <span className="text-slate-500 ml-1">(
            {lang === 'no' ? 'høyreklikk kartet for vær et annet sted' : 'right-click map for weather elsewhere'}
          )</span>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <button
          onClick={() => fetchWeather(latitude.toFixed(4), longitude.toFixed(4))}
          className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded"
        >
          {lang === 'no' ? 'Oppdater (kartmidt)' : 'Refresh (map center)'}
        </button>
      </div>

      {!forecast ? (
        <p className="text-sm text-slate-500">{t('weather.clickMap', lang)}</p>
      ) : (
        <>
          {/* Hero: weather icon + temperature + condition */}
          <div className="flex items-center gap-3 mb-4 bg-slate-700/40 rounded-lg p-3">
            {currentSymbol && <WeatherIcon symbol={currentSymbol} size={56} />}
            <div>
              <div className="text-2xl font-bold">{details.air_temperature?.toFixed(1) ?? '?'}°C</div>
              {currentSymbol && (
                <div className="text-xs text-slate-300">{getWeatherLabel(currentSymbol, lang)}</div>
              )}
            </div>
          </div>

          {/* Current conditions */}
          <div className="grid grid-cols-2 gap-2 text-xs mb-4">
            <WeatherItem label={t('weather.wind', lang)} value={`${details.wind_speed?.toFixed(1) ?? '?'} m/s ${getWindDir(details.wind_from_direction)}`} />
            <WeatherItem label={t('weather.gusts', lang)} value={`${details.wind_speed_of_gust?.toFixed(1) ?? '?'} m/s`} />
            {windChill != null && (
              <WeatherItem label={t('weather.windChill', lang)} value={`${windChill.toFixed(1)}°C`} />
            )}
            <WeatherItem label={t('weather.clouds', lang)} value={`${details.cloud_area_fraction?.toFixed(0) ?? '?'}%`} />
            <WeatherItem label={t('weather.precip', lang)} value={`${next1h?.details?.precipitation_amount?.toFixed(1) ?? '0'} mm`} />
            <WeatherItem label={t('weather.humidity', lang)} value={`${details.relative_humidity?.toFixed(0) ?? '?'}%`} />
            <WeatherItem label={t('weather.pressure', lang)} value={`${details.air_pressure_at_sea_level?.toFixed(0) ?? '?'} hPa`} />
            {snowDepth && (
              <WeatherItem
                label={lang === 'no' ? 'Snødybde' : 'Snow Depth'}
                value={snowDepth.label?.[lang] || snowDepth.depth}
              />
            )}
          </div>

          {/* Sun & Moon */}
          {sun && (
            <div className="text-xs mb-3 space-y-1">
              <div className="flex gap-4">
                {sun.properties?.sunrise && (
                  <span>{t('weather.sunrise', lang)}: {formatTime(sun.properties.sunrise.time)}</span>
                )}
                {sun.properties?.sunset && (
                  <span>{t('weather.sunset', lang)}: {formatTime(sun.properties.sunset.time)}</span>
                )}
              </div>
            </div>
          )}
          {moon && moon.properties?.moonphase !== undefined && (
            <div className="text-xs mb-4 flex items-center gap-1.5">
              <MoonPhaseIcon degree={moon.properties.moonphase} size={16} />
              {t('weather.moonPhase', lang)}: {getMoonPhase(moon.properties.moonphase, lang)}
            </div>
          )}

          {/* 48h Forecast */}
          <h3 className="text-xs font-semibold text-emerald-400 mb-2">{t('weather.forecast', lang)}</h3>
          <div className="space-y-1">
            {forecast48h.map((ts) => {
              const d = ts.data?.instant?.details || {};
              const sym = ts.data?.next_1_hours?.summary?.symbol_code
                || ts.data?.next_6_hours?.summary?.symbol_code;
              const time = new Date(ts.time);
              return (
                <div key={ts.time} className="flex items-center gap-2 text-[11px] bg-slate-700/30 rounded px-2 py-1">
                  <span className="w-12 text-slate-400">
                    {time.toLocaleDateString(lang === 'no' ? 'nb' : 'en', { weekday: 'short' })} {time.getHours().toString().padStart(2, '0')}
                  </span>
                  {sym && <WeatherIcon symbol={sym} size={20} className="shrink-0" />}
                  <span className="w-12">{d.air_temperature?.toFixed(1)}°</span>
                  <span className="w-16">{d.wind_speed?.toFixed(1)} m/s</span>
                  <span className="text-slate-400">{d.cloud_area_fraction?.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function WeatherItem({ label, value }) {
  return (
    <div className="bg-slate-700/50 rounded p-2">
      <div className="text-slate-400 text-[10px]">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function getWindDir(deg) {
  if (deg == null) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function formatTime(iso) {
  if (!iso) return '?';
  try {
    return new Date(iso).toLocaleTimeString('nb', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(11, 16);
  }
}

function getMoonPhase(deg, lang) {
  if (deg < 45) return lang === 'no' ? 'Nymåne' : 'New Moon';
  if (deg < 135) return lang === 'no' ? 'Første kvarter' : 'First Quarter';
  if (deg < 225) return lang === 'no' ? 'Fullmåne' : 'Full Moon';
  if (deg < 315) return lang === 'no' ? 'Siste kvarter' : 'Last Quarter';
  return lang === 'no' ? 'Nymåne' : 'New Moon';
}
