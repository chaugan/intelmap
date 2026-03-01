import { useState, useRef, useEffect, Children } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../lib/i18n.js';

/**
 * Toolbar that automatically moves overflowing items to a "[...]" menu.
 * All children are rendered for measurement, but overflow items are visually hidden.
 * The overflow menu renders clones of the hidden items.
 */
export default function OverflowToolbar({ children, lang, className = '' }) {
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const [overflowIndex, setOverflowIndex] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const menuRef = useRef(null);
  const moreButtonRef = useRef(null);

  const childArray = Children.toArray(children).filter(Boolean);

  // Measure items and determine overflow point
  useEffect(() => {
    const measure = () => {
      if (!measureRef.current || !containerRef.current) return;

      const containerWidth = containerRef.current.offsetWidth;
      const moreButtonWidth = 50;
      const items = measureRef.current.children;
      let usedWidth = 0;
      let newOverflowIndex = -1;

      for (let i = 0; i < items.length; i++) {
        const itemWidth = items[i].offsetWidth + 8; // gap
        const wouldOverflow = usedWidth + itemWidth > containerWidth - moreButtonWidth;

        if (wouldOverflow && i < items.length - 1) {
          newOverflowIndex = i;
          break;
        }
        usedWidth += itemWidth;
      }

      // Check if last item fits without more button
      if (newOverflowIndex === -1 && usedWidth > containerWidth) {
        newOverflowIndex = items.length - 1;
      }

      setOverflowIndex(newOverflowIndex);
    };

    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [childArray.length]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          moreButtonRef.current && !moreButtonRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  // Position menu
  useEffect(() => {
    if (menuOpen && moreButtonRef.current) {
      const rect = moreButtonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
  }, [menuOpen]);

  const hasOverflow = overflowIndex !== -1;
  const overflowItems = hasOverflow ? childArray.slice(overflowIndex) : [];
  const overflowMenuItems = overflowItems.filter(child =>
    !child.props?.className?.includes('w-px') // Skip dividers
  );

  return (
    <>
      {/* Hidden measurement container */}
      <div
        ref={measureRef}
        className="flex items-center gap-2 absolute invisible pointer-events-none"
        style={{ whiteSpace: 'nowrap' }}
      >
        {childArray}
      </div>

      {/* Visible toolbar */}
      <div ref={containerRef} className={`flex items-center gap-2 ${className}`}>
        {childArray.map((child, i) => {
          const isOverflow = hasOverflow && i >= overflowIndex;
          return (
            <div key={i} className={isOverflow ? 'hidden' : 'contents'}>
              {child}
            </div>
          );
        })}

        {/* More button */}
        {hasOverflow && (
          <button
            ref={moreButtonRef}
            onClick={() => setMenuOpen(!menuOpen)}
            className="px-2 py-1 rounded transition-colors bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold shrink-0"
            title={t('toolbar.more', lang)}
          >
            •••
          </button>
        )}
      </div>

      {/* Overflow menu */}
      {menuOpen && overflowMenuItems.length > 0 && createPortal(
        <div
          ref={menuRef}
          className="fixed bg-slate-800 text-slate-100 rounded-lg shadow-2xl border border-slate-600 py-2 min-w-[200px] z-[99999]"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          {overflowMenuItems.map((child, i) => (
            <div key={i} className="px-2 py-1">
              {child}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
