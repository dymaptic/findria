import { Database } from 'duckdb-async';
import type { GeoParquetSource, PreviewResponse } from '@/types';
import type { StatisticType, StatisticsResult } from '@/types/chat';
import {
  validateWhereClause,
  assertValidIdentifier,
  assertStatisticType,
  normalizeSortDirection,
  toFiniteNumber,
  clampLimit,
} from '@/lib/sql-guard';

// Registry of configured GeoParquet sources
export const GEOPARQUET_SOURCES: GeoParquetSource[] = [
  // Overture Buildings
  {
    id: 'overture-buildings',
    name: 'Overture Buildings',
    description: 'Global building footprints from Microsoft, Google, OpenStreetMap. 2.3B+ buildings.',
    urlPattern: 'az://release/2026-02-18.0/theme=buildings/type=building/*',
    columns: {
      id: 'id',
      geometry: 'geometry',
      name: 'names.primary',
      bbox: { xmin: 'bbox.xmin', ymin: 'bbox.ymin', xmax: 'bbox.xmax', ymax: 'bbox.ymax' },
    },
    s3Region: 'us-west-2',
    supportsRealtimeCount: true,
    attribution: 'Overture Maps Foundation',
    license: 'ODbL',
    sourceUrl: 'https://docs.overturemaps.org/',
    dataType: 'polygon',
  },
  {
    id: 'overture-places',
    name: 'Overture Places',
    description: 'Points of interest including businesses, landmarks, amenities. 100M+ places.',
    urlPattern: 'az://release/2026-02-18.0/theme=places/type=place/*',
    columns: {
      id: 'id',
      geometry: 'geometry',
      name: 'names.primary',
      bbox: { xmin: 'bbox.xmin', ymin: 'bbox.ymin', xmax: 'bbox.xmax', ymax: 'bbox.ymax' },
    },
    s3Region: 'us-west-2',
    supportsRealtimeCount: true,
    attribution: 'Overture Maps Foundation',
    license: 'ODbL',
    sourceUrl: 'https://docs.overturemaps.org/',
    dataType: 'point',
  },
  {
    id: 'overture-transportation',
    name: 'Overture Transportation',
    description: 'Global road network with classification and connectivity.',
    urlPattern: 'az://release/2026-02-18.0/theme=transportation/type=segment/*',
    columns: {
      id: 'id',
      geometry: 'geometry',
      name: 'names.primary',
      bbox: { xmin: 'bbox.xmin', ymin: 'bbox.ymin', xmax: 'bbox.xmax', ymax: 'bbox.ymax' },
    },
    s3Region: 'us-west-2',
    supportsRealtimeCount: true,
    attribution: 'Overture Maps Foundation',
    license: 'ODbL',
    sourceUrl: 'https://docs.overturemaps.org/',
    dataType: 'line',
  },
  {
    id: 'overture-addresses',
    name: 'Overture Addresses',
    description: 'Global address points with structured components.',
    urlPattern: 'az://release/2026-02-18.0/theme=addresses/type=address/*',
    columns: {
      id: 'id',
      geometry: 'geometry',
      bbox: { xmin: 'bbox.xmin', ymin: 'bbox.ymin', xmax: 'bbox.xmax', ymax: 'bbox.ymax' },
    },
    s3Region: 'us-west-2',
    supportsRealtimeCount: true,
    attribution: 'Overture Maps Foundation',
    license: 'ODbL + CDLA',
    sourceUrl: 'https://docs.overturemaps.org/',
    dataType: 'point',
  },
  {
    id: 'overture-divisions',
    name: 'Overture Administrative Divisions',
    description: 'Administrative boundaries - countries, states, counties, municipalities.',
    urlPattern: 'az://release/2026-02-18.0/theme=divisions/type=division_area/*',
    columns: {
      id: 'id',
      geometry: 'geometry',
      name: 'names.primary',
      bbox: { xmin: 'bbox.xmin', ymin: 'bbox.ymin', xmax: 'bbox.xmax', ymax: 'bbox.ymax' },
    },
    s3Region: 'us-west-2',
    supportsRealtimeCount: true,
    attribution: 'Overture Maps Foundation',
    license: 'ODbL',
    sourceUrl: 'https://docs.overturemaps.org/',
    dataType: 'polygon',
  },
  {
    id: 'overture-water',
    name: 'Overture Water Features',
    description: 'Water bodies including lakes, rivers, and coastlines.',
    urlPattern: 'az://release/2026-02-18.0/theme=base/type=water/*',
    columns: {
      id: 'id',
      geometry: 'geometry',
      name: 'names.primary',
      bbox: { xmin: 'bbox.xmin', ymin: 'bbox.ymin', xmax: 'bbox.xmax', ymax: 'bbox.ymax' },
    },
    s3Region: 'us-west-2',
    supportsRealtimeCount: true,
    attribution: 'Overture Maps Foundation',
    license: 'ODbL',
    sourceUrl: 'https://docs.overturemaps.org/',
    dataType: 'polygon',
  },
];

