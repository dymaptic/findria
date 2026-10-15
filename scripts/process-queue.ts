import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

import postgres from 'postgres';
import OpenAI from 'openai';
import { IndexingService, IndexResult } from '../services/indexing.service';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://datalibrarian:datalibrarian@localhost:5432/datalibrarian';

const sql = postgres(connectionString);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const indexingService = new IndexingService(sql, openai);

interface IndexingJob {
  id: string;
  job_type: string;
  url: string | null;
  url_type: string | null;
  config: Record<string, unknown> | null;
  status: string;
  priority: number;
  current_offset: number;
  total_items: number | null;
  items_processed: number;
  items_indexed: number;
  items_skipped: number;
  is_reindex: boolean;
  deletion_scope: string | null;
  submitted_at: string;
}

async function getNextJob(types: string[]): Promise<IndexingJob | null> {
  const result = await sql<IndexingJob[]>`
    SELECT *
    FROM indexing_jobs
    WHERE status IN ('pending', 'processing')
      AND job_type = ANY(${types})
    ORDER BY priority ASC, submitted_at ASC
    LIMIT 1
  `;
  return result[0] || null;
}

async function markJobStarted(jobId: string): Promise<void> {
  await sql`
    UPDATE indexing_jobs
    SET status = 'processing', started_at = NOW()
    WHERE id = ${jobId}
  `;
}

async function markJobCompleted(
  jobId: string,
  indexed: number,
  skipped: number,
  processed: number
): Promise<void> {
  await sql`
    UPDATE indexing_jobs
    SET status = 'completed',
        completed_at = NOW(),
        items_indexed = ${indexed},
        items_skipped = ${skipped},
        items_processed = ${processed}
    WHERE id = ${jobId}
  `;
}

async function markJobFailed(jobId: string, error: string): Promise<void> {
  await sql`
    UPDATE indexing_jobs
    SET status = 'failed', error_message = ${error}
    WHERE id = ${jobId}
  `;
}

/** Days after which submitter IPs on queue jobs are cleared. */
const SUBMITTER_IP_RETENTION_DAYS = 30;

/**
 * Privacy: submitter_ip is only needed for short-term rate limiting of
 * submissions. Null it out once a job is older than the retention window.
 * Idempotent; safe to run on every queue pass.
 */
async function purgeOldSubmitterIps(): Promise<void> {
  try {
    const result = await sql`
      UPDATE indexing_jobs
      SET submitter_ip = NULL
      WHERE submitter_ip IS NOT NULL
        AND submitted_at < NOW() - make_interval(days => ${SUBMITTER_IP_RETENTION_DAYS})
    `;
    if (result.count > 0) {
      console.log(`Purged submitter IPs from ${result.count} job(s) older than ${SUBMITTER_IP_RETENTION_DAYS} days.`);
    }
  } catch (error) {
    // Never block queue processing on the purge
    console.warn('Submitter IP purge failed:', error instanceof Error ? error.message : error);
  }
}

