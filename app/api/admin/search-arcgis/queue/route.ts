import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

interface QueueItem {
  id: string;
  title: string;
  url: string | null;
  type: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { items } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Items array is required' },
        { status: 400 }
      );
    }

    if (items.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 items per request' },
        { status: 400 }
      );
    }

    const queued: string[] = [];
    const skipped: string[] = [];

    for (const item of items as QueueItem[]) {
      if (!item.url) {
        skipped.push(item.id);
        continue;
      }

      const normalizedUrl = item.url.replace(/\/$/, '').replace(/\?.*$/, '');

      const result = await sql<{ id: string }[]>`
        INSERT INTO indexing_jobs (
          job_type,
          url,
          url_type,
          server_name,
          status,
          priority,
          config
        ) VALUES (
          'single_url_admin',
          ${normalizedUrl},
          'single_service',
          ${item.title},
          'pending',
          5,
          ${JSON.stringify({
            arcgisItemId: item.id,
            queuedVia: 'search_and_index',
          })}::jsonb
        )
        RETURNING id
      `;

      if (result[0]) {
        queued.push(result[0].id);
      }
    }

    return NextResponse.json({
      queued: queued.length,
      skipped: skipped.length,
      jobIds: queued,
    });
  } catch (error) {
    console.error('Admin queue error:', error);
    return NextResponse.json(
      { error: 'Failed to queue items' },
      { status: 500 }
    );
  }
}
