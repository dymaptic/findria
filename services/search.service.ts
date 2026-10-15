/**
 * Search Service
 *
 * Provides semantic search over geospatial datasets with location-aware ranking.
 *
 * ## Search Workflow
 *
 * 1. **Query Parsing** (queryParserService)
 *    - Input: Natural language query (e.g., "schools in portland, or")
 *    - Output: Extracted topics ("schools"), location ("Portland, Oregon"), bbox, inferred data types
 *    - Uses Claude to parse the query intelligently
 *
 * 2. **Embedding Generation** (embeddingService)
 *    - Input: Topics only (NOT the location - to avoid boosting datasets just because they mention the location)
 *    - Output: 1536-dimension vector from OpenAI text-embedding-3-small
 *    - Example: "schools" → [0.012, -0.034, ...]
 *
 * 3. **Vector Search with Scoring**
 *    - Base score: Cosine similarity between query embedding and dataset embedding
 *    - Soft boosts (added to base score, don't filter):
 *      a. Data type boost (+0.05): If dataset's geometry type matches inferred type
 *      b. Overlap boost (0 to +0.15): Proportional to how much of the search bbox the
 *         dataset's extent covers. Calculated via bbox intersection ratio.
 *         - Full coverage → +0.15, half coverage → +0.075, no overlap → 0
 *         - Prevents neighboring-state datasets from ranking as highly as local ones
 *
 * 4. **Spatial Filtering**
 *    - If bbox provided (from parsed location or explicit), filter to datasets that intersect
 *    - Uses PostGIS ST_Intersects for efficient spatial queries
 *
 * 5. **Coverage Enrichment** (optional)
 *    - For datasets with H3 coverage index, count features within search bbox
 *    - Adds coverageInArea field to results
 *
 * 6. **Logging**
 *    - Anonymous search logging for analytics (non-blocking)
 *
 * ## Scoring Formula
 *
 * final_score = base_similarity + type_boost + overlap_boost + no_extent_penalty + location_name_boost
 *
 * Where:
 * - base_similarity: 1 - cosine_distance(query_embedding, dataset_embedding)
 * - type_boost: 0.05 if data_type matches inferred type, else 0
 * - overlap_boost: 0 to 0.15, proportional to how much of the search bbox the dataset covers
 *   (uses bbox intersection ratio — e.g., a TX dataset covering 50% of NM bbox gets 0.075)
 * - no_extent_penalty: -0.15 if searching with location but dataset has no extent, else 0
 *   (prevents datasets with unknown location from ranking highly in location-based searches)
 * - location_name_boost: +0.10 if dataset name contains the search location, +0.08 if org name does,
 *   +0.07 if tags mention it, +0.05 if description/snippet mentions it
 *   (helps "roads in North Carolina" find NC-named datasets over neighboring states)
 */

import { query } from '@/lib/db';
import { embeddingService } from './embedding.service';
import { queryParserService } from './query-parser.service';
import { searchLogger } from './search-logger.service';
import type { SearchRequest, SearchResult, Dataset, ParsedQuery } from '@/types';
import * as h3 from 'h3-js';

interface DatasetRow {
  id: string;
  source: string;
  source_id: string;
  name: string;
  description: string | null;
  snippet: string | null;
  tags: string[] | null;
  categories: string[] | null;
  data_type: string | null;
  extent_bbox: Record<string, number> | null;
  source_url: string;
  service_url: string | null;
  access_type: string;
  geoparquet_source_id: string | null;
  arcgis_item_id: string | null;
  arcgis_owner: string | null;
  arcgis_type: string | null;
  is_authoritative: boolean | null;
  org_display_name: string | null;
  schema: Record<string, unknown> | null;
  indexed_at: string;
  similarity: number;
}