// Default timeout for DuckDB queries (in milliseconds).
// Azure App Service has a hard 230s request timeout. Individual DuckDB queries
// must complete well within that budget since a chat request may invoke multiple tools.
const DUCKDB_QUERY_TIMEOUT_MS = 60_000; // 60 seconds

// Upper bound for any LIMIT interpolated into DuckDB SQL
const MAX_FEATURE_LIMIT = 5000;

type Bbox = [number, number, number, number];

/**
 * Coerce a bbox to four finite numbers so values interpolated into SQL can
 * never carry anything but a numeric literal.
 */
function normalizeBbox(bbox: unknown): Bbox {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    throw new Error('Invalid bbox: expected [xmin, ymin, xmax, ymax]');
  }
  return bbox.map((v, i) => toFiniteNumber(v, `bbox[${i}]`)) as Bbox;
}

export class GeoParquetService {
  private dbPromise: Promise<Database> | null = null;

  private getDb(): Promise<Database> {
    // Memoize the init promise so concurrent callers share one initialization
    // (a second init would fail once the configuration is locked).
    if (!this.dbPromise) {
      this.dbPromise = this.initDb().catch((err) => {
        this.dbPromise = null;
        throw err;
      });
    }
    return this.dbPromise;
  }

  private async initDb(): Promise<Database> {
    const db = await Database.create(':memory:');
    await db.exec(`
      INSTALL spatial;
      INSTALL azure;
      LOAD spatial;
      LOAD azure;
      SET azure_transport_option_type = 'curl';
      CREATE SECRET (TYPE azure, PROVIDER config, ACCOUNT_NAME 'overturemapswestus2');
      SET enable_object_cache=true;
    `);
    // Defence in depth, applied AFTER extensions are loaded and the secret is
    // configured: block local file access (read_text('/etc/passwd'), COPY TO,
    // ATTACH, INSTALL from disk) and freeze configuration so injected SQL can't
    // re-enable it. Remote az:// reads go through the azure extension's own
    // filesystem and are unaffected. Note: with LocalFileSystem disabled,
    // DuckDB cannot spill to a temp directory or auto-install new extensions.
    await db.exec(`
      SET disabled_filesystems = 'LocalFileSystem';
      SET allow_community_extensions = false;
      SET lock_configuration = true;
    `);
    return db;
  }

