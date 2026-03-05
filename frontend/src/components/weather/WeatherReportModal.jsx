import { useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas-pro';
import { useWeatherReport } from '../../hooks/useWeatherReport.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { t } from '../../lib/i18n.js';
import { getWeatherLabel } from '../../lib/weather-symbols.js';
import MoonPhaseIcon from '../map/MoonPhaseIcon.jsx';
import WeatherIcon from '../panels/WeatherIcon.jsx';
import ExportMenu from '../common/ExportMenu.jsx';

/**
 * Full weather report modal with 7-day forecast, trends, and PNG export.
 * 16:10 aspect ratio, fills viewport better.
 */
export default function WeatherReportModal({ lat, lon, onClose }) {
  const lang = useMapStore((s) => s.lang);
  const user = useAuthStore((s) => s.user);
  const wasosLoggedIn = useAuthStore((s) => s.wasosLoggedIn);
  const prepareWasosUpload = useAuthStore((s) => s.prepareWasosUpload);
  const reportRef = useRef(null);
  const [theme, setTheme] = useState('dark');
  const [exporting, setExporting] = useState(false);

  const { data, loading, error } = useWeatherReport(lat, lon, true);

  // Close on Esc key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const isDark = theme === 'dark';
  const showAurora = lat > 58;

  // Capture at desktop size: clone the element off-screen at fixed landscape
  // dimensions, let the browser do a real reflow, then capture with html2canvas.
  const captureAsDesktop = async () => {
    const el = reportRef.current;
    if (!el) return null;

    // Deep-clone the report and place it off-screen at desktop size
    const clone = el.cloneNode(true);
    Object.assign(clone.style, {
      position: 'fixed', left: '-9999px', top: '0',
      width: '1600px', height: '1000px',
      overflow: 'hidden', maxHeight: 'none', zIndex: '-1',
    });
    clone.classList.add('weather-export-mode');
    document.body.appendChild(clone);

    // Let the browser reflow at the new size
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      return await html2canvas(clone, {
        scale: 2,
        backgroundColor: isDark ? '#1e293b' : '#f8fafc',
        useCORS: true,
        allowTaint: true,
        width: 1600,
        height: 1000,
      });
    } finally {
      document.body.removeChild(clone);
    }
  };

  const handleSaveReport = async () => {
    if (!reportRef.current) return;
    setExporting(true);
    try {
      const canvas = await captureAsDesktop();
      if (!canvas) return;
      const link = document.createElement('a');
      const now = new Date();
      const localTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
      link.download = `weather_report_${localTime}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  const handleWasosUpload = async () => {
    if (!reportRef.current) return;
    setExporting(true);
    try {
      const canvas = await captureAsDesktop();
      if (!canvas) return;
      const imageData = canvas.toDataURL('image/png');
      const now = new Date();
      const localTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
      const filename = `weather_report_${localTime}.png`;

      onClose();
      prepareWasosUpload(imageData, [lon, lat], filename);
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative flex flex-col w-full h-full max-w-[95vw] max-h-[95vh]">
        {/* Actions bar (outside capture area) */}
        <div className="flex items-center justify-end gap-2 mb-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white"
          >
            {isDark ? (lang === 'no' ? 'Lys' : 'Light') : (lang === 'no' ? 'Mørk' : 'Dark')}
          </button>
          {user?.wasosEnabled ? (
            <ExportMenu
              onSaveToDisk={handleSaveReport}
              onTransferToWasos={handleWasosUpload}
              wasosLoggedIn={wasosLoggedIn}
              buttonLabel={exporting ? '...' : t('weather.exportReport', lang)}
              buttonClassName="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 flex items-center gap-1"
              disabled={exporting || loading}
            />
          ) : (
            <button
              onClick={handleSaveReport}
              disabled={exporting || loading}
              className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
            >
              {exporting ? '...' : t('weather.exportReport', lang)}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded bg-slate-700 hover:bg-red-600 text-white text-xl"
          >
            &times;
          </button>
        </div>

        {/* Report content — scrollable on mobile, 16:10 aspect on desktop */}
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          <div
            ref={reportRef}
            className={`${bg} ${text} rounded-lg shadow-2xl overflow-y-auto lg:overflow-hidden w-full lg:w-auto weather-report-container`}
            style={{ maxHeight: 'calc(95vh - 60px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {loading && (
              <div className="flex items-center justify-center h-full min-h-[200px]">
                <div className={`text-xl ${textMuted}`}>{t('weather.loading', lang)}</div>
              </div>
            )}

            {error && (
              <div className="flex items-center justify-center h-full min-h-[200px]">
                <div className="text-red-400 text-lg">{error}</div>
              </div>
            )}

            {data && !loading && (
              <div
                className="wr-content p-3 lg:p-4 lg:h-full flex flex-col gap-3 lg:grid lg:gap-3"
                style={{ gridTemplateRows: 'auto 44% 1fr 100px auto' }}
              >
                {/* Row 1: Header (auto height) */}
                <ReportHeader data={data} lang={lang} accent={accent} textMuted={textMuted} />

                {/* Row 2: Top section — stacked on mobile, side-by-side on desktop */}
                <div className="wr-top-section flex flex-col lg:grid lg:grid-cols-12 gap-3 lg:overflow-hidden">
                  {/* Left column: Current conditions (top) + Aurora (bottom) */}
                  <div className="wr-left-col lg:col-span-4 flex flex-col gap-3 lg:overflow-hidden">
                    {/* Current conditions */}
                    <div className="lg:flex-1 lg:min-h-0 lg:overflow-hidden">
                      <CurrentConditionsHero
                        current={data.current}
                        snowDepth={data.snowDepth}
                        lang={lang}
                        isDark={isDark}
                        bgCard={bgCard}
                        textMuted={textMuted}
                      />
                    </div>

                    {/* Aurora below current conditions */}
                    {showAurora && data.kp && (
                      <div className="lg:flex-1 lg:min-h-0 lg:overflow-hidden">
                        <AuroraSectionHorizontal
                          kp={data.kp}
                          lang={lang}
                          isDark={isDark}
                          bgCard={bgCard}
                          textMuted={textMuted}
                        />
                      </div>
                    )}
                  </div>

                  {/* Right: Trends */}
                  <div className="wr-right-col lg:col-span-8 lg:overflow-hidden">
                    <TrendCharts
                      daily={data.daily}
                      lang={lang}
                      isDark={isDark}
                      bgCard={bgCard}
                      textMuted={textMuted}
                    />
                  </div>
                </div>

                {/* Row 3: 7-day forecast */}
                <div className="wr-forecast lg:overflow-hidden">
                  <SevenDayForecastHorizontal
                    daily={data.daily}
                    lang={lang}
                    isDark={isDark}
                    bgCard={bgCard}
                    textMuted={textMuted}
                    border={border}
                  />
                </div>

                {/* Row 4: Moon and Sun */}
                <div className="wr-moon-sun grid grid-cols-1 sm:grid-cols-2 gap-3 lg:overflow-hidden" style={{ minHeight: '100px' }}>
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

                {/* Row 5: Footer (auto height) */}
                <div className={`text-center text-sm ${textMuted} pt-2 border-t ${border}`}>
                  IntelMap {lang === 'no' ? 'Værrapport' : 'Weather Report'} &bull; {new Date().toLocaleString(lang === 'no' ? 'nb-NO' : 'en-GB')}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Sub-components ============

function ReportHeader({ data, lang, accent, textMuted }) {
  const dateStr = new Date().toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const locationName = data.location.name;
  const coords = `${data.location.lat.toFixed(4)}°N, ${data.location.lon.toFixed(4)}°E`;

  return (
    <div className="flex items-center justify-between shrink-0 gap-2">
      <div className="min-w-0">
        <h1 className={`text-lg lg:text-2xl font-bold ${accent} truncate`}>
          {locationName || coords}
        </h1>
        {locationName && (
          <div className={`text-sm lg:text-base ${textMuted}`}>{coords}</div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className={`text-sm lg:text-base ${textMuted}`}>{dateStr}</div>
      </div>
    </div>
  );
}

function CurrentConditionsHero({ current, snowDepth, lang, isDark, bgCard, textMuted }) {
  if (!current) return null;

  const tempColor = current.temperature < 0 ? 'text-blue-400' : current.temperature > 20 ? 'text-orange-400' : '';
  const windDir = getWindDir(current.windDirection, lang);
  const nowStr = new Date().toLocaleString(lang === 'no' ? 'nb-NO' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div className={`${bgCard} rounded-lg p-3 h-full flex flex-col ${isDark ? 'bg-gradient-to-br from-slate-700/80 to-slate-800/80' : 'bg-gradient-to-br from-white to-slate-100'}`}>
      {/* Temperature row - icon, temp, description on left; Weather now on right */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-2">
          {current.symbol && <WeatherIcon symbol={current.symbol} size={44} />}
          <div className={`text-2xl lg:text-3xl font-bold ${tempColor}`}>
            {current.temperature?.toFixed(1)}°C
          </div>
          <div className="ml-2 hidden sm:block">
            {current.symbol && (
              <div className={`text-sm ${textMuted}`}>{getWeatherLabel(current.symbol, lang)}</div>
            )}
          </div>
        </div>
        <div className={`text-sm lg:text-base font-semibold text-right ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}>
          {lang === 'no' ? 'Været nå' : 'Weather now'}<br />
          <span className={`text-xs lg:text-sm font-normal ${textMuted}`}>{nowStr}</span>
        </div>
      </div>

      {/* Stat boxes - 2 columns on mobile, 3 on larger screens */}
      <div className="wr-stat-grid grid grid-cols-2 lg:grid-cols-3 gap-1.5 lg:gap-2 flex-1">
        <StatBox icon={<WindIcon />} label={lang === 'no' ? 'Vind' : 'Wind'} value={`${current.windSpeed?.toFixed(1)} m/s ${windDir}`} isDark={isDark} />
        <StatBox icon={<HumidityIcon />} label={lang === 'no' ? 'Fuktighet' : 'Humidity'} value={`${current.humidity?.toFixed(0)}%`} isDark={isDark} />
        <StatBox icon={<WindChillIcon />} label={lang === 'no' ? 'Føles som' : 'Feels like'} value={current.feelsLike != null ? `${current.feelsLike.toFixed(1)}°C` : '-'} isDark={isDark} />
        <StatBox icon={<CloudIcon />} label={lang === 'no' ? 'Skyer' : 'Clouds'} value={`${current.cloudCover?.toFixed(0)}%`} isDark={isDark} />
        {snowDepth ? (
          <StatBox icon={<SnowflakeIcon />} label={lang === 'no' ? 'Snødybde' : 'Snow'} value={snowDepth.label?.[lang] || snowDepth.depth} isDark={isDark} />
        ) : (
          <StatBox icon={<SnowflakeIcon />} label={lang === 'no' ? 'Snødybde' : 'Snow'} value="-" isDark={isDark} />
        )}
        <StatBox icon={<PrecipIcon />} label={lang === 'no' ? 'Nedbør' : 'Precip'} value={`${current.precipitation?.toFixed(1) || '0'} mm`} isDark={isDark} />
      </div>
    </div>
  );
}

