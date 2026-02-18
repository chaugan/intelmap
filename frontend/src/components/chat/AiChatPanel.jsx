import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../../stores/useChatStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import ChatMessage from './ChatMessage.jsx';
import { t } from '../../lib/i18n.js';

export default function AiChatPanel() {
  const lang = useMapStore((s) => s.lang);
  const chatDrawerOpen = useMapStore((s) => s.chatDrawerOpen);
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const addMessage = useChatStore((s) => s.addMessage);
  const appendToLastAssistant = useChatStore((s) => s.appendToLastAssistant);
  const setStreaming = useChatStore((s) => s.setStreaming);

  const [input, setInput] = useState('');
  const [sendScreenshot, setSendScreenshot] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg = { role: 'user', content: text };
    addMessage(userMsg);
    setInput('');
    setStreaming(true);
    addMessage({ role: 'assistant', content: '' });

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

      // Capture screenshot directly from the map canvas
      let screenshot = null;
      if (sendScreenshot && map) {
        try {
          screenshot = map.getCanvas().toDataURL('image/jpeg', 0.6);
        } catch {
          // screenshot unavailable
        }
      }

      const apiMessages = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          viewport,
          screenshot,
        }),
      });

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
              appendToLastAssistant(`\n*[${data.name}: ${data.result?.message || 'done'}]*\n`);
            } else if (data.type === 'error') {
              appendToLastAssistant(`\n**Error:** ${data.error}`);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      appendToLastAssistant(`\n**Error:** ${err.message}`);
    } finally {
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500 italic">
            {lang === 'no'
              ? 'Spør AI-strategen om taktiske råd, plassering av enheter, eller analyse av terrenget.'
              : 'Ask the AI strategist for tactical advice, unit placement, or terrain analysis.'}
          </p>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} lang={lang} />
        ))}
        {streaming && (
          <div className="text-xs text-emerald-400 animate-pulse">
            {t('chat.thinking', lang)}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-slate-700 shrink-0">
        <div className="flex items-center gap-1 mb-2">
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
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:opacity-50 px-4 py-2 rounded text-sm transition-colors"
          >
            {t('chat.send', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
