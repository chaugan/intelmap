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
        style={{ width: '90vw', maxWidth: '1400px', maxHeight: '95vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Actions bar (outside capture area) */}
        <div className="flex items-center justify-end gap-2 mb-2">
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white"
          >
            {isDark ? (lang === 'no' ? 'Lys' : 'Light') : (lang === 'no' ? 'Mork' : 'Dark')}
          </button>
          <button
            onClick={handleSaveReport}
            disabled={exporting || loading}
            className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            {exporting ? '...' : (lang === 'no' ? 'Lagre rapport' : 'Save Report')}
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded bg-slate-700 hover:bg-red-600 text-white text-lg"
          >
            &times;
          </button>
        </div>

        {/* Report content (4:3 aspect ratio container) */}
        <div
          ref={reportRef}
          className={`${bg} ${text} rounded-lg overflow-y-auto shadow-2xl`}
          style={{ aspectRatio: '4/3', maxHeight: 'calc(95vh - 50px)' }}
        >
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className={`text-lg ${textMuted}`}>{t('weather.loading', lang)}</div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-red-400">{error}</div>
            </div>
          )}

          {data && !loading && (
            <div className="p-6 space-y-6">
              {/* Header */}
              <ReportHeader data={data} lang={lang} accent={accent} textMuted={textMuted} />

              {/* Current Conditions Hero */}
              <CurrentConditionsHero
                current={data.current}
                snowDepth={data.snowDepth}
                lang={lang}
                isDark={isDark}
                bgCard={bgCard}
                textMuted={textMuted}
              />

              {/* 7-Day Forecast Cards */}
              <SevenDayForecast
                daily={data.daily}
                lang={lang}
                isDark={isDark}
                bgCard={bgCard}
                textMuted={textMuted}
                border={border}
              />

              {/* Trend Charts */}
              <TrendCharts
                daily={data.daily}
                lang={lang}
                isDark={isDark}
                bgCard={bgCard}
                textMuted={textMuted}
              />

              {/* Aurora Section (only for northern locations) */}
              {showAurora && data.kp && (
                <AuroraSection
                  kp={data.kp}
                  aurora={data.aurora}
                  lang={lang}
                  isDark={isDark}
                  bgCard={bgCard}
                  textMuted={textMuted}
                />
              )}

              {/* Moon Phases */}
              <MoonPhasesSection
                daily={data.daily}
                lang={lang}
                isDark={isDark}
                bgCard={bgCard}
                textMuted={textMuted}
              />

              {/* Sun Times */}
              <SunTimesSection
                daily={data.daily}
                lang={lang}
                isDark={isDark}
                bgCard={bgCard}
                textMuted={textMuted}
              />

              {/* Footer */}
              <div className={`text-center text-[10px] ${textMuted} pt-4 border-t ${border}`}>
                IntelMap Weather Report &bull; {new Date().toLocaleString(lang === 'no' ? 'nb' : 'en')}
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

  return (
    <div className="text-center">
      <h1 className={`text-2xl font-bold ${accent}`}>
        {data.location.name || `${data.location.lat.toFixed(4)}°N, ${data.location.lon.toFixed(4)}°E`}
      </h1>
      {data.location.name && (
        <div className={`text-xs ${textMuted}`}>
          {data.location.lat.toFixed(4)}°N, {data.location.lon.toFixed(4)}°E
        </div>
      )}
      <div className={`text-sm ${textMuted} mt-1`}>{dateStr}</div>
      <div className={`text-xs font-medium ${textMuted} mt-1`}>
        {lang === 'no' ? 'IntelMap Værrapport' : 'IntelMap Weather Report'}
      </div>
    </div>
  );
}

function CurrentConditionsHero({ current, snowDepth, lang, isDark, bgCard, textMuted }) {
  if (!current) return null;

  const tempColor = current.temperature < 0 ? 'text-blue-400' : current.temperature > 20 ? 'text-orange-400' : '';
  const windDir = getWindDir(current.windDirection);

  return (
    <div className={`${bgCard} rounded-xl p-5 ${isDark ? 'bg-gradient-to-br from-slate-700/80 to-slate-800/80' : 'bg-gradient-to-br from-white to-slate-100'}`}>
      <div className="flex items-center justify-center gap-6 mb-4">
        {current.symbol && <WeatherIcon symbol={current.symbol} size={72} />}
        <div className="text-center">
          <div className={`text-5xl font-bold ${tempColor}`}>
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

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-center text-xs">
        <StatBox
          icon={<WindIcon />}
          label={lang === 'no' ? 'Vind' : 'Wind'}
          value={`${current.windSpeed?.toFixed(1)} m/s ${windDir}`}
          isDark={isDark}
        />
        <StatBox
          icon={<HumidityIcon />}
          label={lang === 'no' ? 'Fuktighet' : 'Humidity'}
          value={`${current.humidity?.toFixed(0)}%`}
          isDark={isDark}
        />
        <StatBox
          icon={<PressureIcon />}
          label={lang === 'no' ? 'Trykk' : 'Pressure'}
          value={`${current.pressure?.toFixed(0)} hPa`}
          isDark={isDark}
        />
        <StatBox
          icon={<CloudIcon />}
          label={lang === 'no' ? 'Skyer' : 'Clouds'}
          value={`${current.cloudCover?.toFixed(0)}%`}
          isDark={isDark}
        />
        {current.uvIndex != null && (
          <StatBox
            icon={<UVIcon />}
            label="UV"
            value={current.uvIndex.toFixed(1)}
            isDark={isDark}
          />
        )}
        {snowDepth && (
          <StatBox
            icon={<SnowflakeIcon />}
            label={lang === 'no' ? 'Snødybde' : 'Snow'}
            value={snowDepth.label?.[lang] || snowDepth.depth}
            isDark={isDark}
          />
        )}
      </div>
    </div>
  );
}

function StatBox({ icon, label, value, isDark }) {
  return (
    <div className={`${isDark ? 'bg-slate-600/50' : 'bg-slate-100'} rounded-lg p-2`}>
      <div className="flex justify-center mb-1 opacity-70">{icon}</div>
      <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function SevenDayForecast({ daily, lang, isDark, bgCard, textMuted, border }) {
  return (
    <div>
      <h2 className={`text-sm font-semibold mb-3 ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}>
        {lang === 'no' ? '7-dagers prognose' : '7-Day Forecast'}
      </h2>
      <div className="grid grid-cols-7 gap-2">
        {daily.map((day, i) => {
          const date = new Date(day.date);
          const dayName = date.toLocaleDateString(lang === 'no' ? 'nb' : 'en', { weekday: 'short' });
          const dateNum = date.getDate();

          const tempHighColor = day.tempHigh < 0 ? 'text-blue-400' : day.tempHigh > 20 ? 'text-orange-400' : '';
          const tempLowColor = day.tempLow < 0 ? 'text-blue-300' : '';

          return (
            <div
              key={day.date}
              className={`${bgCard} rounded-lg p-2 text-center ${i === 0 ? `ring-2 ${isDark ? 'ring-cyan-500' : 'ring-blue-500'}` : ''}`}
            >
              <div className="font-medium text-xs">{dayName}</div>
              <div className={`text-[10px] ${textMuted}`}>{dateNum}</div>
              <div className="my-2 flex justify-center">
                {day.symbol ? <WeatherIcon symbol={day.symbol} size={36} /> : <div className="w-9 h-9" />}
              </div>
              <div className={`text-sm font-bold ${tempHighColor}`}>
                {day.tempHigh?.toFixed(0)}°
              </div>
              <div className={`text-xs ${tempLowColor || textMuted}`}>
                {day.tempLow?.toFixed(0)}°
              </div>
              {day.precipitation > 0.1 && (
                <div className="text-[10px] text-blue-400 mt-1">
                  {day.precipitation.toFixed(1)} mm
                </div>
              )}
              <div className={`text-[10px] ${textMuted} mt-1`}>
                {day.windMax?.toFixed(0)} m/s
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrendCharts({ daily, lang, isDark, bgCard, textMuted }) {
  const chartHeight = 80;
  const chartWidth = 280;

  // Extract data arrays
  const temps = daily.map(d => ({ high: d.tempHigh, low: d.tempLow }));
  const winds = daily.map(d => d.windMax || 0);
  const precips = daily.map(d => d.precipitation || 0);
  const clouds = daily.map(d => d.cloudAvg || 0);

  return (
    <div>
      <h2 className={`text-sm font-semibold mb-3 ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}>
        {lang === 'no' ? 'Trender' : 'Trends'}
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ChartCard title={lang === 'no' ? 'Temperatur' : 'Temperature'} isDark={isDark} bgCard={bgCard} textMuted={textMuted}>
          <TemperatureChart data={temps} width={chartWidth} height={chartHeight} isDark={isDark} />
        </ChartCard>
        <ChartCard title={lang === 'no' ? 'Vind' : 'Wind'} isDark={isDark} bgCard={bgCard} textMuted={textMuted}>
          <WindChart data={winds} width={chartWidth} height={chartHeight} isDark={isDark} />
        </ChartCard>
        <ChartCard title={lang === 'no' ? 'Nedbør' : 'Precipitation'} isDark={isDark} bgCard={bgCard} textMuted={textMuted}>
          <PrecipChart data={precips} width={chartWidth} height={chartHeight} isDark={isDark} />
        </ChartCard>
        <ChartCard title={lang === 'no' ? 'Skydekke' : 'Cloud Cover'} isDark={isDark} bgCard={bgCard} textMuted={textMuted}>
          <CloudChart data={clouds} width={chartWidth} height={chartHeight} isDark={isDark} />
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, children, isDark, bgCard, textMuted }) {
  return (
    <div className={`${bgCard} rounded-lg p-3`}>
      <div className={`text-[10px] font-medium ${textMuted} mb-2`}>{title}</div>
      <div className="w-full overflow-hidden">{children}</div>
    </div>
  );
}

// SVG Chart Components
function TemperatureChart({ data, width, height, isDark }) {
  if (!data.length) return null;

  const padding = { top: 10, right: 10, bottom: 20, left: 25 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const allTemps = data.flatMap(d => [d.high, d.low]).filter(t => t != null);
  const minT = Math.min(...allTemps) - 2;
  const maxT = Math.max(...allTemps) + 2;

  const xScale = (i) => padding.left + (i / (data.length - 1)) * w;
  const yScale = (t) => padding.top + h - ((t - minT) / (maxT - minT)) * h;

  const highPoints = data.map((d, i) => `${xScale(i)},${yScale(d.high)}`).join(' ');
  const lowPoints = data.map((d, i) => `${xScale(i)},${yScale(d.low)}`).join(' ');

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map(f => (
        <line
          key={f}
          x1={padding.left} y1={padding.top + h * f}
          x2={width - padding.right} y2={padding.top + h * f}
          stroke={isDark ? '#475569' : '#cbd5e1'}
          strokeDasharray="2,2"
        />
      ))}
      {/* High temp line */}
      <polyline points={highPoints} fill="none" stroke="#f97316" strokeWidth="2" />
      {/* Low temp line */}
      <polyline points={lowPoints} fill="none" stroke="#3b82f6" strokeWidth="2" />
      {/* Dots */}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={xScale(i)} cy={yScale(d.high)} r="3" fill="#f97316" />
          <circle cx={xScale(i)} cy={yScale(d.low)} r="3" fill="#3b82f6" />
        </g>
      ))}
      {/* Y-axis labels */}
      <text x={padding.left - 3} y={padding.top + 4} fontSize="8" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">
        {maxT.toFixed(0)}°
      </text>
      <text x={padding.left - 3} y={height - padding.bottom} fontSize="8" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">
        {minT.toFixed(0)}°
      </text>
    </svg>
  );
}

