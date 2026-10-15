'use client';

import { useState } from 'react';
import type { ChatStep } from '@/types/chat';

interface ToolCallStepProps {
  step: ChatStep;
}

// Map tool names to friendly display names
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  search_datasets: 'Searching datasets',
  get_dataset: 'Getting dataset details',
  query_feature_service: 'Querying features',
  count_features: 'Counting features',
  geocode_location: 'Geocoding location',
  add_filtered_layer: 'Adding layer to map',
};

// Map tool names to icons
const TOOL_ICONS: Record<string, React.ReactNode> = {
  search_datasets: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  get_dataset: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  query_feature_service: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
    </svg>
  ),
  count_features: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
    </svg>
  ),
  geocode_location: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  add_filtered_layer: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  ),
};

export function ToolCallStep({ step }: ToolCallStepProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toolName = step.tool || 'unknown';
  const displayName = TOOL_DISPLAY_NAMES[toolName] || toolName;
  const icon = TOOL_ICONS[toolName] || (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );

  const hasResult = step.result !== undefined;
  const hasError = !!step.error;
  const isLoading = !hasResult && !hasError;

  // Get the search query for display (for search_datasets)
  const getSearchQuery = (): string | null => {
    if (toolName === 'search_datasets' && step.input?.query) {
      return step.input.query as string;
    }
    return null;
  };

  const searchQuery = getSearchQuery();

  // Format result summary
  const getResultSummary = (): string => {
    if (hasError) return `Error: ${step.error}`;
    if (!hasResult) return 'Running...';

    const result = step.result as Record<string, unknown>;

    switch (toolName) {
      case 'search_datasets':
        return `Found ${result.total || 0} datasets`;
      case 'get_dataset':
        return result.name ? `${result.name}` : 'Dataset loaded';
      case 'query_feature_service':
        return `${result.featureCount || 0} features (of ${result.totalCount || 0} total)`;
      case 'count_features':
        return `${result.count || 0} features`;
      case 'geocode_location':
        return result.bbox ? `Found ${result.location}` : 'Location not found';
      case 'add_filtered_layer':
        return result.message ? `${result.message}` : `${result.featureCount || 0} features`;
      default:
        return 'Complete';
    }
  };

  return (
    <div className="border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden bg-gray-100/80 dark:bg-dark-bg/50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-200/50 dark:hover:bg-dark-bg-light/50 transition-colors text-left"
      >
        {/* Status indicator */}
        <div className={`
          w-2 h-2 rounded-full
          ${isLoading ? 'bg-teal animate-pulse' : hasError ? 'bg-red-400' : 'bg-green-400'}
        `} />

        {/* Icon */}
        <span className="text-gray-500 dark:text-gray-400">{icon}</span>

        {/* Tool name and summary */}
        <div className="flex-1 min-w-0">
          <span className="text-sm text-gray-600 dark:text-gray-300">{displayName}</span>
          {searchQuery && (
            <span className="text-xs text-teal ml-2">
              &quot;{searchQuery}&quot;
            </span>
          )}
          <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
            {getResultSummary()}
          </span>
        </div>

        {/* Expand chevron */}
        <svg
          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 space-y-2">
          {/* Input */}
          {step.input && Object.keys(step.input).length > 0 && (
            <div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">Input:</div>
              <pre className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-dark-bg rounded p-2 overflow-x-auto">
                {JSON.stringify(step.input, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {hasResult && (
            <div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">Result:</div>
              <pre className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-dark-bg rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
                {JSON.stringify(step.result, null, 2)}
              </pre>
            </div>
          )}

          {/* Error */}
          {hasError && (
            <div>
              <div className="text-xs text-red-600 dark:text-red-400 mb-1">Error:</div>
              <pre className="text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950 rounded p-2 overflow-x-auto">
                {step.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