  /**
   * Run a DuckDB query with a timeout. If the query exceeds the timeout,
   * reject with a descriptive error so the caller (Claude) can adjust.
   */
  private async queryWithTimeout(
    db: Database,
    sql: string,
    params: unknown[] = [],
    timeoutMs: number = DUCKDB_QUERY_TIMEOUT_MS
  ): Promise<Record<string, unknown>[]> {
    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(
          `DuckDB query timed out after ${Math.round(timeoutMs / 1000)}s. ` +
          `The dataset may be too large for this bounding box. Try a smaller area or skip this data source.`
        ));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([
        db.all(sql, ...params),
        timeoutPromise,
      ]);
      return result;
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Query features from any registered GeoParquet source
   */
  async queryFeatures(
    sourceId: string,
    bbox: [number, number, number, number],
    limitInput: number = 100
  ): Promise<PreviewResponse> {
    const source = GEOPARQUET_SOURCES.find((s) => s.id === sourceId);
    if (!source) {
      throw new Error(`Unknown GeoParquet source: ${sourceId}`);
    }

    const [xmin, ymin, xmax, ymax] = normalizeBbox(bbox);
    const limit = clampLimit(limitInput, 100, MAX_FEATURE_LIMIT);
    const db = await this.getDb();

    // Build WHERE clause based on available bbox columns
    const whereClause = source.columns.bbox
      ? `${source.columns.bbox.xmin} <= ${xmax}
         AND ${source.columns.bbox.xmax} >= ${xmin}
         AND ${source.columns.bbox.ymin} <= ${ymax}
         AND ${source.columns.bbox.ymax} >= ${ymin}`
      : `ST_Intersects(${source.columns.geometry},
         ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}))`;

    // Build SELECT with optional name column
    const nameSelect = source.columns.name
      ? `, ${source.columns.name} as name`
      : '';

    const query = `
      SELECT
        ${source.columns.id} as id
        ${nameSelect},
        ST_AsGeoJSON(${source.columns.geometry}) as geojson
      FROM read_parquet('${source.urlPattern}', hive_partitioning=1)
      WHERE ${whereClause}
      LIMIT ${limit}
    `;

    const result = await this.queryWithTimeout(db, query);

    const features = result.map((row: Record<string, unknown>) => ({
      type: 'Feature' as const,
      geometry: JSON.parse(row.geojson as string),
      properties: {
        id: row.id,
        name: row.name || null,
        source: source.id,
        attribution: source.attribution,
      },
    }));

    return {
      type: 'FeatureCollection',
      features,
      source: {
        id: source.id,
        name: source.name,
        attribution: source.attribution,
        license: source.license,
      },
      truncated: features.length >= limit,
    };
  }

  /**
   * Get count of features in bbox (for search result enrichment)
   */
  async getCountForBbox(
    sourceId: string,
    bbox: [number, number, number, number]
  ): Promise<number | null> {
    const source = GEOPARQUET_SOURCES.find((s) => s.id === sourceId);
    if (!source || !source.supportsRealtimeCount) {
      return null;
    }

    const [xmin, ymin, xmax, ymax] = normalizeBbox(bbox);
    const db = await this.getDb();

    const whereClause = source.columns.bbox
      ? `${source.columns.bbox.xmin} <= ${xmax}
         AND ${source.columns.bbox.xmax} >= ${xmin}
         AND ${source.columns.bbox.ymin} <= ${ymax}
         AND ${source.columns.bbox.ymax} >= ${ymin}`
      : `ST_Intersects(${source.columns.geometry},
         ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}))`;

    const countSql = `
      SELECT COUNT(*) as count
      FROM read_parquet('${source.urlPattern}', hive_partitioning=1)
      WHERE ${whereClause}
    `;
    const result = await this.queryWithTimeout(db, countSql);

    // DuckDB returns BigInt for COUNT - convert to Number for JSON serialization
    const count = (result[0] as { count: bigint | number })?.count;
    return count !== undefined ? Number(count) : 0;
  }

  /**
   * Get all registered sources (for indexing into datasets table)
   */
  getSources(): GeoParquetSource[] {
    return GEOPARQUET_SOURCES;
  }

  /**
   * Get a specific source by ID
   */
  getSource(sourceId: string): GeoParquetSource | undefined {
    return GEOPARQUET_SOURCES.find((s) => s.id === sourceId);
  }

