export default function ChatMessage({ message, lang }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm chat-message ${
          isUser
            ? 'bg-emerald-700 text-white'
            : 'bg-slate-700 text-slate-200'
        }`}
      >
        <div className="whitespace-pre-wrap break-words">
          {formatContent(message.content)}
        </div>
      </div>
    </div>
  );
}

function formatContent(text) {
  if (!text) return '';
  // Simple markdown-like formatting
  return text
    .split(/(\*\*.*?\*\*|\*\[.*?\]\*)/g)
    .map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*[') && part.endsWith(']*')) {
        return (
          <span key={i} className="text-xs text-purple-400 italic block my-1">
            {part.slice(2, -2)}
          </span>
        );
      }
      return part;
    });
}
