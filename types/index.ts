export interface Dataset {
  id: string;
  source: 'living_atlas' | 'geoparquet' | 'custom_org' | 'user_submitted';
  sourceId: string;
  name: string;
  description: string | null;
  snippet: string | null;
  tags: string[];
  categories: string[];
  dataType: 'point' | 'line' | 'polygon' | 'raster' | 'table' | null;
  extentBbox: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  } | null;
  sourceUrl: string;
  serviceUrl: string | null;
  accessType: 'public' | 'subscription' | 'requires_auth';

  // Source-specific
  geoparquetSourceId?: string;
  arcgisItemId?: string;
  arcgisOwner?: string;
  arcgisType?: string;
  isAuthoritative?: boolean;
  orgDisplayName?: string;  // For custom_org sources
  schema?: {
    layers: Array<{
      layerId: number;
      layerName: string;
      geometryType: string | null;
      fields: Array<{
        name: string;
        type: string;
        alias: string | null;
        length?: number;
      }>;
    }>;
    fetchedAt: string;
  };

  // Runtime enrichment
  coverageInArea?: number;
  relevanceScore?: number;

  indexedAt: string;
}

export interface Coverage {
  datasetId: string;
  h3Index: string;
  featureCount: number;
}

export interface SearchRequest {
  query: string;
  bbox?: [number, number, number, number];
  sources?: ('living_atlas' | 'geoparquet' | 'custom_org' | 'user_submitted')[];
  dataTypes?: string[];
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  datasets: Dataset[];
  total: number;
  query: ParsedQuery;
}

export interface ParsedQuery {
  originalQuery: string;
  topics: string[];
  location: string | null;
  locationBbox: [number, number, number, number] | null;
  dataTypes: string[];
  filters: Record<string, string>;
}

export interface PreviewRequest {
  datasetId: string;
  bbox: [number, number, number, number];
  limit?: number;
}

export interface PreviewResponse {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
  totalCount?: number;
  truncated: boolean;
  source?: {
    id: string;
    name: string;
    attribution: string;
    license: string;
  };
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: unknown;
  };
  properties: Record<string, unknown>;
}

export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  version: string;
  stats: {
    totalDatasets: number;
    livingAtlasCount: number;
    geoparquetCount: number;
    customOrgCount: number;
    userSubmittedCount: number;
    coverageCells: number;
    lastIndexed: string | null;
  };
}

export interface GeoParquetSource {
  id: string;
  name: string;
  description: string;
  urlPattern: string;
  columns: {
    id: string;
    geometry: string;
    name?: string;
    bbox?: {
      xmin: string;
      ymin: string;
      xmax: string;
      ymax: string;
    };
  };
  s3Region?: string;
  supportsRealtimeCount: boolean;
  attribution: string;
  license: string;
  sourceUrl: string;
  dataType: 'point' | 'line' | 'polygon';
}

// App state types
export interface AppState {
  query: string;
  searchResults: Dataset[];
  totalResults: number;
  parsedQuery: ParsedQuery | null;
  isSearching: boolean;
  searchError: string | null;

  mapBbox: [number, number, number, number] | null;
  useMapExtentFilter: boolean;

  selectedDataset: Dataset | null;
  previewData: PreviewResponse | null;
  isLoadingPreview: boolean;

  isModalOpen: boolean;
}

export type AppAction =
  | { type: 'SET_QUERY'; payload: string }
  | { type: 'SEARCH_START' }
  | { type: 'SEARCH_SUCCESS'; payload: { datasets: Dataset[]; total: number; parsed: ParsedQuery } }
  | { type: 'SEARCH_ERROR'; payload: string }
  | { type: 'SET_MAP_BBOX'; payload: [number, number, number, number] }
  | { type: 'TOGGLE_EXTENT_FILTER' }
  | { type: 'SELECT_DATASET'; payload: Dataset }
  | { type: 'SET_PREVIEW_DATA'; payload: PreviewResponse }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'OPEN_MODAL' }
  | { type: 'CLOSE_MODAL' }
  | { type: 'PREVIEW_START' }
  | { type: 'PREVIEW_ERROR' };

// Re-export chat types
export type {
  StreamEvent,
  MapAction,
  UIAction,
  LayerStyle,
  ChatStep,
  ChatMessage,
  ChatRequest,
  ToolDefinition,
  FeatureQueryParams,
  FeatureCountParams,
} from './chat';