  /**
   * Query Overture Places with optional category filter
   * Categories include: hospital, restaurant, school, hotel, bank, pharmacy, etc.
   */
  async queryPlaces(
    bbox: [number, number, number, number],
    options: {
      category?: string;
      nameContains?: string;
      limit?: number;
    } = {}
  ): Promise<PreviewResponse> {
    const source = GEOPARQUET_SOURCES.find((s) => s.id === 'overture-places');
    if (!source) {
      throw new Error('Overture Places source not configured');
    }

    const [xmin, ymin, xmax, ymax] = normalizeBbox(bbox);
    const limit = clampLimit(options.limit, 100, MAX_FEATURE_LIMIT);
    const params: string[] = [];

    // Build WHERE clause
    const conditions: string[] = [
      `${source.columns.bbox!.xmin} <= ${xmax}`,
      `${source.columns.bbox!.xmax} >= ${xmin}`,
      `${source.columns.bbox!.ymin} <= ${ymax}`,
      `${source.columns.bbox!.ymax} >= ${ymin}`,
    ];

    // Category filter (Overture uses categories.primary and categories.alternate).
    // User input is passed as a bound parameter, never interpolated into SQL.
    if (options.category) {
      const cat = String(options.category).toLowerCase();
      conditions.push(`(
        contains(LOWER(categories.primary), ?)
        OR contains(LOWER(list_aggregate(categories.alternate, 'string_agg', ',')), ?)
      )`);
      params.push(cat, cat);
    }

    // Name filter (bound parameter)
    if (options.nameContains) {
      conditions.push(`contains(LOWER(names.primary), ?)`);
      params.push(String(options.nameContains).toLowerCase());
    }

    const whereClause = conditions.join(' AND ');
    const db = await this.getDb();

    const query = `
      SELECT
        id,
        names.primary as name,
        categories.primary as category,
        ST_AsGeoJSON(geometry) as geojson
      FROM read_parquet('${source.urlPattern}', hive_partitioning=1)
      WHERE ${whereClause}
      LIMIT ${limit}
    `;

    const result = await this.queryWithTimeout(db, query, params);

    const features = result.map((row: Record<string, unknown>) => ({
      type: 'Feature' as const,
      geometry: JSON.parse(row.geojson as string),
      properties: {
        id: row.id,
        name: row.name || null,
        category: row.category || null,
        source: 'overture-places',
        attribution: source.attribution,
      },
    }));

    return {
      type: 'FeatureCollection',
      features,
      source: {
        id: source.id,
        name: source.name,
        attribution: source.attribution,
        license: source.license,
      },
      truncated: features.length >= limit,
    };
  }

  /**
   * Query Overture Buildings within a bbox
   */
  async queryBuildings(
    bbox: [number, number, number, number],
    options: {
      nameContains?: string;
      limit?: number;
    } = {}
  ): Promise<PreviewResponse> {
    const source = GEOPARQUET_SOURCES.find((s) => s.id === 'overture-buildings');
    if (!source) {
      throw new Error('Overture Buildings source not configured');
    }

    const [xmin, ymin, xmax, ymax] = normalizeBbox(bbox);
    const limit = clampLimit(options.limit, 100, MAX_FEATURE_LIMIT);
    const params: string[] = [];

    const conditions: string[] = [
      `${source.columns.bbox!.xmin} <= ${xmax}`,
      `${source.columns.bbox!.xmax} >= ${xmin}`,
      `${source.columns.bbox!.ymin} <= ${ymax}`,
      `${source.columns.bbox!.ymax} >= ${ymin}`,
    ];

    if (options.nameContains) {
      conditions.push(`contains(LOWER(names.primary), ?)`);
      params.push(String(options.nameContains).toLowerCase());
    }

    const whereClause = conditions.join(' AND ');
    const db = await this.getDb();

    const query = `
      SELECT
        id,
        names.primary as name,
        ST_AsGeoJSON(geometry) as geojson
      FROM read_parquet('${source.urlPattern}', hive_partitioning=1)
      WHERE ${whereClause}
      LIMIT ${limit}
    `;

    const result = await this.queryWithTimeout(db, query, params);

    const features = result.map((row: Record<string, unknown>) => ({
      type: 'Feature' as const,
      geometry: JSON.parse(row.geojson as string),
      properties: {
        id: row.id,
        name: row.name || null,
        source: 'overture-buildings',
        attribution: source.attribution,
      },
    }));

    return {
      type: 'FeatureCollection',
      features,
      source: {
        id: source.id,
        name: source.name,
        attribution: source.attribution,
        license: source.license,
      },
      truncated: features.length >= limit,
    };
  }