export class SearchService {
  async search(
    request: SearchRequest,
    sessionHash?: string
  ): Promise<SearchResult> {
    const startTime = Date.now();

    // 1. Parse the natural language query
    const parsed = await queryParserService.parse(request.query);

    // 2. Determine effective bbox (from request or parsed location)
    const effectiveBbox = request.bbox || parsed.locationBbox;

    // 3. Generate embedding for semantic search
    // Include all original query words in the embedding, not just parser-extracted topics.
    // The parser may drop unknown terms (e.g., "lojic" → dropped when lowercase, kept when "LOJIC").
    // By preserving unrecognized words, proper nouns and acronyms still influence results.
    const embeddingStart = Date.now();
    const STOPWORDS = new Set(['a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'by', 'is', 'it', 'and', 'or', 'not', 'with', 'from', 'as', 'are', 'was', 'be', 'has', 'have', 'do', 'does', 'near', 'around', 'about', 'all', 'any', 'my', 'me', 'show', 'find', 'get', 'what', 'where', 'how', 'many', 'much', 'that', 'this', 'those', 'these']);
    const topicWords = new Set(parsed.topics.map(t => t.toLowerCase()));
    const locationWords = new Set((parsed.location || '').toLowerCase().split(/[\s,]+/).filter(Boolean));
    const queryWords = request.query.split(/\s+/).filter(w => w.length > 2);
    const unrecognizedWords = queryWords.filter(w =>
      !topicWords.has(w.toLowerCase()) && !locationWords.has(w.toLowerCase()) && !STOPWORDS.has(w.toLowerCase())
    );

    // Add unrecognized words to topics so they appear in search logs and UI
    if (unrecognizedWords.length > 0) {
      parsed.topics = [...parsed.topics, ...unrecognizedWords];
    }

    const embeddingText = parsed.topics.length > 0
      ? parsed.topics.join(' ')
      : request.query;
    const queryEmbedding = await embeddingService.embed(embeddingText);
    const embeddingDuration = Date.now() - embeddingStart;

    // 4. Build and execute search query
    const datasets = await this.executeSearch({
      embedding: queryEmbedding,
      bbox: effectiveBbox,
      sources: request.sources,
      dataTypes: request.dataTypes || parsed.dataTypes,
      limit: request.limit || 20,
      offset: request.offset || 0,
      location: parsed.location,
    });

    // 5. If bbox provided, enrich with coverage counts
    if (effectiveBbox) {
      await this.enrichWithCoverage(datasets, effectiveBbox);
    }

    const searchDuration = Date.now() - startTime;

    // 6. Log search anonymously (non-blocking)
    searchLogger
      .log({
        queryText: request.query,
        parsedTopics: parsed.topics,
        parsedLocation: parsed.location || undefined,
        parsedBbox: effectiveBbox || undefined,
        resultCount: datasets.length,
        topResultIds: datasets.slice(0, 5).map((d) => d.id),
        searchDurationMs: searchDuration,
        embeddingDurationMs: embeddingDuration,
        sessionHash,
      })
      .catch((err) => console.error('Search logging failed:', err));

    return {
      datasets,
      total: datasets.length,
      query: parsed,
    };
  }

  private async executeSearch(params: {
    embedding: number[];
    bbox?: [number, number, number, number] | null;
    sources?: string[];
    dataTypes?: string[];
    limit: number;
    offset: number;
    location?: string | null;
  }): Promise<Dataset[]> {
    // Build dynamic query parts
    const conditions: string[] = ['embedding IS NOT NULL'];
    const queryParams: unknown[] = [`[${params.embedding.join(',')}]`];
    let paramIndex = 2;

    if (params.sources && params.sources.length > 0) {
      conditions.push(`source = ANY($${paramIndex})`);
      queryParams.push(params.sources);
      paramIndex++;
    }

    // Data types used for soft boost (not filtering)
    const dataTypesParamIndex = paramIndex;
    queryParams.push(params.dataTypes && params.dataTypes.length > 0 ? params.dataTypes : null);
    paramIndex++;

    // Search bbox params (always push 5: area, xmin, ymin, xmax, ymax)
    const searchBboxAreaParamIndex = paramIndex;
    const bboxXminParamIndex = paramIndex + 1;
    const bboxYminParamIndex = paramIndex + 2;
    const bboxXmaxParamIndex = paramIndex + 3;
    const bboxYmaxParamIndex = paramIndex + 4;
    if (params.bbox) {
      const [xmin, ymin, xmax, ymax] = params.bbox;
      const searchBboxArea = (xmax - xmin) * (ymax - ymin);
      conditions.push(`
        (extent IS NULL OR ST_Intersects(
          extent,
          ST_MakeEnvelope($${bboxXminParamIndex}, $${bboxYminParamIndex}, $${bboxXmaxParamIndex}, $${bboxYmaxParamIndex}, 4326)
        ))
      `);
      queryParams.push(searchBboxArea, xmin, ymin, xmax, ymax);
    } else {
      queryParams.push(0, 0, 0, 0, 0);
    }
    paramIndex += 5;

    // Location name for name-matching boost
    const locationParamIndex = paramIndex;
    queryParams.push(params.location || null);
    paramIndex++;

    queryParams.push(params.limit, params.offset);

    // Scoring boosts and penalties (affect ranking but don't filter):
    // 1. type_boost: +0.05 if data_type matches inferred type
    // 2. overlap_boost: 0 to +0.15 proportional to bbox overlap ratio
    //    How much of the search area does this dataset actually cover?
    //    Replaces the old area-ratio heuristic with direct overlap measurement.
    // 3. no_extent_penalty: -0.15 if bbox is provided but dataset has no extent
    //    This penalizes datasets with unknown location when user is searching a specific area
    // 4. location_name_boost: +0.10 if dataset name mentions the search location,
    //    +0.08 if org name does, +0.05 if description/snippet does
    //    This helps surface datasets that are clearly about the searched location

    // Helper: SQL expression for overlap_boost (used in both SELECT and ORDER BY)
    // Two-factor scoring: coverage_ratio * focus_ratio * 0.15
    //   coverage_ratio = intersection_area / search_area (how much of the search area is covered)
    //   focus_ratio = min(search_area / dataset_area, 1.0) (how local/focused the dataset is)
    // This ensures worldwide datasets don't dominate local searches despite covering the area.
    // Note: extent_bbox is double-encoded (JSON string in JSONB), so we use #>>'{}'
    const overlapBoostExpr = `
      CASE
        WHEN $${searchBboxAreaParamIndex}::float = 0 THEN 0
        WHEN extent_bbox IS NULL THEN 0
        ELSE (
          SELECT LEAST(
            GREATEST(
              LEAST(ext_xmax, $${bboxXmaxParamIndex}::float) - GREATEST(ext_xmin, $${bboxXminParamIndex}::float),
              0
            ) * GREATEST(
              LEAST(ext_ymax, $${bboxYmaxParamIndex}::float) - GREATEST(ext_ymin, $${bboxYminParamIndex}::float),
              0
            ) / $${searchBboxAreaParamIndex}::float
            * LEAST($${searchBboxAreaParamIndex}::float / dataset_area, 1.0)
            * 0.15,
            0.15
          )
          FROM (
            SELECT
              ((extent_bbox#>>'{}')::jsonb->>'xmin')::float as ext_xmin,
              ((extent_bbox#>>'{}')::jsonb->>'ymin')::float as ext_ymin,
              ((extent_bbox#>>'{}')::jsonb->>'xmax')::float as ext_xmax,
              ((extent_bbox#>>'{}')::jsonb->>'ymax')::float as ext_ymax,
              GREATEST(
                (((extent_bbox#>>'{}')::jsonb->>'xmax')::float - ((extent_bbox#>>'{}')::jsonb->>'xmin')::float) *
                (((extent_bbox#>>'{}')::jsonb->>'ymax')::float - ((extent_bbox#>>'{}')::jsonb->>'ymin')::float),
                0.0001
              ) as dataset_area
          ) ext
        )
      END`;

    // Helper: SQL expression for location_name_boost
    const locationBoostExpr = `
      CASE
        WHEN $${locationParamIndex}::text IS NULL THEN 0
        WHEN name ILIKE '%' || $${locationParamIndex}::text || '%' THEN 0.10
        WHEN org_display_name ILIKE '%' || $${locationParamIndex}::text || '%' THEN 0.08
        WHEN array_to_string(tags, ' ') ILIKE '%' || $${locationParamIndex}::text || '%' THEN 0.07
        WHEN description ILIKE '%' || $${locationParamIndex}::text || '%' THEN 0.05
        WHEN snippet ILIKE '%' || $${locationParamIndex}::text || '%' THEN 0.05
        ELSE 0
      END`;

    const sql = `
      WITH vector_search AS (
        SELECT
          id,
          1 - (embedding <=> $1::vector) as base_similarity,
          -- Type boost: prefer matching geometry types
          CASE
            WHEN $${dataTypesParamIndex}::text[] IS NOT NULL AND data_type = ANY($${dataTypesParamIndex}::text[]) THEN 0.05
            ELSE 0
          END as type_boost,
          -- Overlap boost: how much of the search area does this dataset cover?
          ${overlapBoostExpr} as overlap_boost,
          -- No-extent penalty: penalize datasets with unknown location for location-based searches
          CASE
            WHEN $${searchBboxAreaParamIndex}::float = 0 THEN 0
            WHEN extent IS NULL THEN -0.15
            ELSE 0
          END as no_extent_penalty,
          -- Location name boost: reward datasets that mention the searched location
          ${locationBoostExpr} as location_name_boost
        FROM datasets
        WHERE ${conditions.join(' AND ')}
        ORDER BY (1 - (embedding <=> $1::vector)) +
          CASE WHEN $${dataTypesParamIndex}::text[] IS NOT NULL AND data_type = ANY($${dataTypesParamIndex}::text[]) THEN 0.05 ELSE 0 END +
          ${overlapBoostExpr} +
          CASE WHEN $${searchBboxAreaParamIndex}::float > 0 AND extent IS NULL THEN -0.15 ELSE 0 END +
          ${locationBoostExpr}
          DESC
        LIMIT 200
      )
      SELECT
        d.id, d.source, d.source_id, d.name, d.description, d.snippet,
        d.tags, d.categories, d.data_type, d.extent_bbox,
        d.source_url, d.service_url, d.access_type,
        d.geoparquet_source_id, d.arcgis_item_id, d.arcgis_owner, d.arcgis_type,
        d.is_authoritative, d.org_display_name, d.schema, d.indexed_at,
        vs.base_similarity + vs.type_boost + vs.overlap_boost + vs.no_extent_penalty + vs.location_name_boost as similarity
      FROM datasets d
      JOIN vector_search vs ON d.id = vs.id
      ORDER BY vs.base_similarity + vs.type_boost + vs.overlap_boost + vs.no_extent_penalty + vs.location_name_boost DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const result = await query<DatasetRow>(sql, queryParams);
    return result.map(this.mapRowToDataset);
  }

  private async enrichWithCoverage(
    datasets: Dataset[],
    bbox: [number, number, number, number]
  ): Promise<void> {
    // Get H3 cells that intersect the bbox
    const [xmin, ymin, xmax, ymax] = bbox;
    const polygon: [number, number][] = [
      [ymin, xmin],
      [ymax, xmin],
      [ymax, xmax],
      [ymin, xmax],
      [ymin, xmin],
    ];

    let h3Cells: string[];
    try {
      h3Cells = h3.polygonToCells(polygon, 2);
    } catch {
      // If polygon is too small or invalid, skip coverage enrichment
      return;
    }

    if (h3Cells.length === 0) return;

    // Convert H3 strings to BigInts for database query
    const h3Indexes = h3Cells.map((cell) => BigInt('0x' + cell));

    // Query coverage for these cells and datasets
    const coverageResult = await query<{ dataset_id: string; total_count: string }>(
      `
      SELECT dataset_id, SUM(feature_count)::text as total_count
      FROM coverage
      WHERE dataset_id = ANY($1)
        AND h3_index = ANY($2)
      GROUP BY dataset_id
    `,
      [
        datasets.map((d) => d.id),
        h3Indexes.map((i) => i.toString()),
      ]
    );

    // Merge coverage into datasets
    const coverageMap = new Map(
      coverageResult.map((r) => [r.dataset_id, parseInt(r.total_count, 10)])
    );

    for (const dataset of datasets) {
      dataset.coverageInArea = coverageMap.get(dataset.id) || undefined;
    }
  }

  private mapRowToDataset(row: DatasetRow): Dataset {
    // Parse extent_bbox - it may come as a JSON string from the database
    let extentBbox: Dataset['extentBbox'] = null;
    if (row.extent_bbox) {
      try {
        extentBbox = typeof row.extent_bbox === 'string'
          ? JSON.parse(row.extent_bbox)
          : row.extent_bbox;
      } catch {
        extentBbox = null;
      }
    }

    return {
      id: row.id,
      source: row.source as Dataset['source'],
      sourceId: row.source_id,
      name: row.name,
      description: row.description,
      snippet: row.snippet,
      tags: row.tags || [],
      categories: row.categories || [],
      dataType: row.data_type as Dataset['dataType'],
      extentBbox,
      sourceUrl: row.source_url,
      serviceUrl: row.service_url,
      accessType: row.access_type as Dataset['accessType'],
      geoparquetSourceId: row.geoparquet_source_id || undefined,
      arcgisItemId: row.arcgis_item_id || undefined,
      arcgisOwner: row.arcgis_owner || undefined,
      arcgisType: row.arcgis_type || undefined,
      isAuthoritative: row.is_authoritative || false,
      orgDisplayName: row.org_display_name || undefined,
      schema: (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Dataset['schema'] || undefined,
      relevanceScore: row.similarity,
      indexedAt: row.indexed_at,
    };
  }
}

export const searchService = new SearchService();
