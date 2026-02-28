import { useRef, useState } from 'react';
import html2canvas from 'html2canvas-pro';
import { useWeatherReport } from '../../hooks/useWeatherReport.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';
import { getWeatherLabel } from '../../lib/weather-symbols.js';
import MoonPhaseIcon from '../map/MoonPhaseIcon.jsx';
import WeatherIcon from '../panels/WeatherIcon.jsx';

/**
 * Full weather report modal with 7-day forecast, trends, and PNG export.
 * 16:10 aspect ratio, 90vw width, no vertical scroll.
 */
export default function WeatherReportModal({ lat, lon, onClose }) {
  const lang = useMapStore((s) => s.lang);
  const reportRef = useRef(null);
  const [theme, setTheme] = useState('light');
  const [exporting, setExporting] = useState(false);

  const { data, loading, error } = useWeatherReport(lat, lon, true);

  const isDark = theme === 'dark';
  const showAurora = lat > 58;

  const handleSaveReport = async () => {
    if (!reportRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        backgroundColor: isDark ? '#1e293b' : '#f8fafc',
        useCORS: true,
        allowTaint: true,
      });
      const link = document.createElement('a');
      const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = `weather_report_${now}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  // Theme classes
  const bg = isDark ? 'bg-slate-800' : 'bg-slate-50';
  const bgCard = isDark ? 'bg-slate-700/60' : 'bg-white';
  const text = isDark ? 'text-slate-100' : 'text-slate-800';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';
  const accent = isDark ? 'text-cyan-400' : 'text-blue-600';
  const border = isDark ? 'border-slate-600' : 'border-slate-200';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative flex flex-col"
        style={{ width: '90vw', maxWidth: '1600px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Actions bar (outside capture area) */}
        <div className="flex items-center justify-end gap-2 mb-2">
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white"
          >
            {isDark ? (lang === 'no' ? 'Lys' : 'Light') : (lang === 'no' ? 'Mørk' : 'Dark')}
          </button>
          <button
            onClick={handleSaveReport}
            disabled={exporting || loading}
            className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            {exporting ? '...' : (lang === 'no' ? 'Lagre rapport' : 'Save Report')}
          </button>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded bg-slate-700 hover:bg-red-600 text-white text-xl"
          >
            &times;
          </button>
        </div>

        {/* Report content (16:10 aspect ratio, no scroll) */}
        <div
          ref={reportRef}
          className={`${bg} ${text} rounded-lg shadow-2xl overflow-hidden`}
          style={{ aspectRatio: '16/10' }}
        >
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className={`text-xl ${textMuted}`}>{t('weather.loading', lang)}</div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-red-400 text-lg">{error}</div>
            </div>
          )}

          {data && !loading && (
            <div className="h-full p-5 flex flex-col">
              {/* Header - compact */}
              <ReportHeader data={data} lang={lang} accent={accent} textMuted={textMuted} />

              {/* Main content - 3 column layout */}
              <div className="flex-1 grid grid-cols-12 gap-4 mt-3">
                {/* Left column: Current conditions */}
                <div className="col-span-3 flex flex-col gap-3">
                  <CurrentConditionsHero
                    current={data.current}
                    snowDepth={data.snowDepth}
                    lang={lang}
                    isDark={isDark}
                    bgCard={bgCard}
                    textMuted={textMuted}
                  />
                  {/* Aurora below current conditions */}
                  {showAurora && data.kp && (
                    <AuroraSection
                      kp={data.kp}
                      lang={lang}
                      isDark={isDark}
                      bgCard={bgCard}
                      textMuted={textMuted}
                    />
                  )}
                </div>

                {/* Middle column: 7-day forecast */}
                <div className="col-span-3">
                  <SevenDayForecast
                    daily={data.daily}
                    lang={lang}
                    isDark={isDark}
                    bgCard={bgCard}
                    textMuted={textMuted}
                    border={border}
                  />
                </div>

                {/* Right column: Trends */}
                <div className="col-span-6">
                  <TrendCharts
                    daily={data.daily}
                    lang={lang}
                    isDark={isDark}
                    bgCard={bgCard}
                    textMuted={textMuted}
                  />
                </div>
              </div>

              {/* Bottom row: Moon and Sun - full width */}
              <div className="grid grid-cols-2 gap-4 mt-3">
                <MoonPhasesSection
                  daily={data.daily}
                  lang={lang}
                  isDark={isDark}
                  bgCard={bgCard}
                  textMuted={textMuted}
                />
                <SunTimesSection
                  daily={data.daily}
                  lang={lang}
                  isDark={isDark}
                  bgCard={bgCard}
                  textMuted={textMuted}
                />
              </div>

              {/* Footer */}
              <div className={`text-center text-xs ${textMuted} pt-2 mt-2 border-t ${border}`}>
                IntelMap {lang === 'no' ? 'Værrapport' : 'Weather Report'} &bull; {new Date().toLocaleString(lang === 'no' ? 'nb' : 'en')}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Sub-components ============

function ReportHeader({ data, lang, accent, textMuted }) {
  const dateStr = new Date().toLocaleDateString(lang === 'no' ? 'nb' : 'en', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Build location display
  const locationName = data.location.name;
  const coords = `${data.location.lat.toFixed(4)}°N, ${data.location.lon.toFixed(4)}°E`;

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className={`text-2xl font-bold ${accent}`}>
          {locationName || coords}
        </h1>
        {locationName && (
          <div className={`text-sm ${textMuted}`}>{coords}</div>
        )}
      </div>
      <div className="text-right">
        <div className={`text-base ${textMuted}`}>{dateStr}</div>
        <div className={`text-sm font-medium ${textMuted}`}>
          IntelMap {lang === 'no' ? 'Værrapport' : 'Weather Report'}
        </div>
      </div>
    </div>
  );
}

function CurrentConditionsHero({ current, snowDepth, lang, isDark, bgCard, textMuted }) {
  if (!current) return null;

  const tempColor = current.temperature < 0 ? 'text-blue-400' : current.temperature > 20 ? 'text-orange-400' : '';
  const windDir = getWindDir(current.windDirection);

  return (
    <div className={`${bgCard} rounded-xl p-4 ${isDark ? 'bg-gradient-to-br from-slate-700/80 to-slate-800/80' : 'bg-gradient-to-br from-white to-slate-100'}`}>
      <div className="flex items-center gap-3 mb-3">
        {current.symbol && <WeatherIcon symbol={current.symbol} size={56} />}
        <div>
          <div className={`text-4xl font-bold ${tempColor}`}>
            {current.temperature?.toFixed(1)}°C
          </div>
          {current.symbol && (
            <div className={`text-sm ${textMuted}`}>{getWeatherLabel(current.symbol, lang)}</div>
          )}
          {current.feelsLike != null && Math.abs(current.feelsLike - current.temperature) > 1 && (
            <div className={`text-xs ${textMuted}`}>
              {lang === 'no' ? 'Føles som' : 'Feels like'} {current.feelsLike.toFixed(1)}°C
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatBox icon={<WindIcon />} label={lang === 'no' ? 'Vind' : 'Wind'} value={`${current.windSpeed?.toFixed(1)} m/s ${windDir}`} isDark={isDark} />
        <StatBox icon={<HumidityIcon />} label={lang === 'no' ? 'Fuktighet' : 'Humidity'} value={`${current.humidity?.toFixed(0)}%`} isDark={isDark} />
        <StatBox icon={<PressureIcon />} label={lang === 'no' ? 'Trykk' : 'Pressure'} value={`${current.pressure?.toFixed(0)} hPa`} isDark={isDark} />
        <StatBox icon={<CloudIcon />} label={lang === 'no' ? 'Skyer' : 'Clouds'} value={`${current.cloudCover?.toFixed(0)}%`} isDark={isDark} />
        {snowDepth && (
          <StatBox icon={<SnowflakeIcon />} label={lang === 'no' ? 'Snødybde' : 'Snow'} value={snowDepth.label?.[lang] || snowDepth.depth} isDark={isDark} />
        )}
        <StatBox icon={<PrecipIcon />} label={lang === 'no' ? 'Nedbør' : 'Precip'} value={`${current.precipitation?.toFixed(1) || '0'} mm`} isDark={isDark} />
      </div>
    </div>
  );
}

function StatBox({ icon, label, value, isDark }) {
  return (
    <div className={`${isDark ? 'bg-slate-600/50' : 'bg-slate-100'} rounded-lg p-2 text-center`}>
      <div className="flex justify-center mb-1 opacity-70">{icon}</div>
      <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{label}</div>
      <div className="font-semibold text-xs">{value}</div>
    </div>
  );
}

function SevenDayForecast({ daily, lang, isDark, bgCard, textMuted, border }) {
  return (
    <div className={`${bgCard} rounded-xl p-3 h-full`}>
      <h2 className={`text-base font-semibold mb-2 ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}>
        {lang === 'no' ? '7-dagers prognose' : '7-Day Forecast'}
      </h2>
      <div className="space-y-1.5">
        {daily.map((day, i) => {
          const date = new Date(day.date);
          const dayName = date.toLocaleDateString(lang === 'no' ? 'nb' : 'en', { weekday: 'short' });
          const dateNum = date.getDate();

          const tempHighColor = day.tempHigh < 0 ? 'text-blue-400' : day.tempHigh > 20 ? 'text-orange-400' : '';
          const tempLowColor = day.tempLow < 0 ? 'text-blue-300' : '';

          return (
            <div
              key={day.date}
              className={`flex items-center gap-2 px-2 py-1.5 rounded ${i === 0 ? (isDark ? 'bg-slate-600/50 ring-1 ring-cyan-500' : 'bg-blue-50 ring-1 ring-blue-400') : ''}`}
            >
              <span className={`w-10 text-sm font-medium`}>{dayName}</span>
              <span className={`w-5 text-xs ${textMuted}`}>{dateNum}</span>
              <div className="w-7 flex justify-center">
                {day.symbol ? <WeatherIcon symbol={day.symbol} size={22} /> : null}
              </div>
              <span className={`w-10 text-sm font-bold text-right ${tempHighColor}`}>{day.tempHigh?.toFixed(0)}°</span>
              <span className={`w-8 text-sm text-right ${tempLowColor || textMuted}`}>{day.tempLow?.toFixed(0)}°</span>
              <span className={`flex-1 text-xs text-right text-blue-400`}>
                {day.precipitation > 0.1 ? `${day.precipitation.toFixed(1)}mm` : ''}
              </span>
              <span className={`w-12 text-xs text-right ${textMuted}`}>{day.windMax?.toFixed(0)} m/s</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrendCharts({ daily, lang, isDark, bgCard, textMuted }) {
  const temps = daily.map(d => ({ high: d.tempHigh, low: d.tempLow, date: d.date }));
  const winds = daily.map(d => ({ value: d.windMax || 0, date: d.date }));
  const precips = daily.map(d => ({ value: d.precipitation || 0, date: d.date }));
  const clouds = daily.map(d => ({ value: d.cloudAvg || 0, date: d.date }));

  return (
    <div className={`${bgCard} rounded-xl p-4 h-full`}>
      <h2 className={`text-base font-semibold mb-2 ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}>
        {lang === 'no' ? 'Trender' : 'Trends'}
      </h2>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 h-[calc(100%-2rem)]">
        <div className="flex flex-col">
          <div className={`text-sm font-medium ${textMuted} mb-1`}>{lang === 'no' ? 'Temperatur' : 'Temperature'}</div>
          <div className="flex-1"><TemperatureChart data={temps} isDark={isDark} lang={lang} /></div>
        </div>
        <div className="flex flex-col">
          <div className={`text-sm font-medium ${textMuted} mb-1`}>{lang === 'no' ? 'Vind' : 'Wind'}</div>
          <div className="flex-1"><WindChart data={winds} isDark={isDark} lang={lang} /></div>
        </div>
        <div className="flex flex-col">
          <div className={`text-sm font-medium ${textMuted} mb-1`}>{lang === 'no' ? 'Nedbør' : 'Precipitation'}</div>
          <div className="flex-1"><PrecipChart data={precips} isDark={isDark} lang={lang} /></div>
        </div>
        <div className="flex flex-col">
          <div className={`text-sm font-medium ${textMuted} mb-1`}>{lang === 'no' ? 'Skydekke' : 'Cloud Cover'}</div>
          <div className="flex-1"><CloudChart data={clouds} isDark={isDark} lang={lang} /></div>
        </div>
      </div>
    </div>
  );
}

// SVG Chart Components with day markers and value labels
function TemperatureChart({ data, isDark, lang }) {
  if (!data.length) return null;

  const width = 380;
  const height = 110;
  const padding = { top: 15, right: 15, bottom: 22, left: 32 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const allTemps = data.flatMap(d => [d.high, d.low]).filter(t => t != null);
  const minT = Math.floor(Math.min(...allTemps) - 2);
  const maxT = Math.ceil(Math.max(...allTemps) + 2);
  const range = maxT - minT || 1;

  const xScale = (i) => padding.left + (i / (data.length - 1)) * w;
  const yScale = (t) => padding.top + h - ((t - minT) / range) * h;

  const ySteps = [];
  const stepSize = range > 10 ? 5 : 2;
  for (let v = Math.ceil(minT / stepSize) * stepSize; v <= maxT; v += stepSize) {
    ySteps.push(v);
  }

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {ySteps.map(v => (
        <g key={v}>
          <line x1={padding.left} y1={yScale(v)} x2={width - padding.right} y2={yScale(v)} stroke={isDark ? '#475569' : '#e2e8f0'} strokeDasharray="2,2" />
          <text x={padding.left - 4} y={yScale(v) + 3} fontSize="9" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">{v}°</text>
        </g>
      ))}
      <polyline points={data.map((d, i) => `${xScale(i)},${yScale(d.high)}`).join(' ')} fill="none" stroke="#f97316" strokeWidth="2" />
      <polyline points={data.map((d, i) => `${xScale(i)},${yScale(d.low)}`).join(' ')} fill="none" stroke="#3b82f6" strokeWidth="2" />
      {data.map((d, i) => {
        const date = new Date(d.date);
        const dayName = date.toLocaleDateString(lang === 'no' ? 'nb' : 'en', { weekday: 'short' });
        return (
          <g key={i}>
            <circle cx={xScale(i)} cy={yScale(d.high)} r="4" fill="#f97316" />
            <circle cx={xScale(i)} cy={yScale(d.low)} r="4" fill="#3b82f6" />
            <text x={xScale(i)} y={height - 4} fontSize="9" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="middle">{dayName}</text>
          </g>
        );
      })}
    </svg>
  );
}

function WindChart({ data, isDark, lang }) {
  if (!data.length) return null;

  const width = 380;
  const height = 110;
  const padding = { top: 20, right: 15, bottom: 22, left: 32 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const maxW = Math.ceil(Math.max(...data.map(d => d.value), 10) / 5) * 5;
  const barWidth = (w / data.length) * 0.65;

  const ySteps = [];
  for (let v = 0; v <= maxW; v += 5) ySteps.push(v);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {ySteps.map(v => (
        <g key={v}>
          <line x1={padding.left} y1={padding.top + h - (v / maxW) * h} x2={width - padding.right} y2={padding.top + h - (v / maxW) * h} stroke={isDark ? '#475569' : '#e2e8f0'} strokeDasharray="2,2" />
          <text x={padding.left - 4} y={padding.top + h - (v / maxW) * h + 3} fontSize="9" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">{v}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const barH = (d.value / maxW) * h;
        const x = padding.left + (i / data.length) * w + (w / data.length - barWidth) / 2;
        const y = padding.top + h - barH;
        const color = d.value < 5 ? '#22c55e' : d.value < 10 ? '#eab308' : d.value < 15 ? '#f97316' : '#ef4444';
        const date = new Date(d.date);
        const dayName = date.toLocaleDateString(lang === 'no' ? 'nb' : 'en', { weekday: 'short' });
        return (
          <g key={i}>
            <rect x={x} y={y} width={barWidth} height={barH} fill={color} rx="3" />
            <text x={x + barWidth / 2} y={y - 3} fontSize="8" fill={isDark ? '#cbd5e1' : '#475569'} textAnchor="middle" fontWeight="600">{d.value.toFixed(0)}</text>
            <text x={x + barWidth / 2} y={height - 4} fontSize="9" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="middle">{dayName}</text>
          </g>
        );
      })}
    </svg>
  );
}

function PrecipChart({ data, isDark, lang }) {
  if (!data.length) return null;

  const width = 380;
  const height = 110;
  const padding = { top: 20, right: 15, bottom: 22, left: 32 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const maxP = Math.max(Math.ceil(Math.max(...data.map(d => d.value)) / 5) * 5, 5);
  const barWidth = (w / data.length) * 0.65;

  const ySteps = [];
  const stepSize = maxP > 20 ? 10 : maxP > 10 ? 5 : 2;
  for (let v = 0; v <= maxP; v += stepSize) ySteps.push(v);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="precipGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      {ySteps.map(v => (
        <g key={v}>
          <line x1={padding.left} y1={padding.top + h - (v / maxP) * h} x2={width - padding.right} y2={padding.top + h - (v / maxP) * h} stroke={isDark ? '#475569' : '#e2e8f0'} strokeDasharray="2,2" />
          <text x={padding.left - 4} y={padding.top + h - (v / maxP) * h + 3} fontSize="9" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">{v}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const barH = (d.value / maxP) * h;
        const x = padding.left + (i / data.length) * w + (w / data.length - barWidth) / 2;
        const y = padding.top + h - barH;
        const date = new Date(d.date);
        const dayName = date.toLocaleDateString(lang === 'no' ? 'nb' : 'en', { weekday: 'short' });
        return (
          <g key={i}>
            <rect x={x} y={y} width={barWidth} height={barH} fill="url(#precipGrad)" rx="3" />
            {d.value > 0.1 && <text x={x + barWidth / 2} y={y - 3} fontSize="8" fill={isDark ? '#cbd5e1' : '#475569'} textAnchor="middle" fontWeight="600">{d.value.toFixed(1)}</text>}
            <text x={x + barWidth / 2} y={height - 4} fontSize="9" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="middle">{dayName}</text>
          </g>
        );
      })}
    </svg>
  );
}

function CloudChart({ data, isDark, lang }) {
  if (!data.length) return null;

  const width = 380;
  const height = 110;
  const padding = { top: 15, right: 15, bottom: 22, left: 32 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const xScale = (i) => padding.left + (i / (data.length - 1)) * w;
  const yScale = (c) => padding.top + h - (c / 100) * h;

  const ySteps = [0, 25, 50, 75, 100];
  const points = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' L ');
  const areaPath = `M ${xScale(0)},${padding.top + h} L ${points} L ${xScale(data.length - 1)},${padding.top + h} Z`;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="cloudGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={isDark ? '#94a3b8' : '#64748b'} stopOpacity="0.5" />
          <stop offset="100%" stopColor={isDark ? '#94a3b8' : '#64748b'} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {ySteps.map(v => (
        <g key={v}>
          <line x1={padding.left} y1={yScale(v)} x2={width - padding.right} y2={yScale(v)} stroke={isDark ? '#475569' : '#e2e8f0'} strokeDasharray="2,2" />
          <text x={padding.left - 4} y={yScale(v) + 3} fontSize="9" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">{v}%</text>
        </g>
      ))}
      <path d={areaPath} fill="url(#cloudGrad)" />
      <polyline points={data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ')} fill="none" stroke={isDark ? '#94a3b8' : '#64748b'} strokeWidth="2" />
      {data.map((d, i) => {
        const date = new Date(d.date);
        const dayName = date.toLocaleDateString(lang === 'no' ? 'nb' : 'en', { weekday: 'short' });
        return (
          <g key={i}>
            <circle cx={xScale(i)} cy={yScale(d.value)} r="4" fill={isDark ? '#94a3b8' : '#64748b'} />
            <text x={xScale(i)} y={height - 4} fontSize="9" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="middle">{dayName}</text>
          </g>
        );
      })}
    </svg>
  );
}

function AuroraSection({ kp, lang, isDark, bgCard, textMuted }) {
  // kp data structure: { current, hourly: [{time, kp, activity}, ...], ... }
  const currentKp = kp?.current || 0;
  const kpForecast = kp?.hourly?.slice(0, 8) || [];

  const getKpColor = (k) => {
    if (k < 3) return '#22c55e';
    if (k < 5) return '#eab308';
    if (k < 7) return '#f97316';
    return '#ef4444';
  };

  const getActivityLevel = (k) => {
    if (k < 2) return lang === 'no' ? 'Rolig' : 'Quiet';
    if (k < 4) return lang === 'no' ? 'Lav' : 'Low';
    if (k < 6) return lang === 'no' ? 'Moderat' : 'Moderate';
    if (k < 8) return lang === 'no' ? 'Aktiv' : 'Active';
    return lang === 'no' ? 'Storm' : 'Storm';
  };

  return (
    <div className={`${bgCard} rounded-xl p-3 flex-1 ${isDark ? 'bg-gradient-to-br from-purple-900/30 to-emerald-900/30' : 'bg-gradient-to-br from-purple-50 to-emerald-50'}`}>
      <h3 className={`text-sm font-semibold mb-2 ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
        {lang === 'no' ? 'Nordlys' : 'Aurora'}
      </h3>
      <div className="flex items-center gap-3">
        <div className="relative w-16 h-16 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <path d="M 10 70 A 40 40 0 1 1 90 70" fill="none" stroke={isDark ? '#475569' : '#e2e8f0'} strokeWidth="10" />
            <path d="M 10 70 A 40 40 0 1 1 90 70" fill="none" stroke={getKpColor(currentKp)} strokeWidth="10" strokeDasharray={`${(currentKp / 9) * 188} 188`} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pt-2">
            <span className="text-xl font-bold" style={{ color: getKpColor(currentKp) }}>{currentKp.toFixed(1)}</span>
          </div>
        </div>
        <div className="flex-1">
          <div className="text-base font-medium" style={{ color: getKpColor(currentKp) }}>{getActivityLevel(currentKp)}</div>
          <div className={`text-xs ${textMuted} mt-1`}>Kp-indeks</div>
          <div className="flex gap-1 mt-2">
            {kpForecast.slice(0, 8).map((k, i) => (
              <div key={i} className="w-4 rounded-sm" style={{ height: `${Math.max(8, (k.kp / 9) * 24)}px`, backgroundColor: getKpColor(k.kp) }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MoonPhasesSection({ daily, lang, isDark, bgCard, textMuted }) {
  const getIllumination = (deg) => Math.round((1 - Math.cos(deg * Math.PI / 180)) / 2 * 100);

  const getMoonPhaseName = (deg, lang) => {
    if (deg < 45) return lang === 'no' ? 'Nymåne' : 'New';
    if (deg < 135) return lang === 'no' ? 'Voksende' : 'Waxing';
    if (deg < 225) return lang === 'no' ? 'Fullmåne' : 'Full';
    if (deg < 315) return lang === 'no' ? 'Avtagende' : 'Waning';
    return lang === 'no' ? 'Nymåne' : 'New';
  };

  return (
    <div className={`${bgCard} rounded-xl p-4`}>
      <h3 className={`text-base font-semibold mb-3 ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
        {lang === 'no' ? 'Månefaser' : 'Moon Phases'}
      </h3>
      <div className="flex justify-between items-start">
        {daily.map((day, i) => {
          const date = new Date(day.date);
          const dayName = date.toLocaleDateString(lang === 'no' ? 'nb' : 'en', { weekday: 'short' });
          const dateNum = date.getDate();
          const illum = day.moonphase != null ? getIllumination(day.moonphase) : null;
          return (
            <div key={day.date} className={`text-center flex-1 ${i === 0 ? 'font-medium' : ''}`}>
              <div className={`text-sm font-medium`}>{dayName}</div>
              <div className={`text-xs ${textMuted}`}>{dateNum}</div>
              <div className="my-2 flex justify-center">
                {day.moonphase != null ? <MoonPhaseIcon degree={day.moonphase} size={32} /> : <div className="w-8 h-8 rounded-full bg-slate-600" />}
              </div>
              {illum != null && <div className={`text-sm font-medium`}>{illum}%</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SunTimesSection({ daily, lang, isDark, bgCard, textMuted }) {
  const formatTime = (iso) => {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleTimeString(lang === 'no' ? 'nb' : 'en', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso.slice(11, 16);
    }
  };

  return (
    <div className={`${bgCard} rounded-xl p-4`}>
      <h3 className={`text-base font-semibold mb-3 ${isDark ? 'text-orange-400' : 'text-orange-600'}`}>
        {lang === 'no' ? 'Soloppgang / Solnedgang' : 'Sunrise / Sunset'}
      </h3>
      <div className="flex justify-between items-start">
        {daily.map((day, i) => {
          const date = new Date(day.date);
          const dayName = date.toLocaleDateString(lang === 'no' ? 'nb' : 'en', { weekday: 'short' });
          const dateNum = date.getDate();
          return (
            <div key={day.date} className={`text-center flex-1 ${i === 0 ? 'font-medium' : ''}`}>
              <div className={`text-sm font-medium`}>{dayName}</div>
              <div className={`text-xs ${textMuted}`}>{dateNum}</div>
              <div className="mt-2">
                <div className="text-sm text-yellow-500 font-medium">{formatTime(day.sunrise)}</div>
                <div className="text-sm text-orange-500 font-medium">{formatTime(day.sunset)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ Icons ============

function WindIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
    </svg>
  );
}

function HumidityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  );
}

function PressureIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

function SnowflakeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
    </svg>
  );
}

function PrecipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M16 14v6m-4-4v6m-4-2v6" />
    </svg>
  );
}

// ============ Helpers ============

function getWindDir(deg) {
  if (deg == null) return '';
  const dirs = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];
  return dirs[Math.round(deg / 45) % 8];
}
