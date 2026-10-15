import buffer from '@turf/buffer';
import union from '@turf/union';
import bbox from '@turf/bbox';
import simplify from '@turf/simplify';
import bboxPolygon from '@turf/bbox-polygon';
import booleanIntersects from '@turf/boolean-intersects';
import { featureCollection, feature as turfFeature } from '@turf/helpers';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { featureQueryService } from './feature-query.service';
import { geoParquetService } from './geoparquet.service';
import { validateWhereClause, isValidIdentifier, STATISTIC_TYPES } from '@/lib/sql-guard';
import type { GeoJSONFeature } from '@/types';
import type { MapAction, StreamEvent, GeoJSONFeatureCollection } from '@/types/chat';

// --- Types ---

export type SpatialRelation = 'within_distance' | 'intersects' | 'contains' | 'within';

export interface SpatialQueryParams {
  // Source (provide ONE of these three)
  sourceServiceUrl?: string;
  sourceId?: string;        // GeoParquet source ID
  sourceGeometryId?: string; // Cached result from previous spatial_query

  sourceWhere?: string;
  sourceBbox?: [number, number, number, number];

  // Target (provide ONE of these two)
  targetServiceUrl?: string;
  targetId?: string;        // GeoParquet target ID

  targetWhere?: string;

  // Spatial operation
  spatialRelation: SpatialRelation;
  distance?: number;
  distanceUnit?: 'miles' | 'kilometers' | 'meters';

  // Output mode
  mode?: 'features' | 'statistics';
  groupByField?: string;
  statisticType?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  statisticField?: string;

  // Display
  label?: string;
}

export interface SpatialQueryResult {
  sourceFeatureCount: number;
  targetFeatureCount?: number;
  targetTotalEstimate?: number;
  truncated?: boolean;
  resultBbox?: [number, number, number, number];
  resultGeometryId: string;
  sampleFeatures?: Array<Record<string, unknown>>;
  statistics?: Array<Record<string, unknown>>;
  totalMatching?: number;
  error?: string;
}

// --- Geometry Cache ---

interface CachedGeometry {
  polygon: Feature<Polygon | MultiPolygon>;
  resultBbox: [number, number, number, number];
  description: string;
  timestamp: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CACHE_MAX_ENTRIES = 50;
const geometryCache = new Map<string, CachedGeometry>();

function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of geometryCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      geometryCache.delete(key);
    }
  }
}

