/**
 * Comprehensive data coverage test script
 * Run with: npx tsx scripts/comprehensive-test.ts
 */

import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_HEADERS = { 'Content-Type': 'application/json', 'Origin': BASE_URL };

interface SearchResult {
  query: string;
  resultCount: number;
  sources: string[];
  duration: number;
  error?: string;
}

// Expanded search queries (105 queries across 8 categories)
const SEARCH_QUERIES = [
  // Building & Infrastructure (15)
  'buildings', 'building footprints', 'buildings in Seattle', 'commercial buildings',
  'residential buildings', 'building permits', 'construction sites', 'skyscrapers',
  'office buildings', 'warehouses', 'building height', '3D buildings', 'building age',
  'historic buildings', 'building density',

  // Transportation (15)
  'roads', 'highways', 'streets', 'bike lanes', 'sidewalks', 'bridges', 'tunnels',
  'airports', 'train stations', 'bus routes', 'ferry terminals', 'parking lots',
  'traffic signals', 'speed limits', 'road conditions',

  // Water Features (15)
  'rivers', 'lakes', 'streams', 'wetlands', 'watersheds', 'oceans', 'coastline',
  'flood zones', 'water quality', 'reservoirs', 'canals', 'aquifers', 'groundwater',
  'stormwater', 'drinking water',

  // Parks & Recreation (15)
  'parks', 'national parks', 'state parks', 'playgrounds', 'sports fields',
  'golf courses', 'hiking trails', 'bike trails', 'campgrounds', 'picnic areas',
  'dog parks', 'gardens', 'nature preserves', 'wildlife refuges', 'recreation centers',

  // Boundaries & Administrative (15)
  'county boundaries', 'state boundaries', 'city limits', 'zip codes', 'census tracts',
  'census blocks', 'congressional districts', 'school districts', 'voting precincts',
  'neighborhoods', 'zoning', 'land use', 'parcels', 'property boundaries', 'jurisdictions',

  // Points of Interest (15)
  'hospitals', 'schools', 'fire stations', 'police stations', 'libraries', 'post offices',
  'government buildings', 'churches', 'cemeteries', 'museums', 'stadiums',
  'shopping centers', 'restaurants', 'gas stations', 'EV charging stations',

  // Environment & Natural (15)
  'elevation', 'terrain', 'soil types', 'geology', 'landslide risk', 'earthquake faults',
  'wildfire risk', 'air quality', 'climate zones', 'vegetation', 'forests', 'grasslands',
  'deserts', 'mountains', 'valleys',
];

async function testSearch(query: string): Promise<SearchResult> {
  const start = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/api/search`, {
      method: 'POST',
      headers: TEST_HEADERS,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const duration = Date.now() - start;

    const sources = [...new Set(data.datasets?.map((d: { source: string }) => d.source) || [])] as string[];

    return {
      query,
      resultCount: data.datasets?.length || 0,
      sources,
      duration,
    };
  } catch (error) {
    return {
      query,
      resultCount: 0,
      sources: [],
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('COMPREHENSIVE DATA COVERAGE TEST');
  console.log('='.repeat(80));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Total Queries: ${SEARCH_QUERIES.length}`);
  console.log();

  const results: SearchResult[] = [];
  let pass = 0;
  let noData = 0;
  let fail = 0;

  // Run queries in batches to avoid overwhelming the server
  const batchSize = 5;
  for (let i = 0; i < SEARCH_QUERIES.length; i += batchSize) {
    const batch = SEARCH_QUERIES.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(q => testSearch(q)));

    for (const result of batchResults) {
      results.push(result);

      const status = result.error ? 'ERROR' : result.resultCount > 0 ? 'PASS' : 'NO DATA';
      if (result.error) fail++;
      else if (result.resultCount > 0) pass++;
      else noData++;

      const icon = result.error ? '❌' : result.resultCount > 0 ? '✅' : '⚠️';
      console.log(`${icon} [${status.padEnd(7)}] "${result.query}" => ${result.resultCount} results (${result.duration}ms)`);
    }

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log();
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total: ${results.length}`);
  console.log(`Pass: ${pass} (${(pass/results.length*100).toFixed(1)}%)`);
  console.log(`No Data: ${noData} (${(noData/results.length*100).toFixed(1)}%)`);
  console.log(`Errors: ${fail} (${(fail/results.length*100).toFixed(1)}%)`);
  console.log();

  // Show queries with no data
  const noDataQueries = results.filter(r => !r.error && r.resultCount === 0);
  if (noDataQueries.length > 0) {
    console.log('Queries with NO DATA (potential gaps):');
    for (const r of noDataQueries) {
      console.log(`  - "${r.query}"`);
    }
    console.log();
  }

  // Show data sources found
  const allSources = new Set(results.flatMap(r => r.sources));
  console.log('Data sources found:');
  for (const source of allSources) {
    const count = results.filter(r => r.sources.includes(source)).length;
    console.log(`  - ${source}: ${count} queries`);
  }
}

main().catch(console.error);
