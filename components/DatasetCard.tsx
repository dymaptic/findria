'use client';

import type { Dataset } from '@/types';
import { Badge } from './ui/Badge';

interface DatasetCardProps {
  dataset: Dataset;
  onClick: () => void;
  isSelected?: boolean;
}

export function DatasetCard({ dataset, onClick, isSelected = false }: DatasetCardProps) {
  const sourceBadge = dataset.source === 'living_atlas' ? 'coral' : dataset.source === 'geoparquet' ? 'teal' : 'gray';
  const sourceLabel = dataset.source === 'living_atlas'
    ? 'ArcGIS'
    : dataset.source === 'geoparquet'
      ? 'Overture'
      : dataset.orgDisplayName || 'ArcGIS';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      aria-pressed={isSelected}
      className={`p-4 border rounded-lg cursor-pointer transition-all ${
        isSelected
          ? 'border-teal bg-teal/10 ring-2 ring-teal'
          : 'border-gray-300 dark:border-slate-700 hover:border-teal hover:bg-gray-100 dark:hover:bg-slate-800/50 bg-white dark:bg-slate-800/30 shadow-sm'
      } focus:outline-none focus:ring-2 focus:ring-teal focus:ring-offset-2 dark:focus:ring-offset-dark-bg`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <h3 className="font-medium text-gray-900 dark:text-white line-clamp-2">
            {dataset.name}
          </h3>
          {dataset.isAuthoritative && (
            <span title="Authoritative" className="flex-shrink-0 text-teal dark:text-teal-light">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </span>
          )}
        </div>
        <Badge variant={sourceBadge} className="flex-shrink-0">
          {sourceLabel}
        </Badge>
      </div>

      {/* Snippet */}
      {dataset.snippet && (
        <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mb-3">
          {dataset.snippet}
        </p>
      )}

      {/* Tags */}
      {dataset.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {dataset.tags.slice(0, 5).map((tag, index) => (
            <Badge key={index} variant="gray">
              {tag}
            </Badge>
          ))}
          {dataset.tags.length > 5 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              +{dataset.tags.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
        <div className="flex items-center gap-2">
          {dataset.dataType && (
            <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
              <DataTypeIcon type={dataset.dataType} />
              {dataset.dataType}
            </span>
          )}
        </div>

        {dataset.coverageInArea !== undefined && dataset.coverageInArea > 0 && (
          <span className="text-teal dark:text-teal-light font-medium">
            {formatNumber(dataset.coverageInArea)} features in area
          </span>
        )}

        {dataset.relevanceScore !== undefined && (
          <span className="text-slate-400 dark:text-slate-500">
            {Math.round(dataset.relevanceScore * 100)}% match
          </span>
        )}
      </div>
    </div>
  );
}

function DataTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'point':
      return (
        <svg className="w-3 h-3" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case 'line':
      return (
        <svg className="w-3 h-3" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M4 20L20 4" />
        </svg>
      );
    case 'polygon':
      return (
        <svg className="w-3 h-3" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="12,2 22,20 2,20" />
        </svg>
      );
    case 'raster':
      return (
        <svg className="w-3 h-3" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
          <rect x="2" y="2" width="20" height="20" rx="2" />
        </svg>
      );
    default:
      return null;
  }
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}
