import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import type { HealthResponse } from '@/types';

interface StatsRow {
  total_datasets: string;
  living_atlas_count: string;
  geoparquet_count: string;
  custom_org_count: string;
  user_submitted_count: string;
  coverage_cells: string;
  last_indexed: string | null;
}

export async function GET() {
  try {
    const stats = await queryOne<StatsRow>(
      `
      SELECT
        (SELECT COUNT(*)::text FROM datasets) as total_datasets,
        (SELECT COUNT(*)::text FROM datasets WHERE source = 'living_atlas') as living_atlas_count,
        (SELECT COUNT(*)::text FROM datasets WHERE source = 'geoparquet') as geoparquet_count,
        (SELECT COUNT(*)::text FROM datasets WHERE source = 'custom_org') as custom_org_count,
        (SELECT COUNT(*)::text FROM datasets WHERE source = 'user_submitted') as user_submitted_count,
        (SELECT COUNT(DISTINCT h3_index)::text FROM coverage) as coverage_cells,
        (SELECT MAX(indexed_at)::text FROM datasets) as last_indexed
    `,
      []
    );

    const response: HealthResponse = {
      status: 'healthy',
      version: '1.0.0',
      stats: {
        totalDatasets: parseInt(stats?.total_datasets || '0', 10),
        livingAtlasCount: parseInt(stats?.living_atlas_count || '0', 10),
        geoparquetCount: parseInt(stats?.geoparquet_count || '0', 10),
        customOrgCount: parseInt(stats?.custom_org_count || '0', 10),
        userSubmittedCount: parseInt(stats?.user_submitted_count || '0', 10),
        coverageCells: parseInt(stats?.coverage_cells || '0', 10),
        lastIndexed: stats?.last_indexed || null,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Health check error:', error);

    const response: HealthResponse = {
      status: 'unhealthy',
      version: '1.0.0',
      stats: {
        totalDatasets: 0,
        livingAtlasCount: 0,
        geoparquetCount: 0,
        customOrgCount: 0,
        userSubmittedCount: 0,
        coverageCells: 0,
        lastIndexed: null,
      },
    };

    return NextResponse.json(response, { status: 503 });
  }
}