  /**
   * Query features with full geometry included in results.
   * Used by spatial queries to extract source geometries for buffering/filtering.
   */
  async queryFeaturesWithGeometry(
    sourceId: string,
    options: {
      bbox?: [number, number, number, number];
      where?: string;
      limit?: number;
    } = {}
  ): Promise<Array<{ type: 'Feature'; geometry: Record<string, unknown>; properties: Record<string, unknown> }>> {
    const source = GEOPARQUET_SOURCES.find((s) => s.id === sourceId);
    if (!source) {
      throw new Error(`Unknown GeoParquet source: ${sourceId}`);
    }

    const limit = clampLimit(options.limit, 200, MAX_FEATURE_LIMIT);
    const conditions: string[] = [];

    if (options.bbox) {
      const [xmin, ymin, xmax, ymax] = normalizeBbox(options.bbox);
      if (source.columns.bbox) {
        conditions.push(
          `${source.columns.bbox.xmin} <= ${xmax}`,
          `${source.columns.bbox.xmax} >= ${xmin}`,
          `${source.columns.bbox.ymin} <= ${ymax}`,
          `${source.columns.bbox.ymax} >= ${ymin}`
        );
      } else {
        conditions.push(
          `ST_Intersects(${source.columns.geometry}, ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}))`
        );
      }
    }

    if (options.where) {
      const whereCheck = validateWhereClause(options.where);
      if (!whereCheck.valid) {
        throw new Error(`Invalid WHERE clause: ${whereCheck.error}`);
      }
      conditions.push(`(${options.where.trim()})`);
    }

    const db = await this.getDb();
    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
    const nameSelect = source.columns.name ? `, ${source.columns.name} as name` : '';

    const query = `
      SELECT
        ${source.columns.id} as id
        ${nameSelect},
        ST_AsGeoJSON(${source.columns.geometry}) as geojson
      FROM read_parquet('${source.urlPattern}', hive_partitioning=1)
      WHERE ${whereClause}
      LIMIT ${limit}
    `;

    const result = await this.queryWithTimeout(db, query);

    return result.map((row: Record<string, unknown>) => ({
      type: 'Feature' as const,
      geometry: JSON.parse(row.geojson as string),
      properties: {
        id: row.id,
        name: row.name || null,
        source: source.id,
        attribution: source.attribution,
      },
    }));
  }

