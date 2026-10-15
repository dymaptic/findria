import type { GeoJSONFeature } from '@/types';
import type { FeatureQueryParams, FeatureCountParams, StatisticsQueryParams, StatisticsResult, StatisticType } from '@/types/chat';
import { validateWhereClause, assertValidIdentifier, assertStatisticType, normalizeSortDirection } from '@/lib/sql-guard';

// Maximum records to return for chat queries to prevent overwhelming responses
const CHAT_QUERY_LIMIT = 10;

export class FeatureQueryService {
  /**
   * Check if a service/layer supports query operations
   */
  private async checkQuerySupport(serviceUrl: string): Promise<{ supported: boolean; reason?: string; supportsGeoJson?: boolean }> {
    try {
      // Get the base service URL (without layer index)
      const layerMatch = serviceUrl.match(/^(.+\/(?:MapServer|FeatureServer))(?:\/(\d+))?$/);
      if (!layerMatch) {
        return { supported: true }; // Can't determine, assume it works
      }

      const baseUrl = layerMatch[1];
      const layerId = layerMatch[2] || '0';

      // Check layer-level capabilities first
      const layerResponse = await fetch(`${baseUrl}/${layerId}?f=json`);
      if (layerResponse.ok) {
        const layerData = await layerResponse.json();

        // Check if layer has Query capability
        if (layerData.capabilities) {
          const capabilities = layerData.capabilities.toLowerCase();
          if (!capabilities.includes('query')) {
            return {
              supported: false,
              reason: 'This layer does not support feature queries (tiles-only service). Try finding a FeatureServer version of this dataset.'
            };
          }
        }

        // Check supported query formats for GeoJSON support
        const supportsGeoJson = layerData.supportedQueryFormats?.toLowerCase().includes('geojson') ?? false;
        return { supported: true, supportsGeoJson };
      }

      // If layer check fails, check service-level capabilities
      const serviceResponse = await fetch(`${baseUrl}?f=json`);
      if (serviceResponse.ok) {
        const serviceData = await serviceResponse.json();
        if (serviceData.capabilities) {
          const capabilities = serviceData.capabilities.toLowerCase();
          if (!capabilities.includes('query') && capabilities.includes('tilesonly')) {
            return {
              supported: false,
              reason: 'This is a tiles-only map service that does not support feature queries.'
            };
          }
        }
      }

      return { supported: true };
    } catch {
      // If check fails, assume it works and let the actual query fail with details
      return { supported: true };
    }
  }

  /**
   * Resolve a service URL to include a queryable layer index.
   * For MapServer roots without a layer index, fetches service metadata
   * to find the first queryable non-group layer.
   */
  private async resolveLayerUrl(serviceUrl: string): Promise<string> {
    // Already has a layer index
    if (serviceUrl.match(/\/\d+$/)) {
      return serviceUrl;
    }

    // Only do special resolution for MapServer roots
    if (!serviceUrl.includes('/MapServer')) {
      return serviceUrl.replace(/\/?$/, '/0');
    }

    try {
      const response = await fetch(`${serviceUrl}?f=json`);
      if (!response.ok) return serviceUrl.replace(/\/?$/, '/0');

      const data = await response.json();
      const layers = data.layers as Array<{ id: number; type?: string; subLayerIds?: number[] | null }> | undefined;
      if (!layers?.length) return serviceUrl.replace(/\/?$/, '/0');

      // Find first non-group layer (group layers have subLayerIds)
      const queryableLayer = layers.find(l =>
        l.type !== 'Group Layer' && (!l.subLayerIds || l.subLayerIds.length === 0)
      );

      const layerId = queryableLayer?.id ?? layers[0].id;
      return `${serviceUrl.replace(/\/?$/, '')}/${layerId}`;
    } catch {
      return serviceUrl.replace(/\/?$/, '/0');
    }
  }

