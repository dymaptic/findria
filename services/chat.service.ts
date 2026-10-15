import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam, ToolUseBlock, TextBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { randomBytes } from 'crypto';
import { searchService } from './search.service';
import { featureQueryService } from './feature-query.service';
import { geocodingService } from './geocoding.service';
import { geoParquetService } from './geoparquet.service';
import { spatialQueryService } from './spatial-query.service';
import { query, queryOne } from '@/lib/db';
import type { Dataset, GeoJSONFeature } from '@/types';
import type { StreamEvent, MapAction, ToolDefinition, SourceDataset, ChatMessage, ContentBlock, ChatStep, GeoJSONFeatureCollection } from '@/types/chat';

// Maximum model round-trips in the agentic tool-use loop, to prevent runaway API calls
export const MAX_AGENTIC_ITERATIONS = 25;

const MAX_ITERATIONS_NOTICE =
  '\n\nI reached the maximum number of tool steps for a single question, so I stopped here. ' +
  'The results above may be incomplete. Try a narrower question or ask a follow-up to continue.';

/**
 * Generate an unguessable, URL-safe conversation/share ID:
 * 96 bits from a CSPRNG, base64url-encoded (16 chars of [A-Za-z0-9_-]).
 */
export function generateShareId(): string {
  return randomBytes(12).toString('base64url');
}

// Lazy initialization to avoid build-time errors
let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return _client;
}

function getSystemPrompt(mapScale?: number): string {
  const today = new Date().toISOString().split('T')[0];
  const scaleContext = mapScale
    ? `\nThe user's current map scale is approximately 1:${Math.round(mapScale).toLocaleString()}. When adding layers that have a minScale restriction, always use zoomToLocation to zoom to the relevant area so the layer is visible.`
    : `\nWhen adding layers that have a minScale restriction, always use zoomToLocation to zoom to the relevant area so the layer is visible. The system will automatically adjust the zoom level if needed.`;
  return `You are Findria, a GIS assistant that helps users discover and analyze geospatial data from ArcGIS Living Atlas, Overture Maps, public agencies, and user-submitted services.

Today's date is ${today}. Always prefer the most current and up-to-date data available. For example, prefer 2020 Census data over 2010 Census data, and newer dataset vintages over older ones.

IMPORTANT: This is a SINGLE-QUESTION interface. Users cannot reply or ask follow-up questions. Your response must be complete and self-contained. DO NOT:
- Ask clarifying questions
- Offer to help with follow-up tasks
- Say "let me know if you need more help"
- Suggest the user ask for more details

CRITICAL RULES:
1. NEVER fabricate or make up data. ALL data must come from tool calls.
2. ONLY provide information that comes directly from the datasets you query. Do NOT supplement with your general knowledge, historical facts, or commentary not found in the data. For example, if asked about the deepest point on Earth, identify it from the data but do NOT add historical information, discovery dates, or trivia unless that information is in the dataset attributes.
3. If you cannot find data to answer a question, say so honestly. Do not fill gaps with your own knowledge.
4. Always search for datasets before trying to query features.
5. ALWAYS add relevant data to the map using add_filtered_layer - visual context helps users understand the answer. Even for count questions, show the features on the map.

WORKFLOW for data questions:
1. FIRST, briefly explain your approach in 1-2 sentences (e.g., "I'll search for flood-related datasets, then query features near Galveston to show flood zones on the map.")
2. Use search_datasets to find relevant datasets based on the user's question
3. If needed, use get_dataset to get full details about a specific dataset (check schema.layers[0].fields for field names)
4. ALWAYS use add_filtered_layer to show relevant features on the map - users can click features to see their attributes
5. Use count_features if you need to know the total count
6. Summarize findings in natural language, mentioning what's shown on the map

CHOOSING THE RIGHT DATASET - PRIORITY ORDER:
When search returns multiple datasets, prefer them in this order:

1. **LOCAL/SPECIFIC DATA (Best)**: City, county, or state-specific datasets
   - Example: "Seattle Building Footprints" from SeattleData is BETTER than "Overture Buildings" for Seattle queries
   - Look for: orgDisplayName containing city/county names, coverageScope="local" or "regional"

2. **AUTHORITATIVE DATA**: Living Atlas datasets marked isAuthoritative=true
   - Official government or agency data with known provenance

3. **NATIONAL/THEMED DATA**: Living Atlas datasets with good coverage for the area
   - Example: USA Parks, US Census data, FEMA flood zones

4. **GENERIC GLOBAL DATA (Fallback)**: Overture/GeoParquet datasets
   - Only use when no better local/specific data exists
   - Overture data (source="geoparquet") is global but generic - no local attributes

DATASET SELECTION CRITERIA:
- relevanceScore: Higher is better (semantic match to query)
- coverageScope: Match to user's intent (global/continental/national/regional/local)
  - For "US county boundaries" or similar national queries, prefer "national" or "continental" scope
  - For city-specific queries, prefer "local" or "regional" over global
- isAuthoritative: Prefer authoritative datasets when available
- hasQueryableService: If user wants to see actual data, prefer queryable datasets
- source: Prefer "living_atlas" or "custom_org" over "geoparquet" for location-specific queries

AVAILABLE TOOLS:
- search_datasets: Semantic search across all indexed datasets. Use this first to find relevant data.
- get_dataset: Get full metadata for a specific dataset by ID. Returns field names in schema.layers[0].fields.
- add_filtered_layer: Add a layer to the map for visualization. Works with both FeatureServer AND MapServer URLs. Does NOT auto-zoom - you must provide zoomToLocation to zoom. Users can click features to see their attributes.
- query_feature_service: Query features to inspect their attributes. Returns up to 10 records. Does NOT add anything to the map.
- count_features: Count features matching a WHERE clause without returning data. Does NOT add anything to the map.
- query_statistics: GROUP BY aggregation for "most common", "total by", "average per" questions. Returns top results sorted by count/sum/etc.
- geocode_location: Find a place, optionally add a pin marker and/or zoom to it. Use zoomTo=false if adding a layer at the same location (to avoid double-zoom).
- query_overture: FALLBACK ONLY - Query Overture GeoParquet data directly. Only use when search_datasets returns no good local/specific matches.

WHEN TO USE query_statistics:
- Questions about frequency: "most common", "how many of each", "breakdown by"
- Questions about aggregates: "total population by state", "average income per county"
- WORKFLOW:
  1. search_datasets to find relevant data
  2. get_dataset to discover field names in schema.layers[0].fields (field name, type, alias)
  3. query_statistics with the appropriate groupByField and statisticType
- Example: "Most common county name in the US" → search for county data → get_dataset to find NAME field → query_statistics(groupByField="NAME", statisticType="count", orderBy="desc")
- For numeric aggregates (sum, avg, min, max), specify both groupByField AND statisticField

COUNTING AND STATISTICS FOR OVERTURE DATA:
- count_features and query_statistics work with BOTH ArcGIS (serviceUrl) AND Overture (sourceId)
- For ArcGIS: use serviceUrl from the dataset
- For Overture: use sourceId (e.g., "overture-buildings", "overture-places")
- Overture queries REQUIRE a bbox - geocode the location first to get coordinates

Available Overture sourceIds:
- overture-buildings: Building footprints (2.3B+ globally)
- overture-places: Points of interest with categories (use groupByField="category" for stats)
- overture-transportation: Road network segments
- overture-addresses: Address points
- overture-divisions: Administrative boundaries
- overture-water: Water features (lakes, rivers, coastlines)

Example workflow for "How many buildings in downtown Portland?":
1. geocode_location("downtown Portland, Oregon") → get bbox and center coordinates
2. count_features(sourceId="overture-buildings", bbox=[from geocode result])

Example workflow for "What are the most common place categories in Seattle?":
1. geocode_location("Seattle, WA") → get bbox
2. query_statistics(sourceId="overture-places", bbox=[from geocode], groupByField="category", statisticType="count")

WHEN TO USE query_overture (FALLBACK ONLY):
- ONLY use when search_datasets returns no suitable local/city-specific data for the query
- Example: User asks for "hospitals in small-town Iowa" and search only returns generic Overture Places
- Do NOT use if search found city/county/state-specific data (e.g., "Seattle Hospitals" dataset)
- The tool queries global Overture data which lacks local attributes - always prefer indexed local data
- IMPORTANT: query_overture AUTOMATICALLY adds data to the map and zooms to the location. Do NOT call add_filtered_layer after query_overture - the data is already displayed.

SPATIAL QUERIES (finding features near/within other features):
- Use spatial_query when the user asks about proximity or containment between two datasets
- Example: "schools within 10 miles of wildfires" → search for both datasets → spatial_query with within_distance
- Example: "hospitals in flood zones" → search for both → spatial_query with intersects
- Workflow: 1) search_datasets to find source + target service URLs, 2) geocode_location to get a bbox for the area of interest, 3) spatial_query with sourceBbox
- IMPORTANT: ALWAYS provide sourceBbox to constrain the query to the area of interest. Without it, the source query returns the first 200 features from anywhere in the layer (which may be far from the user's area). Use geocode_location first to get coordinates for the location mentioned by the user.
- Source = the features to search around (e.g., wildfires), Target = the features to find (e.g., schools)
- The tool automatically visualizes source, buffer zone, and results on the map
- Results include a resultGeometryId that can be reused as sourceGeometryId for chaining queries
- For GeoParquet-to-GeoParquet queries (both sourceId + targetId), uses optimized DuckDB spatial join

LIMITATIONS:
- Feature queries work on Living Atlas datasets with a serviceUrl (both FeatureServer and MapServer URLs support /query)
- query_overture is slower than indexed data and has limited attributes
- WHERE clauses must use standard SQL syntax (field = 'value', field > 100, etc.)

RESPONSE FORMAT:
- Use markdown formatting for readability (headers, lists, bold)
- Be concise - only report what's in the data, nothing more
- When you find relevant datasets, briefly describe the best match
- Always mention that the data is shown on the map and users can click features to see details
- If a query returns no results, explain why
- Do NOT add educational content, historical context, interesting facts, or any information not present in the queried data attributes
- Your role is to find and present data, not to teach or provide commentary${scaleContext}`;
}

