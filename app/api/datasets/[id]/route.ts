import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import type { Dataset } from '@/types';

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
  metadata_json: Record<string, unknown> | null;
  indexed_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = rawId.toLowerCase();

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Invalid dataset ID format' },
        { status: 400 }
      );
    }

    const row = await queryOne<DatasetRow>(
      `
      SELECT
        id, source, source_id, name, description, snippet,
        tags, categories, data_type, extent_bbox,
        source_url, service_url, access_type,
        geoparquet_source_id, arcgis_item_id, arcgis_owner, arcgis_type,
        is_authoritative, org_display_name, schema,
        metadata_json, indexed_at
      FROM datasets
      WHERE id = $1
    `,
      [id]
    );

    if (!row) {
      return NextResponse.json(
        { error: 'Dataset not found' },
        { status: 404 }
      );
    }

    const dataset: Dataset & { metadataJson?: Record<string, unknown> } = {
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
      metadataJson: row.metadata_json || undefined,
      indexedAt: row.indexed_at,
    };

    return NextResponse.json(dataset);
  } catch (error) {
    console.error('Dataset fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dataset' },
      { status: 500 }
    );
  }
}
