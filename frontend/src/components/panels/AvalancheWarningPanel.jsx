import { useEffect, useState } from 'react';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

const DANGER_COLORS = {
  1: '#56B528',
  2: '#FFE800',
  3: '#F18700',
  4: '#E81700',
  5: '#1B1B1B',
};

const DANGER_NAMES = {
  1: { no: 'Liten', en: 'Low' },
  2: { no: 'Moderat', en: 'Moderate' },
  3: { no: 'Betydelig', en: 'Considerable' },
  4: { no: 'Stor', en: 'High' },
  5: { no: 'Meget stor', en: 'Very High' },
};

const ASPECT_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export default function AvalancheWarningPanel() {
  const lang = useMapStore((s) => s.lang);
  const regionId = useMapStore((s) => s.avalancheWarningRegionId);
  const regionName = useMapStore((s) => s.avalancheWarningRegionName);
  const day = useMapStore((s) => s.avalancheWarningsDay);
  const setDay = useMapStore((s) => s.setAvalancheWarningsDay);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!regionId) return;
    setLoading(true);
    setError(null);
    const langKey = lang === 'en' ? 2 : 1;
    fetch(`/api/avalanche-warnings/detail/${regionId}?day=${day}&lang=${langKey}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => setDetail(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [regionId, day, lang]);

  if (!regionId) {
    return (
      <div className="p-3 text-sm text-slate-400">
        {lang === 'no' ? 'Ingen region valgt' : 'No region selected'}
      </div>
    );
  }

  const dangerLevel = detail?.DangerLevel ?? 0;
  const color = DANGER_COLORS[dangerLevel] || '#666';
  const levelName = DANGER_NAMES[dangerLevel]?.[lang === 'en' ? 'en' : 'no'] || '';

  return (
    <div className="flex flex-col h-full p-3 overflow-y-auto">
      <h2 className="text-sm font-semibold text-orange-400 mb-3">
        {t('aval.title', lang)}
      </h2>

      {/* Region + danger badge */}
      <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: color + '22' }}>
        <div className="text-xs text-slate-300 mb-1">{regionName}</div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-8 h-8 rounded-md text-center leading-8 font-bold text-sm"
            style={{
              backgroundColor: color,
              color: dangerLevel === 2 ? '#333' : '#fff',
              border: dangerLevel === 5 ? '1px solid #555' : 'none',
            }}
          >
            {dangerLevel}
          </span>
          <span className="text-base font-semibold" style={{ color }}>
            {levelName}
          </span>
        </div>
      </div>

      {/* Day picker */}
      <div className="flex gap-1 mb-3">
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            onClick={() => setDay(i)}
            className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
              day === i
                ? 'bg-orange-700 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {t(i === 0 ? 'aval.today' : i === 1 ? 'aval.tomorrow' : 'aval.dayAfter', lang)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm">{t('general.loading', lang)}</div>
      ) : error ? (
        <div className="text-red-400 text-sm">{error}</div>
      ) : detail ? (
        <>
          {/* Main text */}
          {detail.MainText && (
            <div className="text-xs text-slate-300 mb-3 leading-relaxed">{detail.MainText}</div>
          )}

          {/* Avalanche problems */}
          {detail.AvalancheProblems?.length > 0 && (
            <Section title={t('aval.problems', lang)}>
              {detail.AvalancheProblems.map((p, i) => (
                <div key={i} className="bg-slate-700/50 rounded p-2 mb-2">
                  <div className="font-semibold text-xs text-orange-300 mb-1">
                    {p.AvalancheProblemTypeName || `Problem ${i + 1}`}
                  </div>
                  {p.AvalCauseName && (
                    <InfoRow label={t('aval.cause', lang)} value={p.AvalCauseName} />
                  )}
                  {p.AvalTriggerSimpleName && (
                    <InfoRow label={t('aval.trigger', lang)} value={p.AvalTriggerSimpleName} />
                  )}
                  {p.AvalProbabilityName && (
                    <InfoRow label={t('aval.probability', lang)} value={p.AvalProbabilityName} />
                  )}
                  {p.DestructiveSizeName && (
                    <InfoRow label={t('aval.size', lang)} value={p.DestructiveSizeName} />
                  )}
                  {p.ValidExpositions && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-slate-400 text-[10px]">{t('aval.aspects', lang)}</span>
                      <AspectRose expositions={p.ValidExpositions} />
                    </div>
                  )}
                  {(p.ExposedHeight1 != null || p.ExposedHeightFill != null) && (
                    <InfoRow
                      label={t('aval.elevation', lang)}
                      value={formatElevation(p, lang)}
                    />
                  )}
                </div>
              ))}
            </Section>
          )}

          {/* Mountain weather */}
          {detail.MountainWeather?.MeasurementTypes?.length > 0 && (
            <Section title={t('aval.mountainWeather', lang)}>
              <div className="grid grid-cols-2 gap-1.5">
                {detail.MountainWeather.MeasurementTypes.map((m, i) => (
                  <div key={i} className="bg-slate-700/50 rounded p-1.5">
                    <div className="text-slate-400 text-[10px]">{m.MeasurementTypeName}</div>
                    <div className="text-xs font-medium">{m.Value}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Narrative sections */}
          {detail.AvalancheDanger && (
            <Section title={t('aval.dangerLevel', lang)}>
              <div className="text-xs text-slate-300 leading-relaxed">{detail.AvalancheDanger}</div>
            </Section>
          )}
          {detail.SnowSurface && (
            <Section title={t('aval.snowSurface', lang)}>
              <div className="text-xs text-slate-300 leading-relaxed">{detail.SnowSurface}</div>
            </Section>
          )}
          {detail.CurrentWeaklayers && (
            <Section title={t('aval.weakLayers', lang)}>
              <div className="text-xs text-slate-300 leading-relaxed">{detail.CurrentWeaklayers}</div>
            </Section>
          )}
          {detail.LatestAvalancheActivity && (
            <Section title={t('aval.recentActivity', lang)}>
              <div className="text-xs text-slate-300 leading-relaxed">{detail.LatestAvalancheActivity}</div>
            </Section>
          )}

          {/* Safety advice */}
          {detail.AvalancheAdvices?.length > 0 && (
            <Section title={t('aval.advice', lang)}>
              <ul className="list-disc list-inside space-y-1">
                {detail.AvalancheAdvices.map((a, i) => (
                  <li key={i} className="text-xs text-slate-300">{a.Text || a.AdviceText}</li>
                ))}
              </ul>
            </Section>
          )}

          {/* Source link */}
          <div className="text-[9px] text-slate-500 mt-2">varsom.no / NVE</div>
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
      <h3 className="text-xs font-semibold text-orange-400 mb-1.5">{title}</h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between items-start text-[11px] mb-0.5">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200 text-right ml-2">{value}</span>
    </div>
  );
}

function formatElevation(problem, lang) {
  const height = problem.ExposedHeight1;
  if (!height) return '';
  const fill = problem.ExposedHeightFill;
  // fill: 1 = above, 2 = below, 3 = between (with ExposedHeight2)
  if (fill === 1) return `${t('aval.above', lang)} ${height}m`;
  if (fill === 2) return `${t('aval.below', lang)} ${height}m`;
  if (fill === 3 && problem.ExposedHeight2) return `${height}m - ${problem.ExposedHeight2}m`;
  return `${height}m`;
}

function AspectRose({ expositions }) {
  // ValidExpositions: 8-char binary string, index 0=N, 1=NE, ..., 7=NW
  const size = 28;
  const cx = size / 2;
  const cy = size / 2;
  const r = 11;
  const wedgeAngle = Math.PI / 4; // 45 degrees

  const wedges = [];
  for (let i = 0; i < 8; i++) {
    const active = expositions[i] === '1';
    const startAngle = (i * 45 - 90 - 22.5) * (Math.PI / 180);
    const endAngle = startAngle + wedgeAngle;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    wedges.push(
      <path
        key={i}
        d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2} Z`}
        fill={active ? '#F18700' : '#444'}
        stroke="#222"
        strokeWidth="0.5"
      />
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {wedges}
      <text x={cx} y={4} textAnchor="middle" fill="#999" fontSize="5">N</text>
    </svg>
  );
}
