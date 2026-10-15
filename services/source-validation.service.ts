import postgres from 'postgres';
import { SUPPORTED_SERVICE_TYPES } from './indexing.service';
import { safeFetch, assertPublicUrl, checkUrlSyntax, readTextCapped, SafeFetchError } from '@/lib/safe-fetch';

/**
 * Synchronous SSRF pre-check (scheme + IP-literal / localhost blocks).
 * The authoritative check — DNS resolution and per-redirect re-validation —
 * happens inside safeFetch(), which every outbound request below uses.
 */
export function validateUrlNotSSRF(url: string): { safe: boolean; error?: string } {
  try {
    checkUrlSyntax(url);
    return { safe: true };
  } catch (error) {
    if (error instanceof SafeFetchError) {
      return { safe: false, error: error.message };
    }
    return { safe: false, error: 'Invalid URL' };
  }
}

/** Upstream-supplied display text: strip control chars and cap length. */
function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  return cleaned || fallback;
}

/** Cap on folders crawled during validation to bound outbound requests. */
const MAX_VALIDATION_FOLDERS = 50;

/**
 * Map an internal failure to a client-safe message. Raw fetch/upstream error
 * text is logged server-side only.
 */
function genericError(context: string, error: unknown): string {
  if (error instanceof SafeFetchError) {
    if (error.code === 'blocked_address' || error.code === 'blocked_protocol' || error.code === 'invalid_url') {
      return error.message;
    }
    if (error.code === 'dns_failure') return 'Could not resolve host';
    return 'Could not reach the service';
  }
  console.warn(`[source-validation] ${context}:`, error instanceof Error ? error.message : error);
  return 'Could not reach the service';
}

export type UrlType = 'arcgis_server' | 'single_service' | 'hub' | 'unknown';

export interface ValidationResult {
  valid: boolean;
  urlType: UrlType;
  name?: string;
  serviceCount?: number;
  layerCount?: number;
  error?: string;
  // Staleness info
  alreadyIndexed?: boolean;
  lastIndexedAt?: Date | null;
  currentDatasetCount?: number;
}

/**
 * Detect URL type from the URL string
 */
export function detectUrlType(url: string): UrlType {
  const normalized = url.toLowerCase();

  // Single service patterns (FeatureServer or MapServer with or without layer number)
  if (normalized.includes('/featureserver') || normalized.includes('/mapserver')) {
    return 'single_service';
  }

  // ArcGIS Server root patterns
  if (normalized.includes('/rest/services')) {
    return 'arcgis_server';
  }

  // Hub/Open Data patterns — match known ArcGIS Hub URL structures
  if (
    normalized.includes('hub.arcgis.com') ||
    normalized.includes('.opendata.arcgis.com') ||
    normalized.match(/^https?:\/\/data[-.]/) ||
    normalized.match(/^https?:\/\/opendata\./) ||
    normalized.match(/^https?:\/\/geodata\./) ||
    normalized.match(/^https?:\/\/geoportal\./) ||
    normalized.match(/^https?:\/\/geohub\./) ||
    normalized.match(/^https?:\/\/gis\.data\./) ||
    normalized.match(/^https?:\/\/gisdata[-.]/)
  ) {
    return 'hub';
  }

  return 'unknown';
}

/**
 * Validate an ArcGIS Server root URL
 */
async function validateArcGISServer(url: string): Promise<ValidationResult> {
  try {
    // Normalize URL
    let apiUrl = url.replace(/\/$/, '');
    if (!apiUrl.includes('?')) {
      apiUrl += '?f=json';
    }

    const response = await safeFetch(apiUrl, { timeoutMs: 15_000 });
    if (!response.ok) {
      return { valid: false, urlType: 'arcgis_server', error: 'The service returned an error response' };
    }

    const data = await response.json();

    if (data.error) {
      return { valid: false, urlType: 'arcgis_server', error: 'The service returned an error response' };
    }

    // ArcGIS Server returns { folders: [...], services: [...] }
    if (data.services || data.folders) {
      const serviceCount = await countServicesRecursive(url.replace(/\?.*$/, ''), data);
      return {
        valid: true,
        urlType: 'arcgis_server',
        name: cleanName(`ArcGIS Server ${data.currentVersion || ''}`.trim(), 'ArcGIS Server'),
        serviceCount,
      };
    }

    return { valid: false, urlType: 'arcgis_server', error: 'Not a valid ArcGIS Server endpoint' };
  } catch (error) {
    return {
      valid: false,
      urlType: 'arcgis_server',
      error: genericError('arcgis_server', error),
    };
  }
}

