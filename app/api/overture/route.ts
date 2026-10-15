import { NextRequest, NextResponse } from 'next/server';
import { geoParquetService } from '@/services/geoparquet.service';
import { geocodingService } from '@/services/geocoding.service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse required parameters
    const dataType = searchParams.get('dataType') as 'places' | 'buildings' | null;
    const location = searchParams.get('location');

    if (!dataType || !['places', 'buildings'].includes(dataType)) {
      return NextResponse.json(
        { error: 'dataType parameter is required (places or buildings)' },
        { status: 400 }
      );
    }

    if (!location) {
      return NextResponse.json(
        { error: 'location parameter is required' },
        { status: 400 }
      );
    }

    // Parse optional parameters
    const category = searchParams.get('category') || undefined;
    const nameContains = searchParams.get('nameContains') || undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 200) : 50;

    // Geocode the location to get a bbox
    const bbox = await geocodingService.geocode(location);
    if (!bbox) {
      return NextResponse.json(
        { error: `Could not geocode location: ${location}` },
        { status: 400 }
      );
    }

    // Query the appropriate Overture dataset
    let result;
    if (dataType === 'places') {
      result = await geoParquetService.queryPlaces(bbox, {
        category,
        nameContains,
        limit,
      });
    } else {
      result = await geoParquetService.queryBuildings(bbox, {
        nameContains,
        limit,
      });
    }

    return NextResponse.json({
      ...result,
      bbox, // Include the geocoded bbox for zoom
    });
  } catch (error) {
    console.error('Overture query error:', error);
    return NextResponse.json(
      { error: 'Failed to query Overture data' },
      { status: 500 }
    );
  }
}