  /**
   * Query features from an ArcGIS Feature Service with optional WHERE clause and bbox.
   */
  async queryFeatures(params: FeatureQueryParams): Promise<{
    features: GeoJSONFeature[];
    totalCount: number;
    truncated: boolean;
  }> {
    const { serviceUrl, where, bbox, outFields, limit } = params;

    // Validate requested field names (allow '*' for all fields)
    outFields?.forEach((f) => {
      if (f !== '*') assertValidIdentifier(f, 'outFields');
    });

    // Check if query is supported
    const querySupport = await this.checkQuerySupport(serviceUrl);
    if (!querySupport.supported) {
      throw new Error(querySupport.reason || 'This service does not support feature queries');
    }

    // Validate WHERE clause
    if (where) {
      const whereCheck = validateWhereClause(where);
      if (!whereCheck.valid) {
        throw new Error(`Invalid WHERE clause: ${whereCheck.error}`);
      }
    }

    // Enforce chat query limit
    const effectiveLimit = Math.min(limit || CHAT_QUERY_LIMIT, CHAT_QUERY_LIMIT);

    // Resolve to a specific layer URL (handles MapServer roots without layer index)
    const queryUrl = await this.resolveLayerUrl(serviceUrl);

    // Use GeoJSON if supported, otherwise fall back to JSON and convert
    const useGeoJson = querySupport.supportsGeoJson !== false;

    // Build query parameters
    const queryParams = new URLSearchParams({
      where: where || '1=1',
      outFields: outFields?.join(',') || '*',
      returnGeometry: 'true',
      outSR: '4326',
      f: useGeoJson ? 'geojson' : 'json',
      resultRecordCount: effectiveLimit.toString(),
    });

    // Add spatial filter if bbox provided
    if (bbox) {
      const [xmin, ymin, xmax, ymax] = bbox;
      queryParams.set('geometry', JSON.stringify({
        xmin,
        ymin,
        xmax,
        ymax,
        spatialReference: { wkid: 4326 },
      }));
      queryParams.set('geometryType', 'esriGeometryEnvelope');
      queryParams.set('spatialRel', 'esriSpatialRelIntersects');
    }

    const response = await fetch(`${queryUrl}/query?${queryParams}`);
    if (!response.ok) {
      throw new Error(`Feature service query failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Check for ArcGIS error response
    if (data.error) {
      throw new Error(`Feature service error: ${data.error.message || data.error.details?.[0] || 'Unknown error'}`);
    }

    // Convert Esri JSON to GeoJSON if needed
    let features: GeoJSONFeature[];
    if (useGeoJson) {
      features = (data.features || []) as GeoJSONFeature[];
    } else {
      features = this.esriToGeoJSON(data.features || []);
    }

    // Get total count
    const totalCount = await this.countFeatures({
      serviceUrl,
      where,
      bbox,
    });

    return {
      features,
      totalCount,
      truncated: totalCount > effectiveLimit,
    };
  }

  /**
   * Convert Esri JSON features to GeoJSON features
   */
  private esriToGeoJSON(esriFeatures: Array<{
    attributes?: Record<string, unknown>;
    geometry?: {
      x?: number;
      y?: number;
      points?: number[][];
      paths?: number[][][];
      rings?: number[][][];
    };
  }>): GeoJSONFeature[] {
    return esriFeatures.map((feature) => {
      const geom = feature.geometry;
      let geometry: GeoJSONFeature['geometry'];

      if (!geom) {
        geometry = { type: 'Point', coordinates: [0, 0] };
      } else if (geom.x !== undefined && geom.y !== undefined) {
        geometry = { type: 'Point', coordinates: [geom.x, geom.y] };
      } else if (geom.points) {
        geometry = { type: 'MultiPoint', coordinates: geom.points };
      } else if (geom.paths) {
        geometry = geom.paths.length === 1
          ? { type: 'LineString', coordinates: geom.paths[0] }
          : { type: 'MultiLineString', coordinates: geom.paths };
      } else if (geom.rings) {
        if (geom.rings.length === 1) {
          geometry = { type: 'Polygon', coordinates: geom.rings };
        } else {
          // Group rings into polygons using winding order.
          // Esri convention: clockwise (area > 0) = outer, counter-clockwise (area < 0) = hole.
          // If all rings have the same winding, treat each as an independent outer ring
          // (handles services that don't follow strict Esri winding convention).
          let hasOuter = false;
          let hasInner = false;
          const ringInfos: { ring: number[][]; isOuter: boolean }[] = [];
          for (const ring of geom.rings) {
            let area = 0;
            for (let i = 0; i < ring.length - 1; i++) {
              area += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
            }
            const isOuter = area >= 0;
            if (isOuter) hasOuter = true; else hasInner = true;
            ringInfos.push({ ring, isOuter });
          }

          if (!hasOuter || !hasInner) {
            // All rings have the same winding — treat each as independent outer ring
            geometry = { type: 'MultiPolygon', coordinates: geom.rings.map((r: number[][]) => [r]) };
          } else {
            // Mixed winding — classify using Esri convention
            const polygons: number[][][][] = [];
            for (const { ring, isOuter } of ringInfos) {
              if (isOuter) {
                polygons.push([ring]);
              } else if (polygons.length > 0) {
                polygons[polygons.length - 1].push(ring);
              } else {
                polygons.push([ring]);
              }
            }
            geometry = polygons.length === 1
              ? { type: 'Polygon', coordinates: polygons[0] }
              : { type: 'MultiPolygon', coordinates: polygons };
          }
        }
      } else {
        geometry = { type: 'Point', coordinates: [0, 0] };
      }

      return {
        type: 'Feature',
        geometry,
        properties: feature.attributes || {},
      };
    });
  }

  /**
   * Count features matching a WHERE clause and optional bbox.
   */
  async countFeatures(params: FeatureCountParams): Promise<number> {
    const { serviceUrl, where, bbox } = params;

    // Check if query is supported
    const querySupport = await this.checkQuerySupport(serviceUrl);
    if (!querySupport.supported) {
      throw new Error(querySupport.reason || 'This service does not support feature queries');
    }

    // Validate WHERE clause
    if (where) {
      const whereCheck = validateWhereClause(where);
      if (!whereCheck.valid) {
        throw new Error(`Invalid WHERE clause: ${whereCheck.error}`);
      }
    }

    // Resolve to a specific layer URL (handles MapServer roots without layer index)
    const queryUrl = await this.resolveLayerUrl(serviceUrl);

    // Build count query parameters
    const queryParams = new URLSearchParams({
      where: where || '1=1',
      returnCountOnly: 'true',
      f: 'json',
    });

    // Add spatial filter if bbox provided
    if (bbox) {
      const [xmin, ymin, xmax, ymax] = bbox;
      queryParams.set('geometry', JSON.stringify({
        xmin,
        ymin,
        xmax,
        ymax,
        spatialReference: { wkid: 4326 },
      }));
      queryParams.set('geometryType', 'esriGeometryEnvelope');
      queryParams.set('spatialRel', 'esriSpatialRelIntersects');
    }

    const response = await fetch(`${queryUrl}/query?${queryParams}`);
    if (!response.ok) {
      throw new Error(`Feature count query failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Check for ArcGIS error response
    if (data.error) {
      throw new Error(`Feature count error: ${data.error.message || data.error.details?.[0] || 'Unknown error'}`);
    }

    return data.count || 0;
  }

  /**
   * Get field information for a feature service layer.
   */
  async getLayerFields(serviceUrl: string): Promise<Array<{
    name: string;
    type: string;
    alias: string | null;
  }>> {
    // Ensure URL ends with layer index
    let layerUrl = serviceUrl;
    if (!layerUrl.match(/\/\d+$/)) {
      layerUrl = layerUrl.replace(/\/?$/, '/0');
    }

    const response = await fetch(`${layerUrl}?f=json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch layer info: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Layer info error: ${data.error.message || 'Unknown error'}`);
    }

    return (data.fields || []).map((field: { name: string; type: string; alias?: string }) => ({
      name: field.name,
      type: field.type,
      alias: field.alias || null,
    }));
  }

  /**
   * Query statistics (GROUP BY with aggregation) from an ArcGIS Feature Service.
   */
  async queryStatistics(params: StatisticsQueryParams): Promise<StatisticsResult> {
    const { serviceUrl, groupByField, statisticField, where, bbox, limit = 10 } = params;

    // Validate identifier-like inputs before they reach the ArcGIS query
    const statisticType = assertStatisticType(params.statisticType);
    const sortDirection = normalizeSortDirection(params.orderBy, 'DESC');
    assertValidIdentifier(groupByField, 'groupByField');

    // Validate: sum/avg/min/max require a statisticField
    if (statisticType !== 'count' && !statisticField) {
      throw new Error(`statisticField is required for ${statisticType} aggregation`);
    }
    if (statisticField) {
      assertValidIdentifier(statisticField, 'statisticField');
    }

    // Check if query is supported
    const querySupport = await this.checkQuerySupport(serviceUrl);
    if (!querySupport.supported) {
      throw new Error(querySupport.reason || 'This service does not support feature queries');
    }

    // Validate WHERE clause
    if (where) {
      const whereCheck = validateWhereClause(where);
      if (!whereCheck.valid) {
        throw new Error(`Invalid WHERE clause: ${whereCheck.error}`);
      }
    }

    // Enforce maximum limit
    const MAX_LIMIT = 20;
    const effectiveLimit = Math.min(Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10, MAX_LIMIT);

    // Resolve to a specific layer URL (handles MapServer roots without layer index)
    const queryUrl = await this.resolveLayerUrl(serviceUrl);

    // Build the outStatistics parameter
    // For count, we count the groupByField itself; for others, we use statisticField
    const statFieldName = statisticType === 'count' ? groupByField : statisticField!;
    const outStatFieldName = statisticType === 'count' ? 'count' : `${statisticType}_${statisticField}`;

    const outStatistics = [{
      statisticType: this.mapStatisticType(statisticType),
      onStatisticField: statFieldName,
      outStatisticFieldName: outStatFieldName,
    }];

    // Build query parameters
    const queryParams = new URLSearchParams({
      where: where || '1=1',
      groupByFieldsForStatistics: groupByField,
      outStatistics: JSON.stringify(outStatistics),
      orderByFields: `${outStatFieldName} ${sortDirection}`,
      returnGeometry: 'false',
      f: 'json',
    });

    // Add spatial filter if bbox provided
    if (bbox) {
      const [xmin, ymin, xmax, ymax] = bbox;
      queryParams.set('geometry', JSON.stringify({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } }));
      queryParams.set('geometryType', 'esriGeometryEnvelope');
      queryParams.set('spatialRel', 'esriSpatialRelIntersects');
    }

    // Use POST to avoid URL length issues with geometry + outStatistics JSON
    const response = await fetch(`${queryUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: queryParams.toString(),
    });
    if (!response.ok) {
      throw new Error(`Statistics query failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Check for ArcGIS error response
    if (data.error) {
      const errorMsg = data.error.message || data.error.details?.[0] || 'Unknown error';
      if (errorMsg.includes('outStatistics') || errorMsg.includes('not supported')) {
        throw new Error('This service does not support statistics queries. Try a different dataset.');
      }
      throw new Error(`Statistics query error: ${errorMsg}`);
    }

    // Extract features/attributes
    const features = data.features || [];
    const totalGroups = features.length;

    // Apply limit and format results
    const limitedFeatures = features.slice(0, effectiveLimit);
    const rows = limitedFeatures.map((f: { attributes: Record<string, unknown> }) => {
      const row: Record<string, unknown> = {};
      row[groupByField] = f.attributes[groupByField];
      row[statisticType] = f.attributes[outStatFieldName];
      return row;
    });

    return {
      rows,
      groupByField,
      statisticType,
      statisticField: statisticType !== 'count' ? statisticField : undefined,
      totalGroups,
      truncated: totalGroups > effectiveLimit,
    };
  }

  /**
   * Query features with full geometry returned (for spatial query source extraction).
   * Unlike queryFeatures, this uses a higher limit and always returns geometry.
   */
  async queryFeaturesWithGeometry(params: {
    serviceUrl: string;
    where?: string;
    bbox?: [number, number, number, number];
    limit?: number;
  }): Promise<GeoJSONFeature[]> {
    const { serviceUrl, where, bbox, limit = 200 } = params;

    const querySupport = await this.checkQuerySupport(serviceUrl);
    if (!querySupport.supported) {
      throw new Error(querySupport.reason || 'This service does not support feature queries');
    }

    // Validate WHERE clause
    if (where) {
      const whereCheck = validateWhereClause(where);
      if (!whereCheck.valid) {
        throw new Error(`Invalid WHERE clause: ${whereCheck.error}`);
      }
    }

    const queryUrl = await this.resolveLayerUrl(serviceUrl);
    const useGeoJson = querySupport.supportsGeoJson !== false;

    const queryParams = new URLSearchParams({
      where: where || '1=1',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      f: useGeoJson ? 'geojson' : 'json',
      resultRecordCount: limit.toString(),
    });

    if (bbox) {
      const [xmin, ymin, xmax, ymax] = bbox;
      queryParams.set('geometry', JSON.stringify({
        xmin, ymin, xmax, ymax,
        spatialReference: { wkid: 4326 },
      }));
      queryParams.set('geometryType', 'esriGeometryEnvelope');
      queryParams.set('spatialRel', 'esriSpatialRelIntersects');
    }

    // Use POST to avoid URL length limits with large bbox geometries
    const response = await fetch(`${queryUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: queryParams.toString(),
    });
    if (!response.ok) {
      throw new Error(`Feature query failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`Feature service error: ${data.error.message || data.error.details?.[0] || 'Unknown error'}`);
    }

    if (useGeoJson) {
      return (data.features || []) as GeoJSONFeature[];
    }
    return this.esriToGeoJSON(data.features || []);
  }

