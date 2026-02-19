import { useState, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas-pro';
import { useChatStore } from '../../stores/useChatStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTacticalStore } from '../../stores/useTacticalStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import ChatMessage from './ChatMessage.jsx';
import { t } from '../../lib/i18n.js';

// Export canvas under Anthropic's 5 MB limit: try PNG, then progressively lower JPEG quality
const MAX_BASE64_LEN = 6_000_000; // ~4.5 MB decoded
function canvasToDataUrl(canvas) {
  const png = canvas.toDataURL('image/png');
  if (png.length <= MAX_BASE64_LEN) return png;
  for (const q of [0.92, 0.8, 0.65]) {
    const jpg = canvas.toDataURL('image/jpeg', q);
    if (jpg.length <= MAX_BASE64_LEN) return jpg;
  }
  return canvas.toDataURL('image/jpeg', 0.5);
}

// Draw lat/lng coordinate grid on AI screenshot for spatial reasoning
function drawCoordGrid(ctx, map, width, height) {
  const bounds = map.getBounds();
  const north = bounds.getNorth(), south = bounds.getSouth();
  const east = bounds.getEast(), west = bounds.getWest();
  const dpr = window.devicePixelRatio || 1;

  // Pick grid interval for ~8-20 lines per axis (denser = better AI precision)
  const INTERVALS = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0005, 0.0002, 0.0001];
  const latSpan = north - south;
  const lonSpan = east - west;
  const latInterval = INTERVALS.find(i => latSpan / i >= 8 && latSpan / i <= 20) || INTERVALS[INTERVALS.length - 1];
  const lonInterval = INTERVALS.find(i => lonSpan / i >= 8 && lonSpan / i <= 20) || INTERVALS[INTERVALS.length - 1];

  // Helper: decimal places for label formatting
  const decimals = (interval) => {
    if (interval >= 1) return 0;
    const s = String(interval);
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : s.length - dot - 1;
  };
  const fmtLat = (v) => `${Math.abs(v).toFixed(decimals(latInterval))}°${v >= 0 ? 'N' : 'S'}`;
  const fmtLon = (v) => `${Math.abs(v).toFixed(decimals(lonInterval))}°${v >= 0 ? 'E' : 'W'}`;

  // Helper: draw text with dark shadow for readability
  const drawLabel = (text, x, y) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillText(text, x + 1 * dpr, y + 1 * dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
  };

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 1 * dpr;
  ctx.font = `bold ${11 * dpr}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'start';

  const centerLat = (north + south) / 2;
  const centerLon = (east + west) / 2;

  // Latitude lines (horizontal)
  const latStart = Math.ceil(south / latInterval) * latInterval;
  for (let lat = latStart; lat <= north; lat = +(lat + latInterval).toFixed(10)) {
    const px = map.project([centerLon, lat]);
    const y = px.y * dpr;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    drawLabel(fmtLat(lat), 6 * dpr, y + 3 * dpr);
  }

  // Longitude lines (vertical)
  const lonStart = Math.ceil(west / lonInterval) * lonInterval;
  for (let lon = lonStart; lon <= east; lon = +(lon + lonInterval).toFixed(10)) {
    const px = map.project([lon, centerLat]);
    const x = px.x * dpr;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    drawLabel(fmtLon(lon), x + 3 * dpr, 6 * dpr);
  }

  ctx.restore();
}

// Draw wind legend onto screenshot canvas (matches WindLegend in WindOverlay.jsx)
function drawWindLegend(ctx, width, height) {
  const items = [
    { label: '<5.4',  color: 'rgb(150, 220, 150)' },
    { label: '5.5',   color: 'rgb(90, 200, 90)' },
    { label: '8',     color: 'rgb(48, 176, 112)' },
    { label: '10.8',  color: 'rgb(32, 160, 160)' },
    { label: '13.9',  color: 'rgb(32, 144, 192)' },
    { label: '17.2',  color: 'rgb(48, 112, 192)' },
    { label: '20.8',  color: 'rgb(64, 64, 176)' },
    { label: '24.5',  color: 'rgb(96, 48, 160)' },
    { label: '28.5',  color: 'rgb(128, 32, 128)' },
    { label: '>32.6', color: 'rgb(110, 16, 96)' },
  ];
  const dpr = window.devicePixelRatio || 1;
  const sw = 30 * dpr, sh = 14 * dpr, gap = 4 * dpr, pad = 10 * dpr;
  const totalW = items.length * (sw + gap) - gap + pad * 2;
  const totalH = sh + 22 * dpr + pad * 2;
  const x0 = width - totalW - 160 * dpr;
  const y0 = height - totalH - 16 * dpr;
  ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
  ctx.beginPath();
  ctx.roundRect(x0, y0, totalW, totalH, 4 * dpr);
  ctx.fill();
  ctx.font = `bold ${11 * dpr}px sans-serif`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('Wind (m/s)', x0 + pad, y0 + pad + 10 * dpr);
  items.forEach((item, i) => {
    const bx = x0 + pad + i * (sw + gap);
    const by = y0 + pad + 16 * dpr;
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.roundRect(bx, by, sw, sh, 2 * dpr);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = `${10 * dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(item.label, bx + sw / 2, by + sh + 10 * dpr);
    ctx.textAlign = 'start';
  });
}

