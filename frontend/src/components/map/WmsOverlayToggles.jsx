import { useMapStore } from '../../stores/useMapStore.js';

const WMS_LAYERS = [
  { key: 'wmsTransport', toggleKey: 'toggleWmsTransport', visibleKey: 'wmsTransportVisible', no: 'Samferdsel', en: 'Transport' },
  { key: 'wmsPlacenames', toggleKey: 'toggleWmsPlacenames', visibleKey: 'wmsPlacenamesVisible', no: 'Stedsnavn', en: 'Place Names' },
  { key: 'wmsContours', toggleKey: 'toggleWmsContours', visibleKey: 'wmsContoursVisible', no: 'Høydekurver', en: 'Contours' },
  { key: 'wmsBorders', toggleKey: 'toggleWmsBorders', visibleKey: 'wmsBordersVisible', no: 'Adm. grenser', en: 'Adm. Borders' },
];

export default function WmsOverlayToggles() {
  const lang = useMapStore((s) => s.lang);
  const baseLayer = useMapStore((s) => s.baseLayer);
  const store = useMapStore();

  if (!baseLayer?.startsWith('satellite')) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {WMS_LAYERS.map((item) => {
        const visible = store[item.visibleKey];
        const toggle = store[item.toggleKey];
        return (
          <button
            key={item.key}
            onClick={toggle}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors border ${
              visible
                ? 'bg-emerald-700/80 border-emerald-600 text-emerald-100'
                : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
            }`}
          >
            {lang === 'no' ? item.no : item.en}
          </button>
        );
      })}
    </div>
  );
}
