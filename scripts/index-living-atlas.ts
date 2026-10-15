import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

import postgres from 'postgres';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import {
  IndexingService,
  LayerInfo,
  ArcGISItem,
  ARCGIS_ONLINE_BASE,
  SUPPORTED_SERVICE_TYPES,
  IGNORED_SERVICE_TYPES,
} from '../services/indexing.service';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://datalibrarian:datalibrarian@localhost:5432/datalibrarian';

const sql = postgres(connectionString);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const indexingService = new IndexingService(sql, openai);

const FILTERS_FILE = path.join(__dirname, '../data/living-atlas-filters.json');

interface FiltersConfig {
  description: string;
  filters: string[];
}

/**
 * Load filters from the recipe file
 */
function loadFilters(): string[] {
  try {
    if (fs.existsSync(FILTERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(FILTERS_FILE, 'utf-8')) as FiltersConfig;
      return data.filters || [];
    }
  } catch (error) {
    console.warn('Could not load filters file:', error);
  }
  return [];
}

/**
 * Save filters to the recipe file
 */
function saveFilters(filters: string[]): void {
  const data: FiltersConfig = {
    description: 'Search filters for Living Atlas indexing. Each filter is run in order, with deduplication by item ID.',
    filters: filters,
  };

  const dir = path.dirname(FILTERS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(FILTERS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Add a new filter to the recipe file (if not already present)
 */
function addFilter(newFilter: string): boolean {
  const filters = loadFilters();
  if (filters.includes(newFilter)) {
    return false;
  }
  filters.push(newFilter);
  saveFilters(filters);
  return true;
}

/**
 * Search Living Atlas for items
 */
async function searchLivingAtlas(
  start: number,
  num: number,
  keyword?: string
): Promise<{
  results: ArcGISItem[];
  total: number;
  nextStart: number;
}> {
  // Living Atlas Esri owner accounts
  const esriOwners = [
    'esri', 'esri_Landscape', 'esri_dm', 'esri_basemaps', 'esri_vector',
    'esri_livefeeds', 'esri_oceans', 'esri_demographics', 'esri_observations',
    'esri_landscape2', 'Esri_GI', 'esri_livefeeds2', 'esri_analytics',
    'esri_imagery', 'Esri_US_Federal_Data', 'esri_environment', 'esri_webstyles',
    'esri_atlas', 'esri_communitymaps', 'esri_dashboardpub', 'esri_data_development',
    'esri_ecm', 'esri_elevation', 'esri_historical', 'esri_hydro', 'esri_policymaps',
    'esri_premium', 'esri_storymaps', 'Federal_User_Community', 'StoryMaps',
  ];
  const ownerFilter = esriOwners.map(o => `owner:${o}`).join(' OR ');
  const typeFilter = SUPPORTED_SERVICE_TYPES.map(t => `type:"${t}"`).join(' OR ');

  // Combined query: Esri owners OR authoritative content
  const sourceFilter = `((${ownerFilter}) OR (contentstatus:"public_authoritative"))`;

  // Build query with optional keyword filter
  let query = `${sourceFilter} (${typeFilter})`;
  if (keyword) {
    query = `${keyword} ${query}`;
  }

  const params = new URLSearchParams({
    q: query,
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
 * Process an ArcGIS item and index each of its layers
 */
async function processItem(
  item: ArcGISItem,
  seenSourceIds: Set<string>,
  itemDelay: number
): Promise<{ indexed: number; skipped: number }> {
  const results = { indexed: 0, skipped: 0 };

  try {
    const itemId = item.id;
    const serviceUrl = item.url || null;
    const itemType = item.type;

    // For non-queryable types (Image Service, Vector Tile), index as single item
    if (!serviceUrl || (itemType !== 'Feature Service' && itemType !== 'Map Service')) {
      const sourceId = itemId;

      if (seenSourceIds.has(sourceId)) {
        results.skipped++;
        return results;
      }

      seenSourceIds.add(sourceId);
      const result = await indexingService.indexLayer({
        item,
        layer: null,
        source: 'living_atlas',
      });

      if (result.status === 'indexed') results.indexed++;
      else results.skipped++;

      await indexingService.sleep(itemDelay);
      return results;
    }

    // Fetch layers from the service
    const layers = await indexingService.fetchServiceLayers(serviceUrl);

    if (layers.length === 0) {
      // No layers found, index as single item
      const sourceId = itemId;

      if (seenSourceIds.has(sourceId)) {
        results.skipped++;
        return results;
      }

      seenSourceIds.add(sourceId);
      const result = await indexingService.indexLayer({
        item,
        layer: null,
        source: 'living_atlas',
      });

      if (result.status === 'indexed') results.indexed++;
      else results.skipped++;

      await indexingService.sleep(itemDelay);
      return results;
    }

    // Index each layer separately
    for (const layer of layers) {
      const sourceId = `${itemId}_layer_${layer.id}`;

      if (seenSourceIds.has(sourceId)) {
        results.skipped++;
        continue;
      }

      seenSourceIds.add(sourceId);
      const result = await indexingService.indexLayer({
        item,
        layer,
        source: 'living_atlas',
      });

      if (result.status === 'indexed') results.indexed++;
      else results.skipped++;

      // Rate limiting between layers
      await indexingService.sleep(itemDelay);
    }

    return results;
  } catch (error) {
    console.error(`    Error processing ${item.id}: ${error}`);
    return results;
  }
}

/**
 * Run indexing for a single filter keyword
 */
async function indexWithFilter(
  keyword: string | undefined,
  limit: number,
  seenSourceIds: Set<string>,
  itemDelay: number,
  batchDelay: number
): Promise<{ indexed: number; skipped: number }> {
  let totalIndexed = 0;
  let totalSkipped = 0;
  let start = 0;
  const pageSize = Math.min(100, limit);
  let itemsProcessed = 0;

  console.log(`\n--- Filter: "${keyword || '(no filter)'}" ---`);

  while (itemsProcessed < limit) {
    console.log(`  Fetching items ${start} to ${start + pageSize}...`);

    const { results, total, nextStart } = await searchLivingAtlas(
      start,
      pageSize,
      keyword
    );

    if (results.length === 0) {
      console.log('  No more results.');
      break;
    }

    for (const item of results) {
      if (itemsProcessed >= limit) break;

      const itemType = item.type;

      // Skip unsupported types
      if (IGNORED_SERVICE_TYPES.includes(itemType)) {
        continue;
      }

      if (!SUPPORTED_SERVICE_TYPES.includes(itemType)) {
        console.log(`    Skipping unknown type: ${itemType}`);
        continue;
      }

      // Check if we've already seen this item ID (from a previous filter)
      const itemId = item.id;

      // For Feature/Map services, we check layer-level dedup in processItem
      // For others, check item-level here
      const isPotentialDupe = seenSourceIds.has(itemId);

      if (isPotentialDupe && item.type !== 'Feature Service' && item.type !== 'Map Service') {
        totalSkipped++;
        itemsProcessed++;
        continue;
      }

      try {
        const { indexed, skipped } = await processItem(item, seenSourceIds, itemDelay);
        totalIndexed += indexed;
        totalSkipped += skipped;
        itemsProcessed++;

        if ((totalIndexed + totalSkipped) % 20 === 0) {
          console.log(`    Progress: ${totalIndexed} indexed, ${totalSkipped} skipped (deduped)`);
        }
      } catch (error) {
        console.error(`    Error processing item ${item.id}:`, error);
        itemsProcessed++;
      }
    }

    if (nextStart === -1 || start >= total) break;
    if (itemsProcessed >= limit) break;

    // Pause between batches
    console.log(`  Batch complete. Pausing ${batchDelay}ms...`);
    await indexingService.sleep(batchDelay);
    start = nextStart;
  }

  console.log(`  Filter complete: ${totalIndexed} indexed, ${totalSkipped} skipped`);
  return { indexed: totalIndexed, skipped: totalSkipped };
}

async function indexLivingAtlas() {
  // Parse arguments
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]!, 10) : Infinity;

  const queryArg = process.argv.find((arg) => arg.startsWith('--query='));
  const singleQuery = queryArg ? queryArg.split('=')[1] : undefined;

  const addFilterArg = process.argv.find((arg) => arg.startsWith('--add-filter='));
  const newFilter = addFilterArg ? addFilterArg.split('=')[1] : undefined;

  // Delay between items in ms (default 500ms for gentle scraping)
  const delayArg = process.argv.find((arg) => arg.startsWith('--delay='));
  const itemDelay = delayArg ? parseInt(delayArg.split('=')[1]!, 10) : 500;

  // Delay between pages/batches in ms (default 2000ms)
  const batchDelayArg = process.argv.find((arg) => arg.startsWith('--batch-delay='));
  const batchDelay = batchDelayArg ? parseInt(batchDelayArg.split('=')[1]!, 10) : 2000;

  // Clear existing living_atlas entries first
  const shouldClear = process.argv.includes('--clear');

  // Show current filters
  const showFilters = process.argv.includes('--show-filters');

  // Run all filters from recipe file
  const runRecipe = process.argv.includes('--recipe');

  console.log('='.repeat(60));
  console.log('Living Atlas Indexer');
  console.log('='.repeat(60));

  // Handle --show-filters
  if (showFilters) {
    const filters = loadFilters();
    console.log('\nCurrent filters in recipe file:');
    if (filters.length === 0) {
      console.log('  (none)');
    } else {
      filters.forEach((f, i) => console.log(`  ${i + 1}. "${f}"`));
    }
    console.log(`\nRecipe file: ${FILTERS_FILE}`);
    await sql.end();
    return;
  }

  // Handle --add-filter
  if (newFilter) {
    const added = addFilter(newFilter);
    if (added) {
      console.log(`\nAdded filter "${newFilter}" to recipe file.`);
    } else {
      console.log(`\nFilter "${newFilter}" already exists in recipe file.`);
    }
    const filters = loadFilters();
    console.log('\nCurrent filters:');
    filters.forEach((f, i) => console.log(`  ${i + 1}. "${f}"`));
    await sql.end();
    return;
  }

  // Determine which filters to run
  let filtersToRun: (string | undefined)[];

  if (singleQuery) {
    // Single query mode (also saves to recipe)
    filtersToRun = [singleQuery];
    addFilter(singleQuery);
    console.log(`Running single query: "${singleQuery}" (saved to recipe)`);
  } else if (runRecipe) {
    // Recipe mode - run all saved filters
    filtersToRun = loadFilters();
    if (filtersToRun.length === 0) {
      console.log('\nNo filters in recipe file. Add some with --add-filter=keyword');
      console.log(`Recipe file: ${FILTERS_FILE}`);
      await sql.end();
      return;
    }
    console.log(`Running ${filtersToRun.length} filters from recipe file`);
  } else {
    console.log('\nUsage:');
    console.log('  --query=KEYWORD       Run single search (also saves to recipe)');
    console.log('  --recipe              Run all filters from recipe file');
    console.log('  --add-filter=KEYWORD  Add filter to recipe without running');
    console.log('  --show-filters        Show current filters in recipe');
    console.log('  --clear               Clear all living_atlas data first');
    console.log('  --limit=N             Limit items per filter');
    console.log('  --delay=MS            Delay between items (default 500)');
    console.log('  --batch-delay=MS      Delay between batches (default 2000)');
    console.log(`\nRecipe file: ${FILTERS_FILE}`);
    await sql.end();
    return;
  }

  console.log(`Rate limiting: ${itemDelay}ms between items, ${batchDelay}ms between batches`);
  if (limit !== Infinity) {
    console.log(`Limiting to ${limit} items per filter.`);
  }
  console.log(`Supported types: ${SUPPORTED_SERVICE_TYPES.join(', ')}`);

  if (shouldClear) {
    console.log('\nClearing existing living_atlas entries...');
    const result = await sql`DELETE FROM datasets WHERE source = 'living_atlas'`;
    console.log(`Deleted ${result.count} existing entries.`);
  }

  // Track seen source IDs across all filters for deduplication
  const seenSourceIds = new Set<string>();
  let grandTotalIndexed = 0;
  let grandTotalSkipped = 0;
  const startTime = Date.now();

  // Run each filter
  for (const filter of filtersToRun) {
    const { indexed, skipped } = await indexWithFilter(
      filter,
      limit,
      seenSourceIds,
      itemDelay,
      batchDelay
    );
    grandTotalIndexed += indexed;
    grandTotalSkipped += skipped;
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total indexed: ${grandTotalIndexed} layers`);
  console.log(`Total skipped (deduped): ${grandTotalSkipped}`);
  console.log(`Unique source IDs: ${seenSourceIds.size}`);
  console.log(`Time: ${Math.round(elapsed)}s`);
  console.log(`Filters run: ${filtersToRun.length}`);

  await sql.end();
}

indexLivingAtlas().catch((error) => {
  console.error('Indexing failed:', error);
  process.exit(1);
});