function StatBox({ icon, label, value, isDark }) {
  return (
    <div className={`${isDark ? 'bg-slate-600/50' : 'bg-slate-100'} rounded p-1.5 lg:p-2 text-center flex flex-col justify-center`}>
      <div className="flex justify-center mb-0.5 lg:mb-1 opacity-70">{icon}</div>
      <div className={`text-xs lg:text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{label}</div>
      <div className="font-semibold text-sm lg:text-base">{value}</div>
    </div>
  );
}

function SevenDayForecastHorizontal({ daily, lang, isDark, bgCard, textMuted, border }) {
  return (
    <div className={`${bgCard} rounded-lg p-3 flex flex-col`} style={{ height: '100%' }}>
      <h2 className={`text-base font-semibold mb-2 shrink-0 ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}>
        {lang === 'no' ? '7-dagers prognose' : '7-Day Forecast'}
      </h2>
      <div className="flex-1 flex gap-2 min-h-0 overflow-x-auto lg:overflow-hidden">
        {daily.map((day, i) => {
          const date = new Date(day.date);
          const dayNameShort = date.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', { weekday: 'short' });
          const dayNameLong = date.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', { weekday: 'long' });
          const dateNum = date.getDate();
          const month = date.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', { month: 'short' });

          const tempHighColor = day.tempHigh < 0 ? 'text-blue-400' : day.tempHigh > 20 ? 'text-orange-400' : '';
          const tempLowColor = day.tempLow < 0 ? 'text-blue-300' : '';

          return (
            <div
              key={day.date}
              className={`flex-1 min-w-[70px] flex flex-col items-center justify-between rounded-lg p-2 overflow-hidden ${i === 0 ? (isDark ? 'bg-slate-600/50' : 'bg-blue-50') : (isDark ? 'bg-slate-700/40' : 'bg-slate-100/60')}`}
            >
              {/* Day and date */}
              <div className="text-center shrink-0">
                <div className="text-sm lg:text-lg font-bold">
                  <span className="wr-day-short lg:hidden">{dayNameShort}</span>
                  <span className="wr-day-long hidden lg:inline">{dayNameLong}</span>
                </div>
                <div className={`text-xs lg:text-base ${textMuted}`}>{dateNum}. {month}</div>
              </div>

              {/* Weather icon */}
              <div className="my-1 flex items-center justify-center">
                {day.symbol ? <WeatherIcon symbol={day.symbol} size={40} /> : null}
              </div>

              {/* Temperatures */}
              <div className="text-center shrink-0">
                <div className={`text-xl lg:text-2xl font-bold ${tempHighColor}`}>{day.tempHigh?.toFixed(0)}°</div>
                <div className={`text-base lg:text-xl ${tempLowColor || textMuted}`}>{day.tempLow?.toFixed(0)}°</div>
              </div>

              {/* Extra info */}
              <div className="text-center space-y-0 shrink-0">
                <div className={`text-xs lg:text-base ${day.precipitation > 0.1 ? 'text-blue-400 font-medium' : textMuted}`}>
                  {(day.precipitation || 0).toFixed(1)} mm
                </div>
                <div className={`text-xs lg:text-base ${textMuted}`}>{day.windMax?.toFixed(0)} m/s</div>
                <div className={`text-xs lg:text-sm ${textMuted}`}>{day.cloudAvg?.toFixed(0)}% ☁</div>
              </div>
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
    <div className={`${bgCard} rounded-lg p-4 h-full flex flex-col`}>
      <h2 className={`text-base font-semibold mb-2 shrink-0 ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}>
        {lang === 'no' ? 'Trender' : 'Trends'}
      </h2>
      <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2 min-h-0">
        <div className="flex flex-col min-h-0">
          <div className={`text-sm font-medium ${textMuted} mb-1 shrink-0`}>{lang === 'no' ? 'Temperatur (°C)' : 'Temperature (°C)'}</div>
          <div className="flex-1 min-h-0"><TemperatureChart data={temps} isDark={isDark} lang={lang} /></div>
        </div>
        <div className="flex flex-col min-h-0">
          <div className={`text-sm font-medium ${textMuted} mb-1 shrink-0`}>{lang === 'no' ? 'Vind (m/s)' : 'Wind (m/s)'}</div>
          <div className="flex-1 min-h-0"><WindChart data={winds} isDark={isDark} lang={lang} /></div>
        </div>
        <div className="flex flex-col min-h-0">
          <div className={`text-sm font-medium ${textMuted} mb-1 shrink-0`}>{lang === 'no' ? 'Nedbør (mm)' : 'Precipitation (mm)'}</div>
          <div className="flex-1 min-h-0"><PrecipChart data={precips} isDark={isDark} lang={lang} /></div>
        </div>
        <div className="flex flex-col min-h-0">
          <div className={`text-sm font-medium ${textMuted} mb-1 shrink-0`}>{lang === 'no' ? 'Skydekke (%)' : 'Cloud Cover (%)'}</div>
          <div className="flex-1 min-h-0"><CloudChart data={clouds} isDark={isDark} lang={lang} /></div>
        </div>
      </div>
    </div>
  );
}

// SVG Chart Components
function TemperatureChart({ data, isDark, lang }) {
  if (!data.length) return null;

  const width = 600;
  const height = 190;
  const padding = { top: 12, right: 8, bottom: 22, left: 28 };
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
  for (let v = Math.ceil(minT / stepSize) * stepSize; v <= maxT; v += stepSize) ySteps.push(v);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {ySteps.map(v => (
        <g key={v}>
          <line x1={padding.left} y1={yScale(v)} x2={width - padding.right} y2={yScale(v)} stroke={isDark ? '#475569' : '#e2e8f0'} strokeDasharray="2,2" />
          <text x={padding.left - 5} y={yScale(v) + 4} fontSize="12" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">{v}°</text>
        </g>
      ))}
      <polyline points={data.map((d, i) => `${xScale(i)},${yScale(d.high)}`).join(' ')} fill="none" stroke="#f97316" strokeWidth="2.5" />
      <polyline points={data.map((d, i) => `${xScale(i)},${yScale(d.low)}`).join(' ')} fill="none" stroke="#3b82f6" strokeWidth="2.5" />
      {data.map((d, i) => {
        const date = new Date(d.date);
        const dayName = date.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', { weekday: 'long' });
        return (
          <g key={i}>
            <circle cx={xScale(i)} cy={yScale(d.high)} r="4" fill="#f97316" />
            <circle cx={xScale(i)} cy={yScale(d.low)} r="4" fill="#3b82f6" />
            <text x={xScale(i)} y={height - 6} fontSize="11" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="middle">{dayName}</text>
          </g>
        );
      })}
    </svg>
  );
}

function WindChart({ data, isDark, lang }) {
  if (!data.length) return null;

  const width = 600;
  const height = 190;
  const padding = { top: 18, right: 8, bottom: 22, left: 28 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const maxW = Math.ceil(Math.max(...data.map(d => d.value), 10) / 5) * 5;
  const barWidth = (w / data.length) * 0.6;

  const ySteps = [];
  for (let v = 0; v <= maxW; v += 5) ySteps.push(v);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {ySteps.map(v => (
        <g key={v}>
          <line x1={padding.left} y1={padding.top + h - (v / maxW) * h} x2={width - padding.right} y2={padding.top + h - (v / maxW) * h} stroke={isDark ? '#475569' : '#e2e8f0'} strokeDasharray="2,2" />
          <text x={padding.left - 5} y={padding.top + h - (v / maxW) * h + 4} fontSize="12" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">{v}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const barH = (d.value / maxW) * h;
        const x = padding.left + (i / data.length) * w + (w / data.length - barWidth) / 2;
        const y = padding.top + h - barH;
        const color = d.value < 5 ? '#22c55e' : d.value < 10 ? '#eab308' : d.value < 15 ? '#f97316' : '#ef4444';
        const date = new Date(d.date);
        const dayName = date.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', { weekday: 'long' });
        return (
          <g key={i}>
            <rect x={x} y={y} width={barWidth} height={barH} fill={color} rx="3" />
            <text x={x + barWidth / 2} y={y - 4} fontSize="11" fill={isDark ? '#e2e8f0' : '#334155'} textAnchor="middle" fontWeight="600">{d.value.toFixed(0)}</text>
            <text x={x + barWidth / 2} y={height - 6} fontSize="11" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="middle">{dayName}</text>
          </g>
        );
      })}
    </svg>
  );
}

function PrecipChart({ data, isDark, lang }) {
  if (!data.length) return null;

  const width = 600;
  const height = 190;
  const padding = { top: 18, right: 8, bottom: 22, left: 28 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const maxP = Math.max(Math.ceil(Math.max(...data.map(d => d.value)) / 5) * 5, 5);
  const barWidth = (w / data.length) * 0.6;

  const ySteps = [];
  const stepSize = maxP > 20 ? 10 : maxP > 10 ? 5 : 2;
  for (let v = 0; v <= maxP; v += stepSize) ySteps.push(v);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="precipGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      {ySteps.map(v => (
        <g key={v}>
          <line x1={padding.left} y1={padding.top + h - (v / maxP) * h} x2={width - padding.right} y2={padding.top + h - (v / maxP) * h} stroke={isDark ? '#475569' : '#e2e8f0'} strokeDasharray="2,2" />
          <text x={padding.left - 5} y={padding.top + h - (v / maxP) * h + 4} fontSize="12" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">{v}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const barH = (d.value / maxP) * h;
        const x = padding.left + (i / data.length) * w + (w / data.length - barWidth) / 2;
        const y = padding.top + h - barH;
        const date = new Date(d.date);
        const dayName = date.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', { weekday: 'long' });
        return (
          <g key={i}>
            <rect x={x} y={y} width={barWidth} height={barH} fill="url(#precipGrad)" rx="3" />
            {d.value > 0.1 && <text x={x + barWidth / 2} y={y - 4} fontSize="11" fill={isDark ? '#e2e8f0' : '#334155'} textAnchor="middle" fontWeight="600">{d.value.toFixed(1)}</text>}
            <text x={x + barWidth / 2} y={height - 6} fontSize="11" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="middle">{dayName}</text>
          </g>
        );
      })}
    </svg>
  );
}

function CloudChart({ data, isDark, lang }) {
  if (!data.length) return null;

  const width = 600;
  const height = 190;
  const padding = { top: 12, right: 8, bottom: 22, left: 32 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const xScale = (i) => padding.left + (i / (data.length - 1)) * w;
  const yScale = (c) => padding.top + h - (c / 100) * h;

  const ySteps = [0, 25, 50, 75, 100];
  const points = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' L ');
  const areaPath = `M ${xScale(0)},${padding.top + h} L ${points} L ${xScale(data.length - 1)},${padding.top + h} Z`;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="cloudGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={isDark ? '#94a3b8' : '#64748b'} stopOpacity="0.5" />
          <stop offset="100%" stopColor={isDark ? '#94a3b8' : '#64748b'} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {ySteps.map(v => (
        <g key={v}>
          <line x1={padding.left} y1={yScale(v)} x2={width - padding.right} y2={yScale(v)} stroke={isDark ? '#475569' : '#e2e8f0'} strokeDasharray="2,2" />
          <text x={padding.left - 5} y={yScale(v) + 4} fontSize="12" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">{v}%</text>
        </g>
      ))}
      <path d={areaPath} fill="url(#cloudGrad)" />
      <polyline points={data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ')} fill="none" stroke={isDark ? '#94a3b8' : '#64748b'} strokeWidth="2.5" />
      {data.map((d, i) => {
        const date = new Date(d.date);
        const dayName = date.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', { weekday: 'long' });
        return (
          <g key={i}>
            <circle cx={xScale(i)} cy={yScale(d.value)} r="4" fill={isDark ? '#94a3b8' : '#64748b'} />
            <text x={xScale(i)} y={height - 6} fontSize="11" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="middle">{dayName}</text>
          </g>
        );
      })}
    </svg>
  );
}

function AuroraSection({ kp, lang, isDark, bgCard, textMuted }) {
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

  // Chart dimensions for aurora forecast
  const chartWidth = 220;
  const chartHeight = 80;
  const padding = { top: 18, right: 8, bottom: 4, left: 8 };
  const w = chartWidth - padding.left - padding.right;
  const h = chartHeight - padding.top - padding.bottom;
  const barWidth = (w / kpForecast.length) * 0.75;

  return (
    <div className={`${bgCard} rounded-lg p-4 h-full flex flex-col ${isDark ? 'bg-gradient-to-br from-purple-900/30 to-emerald-900/30' : 'bg-gradient-to-br from-purple-50 to-emerald-50'}`}>
      <h3 className={`text-base font-semibold mb-3 ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
        {lang === 'no' ? 'Nordlys' : 'Aurora'}
      </h3>
      <div className="flex items-center gap-3">
        <div className="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <path d="M 10 70 A 40 40 0 1 1 90 70" fill="none" stroke={isDark ? '#475569' : '#e2e8f0'} strokeWidth="10" />
            <path d="M 10 70 A 40 40 0 1 1 90 70" fill="none" stroke={getKpColor(currentKp)} strokeWidth="10" strokeDasharray={`${(currentKp / 9) * 188} 188`} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pt-2">
            <span className="text-2xl font-bold" style={{ color: getKpColor(currentKp) }}>{currentKp.toFixed(1)}</span>
          </div>
        </div>
        <div className="flex-1">
          <div className="text-lg font-semibold" style={{ color: getKpColor(currentKp) }}>{getActivityLevel(currentKp)}</div>
          <div className={`text-sm ${textMuted}`}>Kp-indeks</div>
        </div>
      </div>

      {/* Aurora forecast bar chart */}
      {kpForecast.length > 0 && (
        <div className="mt-auto pt-2">
          <div className={`text-sm ${textMuted} mb-1`}>{lang === 'no' ? 'Neste 24t' : 'Next 24h'}</div>
          <svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet">
            {kpForecast.map((k, i) => {
              const barH = (k.kp / 9) * h;
              const x = padding.left + (i / kpForecast.length) * w + (w / kpForecast.length - barWidth) / 2;
              const y = padding.top + h - barH;
              return (
                <g key={i}>
                  <rect x={x} y={y} width={barWidth} height={barH} fill={getKpColor(k.kp)} rx="2" />
                  <text x={x + barWidth / 2} y={y - 3} fontSize="10" fill={isDark ? '#e2e8f0' : '#334155'} textAnchor="middle" fontWeight="600">{k.kp.toFixed(1)}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

// Horizontal Aurora section - two rows: top (gauge+info), bottom (bar chart)
function AuroraSectionHorizontal({ kp, lang, isDark, bgCard, textMuted }) {
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

  const getVisibilityLat = (k) => {
    if (k < 2) return 70;
    if (k < 4) return 65;
    if (k < 6) return 60;
    if (k < 8) return 55;
    return 50;
  };

  return (
    <div className={`${bgCard} rounded-lg p-3 h-full flex flex-col ${isDark ? 'bg-gradient-to-br from-purple-900/30 to-emerald-900/30' : 'bg-gradient-to-br from-purple-50 to-emerald-50'}`}>
      {/* Top row: Kp gauge + info text side by side */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Kp gauge */}
        <div className="relative w-14 h-14 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <path d="M 10 70 A 40 40 0 1 1 90 70" fill="none" stroke={isDark ? '#475569' : '#e2e8f0'} strokeWidth="12" />
            <path d="M 10 70 A 40 40 0 1 1 90 70" fill="none" stroke={getKpColor(currentKp)} strokeWidth="12" strokeDasharray={`${(currentKp / 9) * 188} 188`} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pt-1">
            <span className="text-xl font-bold" style={{ color: getKpColor(currentKp) }}>{currentKp.toFixed(1)}</span>
          </div>
        </div>
        {/* Info text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className={`text-sm lg:text-base font-semibold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
              {lang === 'no' ? 'Nordlys' : 'Aurora'}
            </h3>
            <span className="text-sm lg:text-base font-bold" style={{ color: getKpColor(currentKp) }}>{getActivityLevel(currentKp)}</span>
          </div>
          <div className={`text-xs lg:text-sm ${textMuted}`}>
            Kp-indeks &bull; {lang === 'no' ? 'Synlig ned til' : 'Visible to'} ~{getVisibilityLat(currentKp)}°N
          </div>
        </div>
      </div>

      {/* Bottom row: Forecast bar chart - fills remaining space */}
      {kpForecast.length > 0 && (
        <div className="flex-1 flex flex-col mt-2 min-h-0">
          <div className={`text-xs ${textMuted} mb-1 shrink-0`}>{lang === 'no' ? 'Neste 24 timer' : 'Next 24 hours'}</div>
          <div className="flex-1 flex items-end gap-1">
            {kpForecast.map((k, i) => {
              const barH = Math.max(8, (k.kp / 9) * 100);
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div className="text-xs font-semibold mb-0.5" style={{ color: getKpColor(k.kp) }}>{k.kp.toFixed(1)}</div>
                  <div
                    className="w-full rounded-t"
                    style={{ height: `${barH}%`, backgroundColor: getKpColor(k.kp), minHeight: '6px' }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MoonPhasesSection({ daily, lang, isDark, bgCard, textMuted }) {
  const getIllumination = (deg) => Math.round((1 - Math.cos(deg * Math.PI / 180)) / 2 * 100);

  return (
    <div className={`${bgCard} rounded-lg px-3 py-2 h-full flex flex-col`}>
      <h3 className={`text-sm font-semibold mb-1 shrink-0 ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
        {lang === 'no' ? 'Månefaser' : 'Moon Phases'}
      </h3>
      <div className="flex items-center flex-1 overflow-x-auto gap-1">
        {daily.map((day, i) => {
          const date = new Date(day.date);
          const dayName = date.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', { weekday: 'short' });
          const illum = day.moonphase != null ? getIllumination(day.moonphase) : null;
          return (
            <div key={day.date} className={`text-center flex-1 min-w-[48px] ${i === 0 ? 'font-medium' : ''}`}>
              <div className="text-xs font-medium truncate">{dayName}</div>
              <div className="flex justify-center my-0.5">
                {day.moonphase != null ? <MoonPhaseIcon degree={day.moonphase} size={28} /> : <div className="w-7 h-7 rounded-full bg-slate-600" />}
              </div>
              {illum != null && <div className="text-xs">{illum}%</div>}
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
      return new Date(iso).toLocaleTimeString(lang === 'no' ? 'nb-NO' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso.slice(11, 16);
    }
  };

  return (
    <div className={`${bgCard} rounded-lg px-3 py-2 h-full flex flex-col`}>
      <h3 className={`text-sm font-semibold mb-1 shrink-0 ${isDark ? 'text-orange-400' : 'text-orange-600'}`}>
        {lang === 'no' ? 'Sol' : 'Sun'}
      </h3>
      <div className="flex items-center flex-1 overflow-x-auto gap-1">
        {daily.map((day, i) => {
          const date = new Date(day.date);
          const dayName = date.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', { weekday: 'short' });
          return (
            <div key={day.date} className={`text-center flex-1 min-w-[48px] ${i === 0 ? 'font-medium' : ''}`}>
              <div className="text-xs font-medium truncate">{dayName}</div>
              <div className="text-xs text-yellow-500">{formatTime(day.sunrise)}</div>
              <div className="text-xs text-orange-500">{formatTime(day.sunset)}</div>
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
    </svg>
  );
}

function HumidityIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  );
}

function WindChillIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z" />
      <path d="M2 10h3M2 14h3M19 10h3M19 14h3" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

function SnowflakeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
    </svg>
  );
}

function PrecipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M16 14v6m-4-4v6m-4-2v6" />
    </svg>
  );
}

// ============ Helpers ============

function getWindDir(deg, lang) {
  if (deg == null) return '';
  const dirs = lang === 'no'
    ? ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV']
    : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}
