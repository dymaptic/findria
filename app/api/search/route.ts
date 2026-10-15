import { NextRequest, NextResponse } from 'next/server';
import { searchService } from '@/services/search.service';
import { SearchLogger } from '@/services/search-logger.service';
import { rateLimiter } from '@/lib/rate-limiter';
import type { SearchRequest } from '@/types';
import { validateSearchQuery as validateQuery } from '@/lib/search-query-validation';

// Rate limit configuration for search (more generous than chat)
const RATE_LIMIT_REQUESTS = 60; // requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window

/**
 * Get client IP address from request headers
 */
function getClientIp(request: NextRequest): string {
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) return cfConnectingIp;

  const xForwardedFor = request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }

  const xRealIp = request.headers.get('x-real-ip');
  if (xRealIp) return xRealIp;

  return 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    // 1. Rate limiting
    const clientIp = getClientIp(request);
    const rateLimitKey = `search:${clientIp}`;
    const { allowed, remaining, resetAt } = rateLimiter.check(
      rateLimitKey,
      RATE_LIMIT_REQUESTS,
      RATE_LIMIT_WINDOW_MS
    );

    if (!allowed) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'Too many requests. Please wait before trying again.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(RATE_LIMIT_REQUESTS),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
          },
        }
      );
    }

    // 2. Parse and validate input
    const body = (await request.json()) as SearchRequest;

    if (!body.query || typeof body.query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    const query = body.query.trim();
    const validation = validateQuery(query);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // 3. Process search
    const sessionId = request.cookies.get('session')?.value;
    const sessionHash = sessionId
      ? SearchLogger.hashSession(sessionId)
      : undefined;

    const result = await searchService.search(
      {
        query,
        bbox: body.bbox,
        sources: body.sources,
        dataTypes: body.dataTypes,
        limit: Math.min(body.limit || 20, 100),
        offset: body.offset || 0,
      },
      sessionHash
    );

    return NextResponse.json(result, {
      headers: {
        'X-RateLimit-Limit': String(RATE_LIMIT_REQUESTS),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}

// Also support GET for simple queries
export async function GET(request: NextRequest) {
  try {
    // 1. Rate limiting
    const clientIp = getClientIp(request);
    const rateLimitKey = `search:${clientIp}`;
    const { allowed, remaining, resetAt } = rateLimiter.check(
      rateLimitKey,
      RATE_LIMIT_REQUESTS,
      RATE_LIMIT_WINDOW_MS
    );

    if (!allowed) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'Too many requests. Please wait before trying again.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(RATE_LIMIT_REQUESTS),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
          },
        }
      );
    }

    // 2. Parse and validate input
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query) {
      return NextResponse.json(
        { error: 'Query parameter "q" is required' },
        { status: 400 }
      );
    }

    const trimmedQuery = query.trim();
    const validation = validateQuery(trimmedQuery);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // 3. Process search
    const bbox = searchParams.get('bbox');
    const sources = searchParams.get('sources');
    const dataTypes = searchParams.get('dataTypes');
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');

    const sessionId = request.cookies.get('session')?.value;
    const sessionHash = sessionId
      ? SearchLogger.hashSession(sessionId)
      : undefined;

    const result = await searchService.search(
      {
        query: trimmedQuery,
        bbox: bbox
          ? (bbox.split(',').map(Number) as [number, number, number, number])
          : undefined,
        sources: sources
          ? (sources.split(',') as SearchRequest['sources'])
          : undefined,
        dataTypes: dataTypes ? dataTypes.split(',') : undefined,
        limit: limit ? Math.min(parseInt(limit, 10), 100) : 20,
        offset: offset ? parseInt(offset, 10) : 0,
      },
      sessionHash
    );

    return NextResponse.json(result, {
      headers: {
        'X-RateLimit-Limit': String(RATE_LIMIT_REQUESTS),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