  /**
   * Execute a spatial join between two GeoParquet sources using DuckDB ST_* functions.
   * Optimized path for GeoParquet-to-GeoParquet spatial queries.
   */
  async querySpatialJoin(params: {
    sourceId: string;
    sourceBbox: [number, number, number, number];
    sourceWhere?: string;
    targetId: string;
    spatialRelation: string;
    distance?: number;
    distanceUnit?: 'miles' | 'kilometers' | 'meters';
    targetWhere?: string;
    limit?: number;
    mode?: 'features' | 'statistics';
    groupByField?: string;
    statisticType?: string;
    statisticField?: string;
  }): Promise<{
    features: Array<{ type: 'Feature'; geometry: Record<string, unknown>; properties: Record<string, unknown> }>;
    count: number;
    statistics?: Array<Record<string, unknown>>;
  }> {
    const source = GEOPARQUET_SOURCES.find((s) => s.id === params.sourceId);
    const target = GEOPARQUET_SOURCES.find((s) => s.id === params.targetId);
    if (!source) throw new Error(`Unknown GeoParquet source: ${params.sourceId}`);
    if (!target) throw new Error(`Unknown GeoParquet target: ${params.targetId}`);

    const [xmin, ymin, xmax, ymax] = normalizeBbox(params.sourceBbox);
    const limit = clampLimit(params.limit, 500, MAX_FEATURE_LIMIT);
    const distance = params.distance === undefined ? 0 : toFiniteNumber(params.distance, 'distance');

    // Build source bbox filter
    const sourceBboxFilter = source.columns.bbox
      ? `s.${source.columns.bbox.xmin} <= ${xmax} AND s.${source.columns.bbox.xmax} >= ${xmin} AND s.${source.columns.bbox.ymin} <= ${ymax} AND s.${source.columns.bbox.ymax} >= ${ymin}`
      : `ST_Intersects(s.${source.columns.geometry}, ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}))`;

    // Compute an expanded bbox for the target based on distance
    let targetBboxFilter: string;
    const bufferDeg = this.distanceToDegrees(distance, params.distanceUnit || 'miles');
    const txmin = xmin - bufferDeg;
    const tymin = ymin - bufferDeg;
    const txmax = xmax + bufferDeg;
    const tymax = ymax + bufferDeg;

    if (target.columns.bbox) {
      targetBboxFilter = `t.${target.columns.bbox.xmin} <= ${txmax} AND t.${target.columns.bbox.xmax} >= ${txmin} AND t.${target.columns.bbox.ymin} <= ${tymax} AND t.${target.columns.bbox.ymax} >= ${tymin}`;
    } else {
      targetBboxFilter = `ST_Intersects(t.${target.columns.geometry}, ST_MakeEnvelope(${txmin}, ${tymin}, ${txmax}, ${tymax}))`;
    }

    // Build spatial relationship condition
    let spatialCondition: string;
    switch (params.spatialRelation) {
      case 'within_distance': {
        const distKm = this.toKilometers(distance, params.distanceUnit || 'miles');
        // ST_DWithin uses degrees; approximate conversion: 1 deg ≈ 111.32 km
        const distDeg = distKm / 111.32;
        spatialCondition = `ST_DWithin(s.${source.columns.geometry}, t.${target.columns.geometry}, ${distDeg})`;
        break;
      }
      case 'contains':
        spatialCondition = `ST_Contains(s.${source.columns.geometry}, t.${target.columns.geometry})`;
        break;
      case 'within':
        spatialCondition = `ST_Within(t.${target.columns.geometry}, s.${source.columns.geometry})`;
        break;
      case 'intersects':
      default:
        spatialCondition = `ST_Intersects(s.${source.columns.geometry}, t.${target.columns.geometry})`;
        break;
    }

    // Build source/target WHERE extensions (validated via shared sql-guard)
    const sourceExtra = this.validatedWhereExtra(params.sourceWhere, 'sourceWhere');
    const targetExtra = this.validatedWhereExtra(params.targetWhere, 'targetWhere');

    const db = await this.getDb();

    // Statistics mode
    if (params.mode === 'statistics' && params.groupByField) {
      const groupCol = this.mapFieldToColumn(params.targetId, params.groupByField);
      const statType = params.statisticType ? assertStatisticType(params.statisticType) : 'count';
      const statCol = params.statisticField
        ? this.mapFieldToColumn(params.targetId, params.statisticField)
        : groupCol;
      const aggExpr = statType === 'count'
        ? 'COUNT(*)'
        : `${statType.toUpperCase()}(t.${statCol})`;

      const statsQuery = `
        WITH source_data AS (
          SELECT s.${source.columns.geometry} as geom
          FROM read_parquet('${source.urlPattern}', hive_partitioning=1) s
          WHERE ${sourceBboxFilter}${sourceExtra}
          LIMIT 200
        )
        SELECT
          t.${groupCol} as group_value,
          ${aggExpr} as stat_value
        FROM read_parquet('${target.urlPattern}', hive_partitioning=1) t,
             source_data s
        WHERE ${targetBboxFilter}${targetExtra}
          AND ${spatialCondition.replace(`s.${source.columns.geometry}`, 's.geom')}
          AND t.${groupCol} IS NOT NULL
        GROUP BY t.${groupCol}
        ORDER BY stat_value DESC
        LIMIT 50
      `;

      const result = await this.queryWithTimeout(db, statsQuery);
      const stats = result.map((row: Record<string, unknown>) => {
        const r: Record<string, unknown> = {};
        r[params.groupByField!] = row.group_value;
        const val = row.stat_value;
        r[params.statisticType || 'count'] = typeof val === 'bigint' ? Number(val) : val;
        return r;
      });

      // Get total count
      const countVal = stats.reduce((sum, row) => {
        const v = row[params.statisticType || 'count'];
        return sum + (typeof v === 'number' ? v : 0);
      }, 0);

      return { features: [], count: countVal, statistics: stats };
    }

    // Features mode
    const targetNameSelect = target.columns.name ? `, t.${target.columns.name} as name` : '';

    const featuresQuery = `
      WITH source_data AS (
        SELECT s.${source.columns.geometry} as geom
        FROM read_parquet('${source.urlPattern}', hive_partitioning=1) s
        WHERE ${sourceBboxFilter}${sourceExtra}
        LIMIT 200
      )
      SELECT DISTINCT
        t.${target.columns.id} as id
        ${targetNameSelect},
        ST_AsGeoJSON(t.${target.columns.geometry}) as geojson
      FROM read_parquet('${target.urlPattern}', hive_partitioning=1) t,
           source_data s
      WHERE ${targetBboxFilter}${targetExtra}
        AND ${spatialCondition.replace(`s.${source.columns.geometry}`, 's.geom')}
      LIMIT ${limit}
    `;

    const result = await this.queryWithTimeout(db, featuresQuery);

    const features = result.map((row: Record<string, unknown>) => ({
      type: 'Feature' as const,
      geometry: JSON.parse(row.geojson as string),
      properties: {
        id: row.id,
        name: row.name || null,
        source: target.id,
        attribution: target.attribution,
      },
    }));

    return { features, count: features.length };
  }

