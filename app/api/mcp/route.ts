import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { searchService } from '@/services/search.service';
import { validateSearchQuery } from '@/lib/search-query-validation';

/** Error whose message is safe to return to MCP clients. */
class ToolError extends Error {}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Max JSON-RPC calls per HTTP batch, so one rate-limited request can't fan out unboundedly. */
const MAX_BATCH_SIZE = 10;

function requireDatasetId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ToolError('Dataset not found');
  }
  return value;
}

/**
 * MCP (Model Context Protocol) HTTP Endpoint
 *
 * This implements MCP over HTTP so Claude can connect directly via URL.
 * Add this URL to Claude: https://findria.dymaptic.ai/api/mcp
 */

// Types for MCP
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface DatasetRow {
  id: string;
  source: string;
  name: string;
  description: string | null;
  snippet: string | null;
  tags: string[] | null;
  data_type: string | null;
  extent_bbox: string | null;
  source_url: string;
  service_url: string | null;
  arcgis_owner: string | null;
  arcgis_type: string | null;
  org_display_name: string | null;
  schema: string | null;
}

// Tool definitions
const TOOLS = [
  {
    name: 'search_datasets',
    description: `Search for geospatial datasets using natural language.
Understands location names (e.g., "parks in Portland") and data types (e.g., "building footprints", "roads").
Returns datasets from ArcGIS Living Atlas, Overture Maps, public agencies (cities, counties, states, federal), and user-submitted services.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query (e.g., "building footprints in Seattle", "parks near Denver")',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10, max: 50)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_dataset',
    description: `Get detailed metadata for a dataset by ID.
Returns description, schema/fields, service URL, extent, and tags.
Use this to get the ArcGIS service URL for adding data to ArcGIS Pro.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Dataset ID (UUID)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_service_url',
    description: `Get the ArcGIS Feature Service URL for a dataset.
This URL can be used to add the dataset to ArcGIS Pro or other GIS applications.
Returns the service URL along with instructions for adding to ArcGIS Pro.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Dataset ID (UUID)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_sources',
    description: 'List available data sources and dataset counts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Handle tool calls
async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_datasets': {
      const searchQuery = typeof args.query === 'string' ? args.query.trim() : '';
      const validation = validateSearchQuery(searchQuery);
      if (!validation.valid) {
        throw new ToolError(validation.error || 'Invalid query');
      }
      const requestedLimit = Number(args.limit);
      const limit = Number.isFinite(requestedLimit) && requestedLimit >= 1
        ? Math.min(Math.floor(requestedLimit), 50)
        : 10;

      // Call the search service directly (read-only). Going through HTTP
      // would hit the proxy's Referer check and double-count rate limits.
      const data = await searchService.search({ query: searchQuery, limit, offset: 0 });

      // Format results for Claude
      const results = data.datasets.map((d) => ({
        id: d.id,
        name: d.name,
        source: d.orgDisplayName || d.source,
        description: d.snippet || d.description,
        dataType: d.dataType,
        serviceUrl: d.serviceUrl,
        tags: d.tags?.slice(0, 5),
      }));

      return {
        total: data.total || results.length,
        query: {
          original: searchQuery,
          location: data.query?.location,
          topics: data.query?.topics,
        },
        datasets: results,
      };
    }

    case 'get_dataset': {
      const id = requireDatasetId(args.id);

      const row = await queryOne<DatasetRow>(
        `SELECT id, source, name, description, snippet, tags, data_type,
                extent_bbox, source_url, service_url, arcgis_owner, arcgis_type,
                org_display_name, schema
         FROM datasets WHERE id = $1`,
        [id]
      );

      if (!row) {
        throw new ToolError('Dataset not found');
      }

      let schema = null;
      try {
        schema = row.schema
          ? (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema)
          : null;
      } catch { /* ignore corrupted schema data */ }

      let extent = null;
      try {
        extent = row.extent_bbox
          ? (typeof row.extent_bbox === 'string' ? JSON.parse(row.extent_bbox) : row.extent_bbox)
          : null;
      } catch { /* ignore corrupted extent data */ }

      return {
        id: row.id,
        name: row.name,
        source: row.org_display_name || row.source,
        description: row.description || row.snippet,
        dataType: row.data_type,
        serviceUrl: row.service_url,
        sourceUrl: row.source_url,
        arcgisType: row.arcgis_type,
        extent,
        tags: row.tags,
        schema: schema?.layers?.[0]?.fields?.map((f: { name: string; type: string; alias: string }) => ({
          name: f.name,
          type: f.type,
          alias: f.alias,
        })),
      };
    }

    case 'get_service_url': {
      const id = requireDatasetId(args.id);

      const row = await queryOne<DatasetRow>(
        `SELECT id, name, service_url, source_url, data_type, arcgis_type, org_display_name
         FROM datasets WHERE id = $1`,
        [id]
      );

      if (!row) {
        throw new ToolError('Dataset not found');
      }

      if (!row.service_url) {
        return {
          name: row.name,
          source: row.org_display_name || row.source,
          serviceUrl: null,
          sourceUrl: row.source_url,
          message: 'This dataset does not have a service URL available. Use the source URL to access the data.',
        };
      }

      return {
        name: row.name,
        source: row.org_display_name || row.source,
        serviceUrl: row.service_url,
        dataType: row.data_type,
        arcgisType: row.arcgis_type || 'Feature Service',
        instructions: [
          'To add this to ArcGIS Pro:',
          '1. In the Catalog pane, right-click on "Servers"',
          '2. Select "Add ArcGIS Server Connection"',
          '3. Paste the service URL',
          'Or use the ArcGIS Pro MCP server to add it directly.',
        ],
      };
    }

    case 'list_sources': {
      const counts = await query<{ source: string; count: string }>(
        `SELECT source, COUNT(*)::text as count FROM datasets GROUP BY source`
      );

      const sourceMap: Record<string, number> = {};
      let total = 0;
      for (const row of counts) {
        sourceMap[row.source] = parseInt(row.count);
        total += parseInt(row.count);
      }

      return {
        total,
        sources: {
          livingAtlas: sourceMap['living_atlas'] || 0,
          overtureMap: sourceMap['geoparquet'] || 0,
          publicAgencies: sourceMap['custom_org'] || 0,
          userSubmitted: sourceMap['user_submitted'] || 0,
        },
        description: 'Findria indexes geospatial data from ArcGIS Living Atlas, Overture Maps Foundation, public agencies (cities, counties, states, federal), and user-submitted services.',
      };
    }

    default:
      throw new ToolError('Unknown tool');
  }
}

// Handle MCP JSON-RPC requests
async function handleMCPRequest(req: MCPRequest): Promise<MCPResponse> {
  const { id, method, params } = req;

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'findria',
              version: '1.0.0',
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS },
        };

      case 'tools/call': {
        const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };
        const result = await handleToolCall(name, args || {});
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      }

      case 'ping':
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: 'Method not found',
          },
        };
    }
  } catch (error) {
    if (!(error instanceof ToolError)) {
      console.error(`MCP ${method} error:`, error);
    }
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: error instanceof ToolError ? error.message : 'Internal error',
      },
    };
  }
}

// POST handler for MCP requests
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle batch requests
    if (Array.isArray(body)) {
      if (body.length > MAX_BATCH_SIZE) {
        return NextResponse.json(
          {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: `Batch too large (max ${MAX_BATCH_SIZE})` },
          },
          { status: 400 }
        );
      }
      const responses = await Promise.all(body.map(handleMCPRequest));
      return NextResponse.json(responses);
    }

    // Handle single request
    const response = await handleMCPRequest(body);
    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      },
      { status: 400 }
    );
  }
}

// GET handler - returns server info for discovery
export async function GET() {
  return NextResponse.json({
    name: 'findria',
    version: '1.0.0',
    description: 'Geospatial data search - find datasets from ArcGIS Living Atlas, Overture Maps, and public agencies',
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
    },
  });
}
