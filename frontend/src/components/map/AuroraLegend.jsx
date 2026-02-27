import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

const TIME_OPTIONS = [
  { value: 0, labelKey: 'aurora.now' },
  { value: 1, labelKey: 'aurora.nextHour' },
  { value: 2, labelKey: 'aurora.next3Hours' },
  { value: 3, labelKey: 'aurora.tomorrow' },
  { value: 4, labelKey: 'aurora.dayAfter' },
];

const KP_ACTIVITY_COLORS = {
  quiet: '#4ade80',
  unsettled: '#a3e635',
  active: '#facc15',
  minor_storm: '#fb923c',
  moderate_storm: '#f87171',
  severe_storm: '#ef4444',
};

export default function AuroraLegend({ kpData }) {
  const lang = useMapStore((s) => s.lang);
  const timeOffset = useMapStore((s) => s.auroraTimeOffset);
  const setTimeOffset = useMapStore((s) => s.setAuroraTimeOffset);
  const setActivePanel = useMapStore((s) => s.setActivePanel);

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
  const activityColor = kpInfo?.activity?.level
    ? KP_ACTIVITY_COLORS[kpInfo.activity.level] || '#4ade80'
    : '#4ade80';

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

      {/* Intensity gradient bar */}
      <div className="mb-2">
        <div
          className="h-3 rounded-sm"
          style={{
            background: 'linear-gradient(to right, rgba(0,100,0,0.3), rgba(0,180,0,0.5), rgba(0,255,100,0.7), rgba(100,255,150,0.8), rgba(150,255,200,0.9))',
          }}
        />
        <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
          <span>{t('aurora.none', lang)}</span>
          <span>{t('aurora.low', lang)}</span>
          <span>{t('aurora.moderate', lang)}</span>
          <span>{t('aurora.high', lang)}</span>
        </div>
      </div>

      {/* Kp index display */}
      {kpInfo && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-slate-400 text-[10px]">{t('aurora.kpIndex', lang)}:</span>
          <span className="font-semibold" style={{ color: activityColor }}>
            {typeof kpInfo.kp === 'number' ? kpInfo.kp.toFixed(1) : '?'}
            {kpInfo.activity && ` (${kpInfo.activity[lang === 'no' ? 'no' : 'en']})`}
            {kpInfo.maxKp && (
              <span className="text-slate-400 text-[9px] ml-1">
                {lang === 'no' ? 'maks' : 'max'} {kpInfo.maxKp.toFixed(1)}
              </span>
            )}
          </span>
        </div>
      )}

      {/* View details button */}
      <button
        onClick={() => setActivePanel('aurora')}
        className="w-full text-left px-2 py-1 text-[10px] bg-green-800 hover:bg-green-700 rounded transition-colors"
      >
        {t('aurora.viewDetails', lang)}
      </button>

      <div className="text-slate-600 text-[9px] mt-1">noaa.gov / SWPC</div>
    </div>
  );
}
