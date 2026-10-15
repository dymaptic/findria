import postgres from 'postgres';
import OpenAI from 'openai';
import proj4 from 'proj4';
import { safeFetch, readTextCapped } from '../lib/safe-fetch';

// Common EPSG/WKID proj4 definitions for coordinate transformation
const PROJ4_DEFS: Record<number, string> = {
  4326: '+proj=longlat +datum=WGS84 +no_defs',
  4269: '+proj=longlat +datum=NAD83 +no_defs',
  4267: '+proj=longlat +datum=NAD27 +no_defs',
  3857: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
  102100: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
  28992: '+proj=sterea +lat_0=52.1561605555556 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.4171,50.3319,465.5524,1.9342,-1.6677,9.1019,4.0725 +units=m +no_defs',
  2154: '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  27700: '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs',
  32618: '+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs',
  32617: '+proj=utm +zone=17 +datum=WGS84 +units=m +no_defs',
  32616: '+proj=utm +zone=16 +datum=WGS84 +units=m +no_defs',
  32615: '+proj=utm +zone=15 +datum=WGS84 +units=m +no_defs',
  32614: '+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs',
  32613: '+proj=utm +zone=13 +datum=WGS84 +units=m +no_defs',
  32612: '+proj=utm +zone=12 +datum=WGS84 +units=m +no_defs',
  32611: '+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs',
  32610: '+proj=utm +zone=10 +datum=WGS84 +units=m +no_defs',
  2263: '+proj=lcc +lat_1=41.03333333333333 +lat_2=40.66666666666666 +lat_0=40.16666666666666 +lon_0=-74 +x_0=300000.0000000001 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs',
  2227: '+proj=lcc +lat_1=39.83333333333334 +lat_2=38.33333333333334 +lat_0=37.66666666666666 +lon_0=-122 +x_0=2000000 +y_0=500000.0000000001 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs',
};

// Register proj4 definitions
for (const [wkid, def] of Object.entries(PROJ4_DEFS)) {
  proj4.defs(`EPSG:${wkid}`, def);
}

// Types
export interface LayerInfo {
  id: number;
  name: string;
  type?: string;
  geometryType?: string;
  description?: string;
  fields?: Array<{
    name: string;
    type: string;
    alias?: string;
  }>;
  extent?: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    spatialReference?: { wkid: number };
  };
}

export interface ArcGISItem {
  id: string;
  title: string;
  url?: string | null;
  type: string;
  description?: string | null;
  snippet?: string | null;
  tags?: string[];
  categories?: string[];
  typeKeywords?: string[];
  extent?: number[][] | null;
  access?: string;
  owner?: string;
  contentStatus?: string;
  [key: string]: unknown;
}

export interface IndexLayerOptions {
  item: ArcGISItem;
  layer: LayerInfo | null;
  source: 'living_atlas' | 'custom_org' | 'user_submitted';
  orgDisplayName?: string;
}

export interface IndexLayerResult {
  status: 'indexed' | 'skipped' | 'error';
  sourceId: string;
  error?: string;
}

export interface IndexResult {
  indexed: number;
  skipped: number;
  errors: number;
  sourceIds: string[];
}

export interface DeleteStaleOptions {
  serviceUrlPattern?: string;
  source?: 'living_atlas' | 'custom_org' | 'user_submitted';
  validSourceIds: string[];
  deleteEnabled: boolean;
}

// Constants
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const ARCGIS_ONLINE_BASE = 'https://www.arcgis.com/sharing/rest';

export const SUPPORTED_SERVICE_TYPES = [
  'Feature Service',
  'Map Service',
  'Image Service',
  'Vector Tile Service',
];

export const IGNORED_SERVICE_TYPES = [
  'Web Map',
  'Web Mapping Application',
  'Scene Service',
  'Scene Layer',
  'StoryMap',
  'Dashboard',
  'Web Experience',
  'Form',
  'Survey123',
  'Notebook',
  'Code Sample',
  'Application',
  'Geoprocessing Service',
  'Geometry Service',
];

/**
 * Centralized indexing service for all data sources
 */
export class IndexingService {
  private sql: postgres.Sql;
  private openai: OpenAI;

  constructor(sql: postgres.Sql, openai: OpenAI) {
    this.sql = sql;
    this.openai = openai;
  }

