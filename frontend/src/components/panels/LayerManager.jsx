import { useState } from 'react';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';

export default function LayerManager() {
  const lang = useMapStore((s) => s.lang);
  const layers = useTacticalStore((s) => s.layers);
  const markers = useTacticalStore((s) => s.markers);
  const drawings = useTacticalStore((s) => s.drawings);
  const [newName, setNewName] = useState('');

  const createLayer = () => {
    if (!newName.trim()) return;
    socket.emit('client:layer:add', {
      name: newName.trim(),
      source: 'user',
      createdBy: socket.id,
    });
    setNewName('');
  };

  const toggleLayer = (id, visible) => {
    socket.emit('client:layer:update', { id, visible: !visible });
  };

  const deleteLayer = (id) => {
    socket.emit('client:layer:delete', { id });
  };

  return (
    <div className="flex flex-col h-full p-3">
      <h2 className="text-sm font-semibold text-emerald-400 mb-3">
        {t('layers.title', lang)}
      </h2>

      {/* Create new layer */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createLayer()}
          placeholder={t('layers.name', lang)}
          className="flex-1 bg-slate-700 text-sm px-2 py-1.5 rounded border border-slate-600 focus:border-emerald-500 focus:outline-none"
        />
        <button
          onClick={createLayer}
          className="bg-emerald-600 hover:bg-emerald-500 text-sm px-3 py-1.5 rounded transition-colors"
        >
          {t('layers.create', lang)}
        </button>
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {layers.length === 0 && (
          <p className="text-slate-500 text-sm">{t('layers.noLayers', lang)}</p>
        )}
        {layers.map((layer) => {
          const markerCount = markers.filter(m => m.layerId === layer.id).length;
          const drawingCount = drawings.filter(d => d.layerId === layer.id).length;

          return (
            <div
              key={layer.id}
              className="flex items-center gap-2 bg-slate-700/50 rounded px-2 py-1.5 group"
            >
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={() => toggleLayer(layer.id, layer.visible)}
                className="accent-emerald-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-sm truncate">{layer.name}</span>
                  {layer.source === 'ai' && (
                    <span className="text-[10px] px-1 bg-purple-600 rounded text-white">
                      {t('layers.aiTag', lang)}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-slate-400">
                  {markerCount}m / {drawingCount}d
                </span>
              </div>
              <button
                onClick={() => deleteLayer(layer.id)}
                className="text-red-400 hover:text-red-300 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                title={t('layers.delete', lang)}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
