import type { Dataset, GeoJSONFeature } from './index';

// Source dataset info for citations
export interface SourceDataset {
  id: string;
  name: string;
  source: string;
  sourceUrl: string;
  serviceUrl?: string;
  orgDisplayName?: string;
}

// Stream event types for SSE
export type StreamEvent =
  | { type: 'tool_call'; id: string; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; tool: string; result: unknown; error?: string }
  | { type: 'text'; content: string }
  | { type: 'map_action'; action: MapAction }
  | { type: 'ui_action'; action: UIAction }
  | { type: 'sources'; datasets: SourceDataset[] }
  | { type: 'done'; conversationId: string }
  | { type: 'error'; message: string };

// GeoJSON FeatureCollection for add_geojson action
export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
  source?: {
    id: string;
    name: string;
    attribution?: string;
    license?: string;
  };
  truncated?: boolean;
}

// Map actions that the AI can emit
export type MapAction =
  | {
      type: 'add_layer';
      features: GeoJSONFeature[];
      style?: LayerStyle;
      label?: string;
    }
  | {
      type: 'add_feature_layer';
      serviceUrl: string;
      definitionExpression?: string;
      label?: string;
      style?: LayerStyle;
      bbox?: [number, number, number, number]; // Spatial filter [xmin, ymin, xmax, ymax] in WGS84
    }
  | {
      type: 'add_geojson';
      geojson: GeoJSONFeatureCollection;
      label?: string;
      style?: LayerStyle;
    }
  | {
      type: 'add_marker';
      coordinates: [number, number]; // [longitude, latitude]
      label?: string;
      color?: string;
    }
  | {
      type: 'zoom_to_extent';
      bbox: [number, number, number, number];
      maxScale?: number; // If set, zoom won't go past this scale (stays zoomed in enough)
    }
  | {
      type: 'clear_layers';
    };

// UI actions that the AI can emit
export type UIAction =
  | {
      type: 'show_dataset_card';
      dataset: Dataset;
    }
  | {
      type: 'highlight_dataset';
      datasetId: string;
    };

// Layer styling options
export interface LayerStyle {
  color?: string;
  fillOpacity?: number;
  strokeWidth?: number;
}

// Individual step in a chat response (tool call with optional result)
export interface ChatStep {
  id: string;
  type: 'tool_call' | 'tool_result';
  tool?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp: number;
}

// Content block for interleaved text and tool calls
export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; step: ChatStep }
  | { type: 'sources'; datasets: SourceDataset[] };

// A message in the conversation
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string; // For user messages and final text (backwards compat)
  contentBlocks?: ContentBlock[]; // For assistant messages - interleaved text/tools
  steps?: ChatStep[]; // Deprecated: kept for backwards compat, use contentBlocks
  actions?: (MapAction | UIAction)[];
  timestamp: number;
  isStreaming?: boolean;
}

// Request body for chat API
export interface ChatRequest {
  question: string;
  conversationId?: string;
  mapScale?: number;
}

// Tool definitions for Claude
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Feature query parameters
export interface FeatureQueryParams {
  serviceUrl: string;
  where?: string;
  bbox?: [number, number, number, number];
  outFields?: string[];
  limit?: number;
}

// Feature count parameters
export interface FeatureCountParams {
  serviceUrl: string;
  where?: string;
  bbox?: [number, number, number, number];
}

// Statistics query parameters
export type StatisticType = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface StatisticsQueryParams {
  serviceUrl: string;
  groupByField: string;
  statisticType: StatisticType;
  statisticField?: string; // Required for sum/avg/min/max, ignored for count
  where?: string;
  bbox?: [number, number, number, number];
  orderBy?: 'asc' | 'desc';
  limit?: number;
}

// Statistics query result
export interface StatisticsResult {
  rows: Array<Record<string, unknown>>;
  groupByField: string;
  statisticType: StatisticType;
  statisticField?: string;
  totalGroups: number;
  truncated: boolean;
}