  /**
   * Generate embedding for search text using OpenAI
   */
  async generateEmbedding(text: string): Promise<number[]> {
    // text-embedding-3-small has 8192 token limit
    // ~4 chars/token on average, so 8000 chars is safe
    const cleanedText = text.replace(/\s+/g, ' ').trim().substring(0, 8000);

    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleanedText,
      dimensions: 1536,
    });

    return response.data[0]!.embedding;
  }

  /**
   * Get data type info from ArcGIS service type
   */
  getTypeInfo(arcgisType: string): { dataType: string | null; supportsCoverageQuery: boolean } {
    switch (arcgisType) {
      case 'Feature Service':
        return { dataType: 'polygon', supportsCoverageQuery: true };
      case 'Map Service':
        return { dataType: 'raster', supportsCoverageQuery: false };
      case 'Image Service':
        return { dataType: 'raster', supportsCoverageQuery: false };
      case 'Vector Tile Service':
        return { dataType: 'polygon', supportsCoverageQuery: false };
      default:
        return { dataType: null, supportsCoverageQuery: false };
    }
  }

  /**
   * Map Esri geometry types to simpler names
   */
  mapGeometryType(esriType: string): string {
    const typeMap: Record<string, string> = {
      'esriGeometryPoint': 'point',
      'esriGeometryMultipoint': 'point',
      'esriGeometryPolyline': 'line',
      'esriGeometryPolygon': 'polygon',
      'esriGeometryEnvelope': 'polygon',
    };
    return typeMap[esriType] || 'polygon';
  }

  /**
   * Fetch layer information from a Feature/Map Service
   */
  async fetchServiceLayers(serviceUrl: string): Promise<LayerInfo[]> {
    try {
      const response = await safeFetch(`${serviceUrl}?f=json`, { timeoutMs: 30_000 });
      if (!response.ok) return [];

      const serviceInfo = await response.json();
      if (serviceInfo.error) return [];

      const layers: LayerInfo[] = [];

      // Get layers array (Feature Services and Map Services have this)
      const serviceLayers = serviceInfo.layers || [];

      for (const layer of serviceLayers) {
        // Fetch detailed layer info including fields
        try {
          const layerResponse = await safeFetch(`${serviceUrl}/${layer.id}?f=json`, { timeoutMs: 30_000 });
          if (!layerResponse.ok) continue;

          const layerInfo = await layerResponse.json();
          if (layerInfo.error) continue;

          layers.push({
            id: layer.id,
            name: layerInfo.name || layer.name || `Layer ${layer.id}`,
            type: layerInfo.type,
            geometryType: layerInfo.geometryType,
            description: layerInfo.description,
            fields: layerInfo.fields?.map((f: Record<string, unknown>) => ({
              name: f.name as string,
              type: f.type as string,
              alias: f.alias as string | undefined,
            })),
            extent: layerInfo.extent,
          });

          // Small delay between layer requests
          await this.sleep(50);
        } catch {
          // Skip layers we can't fetch
          continue;
        }
      }

      // If no layers found but service exists, treat as single layer at root
      if (layers.length === 0 && !serviceInfo.error) {
        layers.push({
          id: 0,
          name: serviceInfo.name || 'Default Layer',
          geometryType: serviceInfo.geometryType,
          description: serviceInfo.description,
          fields: serviceInfo.fields?.map((f: Record<string, unknown>) => ({
            name: f.name as string,
            type: f.type as string,
            alias: f.alias as string | undefined,
          })),
          extent: serviceInfo.extent,
        });
      }

      return layers;
    } catch (error) {
      console.warn(`Failed to fetch layers from ${serviceUrl}:`, error);
      return [];
    }
  }

  /**
   * Index a single layer from an ArcGIS item
   */
  async indexLayer(options: IndexLayerOptions): Promise<IndexLayerResult> {
    const { item, layer, source, orgDisplayName } = options;

    try {
      const itemId = item.id;
      const baseServiceUrl = item.url || null;

      // Build source_id: itemId for standalone, itemId_layer_N for layers
      const sourceId = layer ? `${itemId}_layer_${layer.id}` : itemId;

      // Build the full service URL (with layer ID if applicable)
      // Check if baseServiceUrl already ends with a layer index (e.g., /FeatureServer/28)
      // to avoid creating malformed URLs like /FeatureServer/28/0
      let serviceUrl = baseServiceUrl;
      if (layer && baseServiceUrl) {
        const alreadyHasLayerIndex = /\/(FeatureServer|MapServer)\/\d+$/i.test(baseServiceUrl);
        if (!alreadyHasLayerIndex) {
          serviceUrl = `${baseServiceUrl}/${layer.id}`;
        }
        // If URL already has a layer index, keep it as-is (don't append another)
      }

      // Build name: combine parent title with layer name if applicable
      const name = layer && layer.name !== 'Default Layer'
        ? `${item.title} - ${layer.name}`
        : item.title;

      // Build description: combine parent + layer descriptions
      const description = [
        item.description,
        layer?.description,
      ].filter(Boolean).join('\n\n') || null;

      // Build search text: combine everything for good embeddings
      const fieldNames = layer?.fields?.map(f => f.alias || f.name).join(', ') || '';
      const searchTextParts = [
        name,
        item.snippet,
        description,
        layer?.name,
        fieldNames,
        orgDisplayName,
        ...(item.tags || []),
        ...(item.typeKeywords || []),
      ].filter(Boolean);
      const searchText = searchTextParts.join(' ').substring(0, 8000);

      // Generate embedding
      const embedding = await this.generateEmbedding(searchText);

      // Determine data type from layer geometry or item type
      let dataType: string | null = null;
      let supportsCoverageQuery = false;

      if (layer?.geometryType) {
        dataType = this.mapGeometryType(layer.geometryType);
        supportsCoverageQuery = true;
      } else {
        const typeInfo = this.getTypeInfo(item.type);
        dataType = typeInfo.dataType;
        supportsCoverageQuery = typeInfo.supportsCoverageQuery;
      }

      // Build extent bbox - try item.extent first, then fall back to layer.extent
      const itemExtent = item.extent;
      let extentBbox: { xmin: number; ymin: number; xmax: number; ymax: number } | null = null;

      // Try item extent first (ArcGIS format: [[xmin, ymin], [xmax, ymax]])
      if (itemExtent && itemExtent[0] && itemExtent[1]) {
        const [xmin, ymin] = itemExtent[0];
        const [xmax, ymax] = itemExtent[1];
        if (
          typeof xmin === 'number' && !isNaN(xmin) &&
          typeof ymin === 'number' && !isNaN(ymin) &&
          typeof xmax === 'number' && !isNaN(xmax) &&
          typeof ymax === 'number' && !isNaN(ymax)
        ) {
          extentBbox = { xmin, ymin, xmax, ymax };
        }
      }

      // Fall back to layer extent if item extent is missing
      // Layer extent format: { xmin, ymin, xmax, ymax, spatialReference }
      if (!extentBbox && layer?.extent) {
        const le = layer.extent;
        if (
          typeof le.xmin === 'number' && !isNaN(le.xmin) &&
          typeof le.ymin === 'number' && !isNaN(le.ymin) &&
          typeof le.xmax === 'number' && !isNaN(le.xmax) &&
          typeof le.ymax === 'number' && !isNaN(le.ymax)
        ) {
          const wkid = le.spatialReference?.wkid;
          const isWGS84 = wkid === 4326 || wkid === 4269 || wkid === 4267;
          const looksGeographic = le.xmin >= -180 && le.xmax <= 180 && le.ymin >= -90 && le.ymax <= 90;

          if (isWGS84 || (looksGeographic && !wkid)) {
            // Already in WGS84 or geographic coordinates
            extentBbox = { xmin: le.xmin, ymin: le.ymin, xmax: le.xmax, ymax: le.ymax };
          } else if (wkid && PROJ4_DEFS[wkid]) {
            // Transform from projected CRS to WGS84
            try {
              const sw = proj4(`EPSG:${wkid}`, 'EPSG:4326', [le.xmin, le.ymin]);
              const ne = proj4(`EPSG:${wkid}`, 'EPSG:4326', [le.xmax, le.ymax]);
              const transformed = {
                xmin: Math.min(sw[0], ne[0]),
                ymin: Math.min(sw[1], ne[1]),
                xmax: Math.max(sw[0], ne[0]),
                ymax: Math.max(sw[1], ne[1]),
              };
              // Validate transformed coordinates
              if (transformed.xmin >= -180 && transformed.xmax <= 180 &&
                  transformed.ymin >= -90 && transformed.ymax <= 90) {
                extentBbox = transformed;
              }
            } catch {
              // Transformation failed, skip extent
            }
          }
          // If WKID unknown and not geographic, skip (can't transform)
        }
      }

      // Check if item is authoritative
      const contentStatus = item.contentStatus;
      const isAuthoritative = contentStatus === 'public_authoritative';

      // Build schema for this specific layer
      const schema = layer ? {
        layers: [{
          layerId: layer.id,
          layerName: layer.name,
          geometryType: layer.geometryType || null,
          fields: layer.fields || [],
        }],
        fetchedAt: new Date().toISOString(),
      } : null;

      // Upsert to database
      await this.sql`
        INSERT INTO datasets (
          source, source_id, name, description, snippet, tags, categories,
          data_type, extent, extent_bbox, source_url, service_url, access_type,
          arcgis_item_id, arcgis_owner, arcgis_type,
          supports_coverage_query, is_authoritative, metadata_json,
          search_text, embedding, org_display_name, schema
        ) VALUES (
          ${source},
          ${sourceId},
          ${name},
          ${description},
          ${item.snippet || null},
          ${item.tags || []},
          ${item.categories || []},
          ${dataType},
          ${
            extentBbox
              ? this.sql`ST_MakeEnvelope(${extentBbox.xmin}, ${extentBbox.ymin}, ${extentBbox.xmax}, ${extentBbox.ymax}, 4326)`
              : null
          },
          ${extentBbox ? JSON.stringify(extentBbox) : null},
          ${'https://www.arcgis.com/home/item.html?id=' + itemId},
          ${serviceUrl},
          ${item.access || 'public'},
          ${itemId},
          ${item.owner || null},
          ${item.type},
          ${supportsCoverageQuery},
          ${isAuthoritative},
          ${JSON.stringify({ ...item, _layer: layer, _orgDisplayName: orgDisplayName })},
          ${searchText},
          ${`[${embedding.join(',')}]`},
          ${orgDisplayName || null},
          ${schema ? JSON.stringify(schema) : null}
        )
        ON CONFLICT (source, source_id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          snippet = EXCLUDED.snippet,
          tags = EXCLUDED.tags,
          service_url = EXCLUDED.service_url,
          is_authoritative = EXCLUDED.is_authoritative,
          metadata_json = EXCLUDED.metadata_json,
          search_text = EXCLUDED.search_text,
          embedding = EXCLUDED.embedding,
          org_display_name = EXCLUDED.org_display_name,
          schema = EXCLUDED.schema,
          updated_at = NOW()
      `;

      return { status: 'indexed', sourceId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error indexing layer:`, errorMessage);
      return {
        status: 'error',
        sourceId: layer ? `${item.id}_layer_${layer.id}` : item.id,
        error: errorMessage
      };
    }
  }

  /**
   * Check if a dataset already exists (for skip-existing logic)
   */
  async datasetExists(sourceId: string, source: string): Promise<boolean> {
    const result = await this.sql`
      SELECT 1 FROM datasets
      WHERE source = ${source} AND source_id = ${sourceId}
      LIMIT 1
    `;
    return result.length > 0;
  }

  /**
   * Check if an item exists in Living Atlas (for custom sources to avoid duplicating)
   */
  async existsInLivingAtlas(arcgisItemId: string): Promise<boolean> {
    const result = await this.sql`
      SELECT 1 FROM datasets
      WHERE arcgis_item_id = ${arcgisItemId} AND source = 'living_atlas'
      LIMIT 1
    `;
    return result.length > 0;
  }

  /**
   * Delete stale items that are no longer at the source
   * IMPORTANT: Scope must match indexing scope exactly
   */
  async deleteStaleItems(options: DeleteStaleOptions): Promise<number> {
    const { serviceUrlPattern, source, validSourceIds, deleteEnabled } = options;

    if (!deleteEnabled) {
      console.log('Deletion disabled for this job (filtered run)');
      return 0;
    }

    if (validSourceIds.length === 0) {
      console.log('No valid source IDs provided, skipping deletion');
      return 0;
    }

    let result;

    if (serviceUrlPattern) {
      // Delete by service URL pattern (for URL-based jobs)
      result = await this.sql`
        DELETE FROM datasets
        WHERE service_url LIKE ${serviceUrlPattern}
          AND source_id != ALL(${validSourceIds})
      `;
    } else if (source) {
      // Delete by source type (for full re-index jobs)
      result = await this.sql`
        DELETE FROM datasets
        WHERE source = ${source}
          AND source_id != ALL(${validSourceIds})
      `;
    } else {
      console.warn('No deletion scope specified');
      return 0;
    }

    const deletedCount = result.count;
    console.log(`Deleted ${deletedCount} stale items`);
    return deletedCount;
  }

  /**
   * Get stats about indexed data for a source URL pattern
   */
  async getSourceStats(serviceUrlPattern: string): Promise<{
    datasetCount: number;
    oldestIndexed: Date | null;
  }> {
    const result = await this.sql`
      SELECT COUNT(*) as count, MIN(indexed_at) as oldest
      FROM datasets
      WHERE service_url LIKE ${serviceUrlPattern}
    `;
    return {
      datasetCount: parseInt(result[0]?.count || '0'),
      oldestIndexed: result[0]?.oldest || null,
    };
  }

  /**
   * Fetch service metadata and convert to ArcGISItem format
   */
  async fetchServiceAsItem(serviceUrl: string): Promise<ArcGISItem | null> {
    try {
      const response = await safeFetch(`${serviceUrl}?f=json`, { timeoutMs: 30_000 });
      if (!response.ok) return null;

      const data = await response.json();
      if (data.error) return null;

      const id = Buffer.from(serviceUrl).toString('base64').substring(0, 32);

      return {
        id,
        title: data.name || data.documentInfo?.Title || 'Unnamed Service',
        url: serviceUrl,
        type: serviceUrl.toLowerCase().includes('featureserver') ? 'Feature Service' : 'Map Service',
        description: data.description || data.serviceDescription || null,
        snippet: data.documentInfo?.Subject || null,
        tags: data.documentInfo?.Keywords?.split(',').map((k: string) => k.trim()) || [],
        extent: data.fullExtent
          ? [
              [data.fullExtent.xmin, data.fullExtent.ymin],
              [data.fullExtent.xmax, data.fullExtent.ymax],
            ]
          : null,
        access: 'public',
        owner: data.documentInfo?.Author || 'unknown',
      };
    } catch {
      return null;
    }
  }

  /**
   * Index a single service URL (FeatureServer/MapServer), including layer URLs
   *
   * @param overrides - Optional metadata overrides (e.g., from a DCAT feed).
   *   When provided, these take priority over service-level metadata so that
   *   curated hub titles, descriptions, and org names aren't lost.
   */
  async indexSingleService(
    serviceUrl: string,
    overrides?: {
      title?: string;
      description?: string;
      orgDisplayName?: string;
      tags?: string[];
      snippet?: string;
    }
  ): Promise<IndexResult> {
    const results: IndexResult = { indexed: 0, skipped: 0, errors: 0, sourceIds: [] };

    const layerMatch = serviceUrl.match(/\/(\d+)\/?$/);

    if (layerMatch) {
      // Single layer URL
      const layerId = parseInt(layerMatch[1]!, 10);
      const baseServiceUrl = serviceUrl.replace(/\/\d+\/?$/, '');

      const item = await this.fetchServiceAsItem(baseServiceUrl);
      if (!item) {
        results.errors++;
        return results;
      }

      // Apply DCAT/hub metadata overrides
      if (overrides) {
        if (overrides.title) item.title = overrides.title;
        if (overrides.description) item.description = overrides.description;
        if (overrides.snippet) item.snippet = overrides.snippet;
        if (overrides.tags?.length) {
          item.tags = [...new Set([...(item.tags || []), ...overrides.tags])];
        }
      }

      const layers = await this.fetchServiceLayers(baseServiceUrl);
      const layer = layers.find((l) => l.id === layerId);

      if (!layer) {
        results.errors++;
        return results;
      }

      const result = await this.indexLayer({
        item: { ...item, url: baseServiceUrl },
        layer,
        source: 'user_submitted',
        orgDisplayName: overrides?.orgDisplayName,
      });

      if (result.status === 'indexed') {
        results.indexed++;
        results.sourceIds.push(result.sourceId);
      } else if (result.status === 'skipped') {
        results.skipped++;
      } else {
        results.errors++;
      }
    } else {
      // Service root - index all layers
      const item = await this.fetchServiceAsItem(serviceUrl);
      if (!item) {
        results.errors++;
        return results;
      }

      // Apply DCAT/hub metadata overrides
      if (overrides) {
        if (overrides.title) item.title = overrides.title;
        if (overrides.description) item.description = overrides.description;
        if (overrides.snippet) item.snippet = overrides.snippet;
        if (overrides.tags?.length) {
          item.tags = [...new Set([...(item.tags || []), ...overrides.tags])];
        }
      }

      const layers = await this.fetchServiceLayers(serviceUrl);

      if (layers.length === 0) {
        const result = await this.indexLayer({
          item,
          layer: null,
          source: 'user_submitted',
          orgDisplayName: overrides?.orgDisplayName,
        });

        if (result.status === 'indexed') {
          results.indexed++;
          results.sourceIds.push(result.sourceId);
        } else if (result.status === 'skipped') {
          results.skipped++;
        } else {
          results.errors++;
        }
      } else {
        for (const layer of layers) {
          const result = await this.indexLayer({
            item,
            layer,
            source: 'user_submitted',
            orgDisplayName: overrides?.orgDisplayName,
          });

          if (result.status === 'indexed') {
            results.indexed++;
            results.sourceIds.push(result.sourceId);
          } else if (result.status === 'skipped') {
            results.skipped++;
          } else {
            results.errors++;
          }

          await this.sleep(100);
        }
      }
    }

    return results;
  }

  /**
   * Recursively index all services from an ArcGIS Server root URL
   */
  async indexArcGISServer(baseUrl: string): Promise<IndexResult> {
    const results: IndexResult = { indexed: 0, skipped: 0, errors: 0, sourceIds: [] };
    const normalizedUrl = baseUrl.replace(/\/$/, '');

    const response = await safeFetch(`${normalizedUrl}?f=json`, { timeoutMs: 30_000 });
    const data = await response.json();

    if (data.error) {
      results.errors++;
      return results;
    }

    await this.indexServicesRecursive(normalizedUrl, data, results);
    return results;
  }

  /**
   * Recursively crawl folders/services in an ArcGIS Server
   */
  private async indexServicesRecursive(
    baseUrl: string,
    data: { folders?: string[]; services?: Array<{ name: string; type: string }> },
    results: IndexResult
  ): Promise<void> {
    if (data.services) {
      for (const service of data.services) {
        if (!SUPPORTED_SERVICE_TYPES.includes(service.type)) continue;

        const serviceUrl = `${baseUrl}/${service.name}/${service.type.replace(' ', '')}`;
        const serviceResult = await this.indexSingleService(serviceUrl);
        results.indexed += serviceResult.indexed;
        results.skipped += serviceResult.skipped;
        results.errors += serviceResult.errors;
        results.sourceIds.push(...serviceResult.sourceIds);

        await this.sleep(200);
      }
    }

    if (data.folders) {
      for (const folder of data.folders) {
        try {
          const folderResponse = await safeFetch(`${baseUrl}/${folder}?f=json`, { timeoutMs: 30_000 });
          if (folderResponse.ok) {
            const folderData = await folderResponse.json();
            await this.indexServicesRecursive(`${baseUrl}/${folder}`, folderData, results);
          }
        } catch {
          results.errors++;
        }
      }
    }
  }

  /**
   * Extract ArcGIS Online org ID from a Hub site's HTML page.
   * Hub sites embed their org config in the page source.
   */
  async discoverHubOrgId(hubUrl: string): Promise<{ orgId: string; orgName?: string } | null> {
    try {
      const response = await safeFetch(hubUrl.replace(/\/$/, '') + '/', {
        timeoutMs: 15_000,
        headers: { Accept: 'text/html' },
      });
      if (!response.ok) return null;

      // Cap the read: hub pages are user-controlled and could be huge
      const html = await readTextCapped(response, 2 * 1024 * 1024);

      // Look for orgId in the page config (typically in a JSON blob in a script tag)
      const orgIdMatch = html.match(/"orgId"\s*:\s*"([a-zA-Z0-9]+)"/);
      if (!orgIdMatch?.[1]) return null;

      const orgId = orgIdMatch[1];

      // Try to extract org name too
      const orgNameMatch = html.match(/"orgName"\s*:\s*"([^"]+)"/);
      return { orgId, orgName: orgNameMatch?.[1] };
    } catch {
      return null;
    }
  }

  /**
   * Search an ArcGIS Online org for public Feature/Map Services.
   * Uses the sharing/rest/search API with pagination.
   *
   * @param alreadyIndexedUrls - Service URLs already indexed (e.g., from DCAT).
   *   Items whose URL matches one of these are skipped to avoid duplicates.
   */
  async searchOrgServices(
    orgId: string,
    orgName?: string,
    alreadyIndexedUrls?: Set<string>
  ): Promise<IndexResult> {
    const results: IndexResult = { indexed: 0, skipped: 0, errors: 0, sourceIds: [] };
    const seenItemIds = new Set<string>();

    // Normalize the already-indexed URLs for comparison
    const indexedUrlSet = new Set<string>();
    if (alreadyIndexedUrls) {
      for (const url of alreadyIndexedUrls) {
        indexedUrlSet.add(url.toLowerCase().replace(/\/$/, ''));
      }
    }

    // Search for Feature Services and Map Services in the org
    const serviceTypes = ['Feature Service', 'Map Service'];

    for (const serviceType of serviceTypes) {
      let start = 1;
      const num = 100;
      let hasMore = true;

      while (hasMore) {
        try {
          const searchUrl = new URL(`${ARCGIS_ONLINE_BASE}/search`);
          searchUrl.searchParams.set('q', `orgid:${orgId} type:"${serviceType}" access:public`);
          searchUrl.searchParams.set('f', 'json');
          searchUrl.searchParams.set('num', String(num));
          searchUrl.searchParams.set('start', String(start));

          // Fixed, trusted host (ARCGIS_ONLINE_BASE); orgId is constrained to
          // [a-zA-Z0-9]+ by discoverHubOrgId, so plain fetch is fine here.
          const response = await fetch(searchUrl.toString(), {
            signal: AbortSignal.timeout(30_000),
          });

          if (!response.ok) {
            console.warn(`Org search failed: HTTP ${response.status} (start=${start})`);
            break;
          }

          const data = await response.json();
          if (data.error) {
            console.warn(`Org search error: ${data.error.message}`);
            break;
          }

          const searchResults: ArcGISItem[] = data.results || [];

          if (searchResults.length === 0) {
            hasMore = false;
            break;
          }

          for (const item of searchResults) {
            // Skip items we've already processed in this run
            if (seenItemIds.has(item.id)) continue;
            seenItemIds.add(item.id);

            // Skip items without a service URL
            if (!item.url) {
              results.skipped++;
              continue;
            }

            // Skip items already indexed from DCAT pass
            if (indexedUrlSet.has(item.url.toLowerCase().replace(/\/$/, ''))) {
              results.skipped++;
              continue;
            }

            // Skip items already in Living Atlas
            try {
              if (await this.existsInLivingAtlas(item.id)) {
                results.skipped++;
                continue;
              }
            } catch {
              // If check fails, proceed anyway
            }

            // Index the service
            try {
              const layers = await this.fetchServiceLayers(item.url);

              if (layers.length === 0) {
                const result = await this.indexLayer({
                  item,
                  layer: null,
                  source: 'user_submitted',
                  orgDisplayName: orgName,
                });
                if (result.status === 'indexed') {
                  results.indexed++;
                  results.sourceIds.push(result.sourceId);
                } else if (result.status === 'skipped') {
                  results.skipped++;
                } else {
                  results.errors++;
                }
              } else {
                for (const layer of layers) {
                  const result = await this.indexLayer({
                    item,
                    layer,
                    source: 'user_submitted',
                    orgDisplayName: orgName,
                  });
                  if (result.status === 'indexed') {
                    results.indexed++;
                    results.sourceIds.push(result.sourceId);
                  } else if (result.status === 'skipped') {
                    results.skipped++;
                  } else {
                    results.errors++;
                  }
                  await this.sleep(50);
                }
              }
            } catch {
              results.errors++;
            }

            await this.sleep(200);
          }

          // Check if there are more pages
          const nextStart = data.nextStart;
          if (nextStart === -1 || start + num > (data.total || 0)) {
            hasMore = false;
          } else {
            start = nextStart;
          }

          await this.sleep(500);
        } catch (error) {
          console.warn(`Org search page failed:`, error);
          break;
        }
      }
    }

    return results;
  }

  /**
   * Index a Hub/Open Data portal.
   *
   * Strategy:
   * 1. Fetch DCAT feed (site-specific, curated by hub admin)
   * 2. Discover the hub's ArcGIS Online org ID and search the org catalog
   *    directly. Many hubs have DCAT feeds that only expose a subset of
   *    their org's public data. The org search catches everything the
   *    DCAT feed misses.
   * 3. Items already indexed from DCAT are skipped in the org search pass
   *    to avoid duplicates and wasted embedding API calls.
   */
  async indexHub(hubUrl: string): Promise<IndexResult> {
    const results: IndexResult = { indexed: 0, skipped: 0, errors: 0, sourceIds: [] };
    const normalizedUrl = hubUrl.replace(/\/$/, '');

    // Track service URLs indexed from DCAT so org search can skip them
    const dcatIndexedUrls = new Set<string>();
    let dcatParsedOk = false;
    let dcatPublisherName: string | undefined;

    // Phase 1: DCAT feed (site-specific, may include cross-org items)
    try {
      const dcatUrl = `${normalizedUrl}/api/feed/dcat-us/1.1.json`;
      const response = await safeFetch(dcatUrl, { timeoutMs: 30_000 });

      if (response.ok) {
        const dcat = await response.json();
        const datasets = dcat.dataset;

        if (Array.isArray(datasets)) {
          dcatParsedOk = true;
        }

        if (Array.isArray(datasets) && datasets.length > 0) {
          for (const dataset of datasets) {
            const distributions = dataset.distribution || [];
            const serviceDist = distributions.find(
              (d: { accessURL?: string }) =>
                d.accessURL &&
                (/FeatureServer/i.test(d.accessURL) || /MapServer/i.test(d.accessURL))
            );

            if (!serviceDist?.accessURL) continue;

            // Track the base service URL (strip layer number) for dedup
            const serviceUrl = serviceDist.accessURL.replace(/\/\d+\/?$/, '');
            dcatIndexedUrls.add(serviceUrl);

            // Extract DCAT metadata to pass through (otherwise lost)
            const dcatOverrides: {
              title?: string;
              description?: string;
              orgDisplayName?: string;
              tags?: string[];
              snippet?: string;
            } = {};
            if (dataset.title) dcatOverrides.title = dataset.title;
            if (dataset.description) {
              // Strip HTML tags from DCAT descriptions
              const cleanDesc = dataset.description.replace(/<[^>]*>/g, '').trim();
              if (cleanDesc) dcatOverrides.description = cleanDesc;
            }
            if (dataset.publisher?.name) {
              dcatOverrides.orgDisplayName = dataset.publisher.name;
              if (!dcatPublisherName) dcatPublisherName = dataset.publisher.name;
            }
            if (Array.isArray(dataset.keyword) && dataset.keyword.length > 0) {
              dcatOverrides.tags = dataset.keyword;
            }

            try {
              const serviceResult = await this.indexSingleService(
                serviceDist.accessURL,
                Object.keys(dcatOverrides).length > 0 ? dcatOverrides : undefined
              );
              results.indexed += serviceResult.indexed;
              results.skipped += serviceResult.skipped;
              results.errors += serviceResult.errors;
              results.sourceIds.push(...serviceResult.sourceIds);
            } catch {
              results.errors++;
            }

            await this.sleep(200);
          }
        }
      }
    } catch (error) {
      console.warn(`DCAT feed failed for ${normalizedUrl}:`, error);
    }

    console.log(`DCAT phase: ${results.indexed} indexed from ${dcatIndexedUrls.size} service URLs`);

    // Phase 2: Org catalog search (catches items DCAT missed)
    const orgInfo = await this.discoverHubOrgId(normalizedUrl);
    if (orgInfo) {
      console.log(`Discovered org: ${orgInfo.orgName || orgInfo.orgId}. Searching org catalog...`);

      const orgResults = await this.searchOrgServices(
        orgInfo.orgId,
        orgInfo.orgName || dcatPublisherName,
        dcatIndexedUrls
      );

      console.log(
        `Org search phase: ${orgResults.indexed} indexed, ` +
        `${orgResults.skipped} skipped (already indexed or in Living Atlas)`
      );

      results.indexed += orgResults.indexed;
      results.skipped += orgResults.skipped;
      results.errors += orgResults.errors;
      results.sourceIds.push(...orgResults.sourceIds);
    } else {
      console.log('Could not discover org ID from hub site — DCAT-only indexing');
    }

    // If neither path produced anything at all, and we couldn't even parse
    // the DCAT feed or discover an org, that's an error worth reporting.
    // But if DCAT parsed successfully (even with 0 service URLs) or org search
    // ran (even with 0 new items), that's a valid result — just nothing to index.
    if (
      results.indexed === 0 &&
      results.skipped === 0 &&
      dcatIndexedUrls.size === 0 &&
      !dcatParsedOk &&
      !orgInfo
    ) {
      throw new Error('No indexable content found: DCAT feed empty and org search unavailable');
    }

    return results;
  }

  /**
   * Utility: Sleep for a given number of milliseconds
   */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Factory function to create service instance
export function createIndexingService(
  connectionString?: string
): IndexingService {
  const dbUrl = connectionString ||
    process.env.DATABASE_URL ||
    'postgresql://datalibrarian:datalibrarian@localhost:5432/datalibrarian';

  const sql = postgres(dbUrl);
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return new IndexingService(sql, openai);
}
