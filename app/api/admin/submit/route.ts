import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { validateUrl, detectUrlType } from '@/services/source-validation.service';

/**
 * Admin submit endpoint — no rate limiting.
 * Used by the admin indexing page to queue URLs without public restrictions.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url, reindex = false } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { success: false, error: 'URL is required' },
        { status: 400 }
      );
    }

    // Validate the URL
    const validation = await validateUrl(url);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error || 'Invalid URL' },
        { status: 400 }
      );
    }

    // Insert into queue with admin job type and higher priority
    const normalizedUrl = url.replace(/\/$/, '').replace(/\?.*$/, '');
    const urlType = detectUrlType(url);

    const insertResult = await sql<{ id: string }[]>`
      INSERT INTO indexing_jobs (
        job_type,
        url,
        url_type,
        validated_at,
        service_count,
        server_name,
        status,
        priority,
        is_reindex
      ) VALUES (
        'single_url_admin',
        ${normalizedUrl},
        ${urlType},
        NOW(),
        ${validation.serviceCount || null},
        ${validation.name || null},
        'pending',
        5,
        ${reindex}
      )
      RETURNING id
    `;

    const submissionId = insertResult[0]?.id;

    // Get queue position
    const posResult = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text as count
      FROM indexing_jobs
      WHERE status IN ('pending', 'processing')
    `;
    const position = parseInt(posResult[0]?.count || '0', 10);

    return NextResponse.json({
      success: true,
      submissionId,
      position,
      message: `Added to queue. Currently #${position} in line.`,
      validation: {
        urlType: validation.urlType,
        name: validation.name,
        serviceCount: validation.serviceCount,
        layerCount: validation.layerCount,
      },
    });
  } catch (error) {
    console.error('Admin submission error:', error);
    return NextResponse.json(
      { success: false, error: 'Submission failed' },
      { status: 500 }
    );
  }
}
