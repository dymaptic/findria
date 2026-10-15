'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useTheme } from 'next-themes';
import DOMPurify from 'dompurify';
import type { Dataset, PreviewResponse } from '@/types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    require: (modules: string[], callback: (...args: any[]) => void) => void;
  }
}

interface DatasetDetailProps {
  dataset: Dataset;
  previewData: PreviewResponse | null;
  isLoadingPreview: boolean;
  onClose: () => void;
  searchBbox?: [number, number, number, number]; // User's search location bbox
}

// Sanitize HTML to prevent XSS using DOMPurify
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span', 'div'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });
}

// Escape HTML for popup titles built from untrusted feature attributes
function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Check if string contains HTML tags
function containsHtml(str: string): boolean {
  return /<[^>]+>/.test(str);
}

// Validate that an extent bbox has all valid numeric values
function isValidExtent(ext: { xmin: number; ymin: number; xmax: number; ymax: number } | undefined | null): ext is { xmin: number; ymin: number; xmax: number; ymax: number } {
  if (!ext) return false;
  return (
    typeof ext.xmin === 'number' && !isNaN(ext.xmin) &&
    typeof ext.ymin === 'number' && !isNaN(ext.ymin) &&
    typeof ext.xmax === 'number' && !isNaN(ext.xmax) &&
    typeof ext.ymax === 'number' && !isNaN(ext.ymax) &&
    ext.xmin !== ext.xmax && ext.ymin !== ext.ymax // Ensure non-zero extent
  );
}

