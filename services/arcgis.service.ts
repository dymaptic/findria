import type { PreviewResponse, GeoJSONFeature } from '@/types';
import { SUPPORTED_SERVICE_TYPES, ARCGIS_ONLINE_BASE } from './indexing.service';
import { safeFetch } from '@/lib/safe-fetch';

/**
 * Fetch policy:
 * - Service URLs (queryFeatures, getFeatureCount) come from the datasets table
 *   and may be user-submitted, so they go through safeFetch (DNS + private-IP
 *   checks on every redirect hop, timeout).
 * - Calls to the fixed ArcGIS Online sharing API (ARCGIS_ONLINE_BASE) target a
 *   trusted constant host with user input only in query params / an encoded
 *   path segment, so they use plain fetch.
 */
const SERVICE_QUERY_TIMEOUT_MS = 30_000;

export interface ArcGISOnlineSearchResult {
  id: string;
  title: string;
  snippet: string | null;
  type: string;
  owner: string;
  url: string | null;
  tags: string[];
  numViews: number;
  thumbnail: string | null;
}

export class ArcGISService {
  async searchLivingAtlas(
    start: number = 0,
    num: number = 100
  ): Promise<{
    results: Record<string, unknown>[];
    total: number;
    nextStart: number;
  }> {
    const params = new URLSearchParams({
      q: 'owner:esri_livingatlas',
      f: 'json',
      start: start.toString(),
      num: num.toString(),
      sortField: 'modified',
      sortOrder: 'desc',
    });

    const response = await fetch(`${ARCGIS_ONLINE_BASE}/search?${params}`);
    const data = await response.json();

    return {
      results: data.results,
      total: data.total,
      nextStart: data.nextStart,
    };
  }

  async getItemDetails(itemId: string): Promise<Record<string, unknown>> {
    const response = await fetch(
      `${ARCGIS_ONLINE_BASE}/content/items/${encodeURIComponent(itemId)}?f=json`
    );
    return response.json();
  }

  async queryFeatures(
    serviceUrl: string,
    bbox: [number, number, number, number],
    limit: number
  ): Promise<PreviewResponse> {
    const [xmin, ymin, xmax, ymax] = bbox;

    // Ensure URL ends with layer index (default to /0 if not specified)
    let queryUrl = serviceUrl;
    if (!queryUrl.match(/\/\d+$/)) {
      // If URL doesn't end with a layer index, append /0
      queryUrl = queryUrl.replace(/\/?$/, '/0');
    }

    // Try GeoJSON first, fall back to JSON if it fails
    let features: GeoJSONFeature[] = [];
    let querySucceeded = false;

    // Helper to check if error is pagination-related
    const isPaginationError = (error: { message?: string; details?: string[] }): boolean => {
      const msg = (error.message || '').toLowerCase();
      const details = (error.details || []).join(' ').toLowerCase();
      return msg.includes('pagination') || details.includes('pagination') ||
             msg.includes('resultrecordcount') || details.includes('resultrecordcount');
    };

    // Attempt 1: GeoJSON format (preferred)
    const geojsonParams = new URLSearchParams({
      where: '1=1',
      geometry: JSON.stringify({
        xmin,
        ymin,
        xmax,
        ymax,
        spatialReference: { wkid: 4326 },
      }),
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'geojson',
      resultRecordCount: limit.toString(),
    });

    const geojsonResponse = await safeFetch(`${queryUrl}/query?${geojsonParams}`, { timeoutMs: SERVICE_QUERY_TIMEOUT_MS });
    if (geojsonResponse.ok) {
      const data = await geojsonResponse.json();
      if (!data.error && data.features) {
        features = data.features as GeoJSONFeature[];
        querySucceeded = true;
      } else if (data.error && isPaginationError(data.error)) {
        // Retry GeoJSON without pagination
        geojsonParams.delete('resultRecordCount');
        const retryResponse = await safeFetch(`${queryUrl}/query?${geojsonParams}`, { timeoutMs: SERVICE_QUERY_TIMEOUT_MS });
        if (retryResponse.ok) {
          const retryData = await retryResponse.json();
          if (!retryData.error && retryData.features) {
            features = (retryData.features as GeoJSONFeature[]).slice(0, limit);
            querySucceeded = true;
          }
        }
      }
    }

    // Attempt 2: JSON format with manual conversion (fallback for older services)
    if (!querySucceeded) {
      const jsonParams = new URLSearchParams({
        where: '1=1',
        geometry: `${xmin},${ymin},${xmax},${ymax}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
        f: 'json',
        resultRecordCount: limit.toString(),
      });

      let jsonResponse = await safeFetch(`${queryUrl}/query?${jsonParams}`, { timeoutMs: SERVICE_QUERY_TIMEOUT_MS });
      let jsonData: { error?: { message?: string; details?: string[] }; features?: unknown[] } | null = null;

      if (jsonResponse.ok) {
        jsonData = await jsonResponse.json();

        // If pagination not supported, retry without resultRecordCount
        if (jsonData?.error && isPaginationError(jsonData.error)) {
          jsonParams.delete('resultRecordCount');
          jsonResponse = await safeFetch(`${queryUrl}/query?${jsonParams}`, { timeoutMs: SERVICE_QUERY_TIMEOUT_MS });
          if (jsonResponse.ok) {
            jsonData = await jsonResponse.json();
          }
        }
      }

      if (!jsonResponse.ok) {
        // Try to get error details from response body
        let errorDetail = '';
        try {
          const errorBody = await jsonResponse.json();
          errorDetail = errorBody.error?.message || errorBody.error?.details?.[0] || '';
        } catch {
          // Could not parse error body
        }
        throw new Error(`Feature service query failed: ${jsonResponse.status}${errorDetail ? ` - ${errorDetail}` : ''}`);
      }

      if (!jsonData) {
        jsonData = await jsonResponse.json();
      }

      if (jsonData?.error) {
        throw new Error(`Feature service error: ${jsonData.error.message || jsonData.error.details?.[0] || 'Unknown error'}`);
      }

      // Convert Esri JSON to GeoJSON (slice to limit if pagination wasn't supported)
      const esriFeatures = jsonData?.features || [];
      features = this.convertEsriToGeoJSON(esriFeatures.slice(0, limit) as Array<{
        attributes?: Record<string, unknown>;
        geometry?: {
          x?: number;
          y?: number;
          points?: number[][];
          paths?: number[][][];
          rings?: number[][][];
        };
      }>);
      querySucceeded = true;
    }

    // Get count separately (always use JSON format for count)
    let totalCount = features.length;
    try {
      const countParams = new URLSearchParams({
        where: '1=1',
        geometry: `${xmin},${ymin},${xmax},${ymax}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        returnCountOnly: 'true',
        f: 'json',
      });

      const countResponse = await safeFetch(`${queryUrl}/query?${countParams}`, { timeoutMs: SERVICE_QUERY_TIMEOUT_MS });
      if (countResponse.ok) {
        const countData = await countResponse.json();
        if (!countData.error && typeof countData.count === 'number') {
          totalCount = countData.count;
        }
      }
    } catch {
      // Count query failed, use feature count as fallback
    }

    return {
      type: 'FeatureCollection',
      features,
      totalCount,
      truncated: features.length >= limit,
    };
  }