function WindChart({ data, width, height, isDark }) {
  if (!data.length) return null;

  const padding = { top: 10, right: 10, bottom: 20, left: 25 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const maxW = Math.max(...data, 10);
  const barWidth = w / data.length - 4;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {data.map((d, i) => {
        const barH = (d / maxW) * h;
        const x = padding.left + (i / data.length) * w + 2;
        const y = padding.top + h - barH;
        // Color gradient based on wind speed
        const color = d < 5 ? '#22c55e' : d < 10 ? '#eab308' : d < 15 ? '#f97316' : '#ef4444';
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barH}
            fill={color}
            rx="2"
          />
        );
      })}
      {/* Y-axis label */}
      <text x={padding.left - 3} y={padding.top + 4} fontSize="8" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">
        {maxW.toFixed(0)}
      </text>
      <text x={padding.left - 3} y={height - padding.bottom} fontSize="8" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">
        0
      </text>
    </svg>
  );
}

function PrecipChart({ data, width, height, isDark }) {
  if (!data.length) return null;

  const padding = { top: 10, right: 10, bottom: 20, left: 25 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const maxP = Math.max(...data, 5);
  const barWidth = w / data.length - 4;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="precipGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      {data.map((d, i) => {
        const barH = (d / maxP) * h;
        const x = padding.left + (i / data.length) * w + 2;
        const y = padding.top + h - barH;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barH}
            fill="url(#precipGrad)"
            rx="2"
          />
        );
      })}
      <text x={padding.left - 3} y={padding.top + 4} fontSize="8" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">
        {maxP.toFixed(0)}mm
      </text>
    </svg>
  );
}

