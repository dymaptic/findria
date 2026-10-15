import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

import postgres from 'postgres';
import OpenAI from 'openai';
import { ALL_CUSTOM_ORGS, type CustomOrg } from '../config/custom-sources';
import {
  IndexingService,
  ArcGISItem,
  ARCGIS_ONLINE_BASE,
  SUPPORTED_SERVICE_TYPES,
} from '../services/indexing.service';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://datalibrarian:datalibrarian@localhost:5432/datalibrarian';

const sql = postgres(connectionString);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const indexingService = new IndexingService(sql, openai);

/**
 * Search ArcGIS Online for content from a specific owner
 */
async function searchOrgContent(
  owner: string,
  start: number,
  num: number
): Promise<{
  results: ArcGISItem[];
  total: number;
  nextStart: number;
}> {
  const typeFilter = SUPPORTED_SERVICE_TYPES.map((t) => `type:"${t}"`).join(' OR ');

  const params = new URLSearchParams({
    q: `owner:${owner} (${typeFilter})`,
    f: 'json',
    start: start.toString(),
    num: num.toString(),
    sortField: 'modified',
    sortOrder: 'desc',
  });

  const response = await fetch(`${ARCGIS_ONLINE_BASE}/search?${params}`);
  const data = await response.json();

  return {
    results: data.results as ArcGISItem[],
    total: data.total,
    nextStart: data.nextStart,
  };
}

/**
 * Process an ArcGIS item and index each of its layers separately
 */
async function processItem(
  item: ArcGISItem,
  customOrg: CustomOrg,
  skipExisting: boolean = false
): Promise<{ indexed: number; skipped: number; errors: number }> {
  const results = { indexed: 0, skipped: 0, errors: 0 };

  try {
    const itemId = item.id;
    const serviceUrl = item.url || null;
    const itemType = item.type;

    // For non-queryable types (Image Service, Vector Tile), index as single item
    if (!serviceUrl || (itemType !== 'Feature Service' && itemType !== 'Map Service')) {
      const result = await indexSingleItem(item, customOrg, null, skipExisting);
      if (result === 'indexed') results.indexed++;
      else if (result === 'skipped') results.skipped++;
      else results.errors++;
      return results;
    }

    // Fetch layers from the service
    const layers = await indexingService.fetchServiceLayers(serviceUrl);

    if (layers.length === 0) {
      // No layers found, index as single item
      const result = await indexSingleItem(item, customOrg, null, skipExisting);
      if (result === 'indexed') results.indexed++;
      else if (result === 'skipped') results.skipped++;
      else results.errors++;
      return results;
    }

    // Index each layer separately
    for (const layer of layers) {
      const result = await indexSingleItem(item, customOrg, layer, skipExisting);
      if (result === 'indexed') results.indexed++;
      else if (result === 'skipped') results.skipped++;
      else results.errors++;

      // Rate limiting between layers
      await indexingService.sleep(100);
    }

    return results;
  } catch (error) {
    console.error(`    Error processing ${item.id}: ${error}`);
    results.errors++;
    return results;
  }
}

/**
 * Index a single layer (or the whole item if no layer specified)
 */
async function indexSingleItem(
  item: ArcGISItem,
  customOrg: CustomOrg,
  layer: { id: number; name: string; type?: string; geometryType?: string; description?: string; fields?: Array<{ name: string; type: string; alias?: string }> } | null,
  skipExisting: boolean = false
): Promise<'indexed' | 'skipped' | 'error'> {
  try {
    const itemId = item.id;

    // Build source_id: itemId for standalone, itemId_layer_N for layers
    const sourceId = layer ? `${itemId}_layer_${layer.id}` : itemId;

    // Check if this already exists in Living Atlas (always skip those)
    const existsInLA = await indexingService.existsInLivingAtlas(itemId);
    if (existsInLA) {
      return 'skipped';
    }

    // Check if already indexed as custom_org
    if (skipExisting) {
      const exists = await indexingService.datasetExists(sourceId, 'custom_org');
      if (exists) {
        return 'skipped';
      }
    }

    // Use the shared indexing service
    const result = await indexingService.indexLayer({
      item,
      layer,
      source: 'custom_org',
      orgDisplayName: customOrg.name,
    });

    return result.status;
  } catch (error) {
    console.error(`    Error indexing layer: ${error}`);
    return 'error';
  }
}

/**
 * Index all content from an organization
 */
