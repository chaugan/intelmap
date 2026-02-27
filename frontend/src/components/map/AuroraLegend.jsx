import { useState } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

const TIME_OPTIONS = [
  { value: 0, labelKey: 'aurora.now' },
  { value: 1, labelKey: 'aurora.nextHour' },
  { value: 2, labelKey: 'aurora.next3Hours' },
  { value: 3, labelKey: 'aurora.tomorrow' },
  { value: 4, labelKey: 'aurora.dayAfter' },
];

const KP_COLORS = ['#4ade80', '#4ade80', '#a3e635', '#a3e635', '#facc15', '#fb923c', '#f87171', '#ef4444', '#dc2626', '#b91c1c'];

function getLatitudeRegion(lat, lang) {
  if (lat <= 70 && lat > 66) return lang === 'no' ? 'Nord-Norge' : 'Northern Norway';
  if (lat <= 66 && lat > 63) return lang === 'no' ? 'Trøndelag' : 'Central Norway';
  if (lat <= 63 && lat > 60) return lang === 'no' ? 'Midt-Norge' : 'Mid-Norway';
  if (lat <= 60) return lang === 'no' ? 'Sør-Norge' : 'Southern Norway';
  return lang === 'no' ? 'Arktis' : 'Arctic';
}

export default function AuroraLegend({ kpData }) {
  const lang = useMapStore((s) => s.lang);
  const timeOffset = useMapStore((s) => s.auroraTimeOffset);
  const setTimeOffset = useMapStore((s) => s.setAuroraTimeOffset);
  const [hoveredBar, setHoveredBar] = useState(null);

  // Get Kp value based on selected time offset
  const getKpForOffset = () => {
    if (!kpData) return null;

    switch (timeOffset) {
      case 0: return { kp: kpData.current, activity: kpData.currentActivity };
      case 1: return kpData.forecasts?.plus1h
        ? { kp: kpData.forecasts.plus1h.kp, activity: null }
        : null;
      case 2: return kpData.forecasts?.plus3h
        ? { kp: kpData.forecasts.plus3h.kp, activity: null }
        : null;
      case 3: return kpData.forecasts?.tomorrow
        ? { kp: kpData.forecasts.tomorrow.avgKp, maxKp: kpData.forecasts.tomorrow.maxKp, activity: null }
        : null;
      case 4: return kpData.forecasts?.dayAfter
        ? { kp: kpData.forecasts.dayAfter.avgKp, maxKp: kpData.forecasts.dayAfter.maxKp, activity: null }
        : null;
      default: return null;
    }
  };

  const kpInfo = getKpForOffset();
  const kpColorIndex = kpInfo?.kp != null ? Math.min(Math.floor(kpInfo.kp), 9) : 0;
  const kpColor = KP_COLORS[kpColorIndex];

  return (
    <div className="bg-slate-800/90 rounded px-2.5 py-2 text-xs pointer-events-auto min-w-[280px]">
      <div className="text-slate-400 mb-1.5 font-semibold text-[11px]">
        {t('aurora.title', lang)}
      </div>

      {/* Time selector */}
      <div className="flex gap-1 mb-2">
        {TIME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTimeOffset(opt.value)}
            className={`flex-1 px-1 py-0.5 rounded text-[10px] font-medium transition-colors ${
              timeOffset === opt.value
                ? 'bg-green-700 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {t(opt.labelKey, lang)}
          </button>
        ))}
      </div>

      {/* Kp badge with latitude info */}
      {kpInfo && (
        <div className="flex items-center gap-2 mb-2">
          <span
            className="inline-block w-12 h-12 rounded-md text-center leading-[48px] font-bold text-xl"
            style={{ backgroundColor: kpColor, color: '#fff' }}
          >
            {kpInfo.kp?.toFixed(1)}
          </span>
          <div className="flex-1">
            {kpData.auroraLatitude && (
              <div className="text-slate-300 text-[11px]">
                ~{kpData.auroraLatitude}°N ({getLatitudeRegion(kpData.auroraLatitude, lang)})
              </div>
            )}
            {kpInfo.activity && (
              <div className="text-[10px]" style={{ color: kpColor }}>
                {kpInfo.activity[lang === 'no' ? 'no' : 'en']}
              </div>
            )}
            {kpInfo.maxKp && (
              <div className="text-slate-400 text-[9px]">
                {lang === 'no' ? 'Maks' : 'Max'}: {kpInfo.maxKp.toFixed(1)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 24-hour Kp chart with tooltips */}
      {kpData?.hourly?.length > 0 && (
        <div className="bg-slate-900 rounded p-2 mb-2 relative">
          <svg width="100%" height="60" viewBox="0 0 260 60" preserveAspectRatio="none">
            <defs>
              {kpData.hourly.slice(0, 24).map((entry, i) => {
                const kpVal = Math.min(Math.floor(entry.kp), 9);
                const topColor = KP_COLORS[kpVal];
                return (
                  <linearGradient key={`grad-${i}`} id={`aurora-bar-grad-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor={topColor} stopOpacity="1" />
                    <stop offset="50%" stopColor={topColor} stopOpacity="0.6" />
                    <stop offset="100%" stopColor={topColor} stopOpacity="0.1" />
                  </linearGradient>
                );
              })}
            </defs>
            {/* Grid lines - adjusted for new viewBox */}
            <line x1="0" y1="15" x2="220" y2="15" stroke="#334155" strokeWidth="0.5" />
            <line x1="0" y1="30" x2="220" y2="30" stroke="#334155" strokeWidth="0.5" />
            <line x1="0" y1="45" x2="220" y2="45" stroke="#334155" strokeWidth="0.5" />
            {/* Y-axis labels on the right, outside bar area */}
            <text x="235" y="18" fill="#64748b" fontSize="8" textAnchor="middle">6</text>
            <text x="235" y="33" fill="#64748b" fontSize="8" textAnchor="middle">4</text>
            <text x="235" y="48" fill="#64748b" fontSize="8" textAnchor="middle">2</text>
            {/* Bars */}
            {kpData.hourly.slice(0, 24).map((entry, i) => {
              const barWidth = 220 / 24;
              const x = i * barWidth;
              const height = Math.max(3, (entry.kp / 9) * 50);
              const y = 55 - height;
              const hour = new Date(entry.time).getHours();
              return (
                <rect
                  key={i}
                  x={x + 1}
                  y={y}
                  width={barWidth - 2}
                  height={height}
                  fill={`url(#aurora-bar-grad-${i})`}
                  rx="1"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredBar({ i, hour, kp: entry.kp, x: x + barWidth / 2 })}
                  onMouseLeave={() => setHoveredBar(null)}
                />
              );
            })}
          </svg>
          {/* Hour labels */}
          <div className="flex justify-between text-[8px] text-slate-500 mt-0.5" style={{ width: '85%' }}>
            {[0, 6, 12, 18, 24].map((h) => (
              <span key={h}>{h === 24 ? '+24' : h}</span>
            ))}
          </div>
          {/* Hover tooltip */}
          {hoveredBar && (
            <div
              className="absolute bg-slate-950 border border-slate-700 px-2 py-1 rounded text-[10px] text-white pointer-events-none z-10"
              style={{
                left: `${(hoveredBar.x / 260) * 100}%`,
                top: '-4px',
                transform: 'translateX(-50%)',
              }}
            >
              {hoveredBar.hour}:00 — Kp {hoveredBar.kp.toFixed(1)}
            </div>
          )}
        </div>
      )}

      {/* Intensity gradient bar */}
      <div className="mb-1.5">
        <div
          className="h-2.5 rounded-sm"
          style={{
            background: 'linear-gradient(to right, rgba(0,50,10,0.3), rgba(0,100,20,0.5), rgba(0,150,30,0.7), rgba(0,213,37,0.9), rgba(0,213,37,1))',
          }}
        />
        <div className="flex justify-between text-[8px] text-slate-500 mt-0.5">
          <span>{t('aurora.none', lang)}</span>
          <span>{t('aurora.low', lang)}</span>
          <span>{t('aurora.moderate', lang)}</span>
          <span>{t('aurora.high', lang)}</span>
        </div>
      </div>

      <div className="text-slate-600 text-[9px]">noaa.gov / SWPC</div>
    </div>
  );
}
