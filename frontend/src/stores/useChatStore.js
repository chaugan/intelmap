import { create } from 'zustand';

export const useChatStore = create((set, get) => ({
  messages: [],
  streaming: false,
  error: null,

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  appendToLastAssistant: (text) => set((s) => {
    const msgs = [...s.messages];
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'assistant') {
      msgs[msgs.length - 1] = { ...last, content: last.content + text };
    }
    return { messages: msgs };
  }),

  setStreaming: (streaming) => set({ streaming }),
  setError: (error) => set({ error }),
  clearMessages: () => set({ messages: [] }),
}));