  /**
   * Convert Esri JSON features to GeoJSON format
   */
  private convertEsriToGeoJSON(esriFeatures: Array<{
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
      let geometry: GeoJSONFeature['geometry'] = { type: 'Point', coordinates: [0, 0] };

      if (feature.geometry) {
        const geom = feature.geometry;
        if (geom.x !== undefined && geom.y !== undefined) {
          // Point
          geometry = { type: 'Point', coordinates: [geom.x, geom.y] };
        } else if (geom.points) {
          // MultiPoint
          geometry = { type: 'MultiPoint', coordinates: geom.points };
        } else if (geom.paths) {
          // Polyline
          geometry = geom.paths.length === 1
            ? { type: 'LineString', coordinates: geom.paths[0] }
            : { type: 'MultiLineString', coordinates: geom.paths };
        } else if (geom.rings) {
          // Polygon (simplified - doesn't handle holes properly)
          geometry = geom.rings.length === 1
            ? { type: 'Polygon', coordinates: geom.rings }
            : { type: 'MultiPolygon', coordinates: geom.rings.map(ring => [ring]) };
        }
      }

      return {
        type: 'Feature' as const,
        geometry,
        properties: feature.attributes || {},
      };
    });
  }

  async searchArcGISOnline(options: {
    keywords: string;
    bbox?: [number, number, number, number];
    num?: number;
  }): Promise<{ results: ArcGISOnlineSearchResult[]; total: number }> {
    const { keywords, bbox, num = 25 } = options;
    const clampedNum = Math.min(num, 50);

    const typeFilter = SUPPORTED_SERVICE_TYPES.map((t) => `type:"${t}"`).join(' OR ');
    const query = `${keywords} (${typeFilter}) access:public`;

    const params = new URLSearchParams({
      q: query,
      f: 'json',
      start: '1',
      num: clampedNum.toString(),
      sortField: 'numViews',
      sortOrder: 'desc',
    });

    if (bbox) {
      params.set('bbox', bbox.join(','));
    }

    const response = await fetch(`${ARCGIS_ONLINE_BASE}/search?${params}`);
    const data = await response.json();

    const results: ArcGISOnlineSearchResult[] = (data.results || []).map(
      (item: Record<string, unknown>) => ({
        id: item.id as string,
        title: item.title as string,
        snippet: (item.snippet as string) || null,
        type: item.type as string,
        owner: item.owner as string,
        url: (item.url as string) || null,
        tags: (item.tags as string[]) || [],
        numViews: (item.numViews as number) || 0,
        thumbnail: item.thumbnail
          ? `${ARCGIS_ONLINE_BASE}/content/items/${item.id}/info/${item.thumbnail}`
          : null,
      })
    );

    return {
      results,
      total: data.total || 0,
    };
  }

  async getFeatureCount(
    serviceUrl: string,
    polygon: [number, number][]
  ): Promise<number> {
    const params = new URLSearchParams({
      where: '1=1',
      geometry: JSON.stringify({
        rings: [polygon],
        spatialReference: { wkid: 4326 },
      }),
      geometryType: 'esriGeometryPolygon',
      spatialRel: 'esriSpatialRelIntersects',
      returnCountOnly: 'true',
      f: 'json',
    });

    const response = await safeFetch(`${serviceUrl}/query?${params}`, { timeoutMs: SERVICE_QUERY_TIMEOUT_MS });
    const data = await response.json();

    return data.count || 0;
  }
}

export const arcgisService = new ArcGISService();
