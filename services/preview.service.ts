import { arcgisService } from './arcgis.service';
import { geoParquetService } from './geoparquet.service';
import { queryOne } from '@/lib/db';
import { assertPublicUrl } from '@/lib/safe-fetch';
import type { PreviewResponse } from '@/types';

interface DatasetRow {
  id: string;
  source: string;
  source_id: string;
  service_url: string | null;
  geoparquet_source_id: string | null;
  supports_coverage_query: boolean;
  arcgis_type: string | null;
}

/** Default preview cache bounds. */
export const PREVIEW_CACHE_MAX_ENTRIES = 200;
export const PREVIEW_CACHE_TTL_MS = 60_000;

/**
 * Small LRU cache with per-entry TTL. Map insertion order is used as recency
 * order: hits are re-inserted at the end; inserts evict expired entries and
 * then the least-recently-used ones until size <= maxEntries.
 */
export class LruTtlCache<V> {
  private map = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number
  ) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    if (entry.expires <= Date.now()) return undefined;
    this.map.set(key, entry); // mark most recently used
    return entry.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    if (this.map.size > this.maxEntries) {
      this.evictExpired();
      const it = this.map.keys();
      while (this.map.size > this.maxEntries) {
        const oldest = it.next();
        if (oldest.done) break;
        this.map.delete(oldest.value);
      }
    }
  }

  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expires <= now) this.map.delete(key);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

export class PreviewService {
  private cache = new LruTtlCache<PreviewResponse>(PREVIEW_CACHE_MAX_ENTRIES, PREVIEW_CACHE_TTL_MS);

  async getPreview(
    datasetId: string,
    bbox: [number, number, number, number],
    limit: number = 100
  ): Promise<PreviewResponse> {
    // Check cache
    const cacheKey = `${datasetId}-${bbox.join(',')}-${limit}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Get dataset info
    const dataset = await queryOne<DatasetRow>(
      'SELECT id, source, source_id, service_url, geoparquet_source_id, supports_coverage_query, arcgis_type FROM datasets WHERE id = $1',
      [datasetId]
    );

    if (!dataset) {
      throw new Error('Dataset not found');
    }

    let preview: PreviewResponse;

    if (dataset.service_url) {
      // service_url may come from a user submission. Fail fast with a clear
      // error if it no longer resolves publicly; arcgisService then uses
      // safeFetch, which re-validates every request and redirect hop.
      await assertPublicUrl(dataset.service_url);

      // Query ArcGIS Feature Service
      preview = await arcgisService.queryFeatures(
        dataset.service_url,
        bbox,
        limit
      );
    } else if (dataset.geoparquet_source_id) {
      // Query GeoParquet via DuckDB
      preview = await geoParquetService.queryFeatures(
        dataset.geoparquet_source_id,
        bbox,
        limit
      );
    } else {
      throw new Error('Preview not available for this dataset');
    }

    // Cache for PREVIEW_CACHE_TTL_MS (bounded LRU)
    this.cache.set(cacheKey, preview);

    return preview;
  }

  /**
   * Get real-time feature count for GeoParquet sources
   */
  async getRealtimeCount(
    datasetId: string,
    bbox: [number, number, number, number]
  ): Promise<number | null> {
    const dataset = await queryOne<DatasetRow>(
      'SELECT geoparquet_source_id, supports_coverage_query FROM datasets WHERE id = $1',
      [datasetId]
    );

    if (!dataset?.geoparquet_source_id || !dataset.supports_coverage_query) {
      return null;
    }

    return geoParquetService.getCountForBbox(dataset.geoparquet_source_id, bbox);
  }

  /**
   * Clear expired cache entries
   */
  cleanupCache(): void {
    this.cache.evictExpired();
  }
}

export const previewService = new PreviewService();