  /**
   * Validate an optional WHERE fragment and return it as " AND (...)".
   * Throws on an invalid clause rather than silently dropping the filter.
   */
  private validatedWhereExtra(where: string | undefined, label: string): string {
    if (!where || !where.trim()) return '';
    const check = validateWhereClause(where);
    if (!check.valid) {
      throw new Error(`Invalid ${label} clause: ${check.error}`);
    }
    return ` AND (${where.trim()})`;
  }

  /**
   * Convert a distance to approximate degrees for bbox expansion.
   */
  private distanceToDegrees(distance: number, unit: 'miles' | 'kilometers' | 'meters'): number {
    const km = this.toKilometers(distance, unit);
    return km / 111.32; // ~111.32 km per degree at the equator
  }

  /**
   * Convert distance to kilometers.
   */
  private toKilometers(distance: number, unit: 'miles' | 'kilometers' | 'meters'): number {
    switch (unit) {
      case 'miles': return distance * 1.60934;
      case 'meters': return distance / 1000;
      default: return distance;
    }
  }

  /**
   * Query statistics (GROUP BY with aggregation) from GeoParquet sources.
   * Supports grouping by available fields like category (places) or name.
   */
  async queryStatistics(
    sourceId: string,
    bbox: [number, number, number, number],
    options: {
      groupByField: string;
      statisticType: StatisticType;
      statisticField?: string;
      orderBy?: 'asc' | 'desc';
      limit?: number;
    }
  ): Promise<StatisticsResult> {
    const source = GEOPARQUET_SOURCES.find((s) => s.id === sourceId);
    if (!source) {
      throw new Error(`Unknown GeoParquet source: ${sourceId}`);
    }

    const { groupByField, statisticField } = options;
    const statisticType = assertStatisticType(options.statisticType);
    const sortDirection = normalizeSortDirection(options.orderBy, 'DESC');

    // Validate: sum/avg/min/max require a statisticField
    if (statisticType !== 'count' && !statisticField) {
      throw new Error(`statisticField is required for ${statisticType} aggregation`);
    }

    // Enforce maximum limit
    const MAX_LIMIT = 20;
    const effectiveLimit = clampLimit(options.limit, 10, MAX_LIMIT);

    const [xmin, ymin, xmax, ymax] = normalizeBbox(bbox);

    // Build WHERE clause for bbox
    const whereClause = source.columns.bbox
      ? `${source.columns.bbox.xmin} <= ${xmax}
         AND ${source.columns.bbox.xmax} >= ${xmin}
         AND ${source.columns.bbox.ymin} <= ${ymax}
         AND ${source.columns.bbox.ymax} >= ${ymin}`
      : `ST_Intersects(${source.columns.geometry},
         ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}))`;

    // Map field names to actual columns (handle nested fields like categories.primary)
    const groupByColumn = this.mapFieldToColumn(sourceId, groupByField);
    const statColumn = statisticField ? this.mapFieldToColumn(sourceId, statisticField) : groupByColumn;
    const db = await this.getDb();

    // Build aggregation expression
    const aggExpr = statisticType === 'count'
      ? 'COUNT(*)'
      : `${statisticType.toUpperCase()}(${statColumn})`;

    // Build the query
    const query = `
      WITH grouped AS (
        SELECT
          ${groupByColumn} as group_value,
          ${aggExpr} as stat_value
        FROM read_parquet('${source.urlPattern}', hive_partitioning=1)
        WHERE ${whereClause}
          AND ${groupByColumn} IS NOT NULL
        GROUP BY ${groupByColumn}
      )
      SELECT * FROM grouped
      ORDER BY stat_value ${sortDirection}
      LIMIT ${effectiveLimit + 1}
    `;

    const result = await this.queryWithTimeout(db, query);

    // Check if truncated (we fetched limit+1 to check)
    const truncated = result.length > effectiveLimit;
    const limitedResult = result.slice(0, effectiveLimit);

    // DuckDB returns BigInt for aggregations - convert to Number for JSON serialization
    const rows = limitedResult.map((row: Record<string, unknown>) => {
      const r: Record<string, unknown> = {};
      r[groupByField] = row.group_value;
      // Convert BigInt to Number if needed
      const statValue = row.stat_value;
      r[statisticType] = typeof statValue === 'bigint' ? Number(statValue) : statValue;
      return r;
    });

    return {
      rows,
      groupByField,
      statisticType,
      statisticField: statisticType !== 'count' ? statisticField : undefined,
      totalGroups: result.length, // Approximate - we don't know actual total without another query
      truncated,
    };
  }

  /**
   * Map user-friendly field names to actual column paths in GeoParquet
   */
  private mapFieldToColumn(sourceId: string, field: string): string {
    // Field names are interpolated into SQL, so they must be plain identifiers
    assertValidIdentifier(field, 'field');

    // Handle common mappings for Overture sources
    const mappings: Record<string, Record<string, string>> = {
      'overture-places': {
        'name': 'names.primary',
        'category': 'categories.primary',
      },
      'overture-buildings': {
        'name': 'names.primary',
      },
      'overture-divisions': {
        'name': 'names.primary',
      },
    };

    const sourceMapping = mappings[sourceId];
    if (sourceMapping && sourceMapping[field]) {
      return sourceMapping[field];
    }

    // Return as-is if no mapping found (user might be using raw column name)
    return field;
  }
}

export const geoParquetService = new GeoParquetService();
