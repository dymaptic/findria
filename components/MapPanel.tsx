'use client';

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { useTheme } from 'next-themes';
import type { PreviewResponse, GeoJSONFeature } from '@/types';
import type { LayerStyle, GeoJSONFeatureCollection } from '@/types/chat';

// Escape HTML to prevent XSS in popup templates built from untrusted data
function escapeHtml(str: unknown): string {
  const s = String(str ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Helper to convert hex color to RGBA array
function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16),
      alpha,
    ];
  }
  // Default to coral if invalid
  return [226, 78, 66, alpha];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Declare global types for CDN-loaded ArcGIS
declare global {
  interface Window {
    require: (modules: string[], callback: (...args: any[]) => void) => void;
  }
}

interface MapPanelProps {
  onExtentChange?: (bbox: [number, number, number, number]) => void;
  onScaleChange?: (scale: number) => void;
  onMapReady?: () => void;
  previewData?: PreviewResponse | null;
  initialBbox?: [number, number, number, number];
}

export interface MapPanelRef {
  addLayer: (features: GeoJSONFeature[], style?: LayerStyle, label?: string) => void;
  addFeatureLayer: (serviceUrl: string, definitionExpression?: string, label?: string, style?: LayerStyle, bbox?: [number, number, number, number]) => void;
  addGeoJSON: (geojson: GeoJSONFeatureCollection, style?: LayerStyle, label?: string) => void;
  addMarker: (coordinates: [number, number], label?: string, color?: string) => void;
  clearLayers: () => void;
  zoomToExtent: (bbox: [number, number, number, number], maxScale?: number) => void;
}