async function processJob(job: IndexingJob): Promise<void> {
  if (!job.url) {
    await markJobFailed(job.id, 'No URL specified');
    return;
  }

  console.log(`  URL: ${job.url}`);
  console.log(`  Type: ${job.url_type || 'auto-detect'}`);

  const svc = indexingService;
  let result: IndexResult;

  switch (job.url_type) {
    case 'hub':
      result = await svc.indexHub(job.url);
      break;
    case 'arcgis_server':
      result = await svc.indexArcGISServer(job.url);
      break;
    case 'single_service':
      result = await svc.indexSingleService(job.url);
      break;
    default: {
      // Unknown type — try hub first (DCAT feed), then fall back to single service
      const { detectUrlType } = await import('../services/source-validation.service');
      const detected = detectUrlType(job.url);
      if (detected === 'hub') {
        result = await svc.indexHub(job.url);
      } else if (detected === 'arcgis_server') {
        result = await svc.indexArcGISServer(job.url);
      } else {
        // Try hub first since many portals don't match URL patterns
        result = await svc.indexHub(job.url);
        if (result.indexed === 0 && result.errors > 0) {
          console.log('  Hub indexing failed, trying as single service...');
          result = await svc.indexSingleService(job.url);
        }
      }
      break;
    }
  }

  const totalProcessed = result.indexed + result.skipped + result.errors;

  if (result.indexed === 0 && result.errors > 0) {
    await markJobFailed(
      job.id,
      `Indexed 0 datasets. ${result.errors} error(s). URL type: ${job.url_type || 'unknown'}`
    );
    console.log(`  FAILED: 0 indexed, ${result.errors} errors`);
  } else if (result.indexed === 0 && result.errors === 0 && result.skipped === 0) {
    await markJobFailed(job.id, 'No indexable content found at URL');
    console.log(`  FAILED: No indexable content found`);
  } else {
    await markJobCompleted(job.id, result.indexed, result.skipped, totalProcessed);
    if (result.errors > 0) {
      await sql`
        UPDATE indexing_jobs
        SET error_message = ${`Completed with ${result.errors} error(s)`}
        WHERE id = ${job.id}
      `;
    }
    console.log(`  OK: ${result.indexed} indexed, ${result.skipped} skipped, ${result.errors} errors`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const statusOnly = args.includes('--status');

  console.log('='.repeat(60));
  console.log('Queue Processor');
  console.log('='.repeat(60));

  // Show queue status
  const stats = await sql<{
    status: string;
    count: string;
  }[]>`
    SELECT status, COUNT(*)::text as count
    FROM indexing_jobs
    GROUP BY status
    ORDER BY status
  `;

  console.log('\nQueue status:');
  for (const row of stats) {
    console.log(`  ${row.status}: ${row.count}`);
  }

  if (!statusOnly) {
    await purgeOldSubmitterIps();
  }

  if (statusOnly) {
    // Show pending/processing jobs
    const pending = await sql<IndexingJob[]>`
      SELECT * FROM indexing_jobs
      WHERE status IN ('pending', 'processing')
      ORDER BY priority ASC, submitted_at ASC
    `;
    if (pending.length > 0) {
      console.log('\nPending/processing jobs:');
      for (const job of pending) {
        console.log(`  [${job.id.slice(0, 8)}] ${job.job_type} | ${job.url || 'no url'} | ${job.status} | priority=${job.priority}`);
      }
    }
    await sql.end();
    return;
  }

  // Process all user submissions first
  console.log('\n--- Processing user submissions ---');
  let userCount = 0;
  while (true) {
    const job = await getNextJob(['user_submission']);
    if (!job) break;

    userCount++;
    console.log(`\nJob ${userCount}: ${job.job_type} [${job.id.slice(0, 8)}]`);

    if (job.status === 'pending') {
      await markJobStarted(job.id);
    }

    try {
      await processJob(job);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      await markJobFailed(job.id, msg);
      console.log(`  ERROR: ${msg}`);
    }
  }
  console.log(userCount === 0 ? 'No user submissions in queue.' : `\nProcessed ${userCount} user submission(s).`);

  // Process admin jobs
  console.log('\n--- Processing admin jobs ---');
  let adminCount = 0;
  while (true) {
    const job = await getNextJob(['single_url_admin', 'living_atlas', 'custom_orgs']);
    if (!job) break;

    adminCount++;
    console.log(`\nJob ${adminCount}: ${job.job_type} [${job.id.slice(0, 8)}]`);

    if (job.status === 'pending') {
      await markJobStarted(job.id);
    }

    try {
      await processJob(job);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      await markJobFailed(job.id, msg);
      console.log(`  ERROR: ${msg}`);
    }
  }
  console.log(adminCount === 0 ? 'No admin jobs in queue.' : `\nProcessed ${adminCount} admin job(s).`);

  console.log('\n' + '='.repeat(60));
  console.log(`Done. ${userCount + adminCount} total jobs processed.`);
  console.log('='.repeat(60));

  await sql.end();
}

main().catch(async (error) => {
  console.error('Queue processing failed:', error);
  await sql.end();
  process.exit(1);
});
