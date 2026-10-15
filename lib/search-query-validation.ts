/**
 * Shared validation for natural-language search queries.
 *
 * Mirrors the rules in app/api/search/route.ts so server-side callers that
 * bypass the HTTP route (e.g. the MCP endpoint) apply the same checks.
 */

export const MAX_QUERY_LENGTH = 500;
export const MIN_QUERY_LENGTH = 2;

const URL_PATTERN = /https?:\/\/[^\s]+/i;

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?prior\s+instructions/i,
  /disregard\s+(all\s+)?previous/i,
  /forget\s+(all\s+)?previous/i,
  /you\s+are\s+now\s+a/i,
  /act\s+as\s+if\s+you\s+are/i,
  /pretend\s+you\s+are/i,
  /system\s*prompt/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /<<SYS>>/i,
  /<\/SYS>/i,
];

export function validateSearchQuery(query: string): { valid: boolean; error?: string } {
  if (query.length < MIN_QUERY_LENGTH) {
    return { valid: false, error: `Query must be at least ${MIN_QUERY_LENGTH} characters` };
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return { valid: false, error: `Query must be at most ${MAX_QUERY_LENGTH} characters` };
  }

  // Check for URLs (potential SSRF or external service injection)
  if (URL_PATTERN.test(query)) {
    return { valid: false, error: 'Query cannot contain URLs' };
  }

  // Check for prompt injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(query)) {
      return { valid: false, error: 'Invalid query content detected' };
    }
  }

  return { valid: true };
}
