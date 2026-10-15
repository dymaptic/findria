import { NextRequest, NextResponse } from 'next/server';
import { previewService } from '@/services/preview.service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = rawId.toLowerCase();
    const { searchParams } = new URL(request.url);

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Invalid dataset ID format' },
        { status: 400 }
      );
    }

    // Parse bbox parameter (required)
    const bboxParam = searchParams.get('bbox');
    if (!bboxParam) {
      return NextResponse.json(
        { error: 'bbox parameter is required (format: xmin,ymin,xmax,ymax)' },
        { status: 400 }
      );
    }

    const bboxParts = bboxParam.split(',').map(Number);
    if (bboxParts.length !== 4 || bboxParts.some(isNaN)) {
      return NextResponse.json(
        { error: 'Invalid bbox format. Expected: xmin,ymin,xmax,ymax' },
        { status: 400 }
      );
    }

    const bbox = bboxParts as [number, number, number, number];

    // Parse limit parameter (optional, default 100, max 500)
    const limitParam = searchParams.get('limit');
    const limit = limitParam
      ? Math.min(Math.max(parseInt(limitParam, 10), 1), 500)
      : 100;

    const preview = await previewService.getPreview(id, bbox, limit);

    return NextResponse.json(preview);
  } catch (error) {
    console.error('Preview error:', error);

    if (error instanceof Error) {
      if (error.message === 'Dataset not found') {
        return NextResponse.json(
          { error: 'Dataset not found' },
          { status: 404 }
        );
      }
      if (error.message === 'Preview not available for this dataset') {
        return NextResponse.json(
          { error: 'Preview not available for this dataset' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Failed to fetch preview' },
      { status: 500 }
    );
  }
}