function CloudChart({ data, width, height, isDark }) {
  if (!data.length) return null;

  const padding = { top: 10, right: 10, bottom: 20, left: 25 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const xScale = (i) => padding.left + (i / (data.length - 1)) * w;
  const yScale = (c) => padding.top + h - (c / 100) * h;

  // Create area path
  const points = data.map((d, i) => `${xScale(i)},${yScale(d)}`).join(' L ');
  const areaPath = `M ${xScale(0)},${padding.top + h} L ${points} L ${xScale(data.length - 1)},${padding.top + h} Z`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="cloudGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={isDark ? '#94a3b8' : '#64748b'} stopOpacity="0.5" />
          <stop offset="100%" stopColor={isDark ? '#94a3b8' : '#64748b'} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#cloudGrad)" />
      <polyline
        points={data.map((d, i) => `${xScale(i)},${yScale(d)}`).join(' ')}
        fill="none"
        stroke={isDark ? '#94a3b8' : '#64748b'}
        strokeWidth="2"
      />
      <text x={padding.left - 3} y={padding.top + 4} fontSize="8" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">
        100%
      </text>
      <text x={padding.left - 3} y={height - padding.bottom} fontSize="8" fill={isDark ? '#94a3b8' : '#64748b'} textAnchor="end">
        0%
      </text>
    </svg>
  );
}