// Tool definitions for Claude
const TOOLS: ToolDefinition[] = [
  {
    name: 'search_datasets',
    description: 'Search for geospatial datasets using natural language. Returns datasets from ArcGIS Living Atlas and Overture Maps that match the query semantically.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query describing the data you are looking for (e.g., "building footprints", "roads in California", "parks")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5, max: 20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_dataset',
    description: 'Get full metadata for a specific dataset by its ID. Use this after search_datasets to get more details about a promising result.',
    input_schema: {
      type: 'object',
      properties: {
        datasetId: {
          type: 'string',
          description: 'The UUID of the dataset to retrieve',
        },
      },
      required: ['datasetId'],
    },
  },
  {
    name: 'query_feature_service',
    description: 'Query features from an ArcGIS Feature Service or Map Service to inspect their attributes. Returns up to 10 records. Does NOT add anything to the map - use add_filtered_layer to visualize data.',
    input_schema: {
      type: 'object',
      properties: {
        serviceUrl: {
          type: 'string',
          description: 'The ArcGIS service URL to query (FeatureServer or MapServer)',
        },
        where: {
          type: 'string',
          description: 'SQL WHERE clause to filter features (e.g., "STATE_NAME = \'Oregon\'", "POPULATION > 100000"). Use 1=1 for no filter.',
        },
        bbox: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional bounding box [xmin, ymin, xmax, ymax] in WGS84 to filter spatially',
        },
        outFields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of field names to return. Defaults to all fields.',
        },
      },
      required: ['serviceUrl'],
    },
  },
  {
    name: 'count_features',
    description: 'Count features matching criteria without returning the actual data. Works with BOTH ArcGIS Feature Services (serviceUrl) AND Overture/GeoParquet sources (sourceId). Provide exactly one of serviceUrl or sourceId.',
    input_schema: {
      type: 'object',
      properties: {
        serviceUrl: {
          type: 'string',
          description: 'The ArcGIS Feature Service URL to query (use for Living Atlas/custom org data)',
        },
        sourceId: {
          type: 'string',
          description: 'GeoParquet source ID for Overture data (e.g., "overture-buildings", "overture-places", "overture-transportation", "overture-addresses", "overture-divisions", "overture-water")',
        },
        where: {
          type: 'string',
          description: 'SQL WHERE clause to filter features. Use 1=1 to count all features. (ArcGIS only - ignored for GeoParquet)',
        },
        bbox: {
          type: 'array',
          items: { type: 'number' },
          description: 'Bounding box [xmin, ymin, xmax, ymax] in WGS84 to filter spatially. REQUIRED for GeoParquet sources, optional for ArcGIS.',
        },
      },
      required: [],
    },
  },
  {
    name: 'add_filtered_layer',
    description: 'Add a layer to the map for visualization. Works with both FeatureServer and MapServer URLs. The layer is added but the map does NOT auto-zoom unless you provide zoomToLocation. Use this to show data on the map.',
    input_schema: {
      type: 'object',
      properties: {
        serviceUrl: {
          type: 'string',
          description: 'The ArcGIS service URL to add (FeatureServer or MapServer). Include the layer index if available (e.g., ".../MapServer/3").',
        },
        where: {
          type: 'string',
          description: 'SQL WHERE clause to filter features (e.g., "STATE_NAME = \'Oregon\'", "POPULATION > 100000"). Use 1=1 for no filter.',
        },
        label: {
          type: 'string',
          description: 'Label for the layer shown on the map (e.g., "Oregon Counties", "Large Cities")',
        },
        bbox: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional bounding box [xmin, ymin, xmax, ymax] in WGS84 to spatially filter the layer. Only features intersecting this extent will be displayed. Use geocode_location first to get coordinates.',
        },
        zoomToLocation: {
          type: 'string',
          description: 'A location name to zoom the map to after adding the layer (e.g., "Oregon", "Denver, Colorado"). If not provided, the map will NOT zoom.',
        },
        style: {
          type: 'object',
          description: 'Optional styling for the layer',
          properties: {
            color: {
              type: 'string',
              description: 'Hex color for the layer (e.g., "#E24E42" for coral, "#1D809F" for teal)',
            },
            fillOpacity: {
              type: 'number',
              description: 'Fill opacity from 0 to 1 (default: 0.3)',
            },
            strokeWidth: {
              type: 'number',
              description: 'Stroke width in pixels (default: 2)',
            },
          },
        },
      },
      required: ['serviceUrl', 'where', 'label'],
    },
  },
  {
    name: 'geocode_location',
    description: 'Convert a place name to geographic coordinates and bounding box. Can optionally add a pin marker and/or zoom to the location.',
    input_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'Place name to geocode (e.g., "Portland, Oregon", "Texas", "Central Park, NYC")',
        },
        addMarker: {
          type: 'boolean',
          description: 'Whether to add a pin marker at the location (default: true).',
        },
        zoomTo: {
          type: 'boolean',
          description: 'Whether to zoom the map to this location (default: true). Set to false if you want to add a layer at this location but zoom elsewhere.',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'query_overture',
    description: 'FALLBACK ONLY: Query Overture Maps GeoParquet data directly. Only use when search_datasets returns no suitable local/specific data. Returns GeoJSON features and AUTOMATICALLY adds them to the map (do NOT call add_filtered_layer after this). Prefer indexed local data when available.',
    input_schema: {
      type: 'object',
      properties: {
        dataType: {
          type: 'string',
          enum: ['places', 'buildings'],
          description: 'Type of Overture data to query. "places" for POIs (hospitals, restaurants, schools, etc.), "buildings" for building footprints.',
        },
        location: {
          type: 'string',
          description: 'Location to search in (e.g., "Seattle, WA", "downtown Portland"). Will be geocoded to a bounding box.',
        },
        category: {
          type: 'string',
          description: 'For places only: category filter (e.g., "hospital", "restaurant", "school", "hotel", "pharmacy", "bank"). Case-insensitive partial match.',
        },
        nameContains: {
          type: 'string',
          description: 'Optional: filter by name containing this text (case-insensitive)',
        },
        limit: {
          type: 'number',
          description: 'Maximum features to return (default: 50, max: 200)',
        },
      },
      required: ['dataType', 'location'],
    },
  },
  {
    name: 'query_statistics',
    description: 'Query statistics (GROUP BY aggregation) from a data source. Works with BOTH ArcGIS Feature Services (serviceUrl) AND Overture/GeoParquet sources (sourceId). Use for questions like "most common", "how many of each", "total by category". Provide exactly one of serviceUrl or sourceId.',
    input_schema: {
      type: 'object',
      properties: {
        serviceUrl: {
          type: 'string',
          description: 'The ArcGIS Feature Service URL to query (use for Living Atlas/custom org data)',
        },
        sourceId: {
          type: 'string',
          description: 'GeoParquet source ID for Overture data (e.g., "overture-buildings", "overture-places"). For places, groupByField can be "category" or "name".',
        },
        groupByField: {
          type: 'string',
          description: 'Field name to group by. For ArcGIS: check schema.layers[0].fields. For Overture places: "category" or "name". For other Overture: "name".',
        },
        statisticType: {
          type: 'string',
          enum: ['count', 'sum', 'avg', 'min', 'max'],
          description: 'Type of aggregation: "count" for frequency, "sum"/"avg"/"min"/"max" for numeric fields',
        },
        statisticField: {
          type: 'string',
          description: 'Field to aggregate (required for sum/avg/min/max, ignored for count)',
        },
        where: {
          type: 'string',
          description: 'Optional SQL WHERE clause to filter before aggregating. (ArcGIS only - ignored for GeoParquet)',
        },
        bbox: {
          type: 'array',
          items: { type: 'number' },
          description: 'Bounding box [xmin, ymin, xmax, ymax] in WGS84. REQUIRED for GeoParquet sources, optional for ArcGIS.',
        },
        orderBy: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order for results. Default: "desc" (highest/most common first)',
        },
        limit: {
          type: 'number',
          description: 'Maximum groups to return (default: 10, max: 20)',
        },
      },
      required: ['groupByField', 'statisticType'],
    },
  },
  {
    name: 'spatial_query',
    description: 'Find features from one dataset that are near, within, or intersecting features from another dataset. Examples: "schools within 10 miles of wildfires", "hospitals near earthquake zones", "buildings within city boundaries". Requires two data sources (source and target) and a spatial relationship. Use geocode_location or search_datasets first to identify service URLs or bounding boxes.',
    input_schema: {
      type: 'object',
      properties: {
        sourceServiceUrl: {
          type: 'string',
          description: 'ArcGIS service URL for the source features (e.g., the wildfires layer). Provide exactly ONE of sourceServiceUrl, sourceId, or sourceGeometryId.',
        },
        sourceId: {
          type: 'string',
          description: 'GeoParquet source ID for source features (e.g., "overture-places", "overture-buildings"). Requires sourceBbox.',
        },
        sourceGeometryId: {
          type: 'string',
          description: 'Reuse geometry from a previous spatial_query result (the resultGeometryId). Enables chaining queries.',
        },
        sourceWhere: {
          type: 'string',
          description: 'Optional SQL WHERE to filter source features (e.g., "FIRE_TYPE = \'Wildfire\'")',
        },
        sourceBbox: {
          type: 'array',
          items: { type: 'number' },
          description: 'Bounding box [xmin, ymin, xmax, ymax] in WGS84 to constrain source features to an area of interest. REQUIRED when using sourceId. STRONGLY RECOMMENDED for sourceServiceUrl too — without it, the query returns the first 200 features from anywhere in the layer which may miss the target area entirely. Use geocode_location to get coordinates.',
        },
        targetServiceUrl: {
          type: 'string',
          description: 'ArcGIS service URL for the target features to find (e.g., the schools layer). Provide exactly ONE of targetServiceUrl or targetId.',
        },
        targetId: {
          type: 'string',
          description: 'GeoParquet source ID for target features (e.g., "overture-places", "overture-buildings").',
        },
        targetWhere: {
          type: 'string',
          description: 'Optional SQL WHERE to filter target features (e.g., "TYPE = \'Elementary School\'")',
        },
        spatialRelation: {
          type: 'string',
          enum: ['within_distance', 'intersects', 'contains', 'within'],
          description: '"within_distance" (requires distance), "intersects" (any overlap), "contains" (source contains target), "within" (target within source)',
        },
        distance: {
          type: 'number',
          description: 'Distance for within_distance relation. Required when spatialRelation is "within_distance".',
        },
        distanceUnit: {
          type: 'string',
          enum: ['miles', 'kilometers', 'meters'],
          description: 'Unit for distance (default: "miles")',
        },
        mode: {
          type: 'string',
          enum: ['features', 'statistics'],
          description: '"features" returns matching features (default). "statistics" returns grouped counts/aggregations.',
        },
        groupByField: {
          type: 'string',
          description: 'For statistics mode: field to group results by',
        },
        statisticType: {
          type: 'string',
          enum: ['count', 'sum', 'avg', 'min', 'max'],
          description: 'For statistics mode: aggregation type (default: "count")',
        },
        statisticField: {
          type: 'string',
          description: 'For statistics mode: field to aggregate (required for sum/avg/min/max)',
        },
        label: {
          type: 'string',
          description: 'Label for the result layer shown on the map (e.g., "Schools near wildfires")',
        },
      },
      required: ['spatialRelation'],
    },
  },
];

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
}

