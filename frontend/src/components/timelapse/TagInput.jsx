import { useState, useRef } from 'react';

/**
 * TagInput - Free-form comma-separated tag input
 *
 * Users can type any text and separate tags with comma, Enter, or blur
 */
export default function TagInput({ value = [], onChange, placeholder, lang }) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);

  function addTag(tag) {
    const trimmed = tag.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInputValue('');
  }

  function removeTag(index) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(e) {
    if (e.key === ',' || e.key === 'Enter') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && value.length) {
      removeTag(value.length - 1);
    }
  }

  function handleBlur() {
    if (inputValue.trim()) {
      addTag(inputValue);
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    // Split by comma and add each tag
    const tags = pastedText.split(',').map(t => t.trim()).filter(t => t);
    const newTags = tags.filter(t => !value.includes(t));
    if (newTags.length > 0) {
      onChange([...value, ...newTags]);
    }
  }

  return (
    <div
      className="flex flex-wrap gap-1 p-2 bg-slate-800 border border-slate-600 rounded min-h-[42px] cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag, i) => (
        <span
          key={i}
          className="flex items-center gap-1 px-2 py-0.5 bg-cyan-900/50 border border-cyan-700 rounded text-sm text-cyan-300"
        >
          {tag}
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeTag(i);
            }}
            className="text-cyan-500 hover:text-red-400 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPaste={handlePaste}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[100px] bg-transparent outline-none text-sm text-white placeholder-slate-500"
      />
    </div>
  );
}
