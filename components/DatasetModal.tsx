'use client';

import type { Dataset, PreviewResponse } from '@/types';
import { Modal } from './ui/Modal';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';
import { MapPanel } from './MapPanel';

interface DatasetModalProps {
  dataset: Dataset | null;
  previewData: PreviewResponse | null;
  isLoadingPreview: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export function DatasetModal({
  dataset,
  previewData,
  isLoadingPreview,
  isOpen,
  onClose,
}: DatasetModalProps) {
  if (!dataset) return null;

  const sourceBadge = dataset.source === 'living_atlas' ? 'coral' : dataset.source === 'geoparquet' ? 'teal' : 'gray';
  const sourceLabel = dataset.source === 'living_atlas'
    ? 'ArcGIS'
    : dataset.source === 'geoparquet'
      ? 'Overture Maps'
      : dataset.orgDisplayName || 'ArcGIS';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={dataset.name} size="xl">
      <div className="space-y-6">
        {/* Header info */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={sourceBadge}>{sourceLabel}</Badge>
          {dataset.dataType && <Badge variant="gray">{dataset.dataType}</Badge>}
          {dataset.accessType && dataset.accessType !== 'public' && (
            <Badge variant="gray">{dataset.accessType}</Badge>
          )}
        </div>

        {/* Description */}
        {dataset.description && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              Description
            </h3>
            <p className="text-gray-600 dark:text-slate-400 whitespace-pre-wrap">
              {dataset.description}
            </p>
          </div>
        )}

        {/* Map Preview */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
            Preview
          </h3>
          <div className="h-[300px] rounded-lg overflow-hidden">
            {isLoadingPreview ? (
              <div className="h-full flex items-center justify-center bg-gray-100 dark:bg-slate-800 rounded-lg">
                <Spinner size="lg" />
              </div>
            ) : (
              <MapPanel
                previewData={previewData}
                initialBbox={
                  dataset.extentBbox
                    ? [
                        dataset.extentBbox.xmin,
                        dataset.extentBbox.ymin,
                        dataset.extentBbox.xmax,
                        dataset.extentBbox.ymax,
                      ]
                    : undefined
                }
              />
            )}
          </div>
          {previewData && (
            <p className="mt-2 text-xs text-gray-500">
              Showing {previewData.features.length} features
              {previewData.truncated && ' (preview limited)'}
            </p>
          )}
        </div>

        {/* Tags */}
        {dataset.tags.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              Tags
            </h3>
            <div className="flex flex-wrap gap-1">
              {dataset.tags.map((tag, index) => (
                <Badge key={index} variant="gray">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          {dataset.arcgisOwner && (
            <div>
              <span className="text-gray-500 dark:text-slate-500">Owner:</span>{' '}
              <span className="text-gray-900 dark:text-white">{dataset.arcgisOwner}</span>
            </div>
          )}
          {dataset.arcgisType && (
            <div>
              <span className="text-gray-500 dark:text-slate-500">Service Type:</span>{' '}
              <span className="text-gray-900 dark:text-white">{dataset.arcgisType}</span>
            </div>
          )}
          <div>
            <span className="text-slate-500">Indexed:</span>{' '}
            <span className="text-white">
              {new Date(dataset.indexedAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Attribution */}
        {dataset.source === 'geoparquet' && previewData?.source && (
          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg text-sm">
            <p className="text-gray-600 dark:text-slate-400">
              Data from {previewData.source.attribution} under {previewData.source.license} license.
            </p>
          </div>
        )}

        {dataset.source === 'living_atlas' && (
          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg text-sm">
            <p className="text-gray-600 dark:text-slate-400">
              This dataset is provided by Esri via ArcGIS Online.
            </p>
          </div>
        )}

        {(dataset.source === 'custom_org' || dataset.source === 'user_submitted') && (
          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg text-sm">
            <p className="text-gray-600 dark:text-slate-400">
              This dataset is provided by {dataset.orgDisplayName || dataset.arcgisOwner || 'ArcGIS Online'}.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-slate-700">
          <Button
            variant="primary"
            onClick={() => window.open(dataset.sourceUrl, '_blank')}
          >
            View Source
          </Button>
          {dataset.serviceUrl && (
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(dataset.serviceUrl || '');
              }}
            >
              Copy Service URL
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
