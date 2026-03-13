import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t } from '../../lib/i18n.js';

export default function MarkdownNoteOverlay({ drawing, mapRef, isEditing, onSave, onCancel, lang }) {
  const [editText, setEditText] = useState(drawing.properties?.markdown || '');
  const contentRef = useRef(null);
  const textareaRef = useRef(null);

  const color = drawing.properties?.color || '#3b82f6';
  const strokeWidth = drawing.properties?.strokeWidth || 2;
  const fontSize = drawing.properties?.fontSize || 14;
  const markdown = drawing.properties?.markdown || '';

  // Project polygon corners to screen and compute bounding box (no memo — must recompute on map move)
  let box = null;
  const ring = drawing.geometry?.coordinates?.[0];
  if (ring && ring.length >= 4 && mapRef) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let valid = true;
    for (let i = 0; i < ring.length - 1; i++) {
      try {
        const p = mapRef.project(ring[i]);
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      } catch { valid = false; break; }
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (valid && w >= 10 && h >= 10) {
      box = { minX, minY, w, h };
    }
  }

  // Reset edit text when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setEditText(drawing.properties?.markdown || '');
    }
  }, [isEditing, drawing.id]);

  // Auto-focus textarea
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  // Auto-scale in display mode — use ref to avoid re-render loop
  useLayoutEffect(() => {
    if (isEditing || !contentRef.current || !box) return;
    const el = contentRef.current;
    // Temporarily reset transform to measure natural content size
    el.style.transform = 'none';
    const sw = el.scrollWidth;
    const sh = el.scrollHeight;
    const cw = box.w - 20; // account for padding (10px each side)
    const ch = box.h - 16; // account for padding (8px top+bottom)
    let s = 1;
    if (sw > cw || sh > ch) {
      s = Math.max(0.3, Math.min(1, cw / sw, ch / sh));
    }
    el.style.transform = `scale(${s})`;
  });

  if (!box) return null;

  const { minX, minY, w: boxW, h: boxH } = box;
  const toolbarH = isEditing ? 32 : 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: minX,
        top: minY,
        width: boxW,
        height: boxH,
        border: `${Math.max(strokeWidth, 2)}px solid ${color}`,
        background: isEditing ? 'rgba(30, 41, 59, 1)' : 'rgba(30, 41, 59, 0.95)',
        borderRadius: 6,
        overflow: 'hidden',
        zIndex: isEditing ? 50 : 6,
        pointerEvents: isEditing ? 'auto' : 'none',
      }}
      onPointerDown={isEditing ? (e) => e.stopPropagation() : undefined}
      onKeyDown={isEditing ? (e) => e.stopPropagation() : undefined}
    >
      {isEditing ? (
        <>
          {/* Toolbar */}
          <div
            style={{
              height: toolbarH,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 8px',
              background: '#334155',
              borderBottom: '1px solid #64748b',
            }}
          >
            <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 700 }}>{t('draw.note', lang)}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => { onSave(editText); }}
                style={{
                  background: '#22c55e',
                  color: '#ffffff',
                  border: '1px solid #4ade80',
                  borderRadius: 4,
                  width: 30,
                  height: 26,
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: '26px',
                  fontWeight: 800,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                }}
                title="Save"
              >
                &#x2713;
              </button>
              <button
                onClick={() => { onCancel(); }}
                style={{
                  background: '#ef4444',
                  color: '#ffffff',
                  border: '1px solid #f87171',
                  borderRadius: 4,
                  width: 30,
                  height: 26,
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: '26px',
                  fontWeight: 800,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                }}
                title="Cancel"
              >
                &#x2715;
              </button>
            </div>
          </div>
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder={t('draw.notePlaceholder', lang)}
            style={{
              width: '100%',
              height: `calc(100% - ${toolbarH}px)`,
              background: 'transparent',
              color: '#ffffff',
              border: 'none',
              outline: 'none',
              resize: 'none',
              padding: '8px 10px',
              fontSize: Math.max(13, fontSize),
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              lineHeight: 1.5,
            }}
          />
        </>
      ) : (
        <div
          ref={contentRef}
          style={{
            width: boxW,
            height: boxH,
            transformOrigin: 'top left',
            overflow: 'hidden',
            padding: '8px 10px',
            fontSize,
            color: '#f1f5f9',
            lineHeight: 1.5,
          }}
        >
          {markdown ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 style={{ fontSize: '1.25em', fontWeight: 700, margin: '0.5em 0 0.25em', color: '#f8fafc' }}>{children}</h1>,
                h2: ({ children }) => <h2 style={{ fontSize: '1.1em', fontWeight: 700, margin: '0.4em 0 0.2em', color: '#f8fafc' }}>{children}</h2>,
                h3: ({ children }) => <h3 style={{ fontSize: '1em', fontWeight: 700, margin: '0.3em 0 0.15em', color: '#f1f5f9' }}>{children}</h3>,
                p: ({ children }) => <p style={{ margin: '0 0 0.4em', color: '#e2e8f0' }}>{children}</p>,
                ul: ({ children }) => <ul style={{ listStyleType: 'disc', paddingLeft: '1.2em', margin: '0 0 0.4em', color: '#e2e8f0' }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ listStyleType: 'decimal', paddingLeft: '1.2em', margin: '0 0 0.4em', color: '#e2e8f0' }}>{children}</ol>,
                li: ({ children }) => <li style={{ margin: '0.1em 0' }}>{children}</li>,
                strong: ({ children }) => <strong style={{ fontWeight: 700, color: '#f8fafc' }}>{children}</strong>,
                em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                code: ({ inline, children }) => {
                  if (inline) {
                    return <code style={{ background: 'rgba(71, 85, 105, 0.6)', color: '#6ee7b7', padding: '1px 4px', borderRadius: 3, fontSize: '0.85em', fontFamily: 'monospace' }}>{children}</code>;
                  }
                  return (
                    <pre style={{ background: 'rgba(15, 23, 42, 0.6)', borderRadius: 4, padding: '4px 6px', margin: '0.3em 0', overflowX: 'auto' }}>
                      <code style={{ fontSize: '0.85em', fontFamily: 'monospace', color: '#e2e8f0' }}>{children}</code>
                    </pre>
                  );
                },
                pre: ({ children }) => <>{children}</>,
                a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#6ee7b7', textDecoration: 'underline' }}>{children}</a>,
                table: ({ children }) => (
                  <div style={{ overflowX: 'auto', margin: '0.3em 0' }}>
                    <table style={{ fontSize: '0.85em', borderCollapse: 'collapse', border: '1px solid #64748b' }}>{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead style={{ background: 'rgba(51, 65, 85, 0.8)' }}>{children}</thead>,
                th: ({ children }) => <th style={{ border: '1px solid #64748b', padding: '2px 6px', textAlign: 'left', fontWeight: 600, color: '#f1f5f9' }}>{children}</th>,
                td: ({ children }) => <td style={{ border: '1px solid #64748b', padding: '2px 6px', color: '#e2e8f0' }}>{children}</td>,
                blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #6ee7b7', paddingLeft: 8, margin: '0.3em 0', color: '#94a3b8', fontStyle: 'italic' }}>{children}</blockquote>,
                hr: () => <hr style={{ border: 'none', borderTop: '1px solid #64748b', margin: '0.4em 0' }} />,
              }}
            >
              {markdown}
            </ReactMarkdown>
          ) : (
            <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.9em' }}>
              {t('draw.noteEmpty', lang)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
