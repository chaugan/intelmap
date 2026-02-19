import { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../stores/useProjectStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { socket } from '../../lib/socket.js';
import { t } from '../../lib/i18n.js';

export default function ProjectDrawer() {
  const lang = useMapStore((s) => s.lang);
  const user = useAuthStore((s) => s.user);
  const myProjects = useProjectStore((s) => s.myProjects);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const shareProject = useProjectStore((s) => s.shareProject);
  const unshareProject = useProjectStore((s) => s.unshareProject);
  const unshareFromGroup = useProjectStore((s) => s.unshareFromGroup);
  const groups = useProjectStore((s) => s.groups);
  const fetchGroups = useProjectStore((s) => s.fetchGroups);
  const loading = useProjectStore((s) => s.loading);

  const projects = useTacticalStore((s) => s.projects);
  const activeProjectId = useTacticalStore((s) => s.activeProjectId);
  const visibleProjectIds = useTacticalStore((s) => s.visibleProjectIds);
  const showProject = useTacticalStore((s) => s.showProject);
  const hideProject = useTacticalStore((s) => s.hideProject);
  const setActiveProject = useTacticalStore((s) => s.setActiveProject);
  const reorderProjects = useTacticalStore((s) => s.reorderProjects);
  const reorderMyProjects = useProjectStore((s) => s.reorderMyProjects);
  const activeLayerId = useTacticalStore((s) => s.activeLayerId);
  const setActiveLayer = useTacticalStore((s) => s.setActiveLayer);
  const layerVisibility = useTacticalStore((s) => s.layerVisibility);
  const toggleLayerVisibility = useTacticalStore((s) => s.toggleLayerVisibility);

  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [expandedProject, setExpandedProject] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [draggedId, setDraggedId] = useState(null);
  const [sharingId, setSharingId] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [renamingLayerId, setRenamingLayerId] = useState(null);
  const [renameLayerVal, setRenameLayerVal] = useState('');

  useEffect(() => {
    if (user) {
      fetchProjects();
      fetchGroups();
    }
  }, [user]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError('');
    try {
      const project = await createProject(newName.trim());
      setNewName('');
      showProject(project.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm(t('projects.confirmDelete', lang))) return;
    try {
      hideProject(id);
      await deleteProject(id);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRename = async (id) => {
    if (!renameVal.trim()) return;
    try {
      await renameProject(id, renameVal.trim());
      setRenamingId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleShare = async (projectId) => {
    if (!selectedGroupId) return;
    try {
      await shareProject(projectId, selectedGroupId);
      setSharingId(null);
      setSelectedGroupId('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRenameLayer = (projectId, layerId) => {
    if (!renameLayerVal.trim()) return;
    socket.emit('client:layer:update', { projectId, id: layerId, name: renameLayerVal.trim() });
    setRenamingLayerId(null);
  };

  const handleUnshare = async (projectId) => {
    try {
      await unshareProject(projectId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUnshareGroup = async (projectId, groupId) => {
    try {
      await unshareFromGroup(projectId, groupId);
    } catch (err) {
      setError(err.message);
    }
  };

  const isVisible = (id) => visibleProjectIds.includes(id);
  const isActive = (id) => activeProjectId === id;

  // Drag-reorder for drawer order (all projects) and z-ordering (visible projects)
  const handleDragStart = (id) => setDraggedId(id);
  const handleDragOver = (e, overId) => {
    e.preventDefault();
    if (!draggedId || draggedId === overId) return;
    const projectIds = myProjects.map(p => p.id);
    const fromIdx = projectIds.indexOf(draggedId);
    const toIdx = projectIds.indexOf(overId);
    if (fromIdx === -1 || toIdx === -1) return;
    const newOrder = [...projectIds];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedId);
    reorderMyProjects(newOrder);
    // Also update visible z-order to match drawer order
    const newVisibleOrder = newOrder.filter(id => visibleProjectIds.includes(id));
    reorderProjects(newVisibleOrder);
  };
  const handleDragEnd = () => setDraggedId(null);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 border-b border-slate-700 shrink-0">
        <h2 className="text-base font-semibold text-emerald-400">
          {t('drawer.title', lang)}
        </h2>
      </div>

      {/* Create new project */}
      <div className="px-3 py-2.5 border-b border-slate-700 shrink-0">
        <div className="flex gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder={t('projects.namePlaceholder', lang)}
            className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
          >
            +
          </button>
        </div>
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto">
        {loading && myProjects.length === 0 && (
          <p className="text-slate-500 text-sm p-3">{t('general.loading', lang)}</p>
        )}
        {myProjects.length === 0 && !loading && (
          <p className="text-slate-500 text-sm p-3">{t('projects.noProjects', lang)}</p>
        )}
        {myProjects.map((p) => {
          const visible = isVisible(p.id);
          const active = isActive(p.id);
          const expanded = expandedProject === p.id;
          const projData = projects[p.id];

          return (
            <div
              key={p.id}
              className={`border-b border-slate-700/50 ${active ? 'bg-emerald-900/20 border-l-2 border-l-emerald-400' : ''}`}
              draggable
              onDragStart={() => handleDragStart(p.id)}
              onDragOver={(e) => handleDragOver(e, p.id)}
              onDragEnd={handleDragEnd}
            >
              {/* Main row */}
              <div className="flex items-center gap-2 px-3 py-2 group">
                {/* Drag handle */}
                <span className="text-slate-600 cursor-grab text-base" title="Drag to reorder">
                  &#x2630;
                </span>

                {/* Eye toggle (visibility) */}
                <button
                  onClick={() => visible ? hideProject(p.id) : showProject(p.id, myProjects.map(pr => pr.id))}
                  className={`w-7 h-7 flex items-center justify-center rounded ${
                    visible ? 'text-emerald-400' : 'text-slate-600'
                  }`}
                  title={visible ? t('drawer.hide', lang) : t('drawer.show', lang)}
                >
                  {visible ? (
                    <svg className="w-4.5 h-4.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-4.5 h-4.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                      <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                    </svg>
                  )}
                </button>

                {/* Star (active project) */}
                {visible && (
                  <button
                    onClick={() => setActiveProject(p.id)}
                    className={`w-7 h-7 flex items-center justify-center text-base ${
                      active ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'
                    }`}
                    title={t('drawer.setActive', lang)}
                  >
                    {active ? '\u2605' : '\u2606'}
                  </button>
                )}

                {/* Project name */}
                <div className="flex-1 min-w-0 ml-1">
                  {renamingId === p.id ? (
                    <input
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(p.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => setRenamingId(null)}
                      autoFocus
                      className="w-full px-1 py-0.5 bg-slate-900 border border-emerald-500 rounded text-sm text-white focus:outline-none"
                    />
                  ) : (
                    <div
                      className="text-sm truncate cursor-pointer"
                      onDoubleClick={() => {
                        if (p.role === 'admin') {
                          setRenamingId(p.id);
                          setRenameVal(p.name);
                        }
                      }}
                    >
                      {p.name}
                    </div>
                  )}
                  {p.sharedGroups?.length > 0 && (
                    <div className="text-xs text-slate-500 truncate">
                      {p.ownerUsername} &middot; {p.sharedGroups.map(g => g.name).join(', ')} &middot; {p.role}
                    </div>
                  )}
                </div>

                {/* Expand layers */}
                <button
                  onClick={() => setExpandedProject(expanded ? null : p.id)}
                  className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-slate-300 text-base"
                >
                  {expanded ? '\u25B4' : '\u25BE'}
                </button>

                {/* Delete */}
                {p.role === 'admin' && (
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="w-7 h-7 flex items-center justify-center text-red-500 hover:text-red-400 text-base opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t('general.delete', lang)}
                  >
                    {'\u2715'}
                  </button>
                )}
              </div>

              {/* Expanded: layer list */}
              {expanded && projData && (
                <div className="px-6 pb-2.5 space-y-1">
                  {projData.layers.length === 0 && (
                    <p className="text-xs text-slate-600">{t('layers.noLayers', lang)}</p>
                  )}
                  {projData.layers.map((layer) => {
                    const vis = layerVisibility[layer.id] !== false;
                    const isActiveLayer = active && activeLayerId === layer.id;
                    const mCount = projData.markers.filter(m => m.layerId === layer.id).length;
                    const dCount = projData.drawings.filter(d => d.layerId === layer.id).length;
                    return (
                      <div key={layer.id} className={`flex items-center gap-1.5 text-xs rounded px-1.5 py-0.5 ${isActiveLayer ? 'bg-emerald-900/30 ring-1 ring-emerald-500/40' : ''}`}>
                        <input
                          type="checkbox"
                          checked={vis}
                          onChange={() => toggleLayerVisibility(layer.id)}
                          className="accent-emerald-500 w-3.5 h-3.5"
                        />
                        {renamingLayerId === layer.id ? (
                          <input
                            value={renameLayerVal}
                            onChange={(e) => setRenameLayerVal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameLayer(p.id, layer.id);
                              if (e.key === 'Escape') setRenamingLayerId(null);
                            }}
                            onBlur={() => setRenamingLayerId(null)}
                            autoFocus
                            className="flex-1 px-1 py-0 bg-slate-900 border border-emerald-500 rounded text-xs text-white focus:outline-none"
                          />
                        ) : (
                          <span
                            className={`flex-1 truncate cursor-pointer ${isActiveLayer ? 'text-emerald-300 font-medium' : 'text-slate-300 hover:text-white'}`}
                            onClick={() => {
                              if (active) setActiveLayer(isActiveLayer ? null : layer.id);
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setRenamingLayerId(layer.id);
                              setRenameLayerVal(layer.name);
                            }}
                            title={t('drawer.setActiveLayer', lang)}
                          >
                            {isActiveLayer && '\u25B8 '}{layer.name}
                          </span>
                        )}
                        <span className="text-slate-500">{mCount}m {dCount}d</span>
                      </div>
                    );
                  })}
                  {/* Counts for unassigned items */}
                  {(() => {
                    const mNoLayer = projData.markers.filter(m => !m.layerId).length;
                    const dNoLayer = projData.drawings.filter(d => !d.layerId).length;
                    if (mNoLayer + dNoLayer === 0) return null;
                    return (
                      <div className="text-xs text-slate-500 italic px-1.5">
                        {t('drawer.unassigned', lang)}: {mNoLayer}m {dNoLayer}d
                      </div>
                    );
                  })()}

                  {/* Share / Unshare controls (admin only) */}
                  {p.role === 'admin' && (
                    <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-1.5">
                      {/* List currently shared groups */}
                      {p.sharedGroups?.length > 0 && (
                        <div className="space-y-1">
                          {p.sharedGroups.map((sg) => (
                            <div key={sg.id} className="flex items-center gap-1.5 text-xs">
                              <span className="text-slate-400 flex-1 truncate">{sg.name}</span>
                              {p.sharedGroups.length > 1 && (
                                <button
                                  onClick={() => handleUnshareGroup(p.id, sg.id)}
                                  className="text-red-400 hover:text-red-300 text-xs shrink-0"
                                  title={lang === 'no' ? 'Fjern deling' : 'Remove sharing'}
                                >
                                  {'\u2715'}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Make private (unshare all) */}
                      {p.sharedGroups?.length > 0 && (
                        <button
                          onClick={() => handleUnshare(p.id)}
                          className="text-red-400 hover:text-red-300 text-xs"
                        >
                          {t('groups.unshare', lang)}
                        </button>
                      )}
                      {/* Share with another group */}
                      {sharingId === p.id ? (
                        <div className="flex gap-1.5 items-center">
                          <select
                            value={selectedGroupId}
                            onChange={(e) => setSelectedGroupId(e.target.value)}
                            className="flex-1 bg-slate-800 border border-slate-600 rounded text-xs px-1.5 py-1"
                          >
                            <option value="">-- {t('groups.selectGroup', lang)} --</option>
                            {groups
                              .filter(g => !p.sharedGroups?.some(sg => sg.id === g.id))
                              .map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                              ))}
                          </select>
                          <button
                            onClick={() => handleShare(p.id)}
                            disabled={!selectedGroupId}
                            className="px-2 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs transition-colors disabled:opacity-50"
                          >
                            OK
                          </button>
                          <button
                            onClick={() => { setSharingId(null); setSelectedGroupId(''); }}
                            className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors"
                          >
                            {t('general.cancel', lang)}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSharingId(p.id)}
                          className="text-emerald-400 hover:text-emerald-300 text-xs"
                        >
                          + {t('groups.share', lang)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Stats when not expanded */}
              {!expanded && visible && projData && (
                <div className="px-10 pb-1.5 text-xs text-slate-500">
                  {projData.markers.length}m &middot; {projData.drawings.length}d &middot; {projData.layers.length}L
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Active context status bar */}
      {activeProjectId && (() => {
        const proj = myProjects.find(p => p.id === activeProjectId);
        const projData = projects[activeProjectId];
        const activeLayer = projData?.layers.find(l => l.id === activeLayerId);
        return (
          <div className="px-3 py-2.5 border-t border-slate-700 shrink-0 bg-slate-800/80">
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-slate-400">{t('drawer.activeContext', lang)}:</span>
              <span className="text-emerald-300 font-medium truncate">{proj?.name || '?'}</span>
              <span className="text-slate-600">&rsaquo;</span>
              <span className={`truncate ${activeLayer ? 'text-cyan-300' : 'text-slate-500 italic'}`}>
                {activeLayer ? activeLayer.name : t('drawer.noLayer', lang)}
              </span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