export class ChatService {
  /**
   * Generate an unguessable, URL-friendly ID for sharing
   */
  private generateShareId(): string {
    return generateShareId();
  }

  /**
   * Look up a dataset ID by its service URL
   */
  private async getDatasetIdByServiceUrl(serviceUrl: string): Promise<string | null> {
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM datasets WHERE service_url = $1 LIMIT 1`,
      [serviceUrl]
    );
    return row?.id || null;
  }

  /**
   * Validate that a service URL is in our indexed datasets (whitelist check)
   * This prevents the AI from being manipulated into querying arbitrary external services
   */
  private async validateServiceUrl(serviceUrl: string): Promise<{ valid: boolean; error?: string }> {
    // Normalize the URL for comparison (remove trailing slashes, query params)
    const normalizeUrl = (url: string): string => {
      try {
        const parsed = new URL(url);
        // Remove query string and trailing slashes
        return (parsed.origin + parsed.pathname).replace(/\/+$/, '').toLowerCase();
      } catch {
        return url.toLowerCase().replace(/\/+$/, '');
      }
    };

    const normalizedInput = normalizeUrl(serviceUrl);

    // Check if this service URL exists in our datasets
    // Use LIKE to handle URL variations (with/without layer index, etc.)
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM datasets
       WHERE LOWER(service_url) LIKE $1
          OR LOWER(service_url) LIKE $2
       LIMIT 1`,
      [`${normalizedInput}%`, `${normalizedInput.replace('/featureserver', '/mapserver')}%`]
    );