  /**
   * Query features using a polygon geometry as a spatial filter.
   * Used by spatial queries to find target features within a computed filter polygon.
   */
  async queryFeaturesWithPolygonFilter(params: {
    serviceUrl: string;
    polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    spatialRel: string;
    where?: string;
    limit?: number;
    returnCountOnly?: boolean;
  }): Promise<{ features: GeoJSONFeature[]; count: number }> {
    const { serviceUrl, polygon, spatialRel, where, limit = 500, returnCountOnly = false } = params;

    const querySupport = await this.checkQuerySupport(serviceUrl);
    if (!querySupport.supported) {
      throw new Error(querySupport.reason || 'This service does not support feature queries');
    }

    // Validate WHERE clause
    if (where) {
      const whereCheck = validateWhereClause(where);
      if (!whereCheck.valid) {
        throw new Error(`Invalid WHERE clause: ${whereCheck.error}`);
      }
    }

    const queryUrl = await this.resolveLayerUrl(serviceUrl);
    const useGeoJson = !returnCountOnly && querySupport.supportsGeoJson !== false;

    // Convert GeoJSON polygon to Esri rings format
    const rings = polygon.type === 'MultiPolygon'
      ? polygon.coordinates.flat()
      : polygon.coordinates;

    const esriGeometry = JSON.stringify({
      rings,
      spatialReference: { wkid: 4326 },
    });

    // Use POST to avoid URL length limits with large polygon geometries
    if (returnCountOnly) {
      const countParams = new URLSearchParams({
        where: where || '1=1',
        geometry: esriGeometry,
        geometryType: 'esriGeometryPolygon',
        spatialRel,
        inSR: '4326',
        returnCountOnly: 'true',
        f: 'json',
      });

      const response = await fetch(`${queryUrl}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: countParams.toString(),
      });
      if (!response.ok) {
        throw new Error(`Feature count query failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(`Feature count error: ${data.error.message || data.error.details?.[0] || 'Unknown error'}`);
      }

      return { features: [], count: data.count || 0 };
    }

    // Get features (count query is deferred — only needed when result is truncated)
    const queryParams = new URLSearchParams({
      where: where || '1=1',
      geometry: esriGeometry,
      geometryType: 'esriGeometryPolygon',
      spatialRel,
      inSR: '4326',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      f: useGeoJson ? 'geojson' : 'json',
      resultRecordCount: limit.toString(),
    });

    const response = await fetch(`${queryUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: queryParams.toString(),
    });
    if (!response.ok) {
      throw new Error(`Feature query failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`Feature service error: ${data.error.message || data.error.details?.[0] || 'Unknown error'}`);
    }

    let features: GeoJSONFeature[];
    if (useGeoJson) {
      features = (data.features || []) as GeoJSONFeature[];
    } else {
      features = this.esriToGeoJSON(data.features || []);
    }

    // Only fetch separate count if results were truncated (hit the limit)
    let count = features.length;
    if (features.length >= limit) {
      const countParams = new URLSearchParams({
        where: where || '1=1',
        geometry: esriGeometry,
        geometryType: 'esriGeometryPolygon',
        spatialRel,
        inSR: '4326',
        returnCountOnly: 'true',
        f: 'json',
      });

      const countResponse = await fetch(`${queryUrl}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: countParams.toString(),
      });
      if (countResponse.ok) {
        const countData = await countResponse.json();
        count = countData.count || features.length;
      }
    }

    return { features, count };
  }

  /**
   * Map our statistic type to ArcGIS statistic type.
   */
  private mapStatisticType(type: StatisticType): string {
    const mapping: Record<StatisticType, string> = {
      count: 'count',
      sum: 'sum',
      avg: 'avg',
      min: 'min',
      max: 'max',
    };
    return mapping[type];
  }
}

export const featureQueryService = new FeatureQueryService();
