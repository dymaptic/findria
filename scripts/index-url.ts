import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

import postgres from 'postgres';
import OpenAI from 'openai';
import {
  IndexingService,
  IndexResult,
  SUPPORTED_SERVICE_TYPES,
} from '../services/indexing.service';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://datalibrarian:datalibrarian@localhost:5432/datalibrarian';

const sql = postgres(connectionString);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const indexingService = new IndexingService(sql, openai);

type UrlType = 'arcgis_server' | 'single_service' | 'hub' | 'unknown';

interface ValidationResult {
  valid: boolean;
  urlType: UrlType;
  name?: string;
  serviceCount?: number;
  layerCount?: number;
  error?: string;
}

/**
 * Detect URL type from the URL string
 */
function detectUrlType(url: string): UrlType {
  const normalized = url.toLowerCase();

  // Single service patterns (FeatureServer or MapServer with or without layer number)
  if (normalized.includes('/featureserver') || normalized.includes('/mapserver')) {
    return 'single_service';
  }

  // ArcGIS Server root patterns
  if (normalized.includes('/rest/services')) {
    return 'arcgis_server';
  }

  // Hub/Open Data patterns
  if (
    normalized.includes('hub.arcgis.com') ||
    normalized.match(/^https?:\/\/data\.[^\/]+/) ||
    normalized.match(/^https?:\/\/opendata\.[^\/]+/)
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

    const response = await fetch(apiUrl);
    if (!response.ok) {
      return { valid: false, urlType: 'arcgis_server', error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    if (data.error) {
      return { valid: false, urlType: 'arcgis_server', error: data.error.message };
    }

    // ArcGIS Server returns { folders: [...], services: [...] }
    if (data.services || data.folders) {
      const serviceCount = await countServicesRecursive(url.replace(/\?.*$/, ''), data);
      return {
        valid: true,
        urlType: 'arcgis_server',
        name: `ArcGIS Server ${data.currentVersion || ''}`.trim(),
        serviceCount,
      };
    }

    return { valid: false, urlType: 'arcgis_server', error: 'Not a valid ArcGIS Server endpoint' };
  } catch (error) {
    return {
      valid: false,
      urlType: 'arcgis_server',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Count services recursively in an ArcGIS Server
 */
async function countServicesRecursive(
  baseUrl: string,
  data: { folders?: string[]; services?: Array<{ name: string; type: string }> }
): Promise<number> {
  let count = 0;

  // Count services at this level
  if (data.services) {
    count += data.services.filter((s) =>
      SUPPORTED_SERVICE_TYPES.includes(s.type)
    ).length;
  }

  // Recursively count in folders
  if (data.folders) {
    for (const folder of data.folders) {
      try {
        const folderUrl = `${baseUrl}/${folder}?f=json`;
        const response = await fetch(folderUrl);
        if (response.ok) {
          const folderData = await response.json();
          count += await countServicesRecursive(`${baseUrl}/${folder}`, folderData);
        }
      } catch {
        // Skip folders we can't access
      }
      await indexingService.sleep(100);
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

    const response = await fetch(apiUrl);
    if (!response.ok) {
      return { valid: false, urlType: 'single_service', error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    if (data.error) {
      return { valid: false, urlType: 'single_service', error: data.error.message };
    }

    // Check for typical service properties
    if (data.name || data.layers || data.type || data.geometryType) {
      const isServiceRoot = data.layers && Array.isArray(data.layers);
      const layerCount = isServiceRoot ? data.layers.length : 1;

      return {
        valid: true,
        urlType: 'single_service',
        name: data.name || data.documentInfo?.Title || 'Unnamed Service',
        serviceCount: 1,
        layerCount,
      };
    }

    return { valid: false, urlType: 'single_service', error: 'Not a valid ArcGIS service' };
  } catch (error) {
    return {
      valid: false,
      urlType: 'single_service',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate a Hub/Open Data URL
 */
async function validateHub(url: string): Promise<ValidationResult> {
  try {
    // Try ArcGIS Hub API
    const hubApiUrl = `${url.replace(/\/$/, '')}/api/v3/datasets?page[size]=1`;

    const response = await fetch(hubApiUrl);
    if (response.ok) {
      const data = await response.json();
      if (data.meta?.total) {
        return {
          valid: true,
          urlType: 'hub',
          name: 'ArcGIS Hub',
          serviceCount: data.meta.total,
        };
      }
    }

    return { valid: false, urlType: 'hub', error: 'Could not detect Hub API' };
  } catch (error) {
    return {
      valid: false,
      urlType: 'hub',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate a URL and return info about it
 */
async function validateUrl(url: string): Promise<ValidationResult> {
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
 * Index all services from an ArcGIS Server (delegates to service, adds delete-stale support)
 */
async function indexArcGISServer(
  baseUrl: string,
  deleteStale: boolean
): Promise<IndexResult> {
  console.log('Fetching server catalog...');
  const results = await indexingService.indexArcGISServer(baseUrl);

  if (deleteStale && results.sourceIds.length > 0) {
    const pattern = baseUrl.replace(/\/$/, '') + '%';
    const deleted = await indexingService.deleteStaleItems({
      serviceUrlPattern: pattern,
      validSourceIds: results.sourceIds,
      deleteEnabled: true,
    });
    console.log(`Deleted ${deleted} stale items`);
  }

  return results;
}

/**
 * Index a single service (delegates to service, adds delete-stale support)
 */
async function indexSingleService(
  serviceUrl: string,
  deleteStale: boolean
): Promise<IndexResult> {
  const results = await indexingService.indexSingleService(serviceUrl);

  if (deleteStale && results.sourceIds.length > 0) {
    const pattern = serviceUrl.replace(/\/$/, '') + '%';
    await indexingService.deleteStaleItems({
      serviceUrlPattern: pattern,
      validSourceIds: results.sourceIds,
      deleteEnabled: true,
    });
  }

  return results;
}

/**
 * Index a Hub/Open Data portal (delegates to service, adds delete-stale support)
 */
async function indexHub(
  hubUrl: string,
  deleteStale: boolean
): Promise<IndexResult> {
  console.log('Fetching DCAT feed...');
  const results = await indexingService.indexHub(hubUrl);

  if (deleteStale && results.sourceIds.length > 0) {
    const pattern = hubUrl.replace(/\/$/, '') + '%';
    await indexingService.deleteStaleItems({
      serviceUrlPattern: pattern,
      validSourceIds: results.sourceIds,
      deleteEnabled: true,
    });
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
URL Indexer - Index a single URL

Usage: npm run index -- url <url> [options]

Options:
  --delete-stale    Delete items no longer at source (for re-index)

Examples:
  npm run index -- url https://gis.portland.gov/arcgis/rest/services
  npm run index -- url https://services.arcgis.com/.../FeatureServer
  npm run index -- url https://services.arcgis.com/.../FeatureServer/0
`);
    process.exit(0);
  }

  const url = args[0];
  const deleteStale = args.includes('--delete-stale');

  console.log('='.repeat(60));
  console.log('URL Indexer');
  console.log('='.repeat(60));
  console.log(`URL: ${url}`);
  console.log(`Delete stale: ${deleteStale}`);
  console.log('');

  // Validate URL
  console.log('Validating URL...');
  const validation = await validateUrl(url);

  if (!validation.valid) {
    console.error(`Invalid URL: ${validation.error}`);
    await sql.end();
    process.exit(1);
  }

  console.log(`Type: ${validation.urlType}`);
  console.log(`Name: ${validation.name}`);
  if (validation.serviceCount) {
    console.log(`Services found: ${validation.serviceCount}`);
  }
  if (validation.layerCount) {
    console.log(`Layers found: ${validation.layerCount}`);
  }
  console.log('');

  // Index based on type
  let results: { indexed: number; skipped: number; errors: number };

  switch (validation.urlType) {
    case 'arcgis_server':
      results = await indexArcGISServer(url, deleteStale);
      break;
    case 'single_service':
      results = await indexSingleService(url, deleteStale);
      break;
    case 'hub':
      results = await indexHub(url, deleteStale);
      break;
    default:
      console.error('Unknown URL type');
      await sql.end();
      process.exit(1);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Indexed: ${results.indexed}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Errors: ${results.errors}`);

  await sql.end();
}

main().catch((error) => {
  console.error('Indexing failed:', error);
  process.exit(1);
});