function AuroraSection({ kp, aurora, lang, isDark, bgCard, textMuted }) {
  // Get current Kp value
  const currentKp = kp?.kp_index?.[0]?.kp || 0;
  const kpForecast = kp?.kp_index?.slice(0, 8) || [];

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
    <div className={`${bgCard} rounded-xl p-4 ${isDark ? 'bg-gradient-to-r from-purple-900/30 to-emerald-900/30' : 'bg-gradient-to-r from-purple-100 to-emerald-100'}`}>
      <h2 className={`text-sm font-semibold mb-3 ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
        {lang === 'no' ? 'Nordlysprognose' : 'Aurora Forecast'}
      </h2>
      <div className="flex items-center gap-6">
        {/* Kp Gauge */}
        <div className="text-center">
          <div className="relative w-20 h-20">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              {/* Background arc */}
              <path
                d="M 10 70 A 40 40 0 1 1 90 70"
                fill="none"
                stroke={isDark ? '#475569' : '#e2e8f0'}
                strokeWidth="8"
              />
              {/* Filled arc based on Kp */}
              <path
                d="M 10 70 A 40 40 0 1 1 90 70"
                fill="none"
                stroke={getKpColor(currentKp)}
                strokeWidth="8"
                strokeDasharray={`${(currentKp / 9) * 188} 188`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-bold" style={{ color: getKpColor(currentKp) }}>
                {currentKp.toFixed(1)}
              </span>
            </div>
          </div>
          <div className={`text-xs ${textMuted}`}>Kp Index</div>
        </div>

        {/* Activity info */}
        <div className="flex-1">
          <div className="text-sm font-medium" style={{ color: getKpColor(currentKp) }}>
            {getActivityLevel(currentKp)}
          </div>
          <div className={`text-xs ${textMuted} mt-1`}>
            {lang === 'no' ? 'Neste 24t prognose:' : 'Next 24h forecast:'}
          </div>
          {/* Mini forecast bars */}
          <div className="flex gap-1 mt-2">
            {kpForecast.map((k, i) => (
              <div
                key={i}
                className="w-4 rounded-sm"
                style={{
                  height: `${Math.max(8, (k.kp / 9) * 30)}px`,
                  backgroundColor: getKpColor(k.kp),
                }}
                title={`${k.time_tag}: Kp ${k.kp}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MoonPhasesSection({ daily, lang, isDark, bgCard, textMuted }) {
  const getMoonPhaseName = (deg) => {
    if (deg < 45) return lang === 'no' ? 'Nymane' : 'New Moon';
    if (deg < 135) return lang === 'no' ? 'Forste kvarter' : 'First Quarter';
    if (deg < 225) return lang === 'no' ? 'Fullmane' : 'Full Moon';
    if (deg < 315) return lang === 'no' ? 'Siste kvarter' : 'Last Quarter';
    return lang === 'no' ? 'Nymane' : 'New Moon';
  };

  const getIllumination = (deg) => {
    return Math.round((1 - Math.cos(deg * Math.PI / 180)) / 2 * 100);
  };

  return (
    <div className={`${bgCard} rounded-lg p-4`}>
      <h2 className={`text-sm font-semibold mb-3 ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
        {lang === 'no' ? 'Manefaser' : 'Moon Phases'}
      </h2>
      <div className="flex justify-between">
        {daily.map((day, i) => {
          const date = new Date(day.date);
          const dayName = date.toLocaleDateString(lang === 'no' ? 'nb' : 'en', { weekday: 'short' });

          return (
            <div key={day.date} className={`text-center ${i === 0 ? 'font-medium' : ''}`}>
              <div className={`text-[10px] ${textMuted}`}>{dayName}</div>
              <div className="my-1 flex justify-center">
                {day.moonphase != null ? (
                  <MoonPhaseIcon degree={day.moonphase} size={24} />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-slate-600" />
                )}
              </div>
              {day.moonphase != null && (
                <div className={`text-[9px] ${textMuted}`}>
                  {getIllumination(day.moonphase)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SunTimesSection({ daily, lang, isDark, bgCard, textMuted }) {
  return (
    <div className={`${bgCard} rounded-lg p-4`}>
      <h2 className={`text-sm font-semibold mb-3 ${isDark ? 'text-orange-400' : 'text-orange-600'}`}>
        {lang === 'no' ? 'Sol opp/ned' : 'Sunrise/Sunset'}
      </h2>
      <div className="grid grid-cols-7 gap-2 text-center text-[10px]">
        {daily.map((day) => {
          const date = new Date(day.date);
          const dayName = date.toLocaleDateString(lang === 'no' ? 'nb' : 'en', { weekday: 'short' });

          const formatTime = (iso) => {
            if (!iso) return '-';
            try {
              return new Date(iso).toLocaleTimeString(lang === 'no' ? 'nb' : 'en', { hour: '2-digit', minute: '2-digit' });
            } catch {
              return iso.slice(11, 16);
            }
          };

          return (
            <div key={day.date}>
              <div className={textMuted}>{dayName}</div>
              <div className="text-yellow-500 mt-1">{formatTime(day.sunrise)}</div>
              <div className="text-orange-500">{formatTime(day.sunset)}</div>
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

function UVIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
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

// ============ Helpers ============

function getWindDir(deg) {
  if (deg == null) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}
