import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { validateUrlWithStaleness } from '@/services/source-validation.service';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { valid: false, error: 'URL is required' },
        { status: 400 }
      );
    }

    // Basic URL validation
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { valid: false, error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json(
        { valid: false, error: 'URL must use http or https protocol' },
        { status: 400 }
      );
    }

    // Validate the URL
    const result = await validateUrlWithStaleness(sql, url);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Validation error:', error);
    return NextResponse.json(
      { valid: false, error: 'Validation failed' },
      { status: 500 }
    );
  }
}
