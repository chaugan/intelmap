import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

/**
 * Reusable dropdown menu for export options.
 * Shows "Save to disk" and "Transfer to WaSOS" options.
 * "Transfer to WaSOS" is grayed out with tooltip if not logged in.
 */
export default function ExportMenu({
  onSaveToDisk,
  onTransferToWasos,
  wasosLoggedIn,
  buttonIcon,
  buttonLabel,
  buttonClassName,
  disabled,
}) {
  const lang = useMapStore((s) => s.lang);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Update dropdown position when shown
  useEffect(() => {
    if (showDropdown && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
  }, [showDropdown]);

  // Clamp dropdown within viewport after it renders
  useLayoutEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const menu = dropdownRef.current;
      const rect = menu.getBoundingClientRect();
      const padding = 8;

      // If menu goes off left edge, shift it right
      if (rect.left < padding) {
        const currentRight = parseFloat(menu.style.right) || 0;
        const adjustment = padding - rect.left;
        menu.style.right = `${Math.max(padding, currentRight - adjustment)}px`;
      }

      // If menu goes off right edge, shift it left
      if (rect.right > window.innerWidth - padding) {
        menu.style.right = `${padding}px`;
      }
    }
  });

  const handleSaveToDisk = () => {
    setShowDropdown(false);
    onSaveToDisk?.();
  };

  const handleTransferToWasos = () => {
    if (!wasosLoggedIn) return;
    setShowDropdown(false);
    onTransferToWasos?.();
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={disabled}
        className={buttonClassName || "px-2 py-1 rounded transition-colors bg-slate-700 hover:bg-slate-600 disabled:opacity-50 flex items-center gap-1"}
        title={buttonLabel}
      >
        {buttonIcon}
        {buttonLabel && <span className="text-sm">{buttonLabel}</span>}
      </button>

      {showDropdown && createPortal(
        <div
          ref={dropdownRef}
          className="fixed bg-slate-700 text-slate-100 rounded shadow-2xl border border-slate-600 min-w-[180px]"
          style={{ top: dropdownPos.top, right: dropdownPos.right, zIndex: 99999 }}
        >
          {/* Save to disk option */}
          <button
            onClick={handleSaveToDisk}
            className="block w-full text-left px-3 py-2 hover:bg-slate-600 transition-colors text-sm"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {t('wasos.saveToDisk', lang)}
            </div>
          </button>

          {/* Transfer to WaSOS option */}
          <button
            onClick={handleTransferToWasos}
            disabled={!wasosLoggedIn}
            className={`block w-full text-left px-3 py-2 transition-colors text-sm ${
              wasosLoggedIn
                ? 'hover:bg-slate-600'
                : 'opacity-50 cursor-not-allowed'
            }`}
            title={!wasosLoggedIn ? t('wasos.notLoggedIn', lang) : undefined}
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span>{t('wasos.transfer', lang)}</span>
              {!wasosLoggedIn && (
                <svg className="w-3 h-3 ml-auto text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-6V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
            </div>
            {!wasosLoggedIn && (
              <div className="text-xs text-slate-400 mt-0.5 ml-6">
                {t('wasos.notLoggedIn', lang)}
              </div>
            )}
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
