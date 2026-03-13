import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t } from '../../lib/i18n.js';

export default function MarkdownNoteOverlay({ drawing, mapRef, isEditing, onSave, onCancel, lang }) {
  const [editText, setEditText] = useState(drawing.properties?.markdown || '');
  const contentRef = useRef(null);
  const [scale, setScale] = useState(1);
  const textareaRef = useRef(null);

  const color = drawing.properties?.color || '#000000';
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

  // Auto-scale in display mode
  useLayoutEffect(() => {
    if (isEditing || !contentRef.current || !box) return;
    const el = contentRef.current;
    const sw = el.scrollWidth;
    const sh = el.scrollHeight;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (sw > cw || sh > ch) {
      setScale(Math.max(0.3, Math.min(1, cw / sw, ch / sh)));
    } else {
      setScale(1);
    }
  }, [isEditing, markdown, box, fontSize]);

  if (!box) return null;

  const { minX, minY, w: boxW, h: boxH } = box;
  const toolbarH = isEditing ? 28 : 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: minX,
        top: minY,
        width: boxW,
        height: boxH,
        border: `${strokeWidth}px solid ${color}`,
        background: 'rgba(15, 23, 42, 0.92)',
        borderRadius: 4,
        overflow: 'hidden',
        zIndex: 6,
        pointerEvents: isEditing ? 'auto' : 'none',
      }}
      onPointerDown={isEditing ? (e) => e.stopPropagation() : undefined}
      onKeyDown={isEditing ? (e) => e.stopPropagation() : undefined}
    >
      {isEditing ? (
        <>
          {/* Toolbar */}
          <div
            style={{ height: toolbarH, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', background: 'rgba(30,41,59,0.95)', borderBottom: '1px solid rgba(100,116,139,0.4)' }}
          >
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{t('draw.note', lang)}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => { onSave(editText); }}
                style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 3, width: 22, height: 20, cursor: 'pointer', fontSize: 13, lineHeight: '20px', fontWeight: 700 }}
                title="Save"
              >
                &#x2713;
              </button>
              <button
                onClick={() => { onCancel(); }}
                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 3, width: 22, height: 20, cursor: 'pointer', fontSize: 13, lineHeight: '20px', fontWeight: 700 }}
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
              color: '#e2e8f0',
              border: 'none',
              outline: 'none',
              resize: 'none',
              padding: '6px 8px',
              fontSize: Math.max(11, fontSize - 2),
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              lineHeight: 1.4,
            }}
          />
        </>
      ) : (
        <div
          ref={contentRef}
          style={{
            width: boxW / scale,
            height: boxH / scale,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            overflow: 'hidden',
            padding: '6px 8px',
            fontSize,
            color: '#e2e8f0',
            lineHeight: 1.5,
          }}
        >
          {markdown ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 style={{ fontSize: '1.25em', fontWeight: 700, margin: '0.5em 0 0.25em' }}>{children}</h1>,
                h2: ({ children }) => <h2 style={{ fontSize: '1.1em', fontWeight: 700, margin: '0.4em 0 0.2em' }}>{children}</h2>,
                h3: ({ children }) => <h3 style={{ fontSize: '1em', fontWeight: 700, margin: '0.3em 0 0.15em' }}>{children}</h3>,
                p: ({ children }) => <p style={{ margin: '0 0 0.4em' }}>{children}</p>,
                ul: ({ children }) => <ul style={{ listStyleType: 'disc', paddingLeft: '1.2em', margin: '0 0 0.4em' }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ listStyleType: 'decimal', paddingLeft: '1.2em', margin: '0 0 0.4em' }}>{children}</ol>,
                li: ({ children }) => <li style={{ margin: '0.1em 0' }}>{children}</li>,
                strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
                em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                code: ({ inline, children }) => {
                  if (inline) {
                    return <code style={{ background: 'rgba(15,23,42,0.6)', color: '#6ee7b7', padding: '1px 4px', borderRadius: 3, fontSize: '0.85em', fontFamily: 'monospace' }}>{children}</code>;
                  }
                  return (
                    <pre style={{ background: 'rgba(15,23,42,0.8)', borderRadius: 4, padding: '4px 6px', margin: '0.3em 0', overflowX: 'auto' }}>
                      <code style={{ fontSize: '0.85em', fontFamily: 'monospace', color: '#cbd5e1' }}>{children}</code>
                    </pre>
                  );
                },
                pre: ({ children }) => <>{children}</>,
                a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#6ee7b7', textDecoration: 'underline' }}>{children}</a>,
                table: ({ children }) => (
                  <div style={{ overflowX: 'auto', margin: '0.3em 0' }}>
                    <table style={{ fontSize: '0.85em', borderCollapse: 'collapse', border: '1px solid #475569' }}>{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead style={{ background: 'rgba(30,41,59,0.8)' }}>{children}</thead>,
                th: ({ children }) => <th style={{ border: '1px solid #475569', padding: '2px 6px', textAlign: 'left', fontWeight: 600 }}>{children}</th>,
                td: ({ children }) => <td style={{ border: '1px solid #475569', padding: '2px 6px' }}>{children}</td>,
                blockquote: ({ children }) => <blockquote style={{ borderLeft: '2px solid #6ee7b7', paddingLeft: 8, margin: '0.3em 0', color: '#94a3b8', fontStyle: 'italic' }}>{children}</blockquote>,
                hr: () => <hr style={{ border: 'none', borderTop: '1px solid #475569', margin: '0.4em 0' }} />,
              }}
            >
              {markdown}
            </ReactMarkdown>
          ) : (
            <span style={{ color: '#64748b', fontStyle: 'italic', fontSize: '0.9em' }}>
              {t('draw.noteEmpty', lang)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