    if (row) {
      return { valid: true };
    }

    // Check if it's an ArcGIS Online or ArcGIS Server URL (legitimate domains)
    const validDomains = [
      'services.arcgis.com',
      'services1.arcgis.com',
      'services2.arcgis.com',
      'services3.arcgis.com',
      'services4.arcgis.com',
      'services5.arcgis.com',
      'services6.arcgis.com',
      'services7.arcgis.com',
      'services8.arcgis.com',
      'services9.arcgis.com',
      'server.arcgisonline.com',
      'sampleserver6.arcgisonline.com',
    ];

    try {
      const parsed = new URL(serviceUrl);
      const hostname = parsed.hostname.toLowerCase();

      // If it's from a known ArcGIS domain, allow it but log for review
      if (validDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
        console.warn(`Service URL not in index but from valid ArcGIS domain: ${serviceUrl}`);
        return { valid: true };
      }
    } catch {
      // Invalid URL format
    }

    return {
      valid: false,
      error: 'This service URL is not in our indexed datasets. Please use search_datasets to find available data sources.'
    };
  }

  /**
   * Execute a tool call and return the result
   */
  private async executeTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    emitEvent: (event: StreamEvent) => void
  ): Promise<{ result: unknown; mapAction?: MapAction; referencedDatasetIds?: string[]; geoparquetSources?: SourceDataset[] }> {
    const referencedDatasetIds: string[] = [];
    const geoparquetSources: SourceDataset[] = [];

    switch (toolName) {
      case 'search_datasets': {
        const query = toolInput.query as string;
        const limit = Math.min((toolInput.limit as number) || 5, 20);

        const searchResult = await searchService.search({
          query,
          limit,
        });

        // Don't track search results as referenced - only track datasets actually used
        // (via get_dataset, add_filtered_layer, query_feature_service, count_features)

        // Return results with relevance and extent info for better AI decisions
        return {
          result: {
            total: searchResult.total,
            datasets: searchResult.datasets.map((d) => {
              // Determine coverage scope from extent
              let coverageScope = 'unknown';
              if (d.extentBbox) {
                const bbox = d.extentBbox;
                const width = Math.abs((bbox.xmax || 0) - (bbox.xmin || 0));
                const height = Math.abs((bbox.ymax || 0) - (bbox.ymin || 0));
                const area = width * height;
                if (area > 10000) coverageScope = 'global';
                else if (area > 1000) coverageScope = 'continental';
                else if (area > 100) coverageScope = 'national';
                else if (area > 10) coverageScope = 'regional';
                else coverageScope = 'local';
              }

              return {
                id: d.id,
                name: d.name,
                source: d.source,
                orgDisplayName: d.orgDisplayName, // e.g., "Seattle Open Data", "King County" - indicates local data
                snippet: d.snippet || d.description?.substring(0, 200),
                dataType: d.dataType,
                serviceUrl: d.serviceUrl,
                serviceType: d.serviceUrl?.includes('/MapServer') ? 'MapServer' : d.serviceUrl?.includes('/FeatureServer') ? 'FeatureServer' : undefined,
                hasQueryableService: !!d.serviceUrl,
                relevanceScore: d.relevanceScore?.toFixed(3),
                coverageScope,
                isAuthoritative: d.isAuthoritative || false,
                tags: d.tags?.slice(0, 5), // First 5 tags for context
              };
            }),
          },
        };
      }

      case 'get_dataset': {
        const datasetId = toolInput.datasetId as string;

        const row = await queryOne<DatasetRow>(
          `
          SELECT
            id, source, source_id, name, description, snippet,
            tags, categories, data_type, extent_bbox,
            source_url, service_url, access_type,
            geoparquet_source_id, arcgis_item_id, arcgis_owner, arcgis_type,
            is_authoritative, org_display_name, schema, indexed_at
          FROM datasets
          WHERE id = $1
        `,
          [datasetId]
        );

        if (!row) {
          return { result: { error: 'Dataset not found' } };
        }

        referencedDatasetIds.push(datasetId);

        const dataset: Dataset = {
          id: row.id,
          source: row.source as Dataset['source'],
          sourceId: row.source_id,
          name: row.name,
          description: row.description,
          snippet: row.snippet,
          tags: row.tags || [],
          categories: row.categories || [],
          dataType: row.data_type as Dataset['dataType'],
          extentBbox: row.extent_bbox as Dataset['extentBbox'],
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
          indexedAt: row.indexed_at,
        };

        return {
          result: dataset,
          referencedDatasetIds,
        };
      }

      case 'query_feature_service': {
        const serviceUrl = toolInput.serviceUrl as string;
        const where = toolInput.where as string | undefined;
        const bbox = toolInput.bbox as [number, number, number, number] | undefined;
        const outFields = toolInput.outFields as string[] | undefined;

        try {
          // Validate service URL is in our index (security check)
          const urlValidation = await this.validateServiceUrl(serviceUrl);
          if (!urlValidation.valid) {
            return { result: { error: urlValidation.error } };
          }

          // Track the dataset being used
          const datasetId = await this.getDatasetIdByServiceUrl(serviceUrl);
          if (datasetId) {
            referencedDatasetIds.push(datasetId);
          }

          const queryResult = await featureQueryService.queryFeatures({
            serviceUrl,
            where,
            bbox,
            outFields,
          });

          // Query only - does NOT add to map. Use add_filtered_layer to visualize.
          return {
            result: {
              featureCount: queryResult.features.length,
              totalCount: queryResult.totalCount,
              truncated: queryResult.truncated,
              features: queryResult.features.map((f) => ({
                properties: f.properties,
                geometryType: f.geometry.type,
              })),
            },
            referencedDatasetIds,
          };
        } catch (error) {
          return {
            result: {
              error: error instanceof Error ? error.message : 'Query failed',
            },
          };
        }
      }

      case 'count_features': {
        const serviceUrl = toolInput.serviceUrl as string | undefined;
        const sourceId = toolInput.sourceId as string | undefined;
        const where = toolInput.where as string | undefined;
        const bbox = toolInput.bbox as [number, number, number, number] | undefined;

        // Validate: exactly one of serviceUrl or sourceId
        if (serviceUrl && sourceId) {
          return { result: { error: 'Provide either serviceUrl or sourceId, not both' } };
        }
        if (!serviceUrl && !sourceId) {
          return { result: { error: 'Must provide either serviceUrl (for ArcGIS) or sourceId (for Overture/GeoParquet)' } };
        }

        try {
          if (sourceId) {
            // GeoParquet/Overture path
            if (!bbox) {
              return { result: { error: 'bbox is required for Overture/GeoParquet sources. Use geocode_location first to get the bbox for a location.' } };
            }

            // Validate source exists
            const source = geoParquetService.getSource(sourceId);
            if (!source) {
              return { result: { error: `Unknown GeoParquet source: ${sourceId}. Available sources: overture-buildings, overture-places, overture-transportation, overture-addresses, overture-divisions, overture-water` } };
            }

            const count = await geoParquetService.getCountForBbox(sourceId, bbox);

            // Track as geoparquet source
            geoparquetSources.push({
              id: sourceId,
              name: source.name,
              source: 'geoparquet',
              sourceUrl: source.sourceUrl,
              serviceUrl: undefined,
            });

            return {
              result: { count, sourceId, sourceName: source.name },
              geoparquetSources,
            };
          } else {
            // ArcGIS path (existing logic)
            // Validate service URL is in our index (security check)
            const urlValidation = await this.validateServiceUrl(serviceUrl!);
            if (!urlValidation.valid) {
              return { result: { error: urlValidation.error } };
            }

            // Track the dataset being used
            const datasetId = await this.getDatasetIdByServiceUrl(serviceUrl!);
            if (datasetId) {
              referencedDatasetIds.push(datasetId);
            }

            const count = await featureQueryService.countFeatures({
              serviceUrl: serviceUrl!,
              where,
              bbox,
            });

            return {
              result: { count },
              referencedDatasetIds,
            };
          }
        } catch (error) {
          return {
            result: {
              error: error instanceof Error ? error.message : 'Count failed',
            },
          };
        }
      }

      case 'add_filtered_layer': {
        const serviceUrl = toolInput.serviceUrl as string;
        const where = toolInput.where as string;
        const label = toolInput.label as string;
        const bbox = toolInput.bbox as [number, number, number, number] | undefined;
        const zoomToLocation = toolInput.zoomToLocation as string | undefined;
        const style = toolInput.style as { color?: string; fillOpacity?: number; strokeWidth?: number } | undefined;

        try {
          // Validate service URL is in our index (security check)
          const urlValidation = await this.validateServiceUrl(serviceUrl);
          if (!urlValidation.valid) {
            return { result: { error: urlValidation.error } };
          }

          // Track the dataset being used
          const datasetId = await this.getDatasetIdByServiceUrl(serviceUrl);
          if (datasetId) {
            referencedDatasetIds.push(datasetId);
          }

          // Fetch service metadata to get minScale/maxScale
          let minScale = 0;
          let maxScale = 0;
          try {
            const metadataUrl = `${serviceUrl}?f=json`;
            const metadataResponse = await fetch(metadataUrl);
            if (metadataResponse.ok) {
              const metadata = await metadataResponse.json();
              minScale = metadata.minScale || 0;
              maxScale = metadata.maxScale || 0;
            }
          } catch {
            // Non-critical - continue without scale info
          }

          // First count how many features match to validate the query
          const count = await featureQueryService.countFeatures({
            serviceUrl,
            where,
            bbox,
          });

          if (count === 0) {
            return {
              result: {
                error: `No features found matching: ${where}`,
                suggestion: 'Check that the field names and values are correct for this dataset.',
              },
            };
          }

          // Emit add_feature_layer action - this adds the actual FeatureLayer to the map
          // When bbox is provided, the map applies a spatial filter so only features
          // intersecting the area of interest are displayed
          const addLayerAction: MapAction = {
            type: 'add_feature_layer',
            serviceUrl,
            definitionExpression: where,
            label,
            style,
            bbox,
          };
          emitEvent({ type: 'map_action', action: addLayerAction });

          // If a specific location to zoom to is provided, geocode and zoom there
          let zoomBbox: [number, number, number, number] | undefined;
          if (zoomToLocation) {
            const geocodedBbox = await geocodingService.geocode(zoomToLocation);
            if (geocodedBbox) {
              zoomBbox = geocodedBbox;
            }
          }

          // Zoom to the geocoded location
          if (zoomBbox) {
            // Zoom to the location, with minScale constraint so scale-restricted layers are visible
            const zoomAction: MapAction = {
              type: 'zoom_to_extent',
              bbox: zoomBbox,
              // If the layer has a minScale, ensure we zoom in far enough to see it
              ...(minScale > 0 ? { maxScale: minScale } : {}),
            };
            emitEvent({ type: 'map_action', action: zoomAction });
          } else if (minScale > 0) {
            // No zoomToLocation but layer has minScale — the AI didn't specify where to zoom,
            // so we can't auto-zoom, but the LayerList will show the "zoom in" indicator
          }

          // Build scale info for AI context
          let scaleNote = '';
          if (minScale > 0) {
            scaleNote = ` Note: This layer is only visible when zoomed in past 1:${Math.round(minScale).toLocaleString()}.`;
            if (!zoomToLocation) {
              scaleNote += ' You may need to zoom in for the layer to render.';
            }
          }

          return {
            result: {
              featureCount: count,
              message: (zoomBbox
                ? `Added layer "${label}" to the map with ${count} features, zoomed to ${zoomToLocation}.`
                : `Added layer "${label}" to the map with ${count} features.`) + scaleNote,
              minScale: minScale || undefined,
              maxScale: maxScale || undefined,
              // Include bbox for replay
              zoomBbox,
            },
            referencedDatasetIds,
          };
        } catch (error) {
          return {
            result: {
              error: error instanceof Error ? error.message : 'Failed to add layer',
            },
          };
        }
      }

      case 'geocode_location': {
        const location = toolInput.location as string;
        const addMarker = toolInput.addMarker !== false; // Default to true
        const zoomTo = toolInput.zoomTo !== false; // Default to true - zoom to the geocoded location
        const bbox = await geocodingService.geocode(location);

        if (!bbox) {
          return {
            result: {
              error: `Could not geocode location: ${location}`,
            },
          };
        }

        const center: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

        // Add a marker at the location if requested
        if (addMarker) {
          const markerAction: MapAction = {
            type: 'add_marker',
            coordinates: center,
            label: location,
            color: '#E24E42', // Coral
          };
          emitEvent({ type: 'map_action', action: markerAction });
        }

        // Zoom to the location if requested (default: true)
        if (zoomTo) {
          const zoomAction: MapAction = {
            type: 'zoom_to_extent',
            bbox,
          };
          emitEvent({ type: 'map_action', action: zoomAction });
        }

        return {
          result: {
            location,
            bbox,
            center,
          },
        };
      }

      case 'query_overture': {
        const dataType = toolInput.dataType as 'places' | 'buildings';
        const location = toolInput.location as string;
        const category = toolInput.category as string | undefined;
        const nameContains = toolInput.nameContains as string | undefined;
        const limit = Math.min((toolInput.limit as number) || 50, 200);

        try {
          // Geocode the location to get a bbox
          const bbox = await geocodingService.geocode(location);
          if (!bbox) {
            return {
              result: {
                error: `Could not geocode location: ${location}`,
              },
            };
          }

          let previewResult;
          if (dataType === 'places') {
            previewResult = await geoParquetService.queryPlaces(bbox, {
              category,
              nameContains,
              limit,
            });
          } else {
            previewResult = await geoParquetService.queryBuildings(bbox, {
              nameContains,
              limit,
            });
          }

          // Emit GeoJSON to map
          if (previewResult.features.length > 0) {
            const label = category
              ? `Overture ${category} in ${location}`
              : `Overture ${dataType} in ${location}`;

            const geojsonAction: MapAction = {
              type: 'add_geojson',
              geojson: previewResult as unknown as GeoJSONFeatureCollection,
              label,
              style: {
                color: '#1D809F', // Teal for Overture data
                fillOpacity: 0.4,
              },
            };
            emitEvent({ type: 'map_action', action: geojsonAction });

            // Zoom to the location
            const zoomAction: MapAction = {
              type: 'zoom_to_extent',
              bbox,
            };
            emitEvent({ type: 'map_action', action: zoomAction });

            // Track Overture as a source
            const sourceId = dataType === 'places' ? 'overture-places' : 'overture-buildings';
            geoparquetSources.push({
              id: sourceId,
              name: previewResult.source?.name || `Overture ${dataType.charAt(0).toUpperCase() + dataType.slice(1)}`,
              source: 'geoparquet',
              sourceUrl: 'https://docs.overturemaps.org/',
              serviceUrl: undefined,
            });
          }

          return {
            result: {
              featureCount: previewResult.features.length,
              truncated: previewResult.truncated,
              source: previewResult.source,
              sampleFeatures: previewResult.features.slice(0, 5).map((f) => ({
                name: f.properties?.name,
                category: f.properties?.category,
              })),
              message: previewResult.features.length > 0
                ? `Found ${previewResult.features.length} ${dataType} in ${location}. Data shown on map.`
                : `No ${dataType} found in ${location} matching the criteria.`,
            },
            geoparquetSources: geoparquetSources.length > 0 ? geoparquetSources : undefined,
          };
        } catch (error) {
          return {
            result: {
              error: error instanceof Error ? error.message : 'Overture query failed',
            },
          };
        }
      }

      case 'query_statistics': {
        const serviceUrl = toolInput.serviceUrl as string | undefined;
        const sourceId = toolInput.sourceId as string | undefined;
        const groupByField = toolInput.groupByField as string;
        const statisticType = toolInput.statisticType as 'count' | 'sum' | 'avg' | 'min' | 'max';
        const statisticField = toolInput.statisticField as string | undefined;
        const where = toolInput.where as string | undefined;
        const bbox = toolInput.bbox as [number, number, number, number] | undefined;
        const orderBy = (toolInput.orderBy as 'asc' | 'desc') || 'desc';
        const limit = Math.min((toolInput.limit as number) || 10, 20);

        // Validate: exactly one of serviceUrl or sourceId
        if (serviceUrl && sourceId) {
          return { result: { error: 'Provide either serviceUrl or sourceId, not both' } };
        }
        if (!serviceUrl && !sourceId) {
          return { result: { error: 'Must provide either serviceUrl (for ArcGIS) or sourceId (for Overture/GeoParquet)' } };
        }

        try {
          if (sourceId) {
            // GeoParquet/Overture path
            if (!bbox) {
              return { result: { error: 'bbox is required for Overture/GeoParquet sources. Use geocode_location first to get the bbox for a location.' } };
            }

            // Validate source exists
            const source = geoParquetService.getSource(sourceId);
            if (!source) {
              return { result: { error: `Unknown GeoParquet source: ${sourceId}. Available sources: overture-buildings, overture-places, overture-transportation, overture-addresses, overture-divisions, overture-water` } };
            }

            const stats = await geoParquetService.queryStatistics(sourceId, bbox, {
              groupByField,
              statisticType,
              statisticField,
              orderBy,
              limit,
            });

            // Track as geoparquet source
            geoparquetSources.push({
              id: sourceId,
              name: source.name,
              source: 'geoparquet',
              sourceUrl: source.sourceUrl,
              serviceUrl: undefined,
            });

            return {
              result: {
                rows: stats.rows,
                groupByField: stats.groupByField,
                statisticType: stats.statisticType,
                statisticField: stats.statisticField,
                totalGroups: stats.totalGroups,
                truncated: stats.truncated,
                sourceId,
                sourceName: source.name,
                message: stats.rows.length > 0
                  ? `Found ${stats.totalGroups} unique values for ${groupByField} from ${source.name}. Showing top ${stats.rows.length}${stats.truncated ? ' (truncated)' : ''}.`
                  : `No data found for ${groupByField} in ${source.name}.`,
              },
              geoparquetSources,
            };
          } else {
            // ArcGIS path (existing logic)
            // Validate service URL is in our index (security check)
            const urlValidation = await this.validateServiceUrl(serviceUrl!);
            if (!urlValidation.valid) {
              return { result: { error: urlValidation.error } };
            }

            // Track the dataset being used
            const datasetId = await this.getDatasetIdByServiceUrl(serviceUrl!);
            if (datasetId) {
              referencedDatasetIds.push(datasetId);
            }

            const stats = await featureQueryService.queryStatistics({
              serviceUrl: serviceUrl!,
              groupByField,
              statisticType,
              statisticField,
              where,
              bbox,
              orderBy,
              limit,
            });

            return {
              result: {
                rows: stats.rows,
                groupByField: stats.groupByField,
                statisticType: stats.statisticType,
                statisticField: stats.statisticField,
                totalGroups: stats.totalGroups,
                truncated: stats.truncated,
                message: stats.rows.length > 0
                  ? `Found ${stats.totalGroups} unique values for ${groupByField}. Showing top ${stats.rows.length}${stats.truncated ? ' (truncated)' : ''}.`
                  : `No data found for ${groupByField}.`,
              },
              referencedDatasetIds,
            };
          }
        } catch (error) {
          return {
            result: {
              error: error instanceof Error ? error.message : 'Statistics query failed',
            },
          };
        }
      }

      case 'spatial_query': {
        try {
          const spatialParams = {
            sourceServiceUrl: toolInput.sourceServiceUrl as string | undefined,
            sourceId: toolInput.sourceId as string | undefined,
            sourceGeometryId: toolInput.sourceGeometryId as string | undefined,
            sourceWhere: toolInput.sourceWhere as string | undefined,
            sourceBbox: toolInput.sourceBbox as [number, number, number, number] | undefined,
            targetServiceUrl: toolInput.targetServiceUrl as string | undefined,
            targetId: toolInput.targetId as string | undefined,
            targetWhere: toolInput.targetWhere as string | undefined,
            spatialRelation: toolInput.spatialRelation as 'within_distance' | 'intersects' | 'contains' | 'within',
            distance: toolInput.distance as number | undefined,
            distanceUnit: (toolInput.distanceUnit as 'miles' | 'kilometers' | 'meters') || undefined,
            mode: (toolInput.mode as 'features' | 'statistics') || undefined,
            groupByField: toolInput.groupByField as string | undefined,
            statisticType: toolInput.statisticType as 'count' | 'sum' | 'avg' | 'min' | 'max' | undefined,
            statisticField: toolInput.statisticField as string | undefined,
            label: toolInput.label as string | undefined,
          };

          // Validate service URLs are in our index (if ArcGIS sources)
          if (spatialParams.sourceServiceUrl) {
            const urlValidation = await this.validateServiceUrl(spatialParams.sourceServiceUrl);
            if (!urlValidation.valid) {
              return { result: { error: `Source: ${urlValidation.error}` } };
            }
            const datasetId = await this.getDatasetIdByServiceUrl(spatialParams.sourceServiceUrl);
            if (datasetId) referencedDatasetIds.push(datasetId);
          }
          if (spatialParams.targetServiceUrl) {
            const urlValidation = await this.validateServiceUrl(spatialParams.targetServiceUrl);
            if (!urlValidation.valid) {
              return { result: { error: `Target: ${urlValidation.error}` } };
            }
            const datasetId = await this.getDatasetIdByServiceUrl(spatialParams.targetServiceUrl);
            if (datasetId) referencedDatasetIds.push(datasetId);
          }

          // Track GeoParquet sources
          if (spatialParams.sourceId) {
            const source = geoParquetService.getSource(spatialParams.sourceId);
            if (source) {
              geoparquetSources.push({
                id: source.id,
                name: source.name,
                source: 'geoparquet',
                sourceUrl: source.sourceUrl,
              });
            }
          }
          if (spatialParams.targetId) {
            const target = geoParquetService.getSource(spatialParams.targetId);
            if (target) {
              geoparquetSources.push({
                id: target.id,
                name: target.name,
                source: 'geoparquet',
                sourceUrl: target.sourceUrl,
              });
            }
          }

          const spatialResult = await spatialQueryService.executeSpatialQuery(spatialParams, emitEvent);

          return {
            result: spatialResult,
            referencedDatasetIds: referencedDatasetIds.length > 0 ? referencedDatasetIds : undefined,
            geoparquetSources: geoparquetSources.length > 0 ? geoparquetSources : undefined,
          };
        } catch (error) {
          return {
            result: {
              error: error instanceof Error ? error.message : 'Spatial query failed',
            },
          };
        }
      }

      default:
        return {
          result: { error: `Unknown tool: ${toolName}` },
        };
    }
  }

  /**
   * Extract all coordinates from a GeoJSON geometry for extent calculation
   */
  private extractCoordinates(geometry: { type: string; coordinates: unknown }): [number, number][] {
    const coords: [number, number][] = [];

    const extract = (c: unknown): void => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === 'number' && typeof c[1] === 'number') {
        coords.push([c[0] as number, c[1] as number]);
      } else {
        for (const item of c) {
          extract(item);
        }
      }
    };

    extract(geometry.coordinates);
    return coords;
  }

  /**
   * Stream a chat response, yielding events as they occur
   */
  async *streamResponse(
    question: string,
    conversationId?: string,
    mapScale?: number
  ): AsyncGenerator<StreamEvent> {
    const messages: MessageParam[] = [
      { role: 'user', content: question },
    ];

    const referencedDatasetIds: string[] = [];
    const collectedGeoparquetSources: SourceDataset[] = [];
    const collectedActions: MapAction[] = [];
    const toolsCalled: string[] = [];
    let fullResponse = '';

    // Track content blocks for storage (to display in share page)
    const contentBlocks: ContentBlock[] = [];

    // Create event emitter for tool execution
    const pendingMapActions: StreamEvent[] = [];
    const emitEvent = (event: StreamEvent) => {
      pendingMapActions.push(event);
    };

    try {
      // Agentic loop - continue until Claude produces a final response,
      // capped at MAX_AGENTIC_ITERATIONS model calls
      let iterations = 0;
      while (true) {
        if (iterations >= MAX_AGENTIC_ITERATIONS) {
          fullResponse += MAX_ITERATIONS_NOTICE;
          const lastBlock = contentBlocks[contentBlocks.length - 1];
          if (lastBlock && lastBlock.type === 'text') {
            contentBlocks[contentBlocks.length - 1] = {
              type: 'text',
              content: lastBlock.content + MAX_ITERATIONS_NOTICE,
            };
          } else {
            contentBlocks.push({ type: 'text', content: MAX_ITERATIONS_NOTICE });
          }
          yield { type: 'text', content: MAX_ITERATIONS_NOTICE };
          break;
        }
        iterations++;

        const stream = await getClient().messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: getSystemPrompt(mapScale),
          messages,
          tools: TOOLS as Anthropic.Tool[],
          stream: true,
        });

        let currentToolUseId = '';
        let currentToolName = '';
        let currentToolInput = '';
        let currentTextContent = '';
        const toolUseBlocks: ToolUseBlock[] = [];
        let stopReason: string | null = null;

        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'text') {
              // Text block starting
            } else if (event.content_block.type === 'tool_use') {
              currentToolUseId = event.content_block.id;
              currentToolName = event.content_block.name;
              currentToolInput = '';
              toolsCalled.push(currentToolName);
              // Don't yield here - wait for content_block_stop to have full input
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              currentTextContent += event.delta.text;
              yield { type: 'text', content: event.delta.text };

              // Track in contentBlocks: append to last text block or create new one
              const lastBlock = contentBlocks[contentBlocks.length - 1];
              if (lastBlock && lastBlock.type === 'text') {
                contentBlocks[contentBlocks.length - 1] = {
                  type: 'text',
                  content: lastBlock.content + event.delta.text,
                };
              } else {
                contentBlocks.push({ type: 'text', content: event.delta.text });
              }
            } else if (event.delta.type === 'input_json_delta') {
              currentToolInput += event.delta.partial_json;
            }
          } else if (event.type === 'content_block_stop') {
            if (currentToolName && currentToolInput) {
              try {
                const parsedInput = JSON.parse(currentToolInput);
                toolUseBlocks.push({
                  type: 'tool_use',
                  id: currentToolUseId,
                  name: currentToolName,
                  input: parsedInput,
                });

                // Track in contentBlocks as a tool_call
                const toolStep: ChatStep = {
                  id: currentToolUseId,
                  type: 'tool_call',
                  tool: currentToolName,
                  input: parsedInput,
                  timestamp: Date.now(),
                };
                contentBlocks.push({ type: 'tool_call', step: toolStep });

                // Yield tool call with complete input
                yield {
                  type: 'tool_call',
                  id: currentToolUseId,
                  tool: currentToolName,
                  input: parsedInput,
                };
              } catch {
                // Invalid JSON, skip this tool use
              }
              currentToolName = '';
              currentToolInput = '';
            }
          } else if (event.type === 'message_delta') {
            stopReason = event.delta.stop_reason;
          }
        }

        fullResponse += currentTextContent;

        // If stop reason is tool_use, execute tools and continue
        if (stopReason === 'tool_use' && toolUseBlocks.length > 0) {
          // Build assistant message with all content blocks
          const assistantContent: ContentBlockParam[] = [];
          if (currentTextContent) {
            assistantContent.push({ type: 'text', text: currentTextContent });
          }
          for (const toolUse of toolUseBlocks) {
            assistantContent.push({
              type: 'tool_use',
              id: toolUse.id,
              name: toolUse.name,
              input: toolUse.input as Record<string, unknown>,
            });
          }
          messages.push({ role: 'assistant', content: assistantContent });

          // Execute tools and build tool results
          const toolResults: ToolResultBlockParam[] = [];
          for (const toolUse of toolUseBlocks) {
            const { result, referencedDatasetIds: datasetIds, geoparquetSources } = await this.executeTool(
              toolUse.name,
              toolUse.input as Record<string, unknown>,
              emitEvent
            );

            if (datasetIds) {
              referencedDatasetIds.push(...datasetIds);
            }

            if (geoparquetSources) {
              collectedGeoparquetSources.push(...geoparquetSources);
            }

            // Yield any pending map actions and collect them for persistence
            for (const mapEvent of pendingMapActions) {
              yield mapEvent;
              if (mapEvent.type === 'map_action') {
                collectedActions.push(mapEvent.action);
              }
            }
            pendingMapActions.length = 0;

            // Update the corresponding tool_call block in contentBlocks with the result
            const blockIndex = contentBlocks.findIndex(
              (b) => b.type === 'tool_call' && b.step.id === toolUse.id
            );
            if (blockIndex >= 0) {
              const block = contentBlocks[blockIndex];
              if (block.type === 'tool_call') {
                contentBlocks[blockIndex] = {
                  type: 'tool_call',
                  step: {
                    ...block.step,
                    result,
                  },
                };
              }
            }

            yield {
              type: 'tool_result',
              id: toolUse.id,
              tool: toolUse.name,
              result,
            };

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            });
          }

          messages.push({ role: 'user', content: toolResults });
        } else {
          // End turn or max tokens - we're done
          break;
        }
      }

      // Generate an unguessable share ID for the conversation
      const shareId = this.generateShareId();

      // Fetch sources for referenced datasets
      const uniqueDatasetIds = [...new Set(referencedDatasetIds)];
      const sourceDatasets: SourceDataset[] = [];
      if (uniqueDatasetIds.length > 0) {
        for (const datasetId of uniqueDatasetIds) {
          const row = await queryOne<DatasetRow>(
            `SELECT id, name, source, source_url, service_url, org_display_name FROM datasets WHERE id = $1`,
            [datasetId]
          );
          if (row) {
            sourceDatasets.push({
              id: row.id,
              name: row.name,
              source: row.source,
              sourceUrl: row.source_url,
              serviceUrl: row.service_url || undefined,
              orgDisplayName: row.org_display_name || undefined,
            });
          }
        }
      }

      // Add geoparquet/Overture sources (deduplicated by id)
      const addedGeoparquetIds = new Set(sourceDatasets.map(s => s.id));
      for (const geoSource of collectedGeoparquetSources) {
        if (!addedGeoparquetIds.has(geoSource.id)) {
          sourceDatasets.push(geoSource);
          addedGeoparquetIds.add(geoSource.id);
        }
      }

      // Emit sources if any were found
      if (sourceDatasets.length > 0) {
        yield { type: 'sources', datasets: sourceDatasets };
        // Add sources to contentBlocks for storage
        contentBlocks.push({ type: 'sources', datasets: sourceDatasets });
      }

      // Save conversation to database (for sharing and analytics)
      try {
        // Build the messages array for storage with full contentBlocks
        const storedMessages: ChatMessage[] = [
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: question,
            timestamp: Date.now(),
          },
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: fullResponse,
            contentBlocks: contentBlocks, // Store full content blocks for share page
            actions: collectedActions.length > 0 ? collectedActions : undefined,
            timestamp: Date.now(),
          },
        ];

        await query(
          `INSERT INTO chat_conversations (id, question, messages, sources, tools_called, datasets_referenced)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            shareId,
            question,
            JSON.stringify(storedMessages),
            sourceDatasets.length > 0 ? JSON.stringify(sourceDatasets) : null,
            toolsCalled.length > 0 ? toolsCalled : null,
            uniqueDatasetIds.length > 0 ? uniqueDatasetIds : null,
          ]
        );
      } catch (saveError) {
        // Log but don't fail the response if save fails
        console.error('Failed to save conversation:', saveError);
      }

      yield {
        type: 'done',
        conversationId: shareId,
      };

      // Return metadata for logging
      return {
        conversationId: shareId,
        response: fullResponse,
        toolsCalled,
        referencedDatasetIds: [...new Set(referencedDatasetIds)],
      };
    } catch (error) {
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : 'Chat failed',
      };
    }
  }
}

export const chatService = new ChatService();
