import type {
  SearchRequest,
  SearchResult,
  Dataset,
  PreviewResponse,
  HealthResponse,
} from '@/types';

const API_BASE = '/api';

export async function search(request: SearchRequest): Promise<SearchResult> {
  const response = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Search failed' }));
    throw new Error(error.error || 'Search failed');
  }

  return response.json();
}

export async function getDataset(id: string): Promise<Dataset> {
  const response = await fetch(`${API_BASE}/datasets/${id}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch dataset' }));
    throw new Error(error.error || 'Failed to fetch dataset');
  }

  return response.json();
}

export async function getPreview(
  id: string,
  bbox: [number, number, number, number],
  limit?: number
): Promise<PreviewResponse> {
  const params = new URLSearchParams({
    bbox: bbox.join(','),
    ...(limit && { limit: limit.toString() }),
  });

  const response = await fetch(`${API_BASE}/preview/${id}?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch preview' }));
    throw new Error(error.error || 'Failed to fetch preview');
  }

  return response.json();
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE}/health`);

  if (!response.ok) {
    throw new Error('Health check failed');
  }

  return response.json();
}

export async function getCoverage(
  h3Indexes: string[],
  minCount?: number
): Promise<{
  coverage: Array<{
    datasetId: string;
    datasetName: string;
    h3Index: string;
    featureCount: number;
  }>;
}> {
  const params = new URLSearchParams({
    h3: h3Indexes.join(','),
    ...(minCount && { minCount: minCount.toString() }),
  });

  const response = await fetch(`${API_BASE}/coverage?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch coverage' }));
    throw new Error(error.error || 'Failed to fetch coverage');
  }

  return response.json();
}