function cacheGeometry(polygon: Feature<Polygon | MultiPolygon>, resultBbox: [number, number, number, number], description: string): string {
  cleanExpiredCache();

  // Evict oldest if at capacity
  if (geometryCache.size >= CACHE_MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of geometryCache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey) geometryCache.delete(oldestKey);
  }

  const id = `spatial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  geometryCache.set(id, {
    polygon,
    resultBbox,
    description,
    timestamp: Date.now(),
  });
  return id;
}

function getCachedGeometry(id: string): CachedGeometry | null {
  cleanExpiredCache();
  return geometryCache.get(id) || null;
}

// --- Limits ---

const MAX_SOURCE_FEATURES = 200;
const MAX_TARGET_FEATURES = 500;
const MAX_BUFFER_DISTANCE_MILES = 5000;
const MAX_VERTICES = 2000;
const OPERATION_TIMEOUT_MS = 90_000;

// --- Service ---

export class SpatialQueryService {

  /**
   * Main entry point: execute a spatial query.
   */
  async executeSpatialQuery(
    params: SpatialQueryParams,
    emitEvent: (event: StreamEvent) => void
  ): Promise<SpatialQueryResult> {
    // Validate params
    const validation = this.validateParams(params);
    if (validation) {
      return { sourceFeatureCount: 0, resultGeometryId: '', error: validation };
    }

    // Set up timeout
    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        'Spatial query timed out after 90 seconds. Try narrowing the geographic area or using a smaller distance.'
      )), OPERATION_TIMEOUT_MS);
    });

    try {
      const resultPromise = this.executeInternal(params, emitEvent);
      return await Promise.race([resultPromise, timeoutPromise]);
    } catch (error) {
      return {
        sourceFeatureCount: 0,
        resultGeometryId: '',
        error: error instanceof Error ? error.message : 'Spatial query failed',
      };
    } finally {
      clearTimeout(timer!);
    }
  }

  private validateParams(params: SpatialQueryParams): string | null {
    // Validate source
    const sourceCount = [params.sourceServiceUrl, params.sourceId, params.sourceGeometryId].filter(Boolean).length;
    if (sourceCount !== 1) {
      return 'Provide exactly ONE of: sourceServiceUrl, sourceId, or sourceGeometryId';
    }

    // Validate target
    const targetCount = [params.targetServiceUrl, params.targetId].filter(Boolean).length;
    if (targetCount !== 1) {
      return 'Provide exactly ONE of: targetServiceUrl or targetId';
    }

    // Validate distance
    if (params.spatialRelation === 'within_distance') {
      if (!params.distance || params.distance <= 0) {
        return 'distance is required and must be positive for within_distance relation';
      }
      const distMiles = this.toMiles(params.distance, params.distanceUnit || 'miles');
      if (distMiles > MAX_BUFFER_DISTANCE_MILES) {
        return `Distance too large: ${distMiles.toFixed(0)} miles exceeds maximum of ${MAX_BUFFER_DISTANCE_MILES} miles`;
      }
    }

    // Validate WHERE clauses to prevent SQL injection in DuckDB path
    if (params.sourceWhere) {
      const sourceCheck = validateWhereClause(params.sourceWhere);
      if (!sourceCheck.valid) {
        return `Invalid sourceWhere clause: ${sourceCheck.error}`;
      }
    }
    if (params.targetWhere) {
      const targetCheck = validateWhereClause(params.targetWhere);
      if (!targetCheck.valid) {
        return `Invalid targetWhere clause: ${targetCheck.error}`;
      }
    }

    // Validate identifier-like inputs (interpolated into DuckDB SQL)
    if (params.groupByField && !isValidIdentifier(params.groupByField)) {
      return 'Invalid groupByField: must be a plain field name (letters, digits, underscores, dots)';
    }
    if (params.statisticField && !isValidIdentifier(params.statisticField)) {
      return 'Invalid statisticField: must be a plain field name (letters, digits, underscores, dots)';
    }
    if (params.statisticType && !(STATISTIC_TYPES as readonly string[]).includes(params.statisticType)) {
      return `Invalid statisticType: must be one of ${STATISTIC_TYPES.join(', ')}`;
    }

    // Validate GeoParquet requires bbox
    if (params.sourceId && !params.sourceBbox && !params.sourceGeometryId) {
      return 'sourceBbox is required when using sourceId (GeoParquet source). Use geocode_location first to get coordinates.';
    }

    // Validate statistics params
    if (params.mode === 'statistics') {
      if (!params.groupByField) {
        return 'groupByField is required for statistics mode';
      }
      if (params.statisticType && params.statisticType !== 'count' && !params.statisticField) {
        return `statisticField is required for ${params.statisticType} aggregation`;
      }
    }

    return null;
  }

  private async executeInternal(
    params: SpatialQueryParams,
    emitEvent: (event: StreamEvent) => void
  ): Promise<SpatialQueryResult> {

    // Optimize: GeoParquet-to-GeoParquet can use a single DuckDB query
    if (params.sourceId && params.targetId && params.sourceBbox) {
      return this.executeGeoParquetToGeoParquet(params, emitEvent);
    }

    // Step 1: Extract source geometries
    const { features: sourceFeatures, filterPolygon } = await this.extractAndComputeFilter(params);

    if (sourceFeatures.length === 0 && !params.sourceGeometryId) {
      return {
        sourceFeatureCount: 0,
        resultGeometryId: '',
        error: 'No source features found. Try broadening your search area or WHERE clause.',
      };
    }

    const sourceCount = params.sourceGeometryId
      ? 0 // We don't know the count for cached geometry
      : sourceFeatures.length;

    if (!filterPolygon) {
      return {
        sourceFeatureCount: sourceCount,
        resultGeometryId: '',
        error: 'Could not compute spatial filter from source features.',
      };
    }

    // Step 2: Compute result bbox
    const filterBbox = bbox(filterPolygon) as [number, number, number, number];

    // Step 3: Query target features
    const result = await this.queryTarget(params, filterPolygon, filterBbox);

    // Step 4: Cache result geometry
    const label = params.label || 'Spatial query result';
    const geometryId = cacheGeometry(filterPolygon, filterBbox, label);

    // Step 5: Emit map layers
    this.emitMapLayers(params, sourceFeatures, filterPolygon, result, filterBbox, emitEvent);

    // Step 6: Build response
    if (params.mode === 'statistics') {
      return {
        sourceFeatureCount: sourceCount,
        resultGeometryId: geometryId,
        statistics: result.statistics || [],
        totalMatching: result.count,
      };
    }

    return {
      sourceFeatureCount: sourceCount,
      targetFeatureCount: result.features.length,
      targetTotalEstimate: result.count > result.features.length ? result.count : undefined,
      truncated: result.features.length >= MAX_TARGET_FEATURES,
      resultBbox: filterBbox,
      resultGeometryId: geometryId,
      sampleFeatures: result.features.slice(0, 10).map(f => f.properties),
    };
  }

  /**
   * Optimized path: GeoParquet source + GeoParquet target → single DuckDB query
   */
  private async executeGeoParquetToGeoParquet(
    params: SpatialQueryParams,
    emitEvent: (event: StreamEvent) => void
  ): Promise<SpatialQueryResult> {
    const mode = params.mode === 'statistics' ? 'statistics' : 'features';

    const joinResult = await geoParquetService.querySpatialJoin({
      sourceId: params.sourceId!,
      sourceBbox: params.sourceBbox!,
      sourceWhere: params.sourceWhere,
      targetId: params.targetId!,
      spatialRelation: params.spatialRelation,
      distance: params.distance,
      distanceUnit: params.distanceUnit,
      targetWhere: params.targetWhere,
      limit: MAX_TARGET_FEATURES,
      mode,
      groupByField: params.groupByField,
      statisticType: params.statisticType,
      statisticField: params.statisticField,
    });

    // For GeoParquet results, emit as GeoJSON on map
    if (joinResult.features.length > 0) {
      const geojsonFeatures: GeoJSONFeature[] = joinResult.features.map(f => ({
        type: 'Feature' as const,
        geometry: f.geometry as GeoJSONFeature['geometry'],
        properties: f.properties,
      }));

      const label = params.label || 'Spatial query results';
      const geojsonAction: MapAction = {
        type: 'add_geojson',
        geojson: {
          type: 'FeatureCollection',
          features: geojsonFeatures,
        } as GeoJSONFeatureCollection,
        label,
        style: { color: '#4CAF50', fillOpacity: 0.4 },
      };
      emitEvent({ type: 'map_action', action: geojsonAction });
    }

    // Cache a bbox polygon for chaining
    const resultBbox = params.sourceBbox!;
    const bboxPoly = bboxPolygon(resultBbox) as Feature<Polygon>;
    const geometryId = cacheGeometry(bboxPoly, resultBbox, params.label || 'GeoParquet spatial query');

    if (params.mode === 'statistics') {
      return {
        sourceFeatureCount: 0,
        resultGeometryId: geometryId,
        statistics: joinResult.statistics || [],
        totalMatching: joinResult.count,
      };
    }

    return {
      sourceFeatureCount: 0,
      targetFeatureCount: joinResult.features.length,
      truncated: joinResult.features.length >= MAX_TARGET_FEATURES,
      resultBbox,
      resultGeometryId: geometryId,
      sampleFeatures: joinResult.features.slice(0, 10).map(f => f.properties),
    };
  }

  /**
   * Extract source geometries and compute the spatial filter polygon.
   */
  private async extractAndComputeFilter(params: SpatialQueryParams): Promise<{
    features: GeoJSONFeature[];
    filterPolygon: Feature<Polygon | MultiPolygon> | null;
  }> {
    // Case 1: Cached geometry from previous result
    if (params.sourceGeometryId) {
      const cached = getCachedGeometry(params.sourceGeometryId);
      if (!cached) {
        throw new Error('Previous spatial query result has expired. Please run the original query again.');
      }

      // If within_distance, buffer the cached geometry further
      if (params.spatialRelation === 'within_distance' && params.distance) {
        const buffered = this.bufferGeometry(cached.polygon, params.distance, params.distanceUnit || 'miles');
        return { features: [], filterPolygon: buffered };
      }

      return { features: [], filterPolygon: cached.polygon };
    }

    // Case 2: ArcGIS source
    if (params.sourceServiceUrl) {
      const features = await featureQueryService.queryFeaturesWithGeometry({
        serviceUrl: params.sourceServiceUrl,
        where: params.sourceWhere,
        bbox: params.sourceBbox,
        limit: MAX_SOURCE_FEATURES,
      });

      const filterPolygon = this.computeSpatialFilter(features, params.spatialRelation, params.distance, params.distanceUnit);
      return { features, filterPolygon };
    }

    // Case 3: GeoParquet source
    if (params.sourceId) {
      const rawFeatures = await geoParquetService.queryFeaturesWithGeometry(params.sourceId, {
        bbox: params.sourceBbox,
        where: params.sourceWhere,
        limit: MAX_SOURCE_FEATURES,
      });

      const features: GeoJSONFeature[] = rawFeatures.map(f => ({
        type: 'Feature' as const,
        geometry: f.geometry as GeoJSONFeature['geometry'],
        properties: f.properties,
      }));

      const filterPolygon = this.computeSpatialFilter(features, params.spatialRelation, params.distance, params.distanceUnit);
      return { features, filterPolygon };
    }

    return { features: [], filterPolygon: null };
  }

  /**
   * Compute a spatial filter polygon from source features.
   * For within_distance: buffer each feature, then union all.
   * For intersects/contains/within: union source geometries into one polygon.
   */
  private computeSpatialFilter(
    features: GeoJSONFeature[],
    relation: SpatialRelation,
    distance?: number,
    unit?: 'miles' | 'kilometers' | 'meters'
  ): Feature<Polygon | MultiPolygon> | null {
    if (features.length === 0) return null;

    // Convert features to Turf features
    const turfFeatures: Feature[] = features.map(f =>
      turfFeature(f.geometry as GeoJSON.Geometry, f.properties)
    );

    if (relation === 'within_distance' && distance) {
      // Buffer each feature and union
      const buffered: Feature<Polygon | MultiPolygon>[] = [];
      for (const feat of turfFeatures) {
        const buf = buffer(feat, distance, { units: unit || 'miles' });
        if (buf) {
          buffered.push(buf as Feature<Polygon | MultiPolygon>);
        }
      }

      if (buffered.length === 0) return null;
      return this.unionAll(buffered);
    }

    // For intersects/contains/within: create a polygon from the source features
    // If sources are points/lines, buffer them by a small amount to create polygons
    const polygons: Feature<Polygon | MultiPolygon>[] = [];
    for (const feat of turfFeatures) {
      if (feat.geometry.type === 'Polygon' || feat.geometry.type === 'MultiPolygon') {
        polygons.push(feat as Feature<Polygon | MultiPolygon>);
      } else {
        // Buffer points/lines by a small amount to create polygons
        const buf = buffer(feat, 0.1, { units: 'kilometers' });
        if (buf) {
          polygons.push(buf as Feature<Polygon | MultiPolygon>);
        }
      }
    }

    if (polygons.length === 0) return null;
    return this.unionAll(polygons);
  }

  /**
   * Buffer a geometry feature by a distance.
   */
  private bufferGeometry(
    feature: Feature<Polygon | MultiPolygon>,
    distance: number,
    unit: 'miles' | 'kilometers' | 'meters'
  ): Feature<Polygon | MultiPolygon> {
    const buffered = buffer(feature, distance, { units: unit });
    if (!buffered) return feature;
    return this.simplifyIfNeeded(buffered as Feature<Polygon | MultiPolygon>);
  }

  /**
   * Union all polygons into a single polygon/multipolygon.
   */
  private unionAll(polygons: Feature<Polygon | MultiPolygon>[]): Feature<Polygon | MultiPolygon> {
    if (polygons.length === 1) {
      return this.simplifyIfNeeded(polygons[0]);
    }

    // Divide-and-conquer union: O(N log N) instead of O(N^2)
    let current = polygons;
    while (current.length > 1) {
      const next: Feature<Polygon | MultiPolygon>[] = [];
      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 < current.length) {
          const merged = union(featureCollection([current[i], current[i + 1]]));
          next.push(merged ? merged as Feature<Polygon | MultiPolygon> : current[i]);
        } else {
          next.push(current[i]);
        }
      }
      current = next;
    }

    return this.simplifyIfNeeded(current[0]);
  }

  /**
   * Simplify geometry if it exceeds vertex limits (ArcGIS REST API constraint).
   */
  private simplifyIfNeeded(feature: Feature<Polygon | MultiPolygon>): Feature<Polygon | MultiPolygon> {
    const vertexCount = this.countVertices(feature);
    if (vertexCount <= MAX_VERTICES) return feature;

    // Progressively simplify until under the vertex limit
    let tolerance = 0.01;
    let simplified = feature;
    for (let i = 0; i < 10; i++) {
      simplified = simplify(feature, { tolerance, highQuality: true }) as Feature<Polygon | MultiPolygon>;
      if (this.countVertices(simplified) <= MAX_VERTICES) break;
      tolerance *= 2;
    }

    return simplified;
  }

  private countVertices(feature: Feature<Polygon | MultiPolygon>): number {
    let count = 0;
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) {
        count += ring.length;
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const polygon of geom.coordinates) {
        for (const ring of polygon) {
          count += ring.length;
        }
      }
    }
    return count;
  }

  /**
   * Query target features using the computed filter polygon.
   */
  private async queryTarget(
    params: SpatialQueryParams,
    filterPolygon: Feature<Polygon | MultiPolygon>,
    filterBbox: [number, number, number, number]
  ): Promise<{
    features: Array<{ geometry: unknown; properties: Record<string, unknown> }>;
    count: number;
    statistics?: Array<Record<string, unknown>>;
  }> {
    // ArcGIS target
    if (params.targetServiceUrl) {
      return this.queryArcGISTarget(params, filterPolygon);
    }

    // GeoParquet target
    if (params.targetId) {
      return this.queryGeoParquetTarget(params, filterPolygon, filterBbox);
    }

    return { features: [], count: 0 };
  }

  private async queryArcGISTarget(
    params: SpatialQueryParams,
    filterPolygon: Feature<Polygon | MultiPolygon>
  ): Promise<{
    features: Array<{ geometry: unknown; properties: Record<string, unknown> }>;
    count: number;
    statistics?: Array<Record<string, unknown>>;
  }> {
    const spatialRelMap: Record<SpatialRelation, string> = {
      within_distance: 'esriSpatialRelIntersects', // already buffered
      intersects: 'esriSpatialRelIntersects',
      contains: 'esriSpatialRelContains',
      within: 'esriSpatialRelWithin',
    };

    // Statistics mode for ArcGIS
    if (params.mode === 'statistics' && params.groupByField) {
      // Query features within the spatial filter, then aggregate client-side
      const featResult = await featureQueryService.queryFeaturesWithPolygonFilter({
        serviceUrl: params.targetServiceUrl!,
        polygon: filterPolygon.geometry,
        spatialRel: spatialRelMap[params.spatialRelation],
        where: params.targetWhere,
        limit: MAX_TARGET_FEATURES,
      });

      // Client-side groupBy aggregation
      const groups = new Map<string, number>();
      for (const f of featResult.features) {
        const key = String(f.properties?.[params.groupByField] ?? 'null');
        groups.set(key, (groups.get(key) || 0) + 1);
      }
      const statistics = Array.from(groups.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([value, count]) => ({ [params.groupByField!]: value, count }));

      return { features: [], count: featResult.count, statistics };
    }

    // Features mode
    const result = await featureQueryService.queryFeaturesWithPolygonFilter({
      serviceUrl: params.targetServiceUrl!,
      polygon: filterPolygon.geometry,
      spatialRel: spatialRelMap[params.spatialRelation],
      where: params.targetWhere,
      limit: MAX_TARGET_FEATURES,
    });

    return {
      features: result.features.map(f => ({
        geometry: f.geometry,
        properties: f.properties,
      })),
      count: result.count,
    };
  }

  private async queryGeoParquetTarget(
    params: SpatialQueryParams,
    filterPolygon: Feature<Polygon | MultiPolygon>,
    filterBbox: [number, number, number, number]
  ): Promise<{
    features: Array<{ geometry: unknown; properties: Record<string, unknown> }>;
    count: number;
  }> {
    // Use DuckDB with WKT spatial filter
    const source = geoParquetService.getSource(params.targetId!);
    if (!source) {
      throw new Error(`Unknown GeoParquet target: ${params.targetId}`);
    }

    // Step 1: Coarse filter — query features within the filter bbox from DuckDB
    // Request extra features since many will be eliminated by the polygon intersection test
    const coarseFeatures = await geoParquetService.queryFeaturesWithGeometry(params.targetId!, {
      bbox: filterBbox,
      where: params.targetWhere,
      limit: MAX_TARGET_FEATURES * 2,
    });

    // Step 2: Refine — post-filter using actual polygon intersection test
    // The bbox alone can be much larger than the filter polygon (e.g., long line features
    // like hurricane tracks have a bbox spanning thousands of miles)
    const refined = coarseFeatures.filter(f => {
      try {
        const targetFeature = turfFeature(f.geometry as unknown as GeoJSON.Geometry);
        return booleanIntersects(targetFeature, filterPolygon);
      } catch {
        return false;
      }
    });

    // Trim to the target limit
    const trimmed = refined.slice(0, MAX_TARGET_FEATURES);

    return {
      features: trimmed.map(f => ({
        geometry: f.geometry,
        properties: f.properties,
      })),
      count: refined.length,
    };
  }

  /**
   * Emit map visualization layers for the spatial query result.
   *
   * Always uses add_geojson with the actual spatially-filtered features rather
   * than add_feature_layer, because add_feature_layer would show the ENTIRE
   * service layer (only filtered by WHERE, not by the spatial polygon).
   */
  private emitMapLayers(
    params: SpatialQueryParams,
    sourceFeatures: GeoJSONFeature[],
    filterPolygon: Feature<Polygon | MultiPolygon>,
    result: { features: Array<{ geometry: unknown; properties: Record<string, unknown> }>; count: number },
    filterBbox: [number, number, number, number],
    emitEvent: (event: StreamEvent) => void
  ): void {
    // Layer 1: Source features (coral) — actual queried features, not the whole layer
    if (sourceFeatures.length > 0 && sourceFeatures.length <= MAX_SOURCE_FEATURES) {
      const sourceGeojson: MapAction = {
        type: 'add_geojson',
        geojson: {
          type: 'FeatureCollection',
          features: sourceFeatures,
        } as GeoJSONFeatureCollection,
        label: 'Source features',
        style: { color: '#E24E42', fillOpacity: 0.5 },
      };
      emitEvent({ type: 'map_action', action: sourceGeojson });
    }

    // Layer 2: Buffer/filter zone (teal, semi-transparent) - only for distance queries
    if (params.spatialRelation === 'within_distance' && params.distance) {
      const bufferFeatures: GeoJSONFeature[] = [{
        type: 'Feature',
        geometry: filterPolygon.geometry as GeoJSONFeature['geometry'],
        properties: { type: 'buffer_zone' },
      }];

      const bufferAction: MapAction = {
        type: 'add_geojson',
        geojson: {
          type: 'FeatureCollection',
          features: bufferFeatures,
        } as GeoJSONFeatureCollection,
        label: `${params.distance} ${params.distanceUnit || 'miles'} buffer`,
        style: { color: '#1D809F', fillOpacity: 0.15, strokeWidth: 1 },
      };
      emitEvent({ type: 'map_action', action: bufferAction });
    }

    // Layer 3: Result features (green) — actual spatially-filtered features
    if (result.features.length > 0 && params.mode !== 'statistics') {
      const resultGeojson: GeoJSONFeature[] = result.features.map(f => ({
        type: 'Feature' as const,
        geometry: f.geometry as GeoJSONFeature['geometry'],
        properties: f.properties,
      }));

      const resultAction: MapAction = {
        type: 'add_geojson',
        geojson: {
          type: 'FeatureCollection',
          features: resultGeojson,
        } as GeoJSONFeatureCollection,
        label: params.label || 'Result features',
        style: { color: '#4CAF50', fillOpacity: 0.4 },
      };
      emitEvent({ type: 'map_action', action: resultAction });
    }

    // Layer 4: Zoom to the result area
    const zoomAction: MapAction = {
      type: 'zoom_to_extent',
      bbox: filterBbox,
    };
    emitEvent({ type: 'map_action', action: zoomAction });
  }

  // --- Helpers ---

  private toMiles(distance: number, unit: 'miles' | 'kilometers' | 'meters'): number {
    switch (unit) {
      case 'kilometers': return distance * 0.621371;
      case 'meters': return distance * 0.000621371;
      default: return distance;
    }
  }
}

export const spatialQueryService = new SpatialQueryService();
