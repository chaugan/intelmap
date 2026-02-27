import { useEffect, useState } from 'react';
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

export default function AuroraPanel() {
  const lang = useMapStore((s) => s.lang);
  const timeOffset = useMapStore((s) => s.auroraTimeOffset);
  const setTimeOffset = useMapStore((s) => s.setAuroraTimeOffset);
  const [kpData, setKpData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/aurora/kp')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => setKpData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Get Kp value based on selected time offset
  const getKpForOffset = () => {
    if (!kpData) return null;

    switch (timeOffset) {
      case 0: return { kp: kpData.current, activity: kpData.currentActivity, type: 'current' };
      case 1: return kpData.forecasts?.plus1h
        ? { kp: kpData.forecasts.plus1h.kp, activity: null, type: 'forecast' }
        : null;
      case 2: return kpData.forecasts?.plus3h
        ? { kp: kpData.forecasts.plus3h.kp, activity: null, type: 'forecast' }
        : null;
      case 3: return kpData.forecasts?.tomorrow
        ? { kp: kpData.forecasts.tomorrow.avgKp, maxKp: kpData.forecasts.tomorrow.maxKp, type: 'daily' }
        : null;
      case 4: return kpData.forecasts?.dayAfter
        ? { kp: kpData.forecasts.dayAfter.avgKp, maxKp: kpData.forecasts.dayAfter.maxKp, type: 'daily' }
        : null;
      default: return null;
    }
  };

  const kpInfo = getKpForOffset();

  return (
    <div className="flex flex-col h-full p-3 overflow-y-auto">
      <h2 className="text-sm font-semibold text-green-400 mb-3">
        {t('aurora.title', lang)}
      </h2>

      {/* Time selector */}
      <div className="flex gap-1 mb-3">
        {TIME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTimeOffset(opt.value)}
            className={`flex-1 px-1.5 py-1 rounded text-xs font-medium transition-colors ${
              timeOffset === opt.value
                ? 'bg-green-700 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {t(opt.labelKey, lang)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm">{t('general.loading', lang)}</div>
      ) : error ? (
        <div className="text-red-400 text-sm">{error}</div>
      ) : kpData ? (
        <>
          {/* Current Kp display */}
          {kpInfo && (
            <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: KP_COLORS[Math.min(Math.floor(kpInfo.kp), 9)] + '22' }}>
              <div className="text-xs text-slate-300 mb-1">{t('aurora.kpIndex', lang)}</div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-10 h-10 rounded-md text-center leading-10 font-bold text-lg"
                  style={{
                    backgroundColor: KP_COLORS[Math.min(Math.floor(kpInfo.kp), 9)],
                    color: '#fff',
                  }}
                >
                  {kpInfo.kp?.toFixed(1)}
                </span>
                <div>
                  {kpInfo.activity && (
                    <span className="text-base font-semibold" style={{ color: KP_COLORS[Math.min(Math.floor(kpInfo.kp), 9)] }}>
                      {kpInfo.activity[lang === 'no' ? 'no' : 'en']}
                    </span>
                  )}
                  {kpInfo.maxKp && (
                    <div className="text-xs text-slate-400">
                      {lang === 'no' ? 'Maks forventet' : 'Max expected'}: {kpInfo.maxKp.toFixed(1)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Aurora visibility latitude */}
          {kpData.auroraLatitude && (
            <Section title={t('aurora.visibleAt', lang)}>
              <div className="text-xs text-slate-300">
                ~{kpData.auroraLatitude}°N
                {kpData.auroraLatitude <= 70 && kpData.auroraLatitude > 66 && (
                  <span className="text-slate-400 ml-2">({lang === 'no' ? 'Nord-Norge' : 'Northern Norway'})</span>
                )}
                {kpData.auroraLatitude <= 66 && kpData.auroraLatitude > 63 && (
                  <span className="text-slate-400 ml-2">({lang === 'no' ? 'Trøndelag' : 'Central Norway'})</span>
                )}
                {kpData.auroraLatitude <= 63 && kpData.auroraLatitude > 60 && (
                  <span className="text-slate-400 ml-2">({lang === 'no' ? 'Vestlandet/Østlandet' : 'Western/Eastern Norway'})</span>
                )}
                {kpData.auroraLatitude <= 60 && (
                  <span className="text-slate-400 ml-2">({lang === 'no' ? 'Sør-Norge' : 'Southern Norway'})</span>
                )}
              </div>
            </Section>
          )}

          {/* 24-hour Kp chart */}
          {kpData.hourly?.length > 0 && (
            <Section title={lang === 'no' ? '24-timers Kp-prognose' : '24-Hour Kp Forecast'}>
              <div className="h-24 flex items-end gap-px">
                {kpData.hourly.slice(0, 24).map((entry, i) => {
                  const height = Math.max(5, (entry.kp / 9) * 100);
                  const color = KP_COLORS[Math.min(Math.floor(entry.kp), 9)];
                  const hour = new Date(entry.time).getHours();
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center">
                      <div
                        className="w-full rounded-t-sm transition-all"
                        style={{ height: `${height}%`, backgroundColor: color }}
                        title={`${hour}:00 - Kp ${entry.kp.toFixed(1)}`}
                      />
                      {i % 6 === 0 && (
                        <span className="text-[8px] text-slate-500 mt-0.5">{hour}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[8px] text-slate-500 mt-1">
                <span>{lang === 'no' ? 'Nå' : 'Now'}</span>
                <span>+24h</span>
              </div>
            </Section>
          )}

          {/* Kp scale explanation */}
          <Section title={lang === 'no' ? 'Kp-skala' : 'Kp Scale'}>
            <div className="space-y-1">
              {[
                { kp: '0-1', label: { no: 'Rolig - kun høye breddegrader', en: 'Quiet - high latitudes only' } },
                { kp: '2-3', label: { no: 'Ustabil - Nord-Norge', en: 'Unsettled - Northern Norway' } },
                { kp: '4', label: { no: 'Aktiv - Midt-Norge', en: 'Active - Central Norway' } },
                { kp: '5', label: { no: 'Mindre storm - Sør-Norge', en: 'Minor storm - Southern Norway' } },
                { kp: '6-9', label: { no: 'Storm - synlig langt sør', en: 'Storm - visible far south' } },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className="w-8 text-slate-400">{item.kp}</span>
                  <span className="text-slate-300">{item.label[lang === 'no' ? 'no' : 'en']}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Best viewing info */}
          <Section title={t('aurora.bestViewing', lang)}>
            <div className="text-xs text-slate-300 leading-relaxed">
              {lang === 'no'
                ? 'Best sjanser 22:00-02:00 med klar himmel bort fra bybelysning. Se mot nord.'
                : 'Best chances 22:00-02:00 with clear skies away from city lights. Look north.'}
            </div>
          </Section>

          {/* Source */}
          <div className="text-[9px] text-slate-500 mt-2">noaa.gov / SWPC OVATION</div>
        </>
      ) : (
        <div className="text-slate-500 text-xs">
          {lang === 'no' ? 'Ingen data tilgjengelig' : 'No data available'}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-3">
      <h3 className="text-xs font-semibold text-green-400 mb-1.5">{title}</h3>
      {children}
    </div>
  );
}