export const MapPanel = forwardRef<MapPanelRef, MapPanelProps>(function MapPanel({
  onExtentChange,
  onScaleChange,
  onMapReady,
  previewData,
  initialBbox,
}, ref) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const viewRef = useRef<{
    view: unknown;
    map: unknown;
    previewLayer: unknown;
    chatLayer: unknown;
    chatFeatureLayers: unknown[];
    addedGeoJSONLabels: Set<string>; // Track added GeoJSON to prevent duplicates
    GraphicsLayer: unknown;
    Graphic: unknown;
    Polygon: unknown;
    Point: unknown;
    Polyline: unknown;
    Extent: unknown;
    FeatureLayer: unknown;
    MapImageLayer: unknown;
  } | null>(null);

  // Queue for pending actions that arrive before map is ready
  const pendingActionsRef = useRef<Array<() => void>>([]);

  // Expose imperative methods for chat integration
  useImperativeHandle(ref, () => ({
    addLayer: (features: GeoJSONFeature[], style?: LayerStyle, _label?: string) => {
      const executeAddLayer = () => {
        if (!viewRef.current) return;

        const { chatLayer, Graphic, Polygon, Point, Polyline } = viewRef.current as {
          chatLayer: { removeAll: () => void; add: (g: unknown) => void };
          Graphic: new (opts: unknown) => unknown;
          Polygon: new (opts: unknown) => unknown;
          Point: new (opts: unknown) => unknown;
          Polyline: new (opts: unknown) => unknown;
        };

        // Clear previous chat features
        chatLayer.removeAll();

        // Parse style or use defaults (coral for chat features to distinguish from preview)
        const color = style?.color
          ? hexToRgba(style.color, style?.fillOpacity ?? 0.5)
          : [226, 78, 66, 0.5]; // Coral with 0.5 opacity
        const strokeColor = style?.color
          ? hexToRgba(style.color, 1)
          : [226, 78, 66, 1];
        const strokeWidth = style?.strokeWidth ?? 2;

        const symbols = {
          point: {
            type: 'simple-marker',
            color,
            outline: { color: strokeColor, width: strokeWidth },
            size: 10,
          },
          line: {
            type: 'simple-line',
            color: strokeColor,
            width: strokeWidth + 1,
          },
          polygon: {
            type: 'simple-fill',
            color,
            outline: { color: strokeColor, width: strokeWidth },
          },
        };

        for (const feature of features) {
          const geomType = feature.geometry.type.toLowerCase();
          let geometry: unknown;
          let symbol: unknown;

          if (geomType.includes('polygon') || geomType.includes('multipolygon')) {
            const coords = feature.geometry.coordinates;
            const rings = geomType === 'multipolygon'
              ? (coords as number[][][][]).flat()
              : coords;
            geometry = new Polygon({
              rings,
              spatialReference: { wkid: 4326 },
            });
            symbol = symbols.polygon;
          } else if (geomType.includes('line')) {
            const coords = feature.geometry.coordinates;
            const paths = geomType.includes('multi') ? coords : [coords];
            geometry = new Polyline({
              paths,
              spatialReference: { wkid: 4326 },
            });
            symbol = symbols.line;
          } else if (geomType.includes('point')) {
            const coords = feature.geometry.coordinates as number[];
            geometry = new Point({
              longitude: coords[0],
              latitude: coords[1],
            });
            symbol = symbols.point;
          } else {
            continue;
          }

          const props = feature.properties || {};
          const fieldNames = Object.keys(props);
          chatLayer.add(
            new Graphic({
              geometry,
              symbol,
              attributes: feature.properties,
              popupTemplate: {
                title: escapeHtml(feature.properties?.name || feature.properties?.Name || feature.properties?.NAME || feature.properties?.title || _label || 'Feature'),
                content: fieldNames.length > 0
                  ? [{
                      type: 'fields',
                      fieldInfos: fieldNames.map(name => ({
                        fieldName: name,
                        label: name,
                      })),
                    }]
                  : 'No attributes available',
              },
            })
          );
        }
      };

      // If map not ready, queue the action
      if (!viewRef.current) {
        pendingActionsRef.current.push(executeAddLayer);
        return;
      }
      executeAddLayer();
      // Does NOT auto-zoom - caller must use zoomToExtent if zoom is needed
    },

    addFeatureLayer: (serviceUrl: string, definitionExpression?: string, label?: string, style?: LayerStyle, bbox?: [number, number, number, number]) => {
      const executeAddFeatureLayer = () => {
        if (!viewRef.current) return;

        const { map, view, FeatureLayer, MapImageLayer, Extent, chatFeatureLayers } = viewRef.current as {
          map: { add: (layer: unknown) => void };
          view: { whenLayerView: (layer: unknown) => Promise<{ filter: unknown }> };
          FeatureLayer: new (opts: unknown) => { title: string; url?: string; when: () => Promise<unknown>; queryExtent: () => Promise<{ extent: unknown }>; fields: Array<{ name: string; alias: string }>; popupTemplate: unknown };
          MapImageLayer: new (opts: unknown) => { title: string; url?: string; when: () => Promise<unknown> };
          Extent: new (opts: unknown) => unknown;
          chatFeatureLayers: Array<{ url?: string; title?: string }>;
        };

        // Check for duplicate - same URL already added
        const isDuplicate = chatFeatureLayers.some(
          (layer) => layer.url === serviceUrl || layer.title === label
        );
        if (isDuplicate) {
          return;
        }

        // Parse style or use defaults
        const color = style?.color || '#E24E42';
        const fillOpacity = style?.fillOpacity ?? 0.4;
        const strokeWidth = style?.strokeWidth ?? 2;

        // Detect if this is a MapServer or FeatureServer URL
        const isMapServer = serviceUrl.includes('/MapServer');
        const isFeatureServer = serviceUrl.includes('/FeatureServer');

        if (isMapServer && !isFeatureServer) {
          // MapServer URL - use MapImageLayer
          // Extract sublayer ID if present (e.g., /MapServer/12 -> sublayerId = 12)
          const sublayerMatch = serviceUrl.match(/\/MapServer\/(\d+)$/);
          const sublayerId = sublayerMatch ? parseInt(sublayerMatch[1], 10) : null;

          // Get the base MapServer URL (without sublayer ID)
          const baseUrl = sublayerId !== null
            ? serviceUrl.replace(/\/\d+$/, '')
            : serviceUrl;

          // Create MapImageLayer configuration
          const layerConfig: Record<string, unknown> = {
            url: baseUrl,
            title: label || 'Map Layer',
            popupEnabled: true,
          };

          // Build a popup template for MapImageLayer sublayers
          const mapServerPopupTemplate = {
            title: escapeHtml(label || 'Feature'),
            outFields: ['*'],
            content: (event: { graphic: { attributes: Record<string, unknown> } }) => {
              const attrs = event.graphic?.attributes;
              if (!attrs || Object.keys(attrs).length === 0) return 'No attributes available';
              let html = '<table class="esri-widget__table">';
              for (const [key, val] of Object.entries(attrs)) {
                if (key !== 'Shape' && key !== 'Shape_Area' && key !== 'Shape_Length'
                    && key !== 'Shape__Area' && key !== 'Shape__Length') {
                  html += `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(val)}</td></tr>`;
                }
              }
              html += '</table>';
              return html;
            },
          };

          if (sublayerId !== null) {
            // Specific sublayer requested
            const sublayerConfig: Record<string, unknown> = {
              id: sublayerId,
              visible: true,
              popupEnabled: true,
              popupTemplate: mapServerPopupTemplate,
            };

            // Only add definitionExpression if provided
            if (definitionExpression) {
              sublayerConfig.definitionExpression = definitionExpression;
            }

            layerConfig.sublayers = [sublayerConfig];
          } else {
            // No specific sublayer - enable popups on all sublayers after load
            layerConfig.popupEnabled = true;
          }

          const mapImageLayer = new MapImageLayer(layerConfig) as unknown as {
            title: string;
            when: () => Promise<unknown>;
            load: () => Promise<unknown>;
            loadError?: Error;
          };

          // Wait for layer to load, then apply popup templates to sublayers if needed
          mapImageLayer.when().then(() => {
            // If no specific sublayer was configured, enable popups on all sublayers
            if (sublayerId === null && (mapImageLayer as unknown as { allSublayers?: { forEach: (fn: (sl: Record<string, unknown>) => void) => void } }).allSublayers) {
              (mapImageLayer as unknown as { allSublayers: { forEach: (fn: (sl: Record<string, unknown>) => void) => void } }).allSublayers.forEach((sl: Record<string, unknown>) => {
                sl.popupEnabled = true;
                sl.popupTemplate = mapServerPopupTemplate;
              });
            }
          }).catch(() => {
            // MapImageLayer failed to load — skip
          });

          map.add(mapImageLayer as unknown as object);
          chatFeatureLayers.push(mapImageLayer);
        } else {
          // FeatureServer URL - use FeatureLayer with publisher's default renderer
          const featureLayer = new FeatureLayer({
            url: serviceUrl,
            definitionExpression: definitionExpression || '1=1',
            title: label || 'Layer',
            outFields: ['*'],
            popupEnabled: true,
            // Don't override renderer - use the publisher's configured symbology
          });

          // After the layer loads, build a popupTemplate from its actual fields
          featureLayer.when().then(() => {
            const fieldInfos = featureLayer.fields
              .filter((f: { name: string }) => !['Shape', 'Shape__Area', 'Shape__Length', 'GlobalID'].includes(f.name))
              .map((f: { name: string; alias: string }) => ({
                fieldName: f.name,
                label: f.alias || f.name,
              }));
            featureLayer.popupTemplate = {
              title: escapeHtml(label || '{OBJECTID}'),
              content: [{
                type: 'fields',
                fieldInfos,
              }],
            } as unknown;
          });

          // Add to map (don't auto-zoom - let AI control zoom explicitly)
          map.add(featureLayer);
          chatFeatureLayers.push(featureLayer);

          // Apply spatial filter if bbox provided (restricts displayed features to the area of interest)
          if (bbox) {
            view.whenLayerView(featureLayer).then((layerView) => {
              layerView.filter = {
                geometry: new Extent({
                  xmin: bbox[0],
                  ymin: bbox[1],
                  xmax: bbox[2],
                  ymax: bbox[3],
                  spatialReference: { wkid: 4326 },
                }),
                spatialRelationship: 'intersects',
              };
            }).catch((err: Error) => {
              console.warn('[MapPanel] Failed to apply spatial filter:', err);
            });
          }
        }
      };

      // If map not ready, queue the action
      if (!viewRef.current) {
        pendingActionsRef.current.push(executeAddFeatureLayer);
        return;
      }
      executeAddFeatureLayer();
    },

    addGeoJSON: (geojson: GeoJSONFeatureCollection, style?: LayerStyle, label?: string) => {
      const executeAddGeoJSON = () => {
        if (!viewRef.current) return;

        const { map, addedGeoJSONLabels, chatFeatureLayers, FeatureLayer, Graphic, Polygon, Point, Polyline } = viewRef.current as {
          map: { add: (layer: unknown) => void };
          addedGeoJSONLabels: Set<string>;
          chatFeatureLayers: unknown[];
          FeatureLayer: new (opts: unknown) => unknown;
          Graphic: new (opts: unknown) => unknown;
          Polygon: new (opts: unknown) => unknown;
          Point: new (opts: unknown) => unknown;
          Polyline: new (opts: unknown) => unknown;
        };

        // Create a unique key for this GeoJSON layer
        const layerKey = label || geojson.source?.id || `geojson-${geojson.features.length}`;

        // Check for duplicate - skip if already added
        if (addedGeoJSONLabels.has(layerKey)) {
          return;
        }
        addedGeoJSONLabels.add(layerKey);

        // Parse style or use defaults (teal for Overture data)
        const color = style?.color
          ? hexToRgba(style.color, style?.fillOpacity ?? 0.4)
          : [29, 128, 159, 0.4]; // Teal with 0.4 opacity
        const strokeColor = style?.color
          ? hexToRgba(style.color, 1)
          : [29, 128, 159, 1];
        const strokeWidth = style?.strokeWidth ?? 2;

        // Single-pass: determine geometry type, collect field names, and build graphics
        let esriGeomType: 'point' | 'polyline' | 'polygon' | null = null;
        const fieldNameSet = new Set<string>();
        const graphics: unknown[] = [];
        let oid = 1;

        for (const feature of geojson.features) {
          const geomType = feature.geometry.type.toLowerCase();

          // Determine esriGeomType from first valid feature
          if (!esriGeomType) {
            if (geomType.includes('polygon')) esriGeomType = 'polygon';
            else if (geomType.includes('line')) esriGeomType = 'polyline';
            else if (geomType.includes('point')) esriGeomType = 'point';
          }

          // Collect property keys
          if (feature.properties) {
            for (const key of Object.keys(feature.properties)) {
              fieldNameSet.add(key);
            }
          }

          // Build geometry
          let geometry: unknown;
          if ((geomType.includes('polygon') || geomType.includes('multipolygon')) && esriGeomType === 'polygon') {
            const coords = feature.geometry.coordinates;
            const rings = geomType === 'multipolygon'
              ? (coords as number[][][][]).flat()
              : coords;
            geometry = new Polygon({ rings, spatialReference: { wkid: 4326 } });
          } else if (geomType.includes('line') && esriGeomType === 'polyline') {
            const coords = feature.geometry.coordinates;
            const paths = geomType.includes('multi') ? coords : [coords];
            geometry = new Polyline({ paths, spatialReference: { wkid: 4326 } });
          } else if (geomType.includes('point') && esriGeomType === 'point') {
            const coords = feature.geometry.coordinates as number[];
            geometry = new Point({ longitude: coords[0], latitude: coords[1] });
          } else {
            continue;
          }

          // Convert property values to strings for FeatureLayer field compatibility
          const attrs: Record<string, unknown> = { ObjectID: oid++ };
          const props = feature.properties || {};
          for (const key of fieldNameSet) {
            const val = props[key];
            attrs[key] = val != null ? String(val) : '';
          }
          graphics.push(new Graphic({ geometry, attributes: attrs }));
        }
        if (!esriGeomType) return;

        const fieldNames = Array.from(fieldNameSet);

        // Build ArcGIS field definitions (ObjectID + all properties as strings)
        const fields = [
          { name: 'ObjectID', alias: 'ObjectID', type: 'oid' },
          ...fieldNames.map(name => ({ name, alias: name, type: 'string' })),
        ];

        if (graphics.length === 0) return;

        // Build renderer symbol based on geometry type
        let symbol: unknown;
        if (esriGeomType === 'point') {
          symbol = { type: 'simple-marker', color, outline: { color: strokeColor, width: strokeWidth }, size: 10 };
        } else if (esriGeomType === 'polyline') {
          symbol = { type: 'simple-line', color: strokeColor, width: strokeWidth + 1 };
        } else {
          symbol = { type: 'simple-fill', color, outline: { color: strokeColor, width: strokeWidth } };
        }

        // Popup configuration
        const popupFieldInfos = fieldNames.map(name => ({ fieldName: name, label: name }));
        const hasName = fieldNameSet.has('name');

        // Create a client-side FeatureLayer — these reliably appear in LayerList
        const featureLayer = new FeatureLayer({
          source: graphics,
          fields,
          objectIdField: 'ObjectID',
          geometryType: esriGeomType,
          spatialReference: { wkid: 4326 },
          title: label || 'GeoJSON Layer',
          renderer: { type: 'simple', symbol },
          popupTemplate: {
            title: hasName ? '{name}' : escapeHtml(label || 'Feature'),
            content: popupFieldInfos.length > 0
              ? [{ type: 'fields', fieldInfos: popupFieldInfos }]
              : 'No attributes available',
          },
        });

        map.add(featureLayer);
        chatFeatureLayers.push(featureLayer);
      };

      // If map not ready, queue the action
      if (!viewRef.current) {
        pendingActionsRef.current.push(executeAddGeoJSON);
        return;
      }
      executeAddGeoJSON();
    },

    addMarker: (coordinates: [number, number], label?: string, color?: string) => {
      const executeAddMarker = () => {
        if (!viewRef.current) return;

        const { chatLayer, Graphic, Point } = viewRef.current as {
          chatLayer: { add: (g: unknown) => void };
          Graphic: new (opts: unknown) => unknown;
          Point: new (opts: unknown) => unknown;
        };

        const markerColor = color ? hexToRgba(color, 1) : [226, 78, 66, 1]; // Default to coral

        const point = new Point({
          longitude: coordinates[0],
          latitude: coordinates[1],
        });

        const markerSymbol = {
          type: 'simple-marker',
          color: markerColor,
          outline: {
            color: resolvedTheme === 'light' ? [60, 60, 60] : [255, 255, 255],
            width: 2,
          },
          size: 14,
        };

        const graphic = new Graphic({
          geometry: point,
          symbol: markerSymbol,
          attributes: { label },
          popupTemplate: label ? {
            title: escapeHtml(label),
            content: `Location: ${coordinates[1].toFixed(4)}, ${coordinates[0].toFixed(4)}`,
          } : undefined,
        });

        chatLayer.add(graphic);
      };

      // If map not ready, queue the action
      if (!viewRef.current) {
        pendingActionsRef.current.push(executeAddMarker);
        return;
      }
      executeAddMarker();
    },

    clearLayers: () => {
      const executeClearLayers = () => {
        if (!viewRef.current) return;
        const { map, view, chatLayer, chatFeatureLayers, addedGeoJSONLabels } = viewRef.current as {
          map: { remove: (layer: unknown) => void };
          view: { goTo: (opts: unknown) => void };
          chatLayer: { removeAll: () => void };
          chatFeatureLayers: unknown[];
          addedGeoJSONLabels: Set<string>;
        };

        // Clear graphics layer
        chatLayer.removeAll();

        // Remove all feature layers
        for (const layer of chatFeatureLayers) {
          map.remove(layer);
        }
        chatFeatureLayers.length = 0;

        // Clear GeoJSON tracking
        addedGeoJSONLabels.clear();

        // Reset zoom to default US view
        view.goTo({
          center: [-98.5, 39.8],
          zoom: 4,
        });
      };

      // If map not ready, queue the action
      if (!viewRef.current) {
        pendingActionsRef.current.push(executeClearLayers);
        return;
      }
      executeClearLayers();
    },

    zoomToExtent: (bbox: [number, number, number, number], maxScale?: number) => {
      const executeZoom = () => {
        if (!viewRef.current?.view) return;
        const [xmin, ymin, xmax, ymax] = bbox;
        const { view, Extent } = viewRef.current as {
          view: { goTo: (target: unknown) => Promise<void>; scale: number };
          Extent: new (opts: unknown) => unknown;
        };

        // Create a proper Extent object from the ArcGIS API
        const extent = new Extent({
          xmin,
          ymin,
          xmax,
          ymax,
          spatialReference: { wkid: 4326 },
        });

        if (maxScale) {
          // First zoom to the extent, then check if we need to zoom in further
          view.goTo(extent).then(() => {
            if (view.scale > maxScale) {
              // The extent zoom left us too far out — zoom to the center at the required scale
              const centerLon = (xmin + xmax) / 2;
              const centerLat = (ymin + ymax) / 2;
              view.goTo({ center: [centerLon, centerLat], scale: maxScale * 0.9 });
            }
          }).catch(() => {
            // goTo can be interrupted — ignore
          });
        } else {
          view.goTo(extent);
        }
      };

      // If map not ready, queue the action
      if (!viewRef.current?.view) {
        pendingActionsRef.current.push(executeZoom);
        return;
      }
      executeZoom();
    },
  }), [resolvedTheme]);

  const updatePreview = useCallback(() => {
    if (!viewRef.current || !previewData) return;

    const { previewLayer, Graphic, Polygon, Point, Polyline } = viewRef.current as {
      previewLayer: { removeAll: () => void; add: (g: unknown) => void };
      Graphic: new (opts: unknown) => unknown;
      Polygon: new (opts: unknown) => unknown;
      Point: new (opts: unknown) => unknown;
      Polyline: new (opts: unknown) => unknown;
    };

    previewLayer.removeAll();

    // Dymaptic teal for preview features
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
      const geomType = feature.geometry.type.toLowerCase();
      let geometry: unknown;
      let symbol: unknown;

      if (geomType.includes('polygon') || geomType.includes('multipolygon')) {
        const coords = feature.geometry.coordinates;
        // Handle both Polygon and MultiPolygon
        const rings = geomType === 'multipolygon'
          ? (coords as number[][][][]).flat()
          : coords;
        geometry = new Polygon({
          rings,
          spatialReference: { wkid: 4326 },
        });
        symbol = symbols.polygon;
      } else if (geomType.includes('line')) {
        const coords = feature.geometry.coordinates;
        const paths = geomType.includes('multi')
          ? coords
          : [coords];
        geometry = new Polyline({
          paths,
          spatialReference: { wkid: 4326 },
        });
        symbol = symbols.line;
      } else if (geomType.includes('point')) {
        const coords = feature.geometry.coordinates as number[];
        geometry = new Point({
          longitude: coords[0],
          latitude: coords[1],
        });
        symbol = symbols.point;
      } else {
        continue;
      }

      previewLayer.add(
        new Graphic({
          geometry,
          symbol,
          attributes: feature.properties,
          popupTemplate: {
            title: escapeHtml(feature.properties?.name || feature.properties?.Name || feature.properties?.NAME || feature.properties?.title || 'Feature'),
            content: [{
              type: 'fields',
              fieldInfos: [], // Show all fields
            }],
          },
        })
      );
    }
  }, [previewData]);

  // Store callbacks in refs to avoid re-initializing the map when they change
  const onExtentChangeRef = useRef(onExtentChange);
  onExtentChangeRef.current = onExtentChange;

  const onScaleChangeRef = useRef(onScaleChange);
  onScaleChangeRef.current = onScaleChange;

  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;

  const initialBboxRef = useRef(initialBbox);
  // Only update initialBbox ref on first render
  if (!viewRef.current && initialBbox) {
    initialBboxRef.current = initialBbox;
  }

  useEffect(() => {
    // Prevent re-initialization if map already exists
    if (viewRef.current || !mapRef.current || typeof window === 'undefined') return;

    let destroyed = false;
    let retryCount = 0;
    let retryTimeout: ReturnType<typeof setTimeout>;
    const maxRetries = 20; // Wait up to 10 seconds for ArcGIS SDK
    const scaleWatchHandles: Array<{ remove: () => void }> = [];

    const initMap = () => {
      if (destroyed) return;

      if (!window.require) {
        retryCount++;
        if (retryCount < maxRetries) {
          retryTimeout = setTimeout(initMap, 500);
        } else {
          setMapError('ArcGIS SDK failed to load');
        }
        return;
      }

      window.require(
      [
        'esri/Map',
        'esri/views/MapView',
        'esri/layers/GraphicsLayer',
        'esri/layers/FeatureLayer',
        'esri/layers/MapImageLayer',
        'esri/Graphic',
        'esri/geometry/Polygon',
        'esri/geometry/Point',
        'esri/geometry/Polyline',
        'esri/geometry/Extent',
        'esri/config',
        'esri/widgets/LayerList',
        'esri/core/reactiveUtils',
      ],
      (
        Map: new (opts: unknown) => unknown,
        MapView: new (opts: unknown) => { destroy: () => void; watch: (prop: string, cb: (e: { xmin: number; ymin: number; xmax: number; ymax: number }) => void) => void },
        GraphicsLayer: new (opts: unknown) => unknown,
        FeatureLayer: new (opts: unknown) => unknown,
        MapImageLayer: new (opts: unknown) => unknown,
        Graphic: new (opts: unknown) => unknown,
        Polygon: new (opts: unknown) => unknown,
        Point: new (opts: unknown) => unknown,
        Polyline: new (opts: unknown) => unknown,
        Extent: new (opts: unknown) => unknown,
        esriConfig: { apiKey: string },
        LayerList: new (opts: unknown) => unknown,
        reactiveUtils: { watch: (getValue: () => unknown, callback: (value: unknown) => void, options?: { initial?: boolean }) => { remove: () => void } }
      ) => {
        if (destroyed) return;

        // Set API key
        esriConfig.apiKey = process.env.NEXT_PUBLIC_ARCGIS_API_KEY || '';

        const bbox = initialBboxRef.current;
        const map = new Map({
          basemap: resolvedTheme === 'light' ? 'gray-vector' : 'dark-gray-vector',
        });

        const view = new MapView({
          container: mapRef.current,
          map: map,
          center: bbox
            ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
            : [-98.5, 39.8],
          zoom: bbox ? undefined : 4,
          extent: bbox
            ? {
                xmin: bbox[0],
                ymin: bbox[1],
                xmax: bbox[2],
                ymax: bbox[3],
                spatialReference: { wkid: 4326 },
              }
            : undefined,
        });

        // Add preview layer for dataset previews
        const previewLayer = new GraphicsLayer({ id: 'preview', title: 'Data Preview', listMode: 'hide' });
        (map as { add: (layer: unknown) => void }).add(previewLayer);

        // Add chat layer for AI-driven visualizations (on top)
        const chatLayer = new GraphicsLayer({ id: 'chat', title: 'AI Results', listMode: 'hide' });
        (map as { add: (layer: unknown) => void }).add(chatLayer);

        // Add LayerList widget with scale visibility indicators
        const layerList = new LayerList({
          view,
          listItemCreatedFunction: (event: { item: any }) => {
            const item = event.item;
            const layer = item.layer;
            // Only for layers with a minScale constraint
            if (layer.minScale > 0) {
              // Add "Zoom to visible range" action
              item.actionsSections = [[{
                title: 'Zoom to visible range',
                className: 'esri-icon-zoom-in-magnifying-glass',
                id: 'zoom-to-visible',
              }]];
              // Reactively show/hide message based on current scale
              const handle = reactiveUtils.watch(
                () => (view as any).scale,
                (scale: unknown) => {
                  if ((scale as number) > layer.minScale) {
                    item.panel = {
                      content: document.createTextNode('Zoom in to see this layer'),
                      open: true,
                    };
                  } else {
                    item.panel = null;
                  }
                },
                { initial: true }
              );
              scaleWatchHandles.push(handle);
            }
          },
        });

        // Handle LayerList actions
        (layerList as any).on('trigger-action', (event: { action: { id: string }; item: { layer: any } }) => {
          if (event.action.id === 'zoom-to-visible') {
            const layer = event.item.layer;
            if (layer.minScale > 0) {
              (view as any).goTo({ scale: layer.minScale * 0.9 });
            }
          }
        });

        (view as unknown as { ui: { add: (widget: unknown, position: string) => void } }).ui.add(layerList, 'top-right');

        viewRef.current = {
          view,
          map,
          previewLayer,
          chatLayer,
          chatFeatureLayers: [],
          addedGeoJSONLabels: new Set(),
          GraphicsLayer,
          Graphic,
          Polygon,
          Point,
          Polyline,
          Extent,
          FeatureLayer,
          MapImageLayer,
        };

        setIsMapReady(true);
        onMapReadyRef.current?.();

        // Process any pending actions that were queued before map was ready
        if (pendingActionsRef.current.length > 0) {
          for (const action of pendingActionsRef.current) {
            action();
          }
          pendingActionsRef.current = [];
        }

        // Track extent changes (debounced)
        let extentTimeout: ReturnType<typeof setTimeout>;
        view.watch('extent', (extent: { xmin: number; ymin: number; xmax: number; ymax: number } | null) => {
          if (extent) {
            clearTimeout(extentTimeout);
            extentTimeout = setTimeout(() => {
              onExtentChangeRef.current?.([extent.xmin, extent.ymin, extent.xmax, extent.ymax]);
            }, 300);
          }
        });

        // Track scale changes (debounced)
        let scaleTimeout: ReturnType<typeof setTimeout>;
        (view as any).watch('scale', (scale: number) => {
          if (scale) {
            clearTimeout(scaleTimeout);
            scaleTimeout = setTimeout(() => {
              onScaleChangeRef.current?.(scale);
            }, 300);
          }
        });
      }
    );
    };

    // Start initialization
    initMap();

    return () => {
      destroyed = true;
      clearTimeout(retryTimeout);
      // Clean up scale watch handles
      scaleWatchHandles.forEach(h => h.remove());
      scaleWatchHandles.length = 0;
      if (viewRef.current?.view) {
        try {
          (viewRef.current.view as { destroy: () => void }).destroy();
          viewRef.current = null;
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, []); // Empty dependency array - only run once on mount

  // Update preview when data changes
  useEffect(() => {
    updatePreview();
  }, [updatePreview]);

  // Switch basemap when theme changes
  useEffect(() => {
    if (viewRef.current?.map) {
      const newBasemap = resolvedTheme === 'light' ? 'gray-vector' : 'dark-gray-vector';
      (viewRef.current.map as { basemap: string }).basemap = newBasemap;
    }
  }, [resolvedTheme]);

  return (
    <div className="relative w-full h-full min-h-[250px] md:min-h-[400px] bg-gray-100 dark:bg-slate-800 rounded-lg overflow-hidden">
      <div ref={mapRef} className="w-full h-full" />

      {/* Loading state */}
      {!isMapReady && !mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-slate-800">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-teal border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading map...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-slate-800">
          <div className="text-center text-red-400">
            <p className="text-sm">{mapError}</p>
          </div>
        </div>
      )}
    </div>
  );
});
