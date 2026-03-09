import { useState } from 'react';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { useProjectStore } from '../../stores/useProjectStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';

export default function LayerManager() {
  const lang = useMapStore((s) => s.lang);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const setActiveLayer = useTacticalStore((s) => s.setActiveLayer);
  const projects = useTacticalStore((s) => s.projects);
  const layerVisibility = useTacticalStore((s) => s.layerVisibility);
  const toggleLayerVisibility = useTacticalStore((s) => s.toggleLayerVisibility);
  const myProjects = useProjectStore((s) => s.myProjects);
  const user = useAuthStore((s) => s.user);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [copyingLayerId, setCopyingLayerId] = useState(null);

  const projData = activeProjectId ? projects[activeProjectId] : null;
  const layers = projData?.layers || [];
  const markers = projData?.markers || [];
  const drawings = projData?.drawings || [];
  const activeProject = myProjects.find(p => p.id === activeProjectId);
  const projectRole = activeProject?.role;

  const canEdit = projectRole === 'admin' || projectRole === 'editor';

  const createLayer = () => {
    if (!newName.trim() || !activeProjectId) return;
    socket.emit('client:layer:add', {
      projectId: activeProjectId,
      name: newName.trim(),
      source: 'user',
      createdBy: socket.id,
    });
    setNewName('');
  };

  const renameLayer = (id) => {
    if (!renameVal.trim() || !activeProjectId) return;
    socket.emit('client:layer:update', { projectId: activeProjectId, id, name: renameVal.trim() });
    setRenamingId(null);
  };

  const deleteLayer = (id, name) => {
    if (!activeProjectId) return;
    const msg = t('layers.confirmDelete', lang).replace('{name}', name || '');
    if (!confirm(msg)) return;
    socket.emit('client:layer:delete', { projectId: activeProjectId, id });
    if (activeLayerId === id) setActiveLayer(null);
  };

  const handleCopyLayer = async (layerId, targetProjectId) => {
    try {
      const res = await fetch(`/api/projects/${activeProjectId}/layers/${layerId}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProjectId }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Copy failed');
      if (targetProjectId && targetProjectId !== activeProjectId) {
        socket.emit('client:project:join', { projectId: targetProjectId });
      }
      setCopyingLayerId(null);
    } catch (err) {
      console.error('Layer copy error:', err);
    }
  };

  if (!activeProjectId) {
    return (
      <div className="flex flex-col h-full p-3">
        <h2 className="text-sm font-semibold text-emerald-400 mb-3">
          {t('layers.title', lang)}
        </h2>
        <p className="text-slate-500 text-sm">{t('drawer.noActiveProject', lang)}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-3">
      <h2 className="text-sm font-semibold text-emerald-400 mb-3">
        {t('layers.title', lang)}
      </h2>

      {/* Create new layer */}
      {canEdit && (
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
      )}

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {layers.length === 0 && (
          <p className="text-slate-500 text-sm">{t('layers.noLayers', lang)}</p>
        )}
        {layers.map((layer) => {
          const vis = layerVisibility[layer.id] !== false;
          const isActiveLayer = activeLayerId === layer.id;
          const markerCount = markers.filter(m => m.layerId === layer.id).length;
          const drawingCount = drawings.filter(d => d.layerId === layer.id).length;
          const writableOthers = myProjects.filter(tp => tp.id !== activeProjectId && (tp.role === 'admin' || tp.role === 'editor'));
          const canCopy = canEdit || writableOthers.length > 0;

          return (
            <div
              key={layer.id}
              className={`rounded px-2 py-1.5 group ${isActiveLayer ? 'bg-emerald-900/30 border border-emerald-600/40' : 'bg-slate-700/50'}`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={vis}
                  onChange={() => toggleLayerVisibility(layer.id)}
                  className="accent-emerald-500 w-3.5 h-3.5"
                />
                <div className="flex-1 min-w-0">
                  {renamingId === layer.id ? (
                    <input
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') renameLayer(layer.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => setRenamingId(null)}
                      autoFocus
                      className="w-full px-1 py-0 bg-slate-900 border border-emerald-500 rounded text-sm text-white focus:outline-none"
                    />
                  ) : (
                    <span
                      className={`text-sm truncate block cursor-pointer ${isActiveLayer ? 'text-emerald-300 font-medium' : 'text-slate-300 hover:text-white'}`}
                      onClick={() => setActiveLayer(isActiveLayer ? null : layer.id)}
                      onDoubleClick={() => { if (canEdit) { setRenamingId(layer.id); setRenameVal(layer.name); } }}
                      title={t('drawer.setActiveLayer', lang)}
                    >
                      {isActiveLayer && '\u25B8 '}{layer.name}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 whitespace-nowrap">
                  {markerCount}m {drawingCount}d
                </span>
                {layer.source === 'ai' && (
                  <span className="text-[10px] px-1 bg-purple-600 rounded text-white">
                    {t('layers.aiTag', lang)}
                  </span>
                )}

                {/* Copy layer */}
                {canCopy && (
                  <div className="relative">
                    <button
                      onClick={() => setCopyingLayerId(copyingLayerId === layer.id ? null : layer.id)}
                      className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded text-slate-600 hover:text-cyan-400 hover:bg-cyan-900/30 transition-colors opacity-0 group-hover:opacity-100"
                      title={t('layers.copy', lang)}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                      </svg>
                    </button>
                    {copyingLayerId === layer.id && (
                      <div className="absolute right-0 top-5 z-50 bg-slate-800 border border-slate-600 rounded shadow-xl py-1 min-w-[140px] text-xs">
                        <div className="px-2 py-1 text-slate-500 font-medium">{t('layers.copyTo', lang)}</div>
                        {canEdit && (
                          <button
                            onClick={() => handleCopyLayer(layer.id, activeProjectId)}
                            className="w-full text-left px-2 py-1 hover:bg-slate-700 text-slate-300"
                          >
                            {t('layers.sameProject', lang)}
                          </button>
                        )}
                        {writableOthers.map(tp => (
                          <button
                            key={tp.id}
                            onClick={() => handleCopyLayer(layer.id, tp.id)}
                            className="w-full text-left px-2 py-1 hover:bg-slate-700 text-slate-300 truncate"
                          >
                            {tp.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Delete */}
                {canEdit && (
                  <button
                    onClick={() => deleteLayer(layer.id, layer.name)}
                    className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded text-slate-600 hover:text-red-400 hover:bg-red-900/30 transition-colors opacity-0 group-hover:opacity-100"
                    title={t('layers.delete', lang)}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Unassigned items */}
        {(() => {
          const unMarkers = markers.filter(m => !m.layerId);
          const unDrawings = drawings.filter(d => !d.layerId);
          if (unMarkers.length + unDrawings.length === 0) return null;
          return (
            <div className="text-xs text-slate-500 italic px-1.5 mt-2">
              {t('drawer.unassigned', lang)}: {unMarkers.length}m {unDrawings.length}d
            </div>
          );
        })()}
      </div>
    </div>
  );
}
