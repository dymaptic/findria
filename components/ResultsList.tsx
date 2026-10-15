'use client';

import type { Dataset } from '@/types';
import { DatasetCard } from './DatasetCard';
import { Spinner } from './ui/Spinner';

interface ResultsListProps {
  datasets: Dataset[];
  selectedDataset: Dataset | null;
  onSelectDataset: (dataset: Dataset) => void;
  isLoading?: boolean;
  error?: string | null;
  total?: number;
}

export function ResultsList({
  datasets,
  selectedDataset,
  onSelectDataset,
  isLoading = false,
  error = null,
  total = 0,
}: ResultsListProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Spinner size="lg" />
        <p className="mt-4 text-gray-500 dark:text-slate-400">
          Searching for datasets...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
          <svg
            className="w-6 h-6 text-red-600 dark:text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          Search failed
        </h3>
        <p className="text-gray-500 dark:text-slate-400">{error}</p>
      </div>
    );
  }

  if (datasets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-4">
          <svg
            className="w-6 h-6 text-gray-400 dark:text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          No results found
        </h3>
        <p className="text-gray-500 dark:text-slate-400 max-w-sm">
          Try using broader search terms or removing location filters. You can also try searching for different data types.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Results header */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-slate-700">
        <h2 className="text-sm font-medium text-gray-900 dark:text-white">
          {total > 0 ? `${total} results` : `${datasets.length} results`}
        </h2>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto py-3 space-y-3">
        {datasets.map((dataset) => (
          <DatasetCard
            key={dataset.id}
            dataset={dataset}
            isSelected={selectedDataset?.id === dataset.id}
            onClick={() => onSelectDataset(dataset)}
          />
        ))}
      </div>
    </div>
  );
}