/**
 * Count services recursively in an ArcGIS Server (limited depth for validation)
 */
async function countServicesRecursive(
  baseUrl: string,
  data: { folders?: string[]; services?: Array<{ name: string; type: string }> },
  depth: number = 0
): Promise<number> {
  let count = 0;

  // Count services at this level
  if (data.services) {
    count += data.services.filter((s) =>
      SUPPORTED_SERVICE_TYPES.includes(s.type)
    ).length;
  }

  // Recursively count in folders (limit depth for quick validation)
  if (data.folders && depth < 2) {
    for (const folder of data.folders.slice(0, MAX_VALIDATION_FOLDERS)) {
      if (typeof folder !== 'string') continue;
      try {
        const folderUrl = `${baseUrl}/${folder}?f=json`;
        const response = await safeFetch(folderUrl, { timeoutMs: 10_000 });
        if (response.ok) {
          const folderData = await response.json();
          count += await countServicesRecursive(`${baseUrl}/${folder}`, folderData, depth + 1);
        }
      } catch {
        // Skip folders we can't access
      }
      // Small delay to avoid hammering the server
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return count;
}

/**
 * Validate a single service URL (FeatureServer/MapServer)
 */
async function validateSingleService(url: string): Promise<ValidationResult> {
  try {
    let apiUrl = url.replace(/\/$/, '');
    if (!apiUrl.includes('?')) {
      apiUrl += '?f=json';
    }

    const response = await safeFetch(apiUrl, { timeoutMs: 15_000 });
    if (!response.ok) {
      return { valid: false, urlType: 'single_service', error: 'The service returned an error response' };
    }

    const data = await response.json();

    if (data.error) {
      return { valid: false, urlType: 'single_service', error: 'The service returned an error response' };
    }

    // Check for typical service properties
    if (data.name || data.layers || data.type || data.geometryType) {
      const isServiceRoot = data.layers && Array.isArray(data.layers);
      const layerCount = isServiceRoot ? data.layers.length : 1;

      return {
        valid: true,
        urlType: 'single_service',
        name: cleanName(data.name || data.documentInfo?.Title, 'Unnamed Service'),
        serviceCount: 1,
        layerCount,
      };
    }

    return { valid: false, urlType: 'single_service', error: 'Not a valid ArcGIS service' };
  } catch (error) {
    return {
      valid: false,
      urlType: 'single_service',
      error: genericError('single_service', error),
    };
  }
}

/**
 * Extract the site name from the hub's HTML <title> tag.
 * More reliable than the v3 API which returns global (non-site-specific) data.
 */
async function fetchHubSiteName(url: string): Promise<string | null> {
  try {
    const response = await safeFetch(url.replace(/\/$/, '') + '/', {
      timeoutMs: 10_000,
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) return null;
    // Read just enough to find the title (avoid downloading full page)
    const text = await readTextCapped(response, 256 * 1024);
    const match = text.match(/<title[^>]*>(.*?)<\/title>/i);
    if (match?.[1]) {
      // Clean up common suffixes and taglines
      let title = match[1]
        .replace(/\s*\|.*$/, '')    // "Site Name | Powered by ArcGIS"
        .replace(/\s{2,}.*$/, '')   // "Site Name  Your tagline here"
        .trim();
      // Only strip dash/em-dash suffix if the remaining text is long enough
      // (avoids stripping legit names like "Data-Driven GIS Portal")
      const dashClean = title.replace(/\s+[-–—]\s+.*$/, '');
      if (dashClean.length > 5) title = dashClean;
      return title || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate a Hub/Open Data URL
 */
async function validateHub(url: string): Promise<ValidationResult> {
  try {
    const baseUrl = url.replace(/\/$/, '');

    // Fetch DCAT feed (site-specific) and HTML title in parallel for speed.
    // The v3 API is NOT site-specific — it returns global results — so we avoid
    // using it for name detection. We only use it as a fallback existence check.
    const [dcatResult, siteName] = await Promise.all([
      safeFetch(`${baseUrl}/api/feed/dcat-us/1.1.json`, { timeoutMs: 20_000 })
        .then(async (r) => {
          if (!r.ok) return 0;
          const d = await r.json();
          return Array.isArray(d.dataset) ? d.dataset.length : 0;
        })
        .catch(() => 0),
      fetchHubSiteName(url),
    ]);

    let datasetCount = dcatResult;

    // Fallback: if DCAT timed out or returned 0, check v3 API for existence
    if (datasetCount === 0) {
      try {
        const hubApiUrl = `${baseUrl}/api/v3/datasets?page[size]=1`;
        const response = await safeFetch(hubApiUrl, { timeoutMs: 15_000 });
        if (response.ok) {
          const data = await response.json();
          if (data.meta?.total) {
            datasetCount = data.meta.total;
          }
        }
      } catch {
        // v3 also failed — no data found
      }
    }

    if (datasetCount > 0) {
      return {
        valid: true,
        urlType: 'hub',
        name: cleanName(siteName, 'Open Data Hub'),
      };
    }

    return { valid: false, urlType: 'hub', error: 'Could not detect Hub API or DCAT feed' };
  } catch (error) {
    return {
      valid: false,
      urlType: 'hub',
      error: genericError('hub', error),
    };
  }
}

/**
 * Validate a URL and return info about it
 */
export async function validateUrl(url: string): Promise<ValidationResult> {
  // Block SSRF attempts
  const ssrfCheck = validateUrlNotSSRF(url);
  if (!ssrfCheck.safe) {
    return { valid: false, urlType: 'unknown', error: ssrfCheck.error };
  }
  // Resolve DNS up front so private/unresolvable hosts get a clear answer
  // (safeFetch re-checks every hop, including redirects).
  try {
    await assertPublicUrl(url);
  } catch (error) {
    return { valid: false, urlType: 'unknown', error: genericError('preflight', error) };
  }

  const urlType = detectUrlType(url);

  switch (urlType) {
    case 'arcgis_server':
      return validateArcGISServer(url);
    case 'single_service':
      return validateSingleService(url);
    case 'hub':
      return validateHub(url);
    default:
      // Try each type
      let result = await validateArcGISServer(url);
      if (result.valid) return result;

      result = await validateSingleService(url);
      if (result.valid) return result;

      result = await validateHub(url);
      if (result.valid) return result;

      return { valid: false, urlType: 'unknown', error: 'Could not determine URL type' };
  }
}

/**
 * Check if a URL is already indexed and get staleness info
 */
export async function checkExistingIndex(
  sql: postgres.Sql,
  url: string
): Promise<{
  alreadyIndexed: boolean;
  lastIndexedAt: Date | null;
  currentDatasetCount: number;
}> {
  // Build a LIKE pattern based on URL type
  const normalizedUrl = url.replace(/\/$/, '').replace(/\?.*$/, '');
  const escapedUrl = normalizedUrl.replace(/[%_\\]/g, '\\$&');
  const pattern = escapedUrl + '%';

  const result = await sql<{ count: string; oldest: Date | null }[]>`
    SELECT COUNT(*)::text as count, MIN(indexed_at) as oldest
    FROM datasets
    WHERE service_url LIKE ${pattern} ESCAPE '\\'
  `;

  const count = parseInt(result[0]?.count || '0', 10);
  const oldest = result[0]?.oldest || null;

  return {
    alreadyIndexed: count > 0,
    lastIndexedAt: oldest,
    currentDatasetCount: count,
  };
}

/**
 * Full validation including staleness check
 */
export async function validateUrlWithStaleness(
  sql: postgres.Sql,
  url: string
): Promise<ValidationResult> {
  // First validate the URL
  const validation = await validateUrl(url);

  if (!validation.valid) {
    return validation;
  }

  // Then check if already indexed
  const existingInfo = await checkExistingIndex(sql, url);

  return {
    ...validation,
    alreadyIndexed: existingInfo.alreadyIndexed,
    lastIndexedAt: existingInfo.lastIndexedAt,
    currentDatasetCount: existingInfo.currentDatasetCount,
  };
}
