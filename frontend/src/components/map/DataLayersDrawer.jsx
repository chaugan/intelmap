import { useState, useEffect } from 'react';
import { useMapStore, getThemeState } from '../../stores/useMapStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { t } from '../../lib/i18n.js';

const OVERLAYS = [
  { id: 'wind', toggleKey: 'toggleWind', visibleKey: 'windVisible', opacityKey: 'windOpacity', setOpacityKey: 'setWindOpacity', accent: 'accent-emerald-500' },
  { id: 'webcams', toggleKey: 'toggleWebcams', visibleKey: 'webcamsVisible', opacityKey: null, setOpacityKey: null, accent: null },
  { id: 'avalanche', toggleKey: 'toggleAvalanche', visibleKey: 'avalancheVisible', opacityKey: null, setOpacityKey: null, accent: null },
  { id: 'avalancheWarnings', toggleKey: 'toggleAvalancheWarnings', visibleKey: 'avalancheWarningsVisible', opacityKey: 'avalancheWarningsOpacity', setOpacityKey: 'setAvalancheWarningsOpacity', accent: 'accent-orange-500' },
  { id: 'snowDepth', toggleKey: 'toggleSnowDepth', visibleKey: 'snowDepthVisible', opacityKey: 'snowDepthOpacity', setOpacityKey: 'setSnowDepthOpacity', accent: 'accent-blue-500' },
  { id: 'aircraft', toggleKey: 'toggleAircraft', visibleKey: 'aircraftVisible', opacityKey: 'aircraftOpacity', setOpacityKey: 'setAircraftOpacity', accent: 'accent-amber-500' },
  { id: 'vessels', toggleKey: 'toggleVessels', visibleKey: 'vesselsVisible', opacityKey: 'vesselsOpacity', setOpacityKey: 'setVesselsOpacity', accent: 'accent-cyan-500' },
];

const OVERLAY_LABELS = {
  wind: { no: 'Vind', en: 'Wind' },
  webcams: { no: 'Webkameraer', en: 'Webcams' },
  snowDepth: { no: 'Snødybde', en: 'Snow Depth' },
  avalanche: { no: 'Skredterreng', en: 'Aval. Terrain' },
  avalancheWarnings: { no: 'Skredvarsel', en: 'Aval. Warnings' },
  aircraft: { no: 'Luftfart', en: 'Aircraft' },
  vessels: { no: 'Fartøy', en: 'Vessels' },
};

