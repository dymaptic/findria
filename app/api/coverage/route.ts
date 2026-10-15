import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface CoverageRow {
  dataset_id: string;
  dataset_name: string;
  h3_index: string;
  feature_count: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse h3 parameter (required)
    const h3Param = searchParams.get('h3');
    if (!h3Param) {
      return NextResponse.json(
        { error: 'h3 parameter is required (comma-separated H3 indexes)' },
        { status: 400 }
      );
    }

    const h3Indexes = h3Param.split(',').map((h) => h.trim());

    // Validate H3 indexes
    const h3Regex = /^[0-9a-f]{15}$/i;
    const invalidIndexes = h3Indexes.filter((h) => !h3Regex.test(h));
    if (invalidIndexes.length > 0) {
      return NextResponse.json(
        { error: `Invalid H3 index format: ${invalidIndexes.join(', ')}` },
        { status: 400 }
      );
    }

    // Parse minCount parameter (optional, default 1)
    const minCountParam = searchParams.get('minCount');
    const minCount = minCountParam ? parseInt(minCountParam, 10) : 1;

    // Convert H3 strings to BigInts for database query
    const h3BigInts = h3Indexes.map((h) => BigInt('0x' + h));

    const result = await query<CoverageRow>(
      `
      SELECT
        c.dataset_id,
        d.name as dataset_name,
        c.h3_index::text as h3_index,
        c.feature_count
      FROM coverage c
      JOIN datasets d ON d.id = c.dataset_id
      WHERE c.h3_index = ANY($1)
        AND c.feature_count >= $2
      ORDER BY c.feature_count DESC
    `,
      [h3BigInts.map((b) => b.toString()), minCount]
    );

    // Convert BigInt h3_index back to hex string
    const coverage = result.map((row) => ({
      datasetId: row.dataset_id,
      datasetName: row.dataset_name,
      h3Index: BigInt(row.h3_index).toString(16).padStart(15, '0'),
      featureCount: row.feature_count,
    }));

    return NextResponse.json({ coverage });
  } catch (error) {
    console.error('Coverage error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch coverage' },
      { status: 500 }
    );
  }
}
