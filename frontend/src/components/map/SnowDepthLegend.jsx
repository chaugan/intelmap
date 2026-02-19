import { useMapStore } from '../../stores/useMapStore.js';

const items = [
  { label: 'Barmark', labelEn: 'Bare', color: '#CCFF66' },
  { label: '<25', color: '#AAFFFF' },
  { label: '25–50', color: '#00FFFF' },
  { label: '50–100', color: '#00AAFF' },
  { label: '100–150', color: '#0055FF' },
  { label: '150–200', color: '#0000FF' },
  { label: '200–400', color: '#0000CC' },
  { label: '>400', color: '#000080' },
];

export default function SnowDepthLegend() {
  const lang = useMapStore((s) => s.lang);

  return (
    <div className="bg-slate-800/90 rounded px-2.5 py-2 text-xs pointer-events-auto min-w-[360px]">
      <div className="text-slate-400 mb-1.5 font-semibold text-[11px]">
        {lang === 'no' ? 'Snødybde (cm)' : 'Snow Depth (cm)'}
      </div>
      <div className="flex gap-2">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col items-center flex-1 min-w-0">
            <div className="w-full h-3 rounded-sm" style={{ backgroundColor: item.color }} />
            <span className="text-slate-400 text-[10px] mt-0.5 whitespace-nowrap">
              {lang === 'en' && item.labelEn ? item.labelEn : item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