export function DatasetDetail({
  dataset,
  previewData,
  isLoadingPreview,
  onClose,
  searchBbox,
}: DatasetDetailProps) {
  const { resolvedTheme } = useTheme();
  const panelRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapViewRef = useRef<{
    view: unknown;
    previewLayer: unknown;
    Graphic?: unknown;
    Polygon?: unknown;
    Point?: unknown;
    Polyline?: unknown;
  } | null>(null);

  const sourceBadge = dataset.source === 'living_atlas' ? 'coral' : dataset.source === 'geoparquet' ? 'teal' : 'gray';
  const sourceLabel = dataset.source === 'living_atlas'
    ? 'ArcGIS'
    : dataset.source === 'geoparquet'
      ? 'Overture Maps'
      : dataset.orgDisplayName || 'ArcGIS';

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Track if map has been initialized (to prevent double-init from React Strict Mode)
  const mapInitializedRef = useRef(false);

  // Initialize map
  useEffect(() => {
    // Skip if already initialized or no container
    if (mapInitializedRef.current || !mapContainerRef.current || typeof window === 'undefined') return;

    let destroyed = false;
    let retryCount = 0;
    let retryTimeout: ReturnType<typeof setTimeout>;
    const maxRetries = 20;

    const initMap = () => {
      if (destroyed || !mapContainerRef.current || mapInitializedRef.current) return;

      if (!window.require) {
        retryCount++;
        if (retryCount < maxRetries) {
          retryTimeout = setTimeout(initMap, 500);
        }
        return;
      }

      // Mark as initialized immediately to prevent double-init
      mapInitializedRef.current = true;

      window.require(
        [
          'esri/Map',
          'esri/views/MapView',
          'esri/layers/GraphicsLayer',
          'esri/Graphic',
          'esri/geometry/Polygon',
          'esri/geometry/Point',
          'esri/geometry/Polyline',
          'esri/config',
        ],
        (
          Map: new (opts: unknown) => unknown,
          MapView: new (opts: unknown) => { destroy: () => void; goTo: (target: unknown) => void },
          GraphicsLayer: new (opts: unknown) => unknown,
          Graphic: new (opts: unknown) => unknown,
          Polygon: new (opts: unknown) => unknown,
          Point: new (opts: unknown) => unknown,
          Polyline: new (opts: unknown) => unknown,
          esriConfig: { apiKey: string }
        ) => {
          if (destroyed || !mapContainerRef.current) {
            mapInitializedRef.current = false;
            return;
          }

          esriConfig.apiKey = process.env.NEXT_PUBLIC_ARCGIS_API_KEY || '';

          // Priority for map extent:
          // 1) searchBbox (user's search location, e.g., "Portland")
          // 2) dataset.extentBbox (the dataset's coverage area)
          // 3) Continental US fallback
          const hasSearchBbox = searchBbox && searchBbox.length === 4;
          const hasValidDatasetExtent = isValidExtent(dataset.extentBbox);

          const map = new Map({ basemap: resolvedTheme === 'light' ? 'gray-vector' : 'dark-gray-vector' });

          // Build view options
          const viewOptions: Record<string, unknown> = {
            container: mapContainerRef.current,
            map: map,
          };

          if (hasSearchBbox) {
            // Use search location (e.g., Portland bbox from "buildings in portland")
            const [xmin, ymin, xmax, ymax] = searchBbox;
            viewOptions.center = [(xmin + xmax) / 2, (ymin + ymax) / 2];
            viewOptions.extent = {
              xmin, ymin, xmax, ymax,
              spatialReference: { wkid: 4326 },
            };
          } else if (hasValidDatasetExtent) {
            // Fall back to dataset extent
            const bbox = dataset.extentBbox!;
            viewOptions.center = [(bbox.xmin + bbox.xmax) / 2, (bbox.ymin + bbox.ymax) / 2];
            viewOptions.extent = {
              xmin: bbox.xmin,
              ymin: bbox.ymin,
              xmax: bbox.xmax,
              ymax: bbox.ymax,
              spatialReference: { wkid: 4326 },
            };
          } else {
            // Continental US fallback
            viewOptions.center = [-98.5, 39.8];
            viewOptions.zoom = 4;
          }

          const view = new MapView(viewOptions);

          // Configure popup for better UX
          (view as unknown as { popup: { dockEnabled: boolean; dockOptions: { position: string; breakpoint: boolean } } }).popup.dockEnabled = true;
          (view as unknown as { popup: { dockOptions: { position: string; breakpoint: boolean } } }).popup.dockOptions = {
            position: 'bottom-right',
            breakpoint: false,
          };

          const previewLayer = new GraphicsLayer({ id: 'preview' });
          (map as { add: (layer: unknown) => void }).add(previewLayer);

          mapViewRef.current = {
            view,
            previewLayer,
            Graphic,
            Polygon,
            Point,
            Polyline,
          };
        }
      );
    };

    initMap();

    return () => {
      destroyed = true;
      clearTimeout(retryTimeout);
      if (mapViewRef.current?.view) {
        try {
          (mapViewRef.current.view as { destroy: () => void }).destroy();
          mapViewRef.current = null;
        } catch {
          // Ignore cleanup errors
        }
      }
      // Reset the initialized flag on cleanup
      mapInitializedRef.current = false;
    };
  }, []); // Empty dependency - only init once per component mount

  // Update preview data on map
  const updatePreview = useCallback(() => {
    if (!mapViewRef.current || !previewData) return;

    const { previewLayer, Graphic, Polygon, Point, Polyline } = mapViewRef.current;

    if (!Graphic || !Polygon || !Point || !Polyline) return;

    const mapRef = {
      previewLayer: previewLayer as { removeAll: () => void; add: (g: unknown) => void },
      Graphic: Graphic as new (opts: unknown) => unknown,
      Polygon: Polygon as new (opts: unknown) => unknown,
      Point: Point as new (opts: unknown) => unknown,
      Polyline: Polyline as new (opts: unknown) => unknown,
    };

    mapRef.previewLayer.removeAll();

    const symbols = {
      point: {
        type: 'simple-marker',
        color: [29, 128, 159, 0.8],
        outline: { color: [22, 102, 128], width: 2 },
        size: 8,
      },
      line: {
        type: 'simple-line',
        color: [29, 128, 159],
        width: 3,
      },
      polygon: {
        type: 'simple-fill',
        color: [29, 128, 159, 0.3],
        outline: { color: [22, 102, 128], width: 2 },
      },
    };

    for (const feature of previewData.features) {
      // Skip features with null or missing geometry
      if (!feature.geometry || !feature.geometry.type) {
        continue;
      }
      const geomType = feature.geometry.type.toLowerCase();
      let geometry: unknown;
      let symbol: unknown;

      if (geomType.includes('polygon') || geomType.includes('multipolygon')) {
        const coords = feature.geometry.coordinates;
        const rings = geomType === 'multipolygon'
          ? (coords as number[][][][]).flat()
          : coords;
        geometry = new mapRef.Polygon({
          rings,
          spatialReference: { wkid: 4326 },
        });
        symbol = symbols.polygon;
      } else if (geomType.includes('line')) {
        const coords = feature.geometry.coordinates;
        const paths = geomType.includes('multi') ? coords : [coords];
        geometry = new mapRef.Polyline({
          paths,
          spatialReference: { wkid: 4326 },
        });
        symbol = symbols.line;
      } else if (geomType.includes('point')) {
        const coords = feature.geometry.coordinates as number[];
        geometry = new mapRef.Point({
          longitude: coords[0],
          latitude: coords[1],
        });
        symbol = symbols.point;
      } else {
        continue;
      }

      // Build popup content showing all fields
      const props = feature.properties || {};
      const fieldNames = Object.keys(props);
      const popupTemplate = {
        title: escapeHtml(props.name || props.Name || props.NAME || props.title || props.Title || 'Feature'),
        content: fieldNames.length > 0
          ? [{
              type: 'fields',
              fieldInfos: fieldNames.map(name => ({
                fieldName: name,
                label: name,
              })),
            }]
          : 'No attributes available',
      };

      mapRef.previewLayer.add(
        new mapRef.Graphic({
          geometry,
          symbol,
          attributes: feature.properties,
          popupTemplate,
        })
      );
    }
  }, [previewData]);

  // Update preview when data changes
  useEffect(() => {
    updatePreview();
  }, [updatePreview]);

  // Handle click outside to close
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Render description - handle HTML content
  const renderDescription = () => {
    const description = dataset.description;
    if (!description) return null;

    if (containsHtml(description)) {
      return (
        <div
          className="text-slate-600 dark:text-slate-300 prose dark:prose-invert prose-sm max-w-none prose-p:my-2 prose-a:text-teal dark:prose-a:text-teal-light"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(description) }}
        />
      );
    }

    return (
      <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{description}</p>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div
        ref={panelRef}
        className="relative w-full max-w-4xl max-h-[95vh] md:max-h-[90vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl overflow-hidden flex flex-col mx-2 md:mx-4"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 md:p-6 border-b border-gray-200 dark:border-slate-700">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={sourceBadge}>{sourceLabel}</Badge>
              {dataset.isAuthoritative && (
                <span title="Authoritative" className="text-teal dark:text-teal-light">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </span>
              )}
              {dataset.dataType && <Badge variant="gray">{dataset.dataType}</Badge>}
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{dataset.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 space-y-4 md:space-y-6">
            {/* Description */}
            {dataset.description && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">
                  Description
                </h3>
                {renderDescription()}
              </div>
            )}

            {/* Map Preview */}
            <div>
              <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">
                Data Preview
              </h3>
              <div className="h-[250px] md:h-[350px] rounded-lg overflow-hidden bg-gray-100 dark:bg-slate-800 relative">
                <div ref={mapContainerRef} className="w-full h-full" />

                {/* Loading overlay */}
                {isLoadingPreview && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-100/80 dark:bg-slate-800/80">
                    <div className="text-center">
                      <Spinner size="lg" />
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Loading preview...</p>
                    </div>
                  </div>
                )}
              </div>

              {previewData && (
                <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">
                  Showing {previewData.features.length} sample features
                  {previewData.truncated && ' (preview limited)'}
                </p>
              )}

              {!isLoadingPreview && !previewData && (
                <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">
                  No preview available for this dataset
                </p>
              )}
            </div>

            {/* Tags */}
            {dataset.tags.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">
                  Tags
                </h3>
                <div className="flex flex-wrap gap-2">
                  {dataset.tags.map((tag, index) => (
                    <Badge key={index} variant="gray">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div>
              <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">
                Details
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 text-sm">
                {dataset.arcgisOwner && (
                  <div>
                    <span className="text-slate-400 dark:text-slate-500">Owner</span>
                    <p className="text-gray-900 dark:text-white">{dataset.arcgisOwner}</p>
                  </div>
                )}
                {dataset.arcgisType && (
                  <div>
                    <span className="text-slate-400 dark:text-slate-500">Service Type</span>
                    <p className="text-gray-900 dark:text-white">{dataset.arcgisType}</p>
                  </div>
                )}
                {dataset.accessType && (
                  <div>
                    <span className="text-slate-400 dark:text-slate-500">Access</span>
                    <p className="text-gray-900 dark:text-white capitalize">{dataset.accessType}</p>
                  </div>
                )}
                <div>
                  <span className="text-slate-400 dark:text-slate-500">Last Indexed</span>
                  <p className="text-gray-900 dark:text-white">
                    {new Date(dataset.indexedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>

            {/* Schema / Fields */}
            {dataset.schema && dataset.schema.layers && dataset.schema.layers.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">
                  Fields
                </h3>
                {dataset.schema.layers.map((layer, layerIndex) => (
                  <div key={layerIndex} className="mb-4">
                    {dataset.schema!.layers.length > 1 && (
                      <p className="text-sm text-slate-600 dark:text-slate-300 mb-2 font-medium">
                        {layer.layerName}
                        {layer.geometryType && (
                          <span className="text-slate-400 dark:text-slate-500 ml-2">({layer.geometryType})</span>
                        )}
                      </p>
                    )}
                    <div className="bg-gray-100 dark:bg-slate-800 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-slate-700">
                            <th className="text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-medium">Field</th>
                            <th className="text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-medium">Type</th>
                            <th className="text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-medium hidden sm:table-cell">Alias</th>
                          </tr>
                        </thead>
                        <tbody>
                          {layer.fields.slice(0, 20).map((field, fieldIndex) => (
                            <tr key={fieldIndex} className="border-b border-gray-200/50 dark:border-slate-700/50 last:border-0">
                              <td className="px-3 py-1.5 text-gray-900 dark:text-white font-mono text-xs">{field.name}</td>
                              <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{field.type}</td>
                              <td className="px-3 py-1.5 text-slate-400 dark:text-slate-500 hidden sm:table-cell">
                                {field.alias !== field.name ? field.alias : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {layer.fields.length > 20 && (
                        <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 border-t border-gray-200 dark:border-slate-700">
                          + {layer.fields.length - 20} more fields
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Attribution */}
            {dataset.source === 'geoparquet' && previewData?.source && (
              <div className="p-4 bg-gray-100 dark:bg-slate-800 rounded-lg">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Data from <span className="text-gray-900 dark:text-white">{previewData.source.attribution}</span> under{' '}
                  <span className="text-gray-900 dark:text-white">{previewData.source.license}</span> license.
                </p>
              </div>
            )}

            {dataset.source === 'living_atlas' && (
              <div className="p-4 bg-gray-100 dark:bg-slate-800 rounded-lg">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  This dataset is provided by <span className="text-gray-900 dark:text-white">Esri via ArcGIS Online</span>.
                </p>
              </div>
            )}

            {(dataset.source === 'custom_org' || dataset.source === 'user_submitted') && (
              <div className="p-4 bg-gray-100 dark:bg-slate-800 rounded-lg">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  This dataset is provided by <span className="text-gray-900 dark:text-white">{dataset.orgDisplayName || dataset.arcgisOwner || 'ArcGIS Online'}</span>.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-4 md:p-6 border-t border-gray-200 dark:border-slate-700 bg-gray-100/50 dark:bg-slate-800/50">
          <div className="flex flex-col md:flex-row gap-2 md:gap-3">
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
          </div>
          <Button variant="ghost" onClick={onClose} className="md:w-auto">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