export default function AiChatPanel() {
  const lang = useMapStore((s) => s.lang);
  const chatDrawerOpen = useMapStore((s) => s.chatDrawerOpen);
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const addMessage = useChatStore((s) => s.addMessage);
  const appendToLastAssistant = useChatStore((s) => s.appendToLastAssistant);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const user = useAuthStore((s) => s.user);

  const [input, setInput] = useState('');
  const [sendScreenshot, setSendScreenshot] = useState(false);
  const [aiStatus, setAiStatus] = useState(null); // { hasKey, model, prompts }
  const [activePrompt, setActivePrompt] = useState('general');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when drawer opens
  useEffect(() => {
    if (chatDrawerOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [chatDrawerOpen]);

  // Focus input after streaming ends
  useEffect(() => {
    if (!streaming) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [streaming]);

  // Check AI availability on mount and when drawer opens
  useEffect(() => {
    if (!chatDrawerOpen) return;
    fetch('/api/ai/status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setAiStatus(data); })
      .catch(() => {});
  }, [chatDrawerOpen]);

  const handleAbort = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg = { role: 'user', content: text };
    addMessage(userMsg);
    setInput('');
    setStreaming(true);
    addMessage({ role: 'assistant', content: '' });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Read fresh viewport and bounds directly from map at send time
      const mapState = useMapStore.getState();
      const map = mapState.mapRef;
      let latitude = mapState.latitude;
      let longitude = mapState.longitude;
      let zoom = mapState.zoom;
      let bounds = mapState.bounds;

      // Get fresh center and bounds directly from the map instance
      if (map) {
        try {
          const center = map.getCenter();
          latitude = center.lat;
          longitude = center.lng;
          zoom = map.getZoom();
          const b = map.getBounds();
          bounds = {
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest(),
          };
        } catch {
          // fallback to store values
        }
      }

      const viewport = { latitude, longitude, zoom, bounds };

      // Capture screenshot of the full map container (canvas + DOM overlays)
      let screenshot = null;
      if (sendScreenshot && map) {
        try {
          // Force a fresh render before capturing to avoid black canvas
          map.triggerRepaint();
          await new Promise((resolve) => {
            map.once('render', resolve);
          });

          // Try html2canvas for full DOM capture (includes popups, markers, legends)
          const mapContainer = document.querySelector('[data-map-container]');
          if (mapContainer) {
            try {
              const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // cap DPR for AI — retina not needed
              const captured = await html2canvas(mapContainer, {
                useCORS: true,
                backgroundColor: null,
                scale: dpr,
              });
              const ctx = captured.getContext('2d');
              drawCoordGrid(ctx, map, captured.width, captured.height);
              screenshot = canvasToDataUrl(captured);
            } catch (e) {
              console.warn('html2canvas failed, falling back to canvas capture:', e);
            }
          }

          // Fallback: direct canvas capture if html2canvas failed
          if (!screenshot) {
            const mapCanvas = map.getCanvas();
            const offscreen = document.createElement('canvas');
            offscreen.width = mapCanvas.width;
            offscreen.height = mapCanvas.height;
            const ctx = offscreen.getContext('2d');
            ctx.drawImage(mapCanvas, 0, 0);
            drawCoordGrid(ctx, map, offscreen.width, offscreen.height);
            screenshot = canvasToDataUrl(offscreen);
          }
        } catch {
          // screenshot unavailable
        }
      }

      const apiMessages = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const activeProjectId = useTacticalStore.getState().activeProjectId;

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          messages: apiMessages,
          viewport,
          screenshot,
          projectId: activeProjectId,
          promptId: activePrompt,
        }),
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch {}
        appendToLastAssistant(`**Error:** ${errMsg}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text') {
              appendToLastAssistant(data.content);
            } else if (data.type === 'tool') {
              appendToLastAssistant(`\n*[${data.name}: ${data.result?.message || 'done'}]*`);
            } else if (data.type === 'error') {
              appendToLastAssistant(`\n**Error:** ${data.error}`);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        appendToLastAssistant(lang === 'no' ? '\n\n*[Avbrutt]*' : '\n\n*[Aborted]*');
      } else {
        appendToLastAssistant(`\n**Error:** ${err.message}`);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-slate-700 shrink-0">
        <h2 className="text-sm font-semibold text-emerald-400">
          {t('chat.title', lang)}
        </h2>
      </div>

      {/* No API key warning */}
      {aiStatus && !aiStatus.hasKey && (
        <div className="px-3 py-2 bg-amber-900/50 border-b border-amber-700 text-amber-300 text-xs">
          {t('chat.noKey', lang)}
          {user?.role !== 'admin' && (
            <span className="ml-1">
              ({lang === 'no' ? 'kontakt administrator' : 'contact admin'})
            </span>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500 italic">
            {lang === 'no'
              ? 'Sp\u00f8r AI-karthjelper om steder, ruter, kartmarkering, eller analyse av terrenget.'
              : 'Ask the AI map helper about locations, routes, map markings, or terrain analysis.'}
          </p>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} lang={lang} />
        ))}
        {streaming && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-emerald-400 animate-pulse">
              {t('chat.thinking', lang)}
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-slate-700 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          {/* System prompt selector */}
          {aiStatus?.prompts && aiStatus.prompts.length > 1 && (
            <select
              value={activePrompt}
              onChange={(e) => setActivePrompt(e.target.value)}
              className="bg-slate-700 text-[10px] text-slate-300 px-1.5 py-0.5 rounded border border-slate-600 focus:border-emerald-500 focus:outline-none"
            >
              {aiStatus.prompts.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={sendScreenshot}
              onChange={(e) => setSendScreenshot(e.target.checked)}
              className="accent-emerald-500"
            />
            {t('chat.screenshot', lang)}
          </label>
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={t('chat.placeholder', lang)}
            disabled={streaming}
            className="flex-1 bg-slate-700 text-sm px-3 py-2 rounded border border-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={streaming ? handleAbort : handleSend}
            disabled={!streaming && (!input.trim() || (aiStatus && !aiStatus.hasKey))}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              streaming
                ? 'bg-red-700 hover:bg-red-600 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:opacity-50'
            }`}
          >
            {streaming ? (lang === 'no' ? 'Stopp' : 'Stop') : t('chat.send', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
