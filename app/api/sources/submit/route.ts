import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { validateUrl, detectUrlType } from '@/services/source-validation.service';

const RATE_LIMIT_PER_HOUR = parseInt(process.env.SUBMISSION_RATE_LIMIT_PER_HOUR || '25', 10);
const REINDEX_COOLDOWN_HOURS = 24;

/**
 * Get client IP from request headers
 */
function getClientIp(request: Request): string {
  // Prefer Cloudflare's header: x-forwarded-for's first entry is client-
  // controlled when behind Cloudflare. (Only trustworthy if the origin is
  // restricted to Cloudflare IP ranges.)
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  return 'unknown';
}

/**
 * Check rate limit for an IP address
 */
async function checkRateLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const result = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count
    FROM indexing_jobs
    WHERE submitter_ip = ${ip}
      AND submitted_at > ${oneHourAgo}
  `;

  const count = parseInt(result[0]?.count || '0', 10);
  const remaining = Math.max(0, RATE_LIMIT_PER_HOUR - count);

  return {
    allowed: count < RATE_LIMIT_PER_HOUR,
    remaining,
  };
}

/**
 * Check if this URL was submitted recently (24hr cooldown)
 */
async function checkRecentSubmission(url: string): Promise<{
  recentlySubmitted: boolean;
  lastSubmittedAt: Date | null;
}> {
  const cooldownAgo = new Date(Date.now() - REINDEX_COOLDOWN_HOURS * 60 * 60 * 1000);
  const normalizedUrl = url.replace(/\/$/, '').replace(/\?.*$/, '');
  const escapedUrl = normalizedUrl.replace(/[%_\\]/g, '\\$&');

  const result = await sql<{ submitted_at: Date }[]>`
    SELECT submitted_at
    FROM indexing_jobs
    WHERE url LIKE ${escapedUrl + '%'} ESCAPE '\\'
      AND submitted_at > ${cooldownAgo}
      AND status != 'failed'
    ORDER BY submitted_at DESC
    LIMIT 1
  `;

  if (result.length > 0) {
    return {
      recentlySubmitted: true,
      lastSubmittedAt: result[0]!.submitted_at,
    };
  }

  return {
    recentlySubmitted: false,
    lastSubmittedAt: null,
  };
}

/**
 * Get current queue position
 */
async function getQueuePosition(): Promise<number> {
  const result = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count
    FROM indexing_jobs
    WHERE status IN ('pending', 'processing')
  `;

  return parseInt(result[0]?.count || '0', 10) + 1;
}

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

    // Get client IP for rate limiting
    const clientIp = getClientIp(request);

    // Check rate limit
    const rateLimit = await checkRateLimit(clientIp);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded. Please try again later.',
          rateLimitRemaining: 0,
        },
        { status: 429 }
      );
    }

    // Check 24hr cooldown (unless it's a re-index request that we want to allow)
    if (!reindex) {
      const recentCheck = await checkRecentSubmission(url);
      if (recentCheck.recentlySubmitted) {
        return NextResponse.json(
          {
            success: false,
            error: `This URL was recently submitted. Please wait before requesting a re-index.`,
            lastSubmittedAt: recentCheck.lastSubmittedAt,
          },
          { status: 429 }
        );
      }
    }

    // Validate the URL
    const validation = await validateUrl(url);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error || 'Invalid URL' },
        { status: 400 }
      );
    }

    // Insert into queue
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
        is_reindex,
        submitter_ip
      ) VALUES (
        'user_submission',
        ${normalizedUrl},
        ${urlType},
        NOW(),
        ${validation.serviceCount || null},
        ${validation.name || null},
        'pending',
        1,
        ${reindex},
        ${clientIp}
      )
      RETURNING id
    `;

    const submissionId = insertResult[0]?.id;
    const position = await getQueuePosition();

    return NextResponse.json({
      success: true,
      submissionId,
      position,
      message: `Added to queue. Currently #${position} in line.`,
      rateLimitRemaining: rateLimit.remaining - 1,
      validation: {
        urlType: validation.urlType,
        name: validation.name,
        serviceCount: validation.serviceCount,
        layerCount: validation.layerCount,
      },
    });
  } catch (error) {
    console.error('Submission error:', error);
    return NextResponse.json(
      { success: false, error: 'Submission failed' },
      { status: 500 }
    );
  }
}
