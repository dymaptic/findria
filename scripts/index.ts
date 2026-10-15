#!/usr/bin/env tsx
/**
 * Unified CLI for Findria indexing
 *
 * Usage:
 *   npm run index -- <command> [options]
 *
 * Commands:
 *   living-atlas    Index from ArcGIS Living Atlas
 *   custom-orgs     Index from custom organization sources
 *   url             Index a single URL (ArcGIS Server, FeatureServer, or Hub)
 *   geoparquet      Index GeoParquet sources
 *   queue           Process pending jobs from the indexing_jobs table
 *   help            Show this help message
 *
 * Examples:
 *   npm run index -- living-atlas --query=parks
 *   npm run index -- living-atlas --recipe
 *   npm run index -- custom-orgs --filter=portland
 *   npm run index -- url https://gis.portland.gov/arcgis/rest/services
 *   npm run index -- geoparquet
 */

import { spawn } from 'child_process';
import * as path from 'path';

const SCRIPTS_DIR = __dirname;

function showHelp() {
  console.log(`
Findria Indexing CLI
============================

Usage: npm run index -- <command> [options]

Commands:
  living-atlas    Index from ArcGIS Living Atlas
  custom-orgs     Index from custom organization sources
  url <url>       Index a single URL (immediate, no queue)
  geoparquet      Index GeoParquet sources
  queue           Process pending jobs from the queue table
  help            Show this help message

Living Atlas Options:
  --query=KEYWORD       Run single search (also saves to recipe)
  --recipe              Run all filters from recipe file
  --add-filter=KEYWORD  Add filter to recipe without running
  --show-filters        Show current filters in recipe
  --clear               Clear all living_atlas data first
  --limit=N             Limit items per filter
  --delay=MS            Delay between items (default 500)
  --batch-delay=MS      Delay between batches (default 2000)

Custom Orgs Options:
  --filter=TERM         Filter orgs by name/region
  --limit-per-org=N     Limit items per org (default 50)
  --max-orgs=N          Max orgs to process
  --skip=N              Skip first N orgs
  --skip-existing       Skip already-indexed items

URL Options:
  --delete-stale        Delete items no longer at source (for re-index)

Examples:
  npm run index -- living-atlas --query="parks"
  npm run index -- living-atlas --recipe --limit=100
  npm run index -- living-atlas --show-filters
  npm run index -- custom-orgs --filter=portland --limit-per-org=20
  npm run index -- url https://gis.portland.gov/arcgis/rest/services
  npm run index -- url https://services.arcgis.com/.../FeatureServer
  npm run index -- geoparquet
  npm run index -- queue
  npm run index -- queue --status
`);
}

function runScript(scriptName: string, args: string[]) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);

  console.log(`Running: tsx ${scriptPath} ${args.join(' ')}\n`);

  const child = spawn('npx', ['tsx', scriptPath, ...args], {
    stdio: 'inherit',
    cwd: path.join(SCRIPTS_DIR, '..'),
  });

  child.on('close', (code) => {
    process.exit(code || 0);
  });

  child.on('error', (err) => {
    console.error(`Failed to start script: ${err.message}`);
    process.exit(1);
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case 'living-atlas':
      runScript('index-living-atlas.ts', commandArgs);
      break;

    case 'custom-orgs':
      runScript('index-custom-sources.ts', commandArgs);
      break;

    case 'url':
      if (commandArgs.length === 0 || commandArgs[0] === '--help' || commandArgs[0] === '-h') {
        runScript('index-url.ts', ['--help']);
        break;
      }
      if (commandArgs[0].startsWith('-')) {
        console.error('Error: URL is required for the "url" command');
        console.error('Usage: npm run index -- url <url> [options]');
        process.exit(1);
      }
      runScript('index-url.ts', commandArgs);
      break;

    case 'geoparquet':
      runScript('index-geoparquet.ts', commandArgs);
      break;

    case 'queue':
      runScript('process-queue.ts', commandArgs);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "npm run index -- help" for usage information');
      process.exit(1);
  }
}

main();
