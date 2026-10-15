'use client';

interface ModeToggleProps {
  mode: 'search' | 'ask';
  onModeChange: (mode: 'search' | 'ask') => void;
  compact?: boolean;
}

export function ModeToggle({ mode, onModeChange, compact = false }: ModeToggleProps) {
  return (
    <div role="group" aria-label="Search mode" className="inline-flex rounded-full bg-gray-100 dark:bg-slate-800 p-1 border border-gray-200 dark:border-slate-700">
      <button
        onClick={() => onModeChange('search')}
        className={`
          ${compact ? 'px-2.5' : 'px-4'} py-1.5 text-sm font-medium rounded-full transition-all duration-200
          ${mode === 'search'
            ? 'bg-teal text-white shadow-sm'
            : 'text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white'
          }
        `}
        aria-label="Search"
        aria-pressed={mode === 'search'}
        title="Search"
      >
        <span className="flex items-center gap-1.5">
          <svg className="w-4 h-4" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {!compact && 'Search'}
        </span>
      </button>
      <button
        onClick={() => onModeChange('ask')}
        className={`
          ${compact ? 'px-2.5' : 'px-4'} py-1.5 text-sm font-medium rounded-full transition-all duration-200
          ${mode === 'ask'
            ? 'bg-teal text-white shadow-sm'
            : 'text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white'
          }
        `}
        aria-label="Ask AI"
        aria-pressed={mode === 'ask'}
        title="Ask AI"
      >
        <span className="flex items-center gap-1.5">
          <svg className="w-4 h-4" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {!compact && 'Ask AI'}
        </span>
      </button>
    </div>
  );
}
