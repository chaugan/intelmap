import { useMapStore } from '../../stores/useMapStore.js';

const DANGER_LEVELS = [
  { level: 0, no: 'Ikke vurdert', en: 'Not assessed', color: '#888888' },
  { level: 1, no: 'Liten', en: 'Low', color: '#56B528' },
  { level: 2, no: 'Moderat', en: 'Moderate', color: '#FFE800' },
  { level: 3, no: 'Betydelig', en: 'Considerable', color: '#F18700' },
  { level: 4, no: 'Stor', en: 'High', color: '#E81700' },
  { level: 5, no: 'Meget stor', en: 'Very High', color: '#1B1B1B' },
];

const DAY_LABELS = {
  no: ['I dag', 'I morgen', 'Overmorgen'],
  en: ['Today', 'Tomorrow', 'Day after'],
};

export default function AvalancheWarningsLegend() {
  const lang = useMapStore((s) => s.lang);
  const day = useMapStore((s) => s.avalancheWarningsDay);
  const setDay = useMapStore((s) => s.setAvalancheWarningsDay);

  return (
    <div className="bg-slate-800/90 rounded px-2.5 py-2 text-xs pointer-events-auto min-w-[280px]">
      <div className="text-slate-400 mb-1.5 font-semibold text-[11px]">
        {lang === 'no' ? 'Skredvarsel' : 'Avalanche Warnings'}
      </div>
      <div className="flex gap-1.5 mb-2">
        {DANGER_LEVELS.map((d) => (
          <div key={d.level} className="flex flex-col items-center flex-1 min-w-0">
            <div className="w-full h-3 rounded-sm" style={{ backgroundColor: d.color, border: d.level === 5 ? '1px solid #555' : 'none' }} />
            <span className="text-slate-400 text-[9px] mt-0.5 whitespace-nowrap">
              {d.level}. {lang === 'en' ? d.en : d.no}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {DAY_LABELS[lang === 'en' ? 'en' : 'no'].map((label, i) => (
          <button
            key={i}
            onClick={() => setDay(i)}
            className={`flex-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              day === i
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="text-slate-600 text-[9px] mt-1">varsom.no / NVE</div>
    </div>
  );
}
