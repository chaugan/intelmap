import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

/**
 * Small popup showing which project + layer an item belongs to.
 * Props: projectId, layerId, x, y (viewport coords), onClose
 */
export default function ItemInfoPopup({ projectId, layerId, x, y, onClose }) {
  const lang = useMapStore((s) => s.lang);
  const myProjects = useProjectStore((s) => s.myProjects);
  const projects = useTacticalStore((s) => s.projects);
  const popupRef = useRef(null);

  const proj = myProjects.find(p => p.id === projectId);
  const projData = projects[projectId];
  const layer = projData?.layers?.find(l => l.id === layerId);

  // Close on any click/right-click outside or Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const onMouseDown = (e) => {
      if (popupRef.current && popupRef.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    // Use capture phase + small delay to avoid immediate close from the opening right-click
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', onMouseDown, true);
      document.addEventListener('contextmenu', onMouseDown, true);
    }, 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onMouseDown, true);
      document.removeEventListener('contextmenu', onMouseDown, true);
      clearTimeout(timer);
    };
  }, [onClose]);

  // Calculate clamped position to keep dialog within viewport
  const [clampedPos, setClampedPos] = useState({ left: x, top: y, ready: false });

  // Use useLayoutEffect to calculate position before browser paints
  useLayoutEffect(() => {
    if (!popupRef.current) return;

    const rect = popupRef.current.getBoundingClientRect();
    const padding = 10;

    let left = x;
    let top = y;

    // Clamp right edge
    if (left + rect.width > window.innerWidth - padding) {
      left = window.innerWidth - rect.width - padding;
    }
    // Clamp left edge
    if (left < padding) {
      left = padding;
    }
    // Clamp bottom edge
    if (top + rect.height > window.innerHeight - padding) {
      top = window.innerHeight - rect.height - padding;
    }
    // Clamp top edge
    if (top < padding) {
      top = padding;
    }

    setClampedPos({ left, top, ready: true });
  }, [x, y]);

  return (
    <div
      ref={popupRef}
      className="fixed z-[60] bg-slate-800 border border-slate-600 rounded-lg shadow-xl px-3 py-2 min-w-[180px]"
      style={{ left: clampedPos.left, top: clampedPos.top, visibility: clampedPos.ready ? 'visible' : 'hidden' }}
    >
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className="text-slate-400 shrink-0">{t('info.project', lang)}:</span>
        <span className="text-emerald-300 font-medium truncate">{proj?.name || projectId}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-400 shrink-0">{t('info.layer', lang)}:</span>
        <span className={`truncate ${layer ? 'text-cyan-300' : 'text-slate-500 italic'}`}>
          {layer ? layer.name : t('info.noLayer', lang)}
        </span>
      </div>
    </div>
  );
}
