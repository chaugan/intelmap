import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

export default function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setLoginOpen = useAuthStore((s) => s.setLoginOpen);
  const setPasswordChangeOpen = useAuthStore((s) => s.setPasswordChangeOpen);
  const setAdminPanelOpen = useAuthStore((s) => s.setAdminPanelOpen);
  const toggleProjectDrawer = useMapStore((s) => s.toggleProjectDrawer);
  const lang = useMapStore((s) => s.lang);

  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!user) {
    return (
      <button
        onClick={() => setLoginOpen(true)}
        className="px-3 py-1 text-sm bg-emerald-700 hover:bg-emerald-600 rounded transition-colors"
      >
        {t('auth.login', lang)}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        {user.username}
        {user.role === 'admin' && <span className="text-xs text-amber-400">admin</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-slate-700 rounded shadow-xl border border-slate-600 z-50 min-w-[180px] py-1">
          <button
            onClick={() => { toggleProjectDrawer(); setOpen(false); }}
            className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-600 transition-colors"
          >
            {t('drawer.title', lang)}
          </button>
          <button
            onClick={() => { setPasswordChangeOpen(true); setOpen(false); }}
            className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-600 transition-colors"
          >
            {t('auth.changePassword', lang)}
          </button>
          {user.role === 'admin' && (
            <button
              onClick={() => { setAdminPanelOpen(true); setOpen(false); }}
              className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-600 transition-colors text-amber-400"
            >
              {t('admin.title', lang)}
            </button>
          )}
          <hr className="border-slate-600 my-1" />
          <button
            onClick={() => { logout(); setOpen(false); }}
            className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-600 transition-colors text-red-400"
          >
            {t('auth.logout', lang)}
          </button>
        </div>
      )}
    </div>
  );
}