export default function DataLayersDrawer() {
  const lang = useMapStore((s) => s.lang);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  // Overlay state
  const store = useMapStore();
  const overlayOrder = useMapStore((s) => s.overlayOrder);
  const moveOverlayUp = useMapStore((s) => s.moveOverlayUp);
  const moveOverlayDown = useMapStore((s) => s.moveOverlayDown);
  const applyTheme = useMapStore((s) => s.applyTheme);

  // Theme state
  const [themes, setThemes] = useState([]);
  const [themeName, setThemeName] = useState('');
  const [themeLoading, setThemeLoading] = useState(false);

  // Fetch themes on mount
  useEffect(() => {
    fetchThemes();
  }, []);

  const fetchThemes = async () => {
    try {
      const res = await fetch('/api/themes');
      if (res.ok) setThemes(await res.json());
    } catch { /* ignore */ }
  };

  const handleSaveTheme = async () => {
    if (!themeName.trim()) return;
    setThemeLoading(true);
    try {
      const res = await fetch('/api/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: themeName.trim(), state: getThemeState() }),
      });
      if (res.ok) {
        setThemeName('');
        await fetchThemes();
      }
    } catch { /* ignore */ }
    setThemeLoading(false);
  };

  const handleDeleteTheme = async (id) => {
    try {
      const res = await fetch(`/api/themes/${id}`, { method: 'DELETE' });
      if (res.ok) setThemes((prev) => prev.filter((t) => t.id !== id));
    } catch { /* ignore */ }
  };

  const handleApplyTheme = (theme) => {
    applyTheme(theme.state);
  };

  // Active overlays for z-order
  const activeOverlayIds = OVERLAYS.filter((o) => store[o.visibleKey]).map((o) => o.id);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-slate-700 shrink-0">
        <h2 className="text-base font-semibold text-emerald-400">
          {t('dataLayers.title', lang)}
        </h2>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Overlays section */}
        <div className="px-3 py-2.5 border-b border-slate-700">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2 font-semibold">
            {t('dataLayers.overlays', lang)}
          </div>
          <div className="space-y-1.5">
            {OVERLAYS.map((overlay) => {
              const visible = store[overlay.visibleKey];
              const toggle = store[overlay.toggleKey];
              const opacity = overlay.opacityKey ? store[overlay.opacityKey] : null;
              const setOpacity = overlay.setOpacityKey ? store[overlay.setOpacityKey] : null;

              return (
                <div key={overlay.id}>
                  <div className="flex items-center gap-2">
                    {/* Eye toggle */}
                    <button
                      onClick={toggle}
                      className={`w-6 h-6 flex items-center justify-center rounded ${visible ? 'text-emerald-400' : 'text-slate-600'}`}
                    >
                      {visible ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                          <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                        </svg>
                      )}
                    </button>
                    <span className={`text-sm flex-1 ${visible ? 'text-slate-200' : 'text-slate-500'}`}>
                      {OVERLAY_LABELS[overlay.id]?.[lang] || overlay.id}
                    </span>
                  </div>
                  {/* Opacity slider (when visible and has opacity) */}
                  {visible && setOpacity && (
                    <div className="flex items-center gap-2 ml-8 mt-0.5">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={opacity}
                        onChange={(e) => setOpacity(parseFloat(e.target.value))}
                        className={`flex-1 h-1 ${overlay.accent}`}
                      />
                      <span className="text-[10px] text-slate-500 w-7 text-right">{Math.round(opacity * 100)}%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Z-Order section (only when 2+ overlays active) */}
        {activeOverlayIds.length >= 2 && (
          <div className="px-3 py-2.5 border-b border-slate-700">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2 font-semibold">
              {lang === 'no' ? 'Lag-rekkefølge (øverst → nederst)' : 'Layer order (top → bottom)'}
            </div>
            {[...overlayOrder].reverse()
              .filter((id) => activeOverlayIds.includes(id))
              .map((id, i, arr) => (
                <div key={id} className="flex items-center justify-between py-1">
                  <span className="text-xs text-slate-200">{OVERLAY_LABELS[id]?.[lang] || id}</span>
                  <div className="flex gap-0.5">
                    <button
                      onClick={() => moveOverlayUp(id)}
                      disabled={i === 0}
                      className="px-1 py-0.5 rounded text-[10px] bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-default"
                      title={lang === 'no' ? 'Flytt opp' : 'Move up'}
                    >▲</button>
                    <button
                      onClick={() => moveOverlayDown(id)}
                      disabled={i === arr.length - 1}
                      className="px-1 py-0.5 rounded text-[10px] bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-default"
                      title={lang === 'no' ? 'Flytt ned' : 'Move down'}
                    >▼</button>
                  </div>
                </div>
              ))}
            {store.windVisible && (
              <div className="text-[9px] text-slate-500 mt-1 border-t border-slate-600 pt-1">
                {lang === 'no' ? 'Vind vises alltid over kartlag' : 'Wind always renders above map layers'}
              </div>
            )}
          </div>
        )}

        {/* Map Themes section */}
        <div className="px-3 py-2.5">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2 font-semibold">
            {t('dataLayers.themes', lang)}
          </div>

          {/* Admin: save new theme */}
          {isAdmin && (
            <div className="flex gap-1.5 mb-2">
              <input
                value={themeName}
                onChange={(e) => setThemeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveTheme()}
                placeholder={lang === 'no' ? 'Temanavn...' : 'Theme name...'}
                className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={handleSaveTheme}
                disabled={!themeName.trim() || themeLoading}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
              >
                {t('general.save', lang)}
              </button>
            </div>
          )}

          {/* Theme list */}
          {themes.length === 0 && (
            <p className="text-slate-500 text-xs">{t('dataLayers.noThemes', lang)}</p>
          )}
          <div className="space-y-0.5">
            {themes.map((theme) => (
              <div key={theme.id} className="flex items-center gap-1.5 group">
                <button
                  onClick={() => handleApplyTheme(theme)}
                  className="flex-1 text-left text-sm text-slate-300 hover:text-emerald-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors truncate"
                >
                  {theme.name}
                </button>
                {isAdmin && (
                  <button
                    onClick={() => handleDeleteTheme(theme.id)}
                    className="w-6 h-6 flex items-center justify-center text-red-500 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title={t('general.delete', lang)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
