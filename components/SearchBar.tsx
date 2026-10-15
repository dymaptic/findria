'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';

interface SearchBarProps {
  initialQuery?: string;
  onSearch: (query: string) => void;
  isSearching?: boolean;
}

export function SearchBar({
  initialQuery = '',
  onSearch,
  isSearching = false,
}: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync query state when initialQuery changes (e.g., from example buttons)
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  // Focus on "/" key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        setQuery('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
            <svg
              className="w-5 h-5 text-gray-400"
              aria-hidden="true"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for geospatial data... (e.g., 'building footprints in Portland')"
            className="w-full pl-12 pr-12 py-3 text-lg border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-dark-bg-light text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal focus:border-transparent"
            disabled={isSearching}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute inset-y-0 right-0 flex items-center pr-4 text-gray-400 hover:text-gray-600"
            >
              <svg
                className="w-5 h-5"
                aria-hidden="true"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
        <Button type="submit" disabled={isSearching || !query.trim()} size="lg">
          {isSearching ? (
            <>
              <Spinner size="sm" className="mr-2" />
              Searching...
            </>
          ) : (
            'Search'
          )}
        </Button>
      </div>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Press <kbd className="px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded">/</kbd> to focus,{' '}
        <kbd className="px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded">Esc</kbd> to clear
      </p>
    </form>
  );
}
