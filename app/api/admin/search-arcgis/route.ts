import { NextResponse } from 'next/server';
import { arcgisService } from '@/services/arcgis.service';
import { geocodingService } from '@/services/geocoding.service';
import { sql } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { keywords, location, num = 25 } = body;

    if (!keywords || typeof keywords !== 'string' || !keywords.trim()) {
      return NextResponse.json(
        { error: 'Keywords are required' },
        { status: 400 }
      );
    }

    const clampedNum = Math.min(Math.max(1, num), 50);

    // Geocode location if provided
    let bbox: [number, number, number, number] | undefined;
    if (location && typeof location === 'string' && location.trim()) {
      const geocoded = await geocodingService.geocode(location.trim());
      if (geocoded) {
        bbox = geocoded;
      }
    }

    // Search ArcGIS Online
    const searchResult = await arcgisService.searchArcGISOnline({
      keywords: keywords.trim(),
      bbox,
      num: clampedNum,
    });

    // Check which items are already indexed (single query)
    const itemIds = searchResult.results.map((r) => r.id);
    let indexedIds = new Set<string>();

    if (itemIds.length > 0) {
      const existing = await sql<{ arcgis_item_id: string }[]>`
        SELECT DISTINCT arcgis_item_id
        FROM datasets
        WHERE arcgis_item_id = ANY(${itemIds}::text[])
      `;
      indexedIds = new Set(existing.map((e) => e.arcgis_item_id));
    }

    // Annotate results
    const results = searchResult.results.map((r) => ({
      ...r,
      alreadyIndexed: indexedIds.has(r.id),
    }));

    return NextResponse.json({
      results,
      total: searchResult.total,
      bbox: bbox || null,
    });
  } catch (error) {
    console.error('Admin search-arcgis error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
