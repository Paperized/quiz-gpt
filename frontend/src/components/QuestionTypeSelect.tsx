import { useEffect, useRef, useState } from 'react';
import { QUESTION_TYPES } from '../types';
import type { QuestionType } from '../types';

const TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple Choice',
  true_false: 'True / False',
  multi_select: 'Multi Select',
  free_text: 'Free Text'
};

export function QuestionTypeSelect({
  value,
  onChange
}: {
  value: QuestionType[];
  onChange: (value: QuestionType[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const allSelected = value.length === QUESTION_TYPES.length;
  const displayText = allSelected
    ? 'All'
    : value.map((t) => TYPE_LABELS[t]).join(', ');

  function toggle(type: QuestionType) {
    if (value.includes(type)) {
      const next = value.filter((t) => t !== type);
      if (next.length === 0) return;
      onChange(next);
    } else {
      onChange([...value, type]);
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-[12px] font-medium text-on-surface block font-geist">Question Type</label>
      <div ref={containerRef} className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="w-full bg-surface border border-border-subtle text-on-surface text-[14px] rounded px-3 py-2.5 text-left flex items-center justify-between hover:border-outline-variant transition-colors"
        >
          <span className="truncate text-[13px]">{displayText}</span>
          <svg className={`w-4 h-4 text-text-muted shrink-0 ml-2 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {open && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-surface-container border border-border-subtle rounded-lg shadow-xl py-1">
            {QUESTION_TYPES.map((type) => (
              <label
                key={type}
                className="flex items-center gap-3 px-3 py-2 hover:bg-surface-variant cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={value.includes(type)}
                  onChange={() => toggle(type)}
                  className="accent-accent-teal"
                />
                <span className="text-[13px] text-on-surface">{TYPE_LABELS[type]}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
