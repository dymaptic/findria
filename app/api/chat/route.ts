import { NextRequest } from 'next/server';
import { chatService } from '@/services/chat.service';
import { guardrailService } from '@/services/guardrail.service';
import { rateLimiter } from '@/lib/rate-limiter';
import type { ChatRequest, StreamEvent } from '@/types/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Rate limit configuration
const RATE_LIMIT_REQUESTS = 20; // requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window

/**
 * Get client IP address from request headers
 * Supports Cloudflare, standard proxies, and direct connections
 */
function getClientIp(request: NextRequest): string {
  // Cloudflare
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) return cfConnectingIp;

  // Standard proxy headers
  const xForwardedFor = request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    // Take the first IP in the chain (original client)
    return xForwardedFor.split(',')[0].trim();
  }

  const xRealIp = request.headers.get('x-real-ip');
  if (xRealIp) return xRealIp;

  // Fallback - in development this might be missing
  return 'unknown';
}

/**
 * Create a standardized error response
 */
function errorResponse(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Create a "blocked" response that mimics a friendly AI response
 */
function blockedResponse(): Response {
  const message = "I'm sorry, I can only help with questions about finding and exploring geospatial data. " +
    "Try asking me about maps, geographic boundaries, demographics, buildings, roads, or other spatial datasets. " +
    "For example: \"Show me parks in Denver\" or \"Find building footprints in Seattle\".";

  // Return as a streamed response to match expected format
  const encoder = new TextEncoder();
  const events: StreamEvent[] = [
    { type: 'text', content: message },
    { type: 'done', conversationId: 'blocked' },
  ];

  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    // 1. Rate limiting
    const clientIp = getClientIp(request);
    const rateLimitKey = `chat:${clientIp}`;
    const { allowed: rateLimitAllowed, remaining, resetAt } = rateLimiter.check(
      rateLimitKey,
      RATE_LIMIT_REQUESTS,
      RATE_LIMIT_WINDOW_MS
    );

    if (!rateLimitAllowed) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
      return new Response(
        JSON.stringify({
          error: 'Too many requests. Please wait before trying again.',
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(RATE_LIMIT_REQUESTS),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
          },
        }
      );
    }

    // 2. Parse request body
    const body = (await request.json()) as ChatRequest;

    if (!body.question || typeof body.question !== 'string') {
      return errorResponse('Question is required', 400);
    }

    const question = body.question.trim();

    // 3. Input validation (fast, no AI)
    const inputValidation = guardrailService.validateInput(question);
    if (!inputValidation.valid) {
      return errorResponse(inputValidation.error || 'Invalid input', 400);
    }

    // 4. Guardrail check (AI-powered, quick classification)
    const guardrailResult = await guardrailService.checkGuardrail(question);
    if (!guardrailResult.allowed) {
      if (guardrailResult.unavailable) {
        // Classifier is down (guardrail fails closed). Signal a transient
        // 503 with the guardrail's message; useChat shows `error` from
        // non-OK JSON responses.
        return new Response(
          JSON.stringify({
            error: guardrailResult.reason || 'The assistant is temporarily unavailable. Please try again in a moment.',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
          }
        );
      }
      // Off-topic: return a friendly "can't help with that" message
      return blockedResponse();
    }

    // 5. Process the chat request
    const encoder = new TextEncoder();
    const keepaliveJson = JSON.stringify({ type: 'keepalive' }) + '\n';
    const KEEPALIVE_INTERVAL_MS = 15_000; // Send keepalive every 15s to prevent Azure LB 230s idle timeout

    const stream = new ReadableStream({
      async start(controller) {
        // Send periodic keepalive events to prevent Azure App Service
        // load balancer from killing the connection during long tool executions.
        // Azure LB has a hard 230s idle timeout that is not configurable.
        const keepaliveTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(keepaliveJson));
          } catch {
            // Controller may be closed, ignore
          }
        }, KEEPALIVE_INTERVAL_MS);

        try {
          const generator = chatService.streamResponse(
            question,
            body.conversationId,
            body.mapScale
          );

          for await (const event of generator) {
            // Send event as NDJSON line
            const line = JSON.stringify(event) + '\n';
            controller.enqueue(encoder.encode(line));
          }

          controller.close();
        } catch (error) {
          // Log details server-side; send only a generic message to the client
          console.error('Chat stream error:', error);
          const errorEvent: StreamEvent = {
            type: 'error',
            message: 'Something went wrong while generating a response. Please try again.',
          };
          controller.enqueue(encoder.encode(JSON.stringify(errorEvent) + '\n'));
          controller.close();
        } finally {
          clearInterval(keepaliveTimer);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-RateLimit-Limit': String(RATE_LIMIT_REQUESTS),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return errorResponse('Chat failed', 500);
  }
}
