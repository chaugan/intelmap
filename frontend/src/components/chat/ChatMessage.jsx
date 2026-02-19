import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function downloadMd(content) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-response-${ts}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPdf(content) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>AI Response</title>
<style>body{font-family:system-ui,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#1e293b;line-height:1.6}
h1,h2,h3{margin-top:1.2em}pre{background:#f1f5f9;padding:12px;border-radius:6px;overflow-x:auto}
code{font-family:monospace;font-size:0.9em}table{border-collapse:collapse;margin:1em 0}
th,td{border:1px solid #cbd5e1;padding:6px 10px}th{background:#f1f5f9}
blockquote{border-left:3px solid #94a3b8;margin-left:0;padding-left:12px;color:#475569}</style>
</head><body><div id="content"></div>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script>document.getElementById('content').innerHTML=marked.parse(${JSON.stringify(content)});window.print();<\/script>
</body></html>`);
  win.document.close();
}

export default function ChatMessage({ message, lang }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`group relative max-w-[85%] rounded-lg px-3 py-2 text-sm chat-message ${
          isUser
            ? 'bg-emerald-700 text-white'
            : 'bg-slate-700 text-slate-200'
        }`}
      >
        {!isUser && message.content && (
          <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5">
            <button
              onClick={() => downloadMd(message.content)}
              className="p-0.5 rounded hover:bg-slate-600 text-slate-400 hover:text-white transition-colors"
              title={lang === 'no' ? 'Last ned som Markdown' : 'Download as Markdown'}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
            <button
              onClick={() => exportPdf(message.content)}
              className="p-0.5 rounded hover:bg-slate-600 text-slate-400 hover:text-white transition-colors"
              title={lang === 'no' ? 'Skriv ut / lagre som PDF' : 'Print / save as PDF'}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
            </button>
          </div>
        )}
        <div className="break-words">
          {formatContent(message.content, isUser)}
        </div>
      </div>
    </div>
  );
}

function formatContent(text, isUser) {
  if (!text) return '';

  // Split on tool annotations *[...]* — keep them as styled spans
  const parts = text.split(/(\*\[.*?\]\*)/g);

  return parts.map((part, i) => {
    if (part.startsWith('*[') && part.endsWith(']*')) {
      return (
        <span key={i} className="text-xs text-purple-400 italic block my-1">
          {part.slice(2, -2)}
        </span>
      );
    }
    // Render everything else through ReactMarkdown
    return (
      <ReactMarkdown
        key={i}
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold mt-2 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>,
          p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ inline, className, children }) => {
            if (inline) {
              return (
                <code className="bg-slate-900/60 text-emerald-300 px-1 py-0.5 rounded text-xs font-mono">
                  {children}
                </code>
              );
            }
            return (
              <pre className="bg-slate-900/80 rounded p-2 my-1.5 overflow-x-auto">
                <code className="text-xs font-mono text-slate-300">{children}</code>
              </pre>
            );
          },
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline hover:text-emerald-300">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-1.5">
              <table className="text-xs border-collapse border border-slate-600">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-800">{children}</thead>,
          th: ({ children }) => <th className="border border-slate-600 px-2 py-1 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-slate-600 px-2 py-1">{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-emerald-500 pl-2 my-1.5 text-slate-400 italic">{children}</blockquote>
          ),
          hr: () => <hr className="border-slate-600 my-2" />,
        }}
      >
        {part}
      </ReactMarkdown>
    );
  });
}