async function indexOrg(
  org: CustomOrg,
  limitPerOrg: number,
  skipExisting: boolean = false
): Promise<{ indexed: number; skipped: number; errors: number }> {
  let start = 0;
  const pageSize = Math.min(100, limitPerOrg);
  let totalIndexed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let itemsProcessed = 0;

  while (itemsProcessed < limitPerOrg) {
    const { results, total, nextStart } = await searchOrgContent(org.owner, start, pageSize);

    if (results.length === 0) break;

    for (const item of results) {
      if (itemsProcessed >= limitPerOrg) break;

      const itemType = item.type;
      if (!SUPPORTED_SERVICE_TYPES.includes(itemType)) continue;

      const { indexed, skipped, errors } = await processItem(item, org, skipExisting);
      totalIndexed += indexed;
      totalSkipped += skipped;
      totalErrors += errors;
      itemsProcessed++;

      // Rate limiting between items
      await indexingService.sleep(200);
    }

    if (nextStart === -1 || start >= total) break;
    start = nextStart;
  }

  return { indexed: totalIndexed, skipped: totalSkipped, errors: totalErrors };
}

async function indexCustomSources() {
  // Parse arguments
  const limitPerOrgArg = process.argv.find((arg) => arg.startsWith('--limit-per-org='));
  const limitPerOrg = limitPerOrgArg ? parseInt(limitPerOrgArg.split('=')[1]!, 10) : 50;

  const maxOrgsArg = process.argv.find((arg) => arg.startsWith('--max-orgs='));
  const maxOrgs = maxOrgsArg ? parseInt(maxOrgsArg.split('=')[1]!, 10) : Infinity;

  const filterArg = process.argv.find((arg) => arg.startsWith('--filter='));
  const filter = filterArg ? filterArg.split('=')[1]!.toLowerCase() : null;

  const skipArg = process.argv.find((arg) => arg.startsWith('--skip='));
  const skip = skipArg ? parseInt(skipArg.split('=')[1]!, 10) : 0;

  // Skip already-indexed items (saves embedding costs on re-runs)
  const skipExisting = process.argv.includes('--skip-existing');

  // Filter orgs if specified
  let orgs = ALL_CUSTOM_ORGS;
  if (filter) {
    orgs = orgs.filter(
      (o) =>
        o.owner.toLowerCase().includes(filter) ||
        o.name.toLowerCase().includes(filter) ||
        (o.region && o.region.toLowerCase().includes(filter))
    );
  }

  // Apply skip and max
  orgs = orgs.slice(skip, skip + maxOrgs);

  console.log('='.repeat(60));
  console.log('Custom Sources Indexer');
  console.log('='.repeat(60));
  console.log(`Organizations to process: ${orgs.length}`);
  console.log(`Limit per org: ${limitPerOrg}`);
  if (filter) console.log(`Filter: "${filter}"`);
  if (skip > 0) console.log(`Skipping first: ${skip}`);
  if (skipExisting) console.log(`Skip existing: YES (saves embedding costs)`);
  console.log('');

  let totalIndexed = 0;
  let totalSkipped = 0;
  let orgsWithData = 0;
  let orgsEmpty = 0;

  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i]!;
    console.log(`[${i + 1}/${orgs.length}] ${org.name} (${org.owner})`);

    try {
      const { indexed, skipped } = await indexOrg(org, limitPerOrg, skipExisting);
      totalIndexed += indexed;
      totalSkipped += skipped;

      if (indexed > 0 || skipped > 0) {
        const parts = [];
        if (indexed > 0) parts.push(`${indexed} layers indexed`);
        if (skipped > 0) parts.push(`${skipped} skipped`);
        console.log(`    ✓ ${parts.join(', ')}`);
        orgsWithData++;
      } else {
        console.log(`    - No public Feature Services found`);
        orgsEmpty++;
      }
    } catch (error) {
      console.log(`    ✗ Error: ${error}`);
    }

    // Small delay between orgs
    await indexingService.sleep(500);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total layers indexed: ${totalIndexed}`);
  console.log(`Skipped (existing or in Living Atlas): ${totalSkipped}`);
  console.log(`Organizations with data: ${orgsWithData}`);
  console.log(`Organizations empty/private: ${orgsEmpty}`);

  await sql.end();
}

indexCustomSources().catch((error) => {
  console.error('Indexing failed:', error);
  process.exit(1);
});
