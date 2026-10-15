/**
 * fix-embeddings.ts — Find and repair short/missing embeddings
 *
 * Usage:
 *   npx tsx scripts/fix-embeddings.ts              # Report only (dry run)
 *   npx tsx scripts/fix-embeddings.ts --fix        # Fix short embeddings
 *   node dist/fix-embeddings.js                    # Production (compiled)
 *   node dist/fix-embeddings.js --fix              # Production fix mode
 */

import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

import postgres from 'postgres';
import OpenAI from 'openai';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://datalibrarian:datalibrarian@localhost:5432/datalibrarian';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EXPECTED_DIMS = 1536;
const BATCH_SIZE = 50;

const sql = postgres(connectionString);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const fixMode = process.argv.includes('--fix');

async function generateEmbedding(text: string): Promise<number[]> {
  const cleanedText = text.replace(/\s+/g, ' ').trim().substring(0, 8000);
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: cleanedText,
    dimensions: EXPECTED_DIMS,
  });
  return response.data[0]!.embedding;
}

async function main() {
  console.log('============================================================');
  console.log('Embedding Health Check');
  console.log('============================================================');
  console.log(`Mode: ${fixMode ? 'FIX' : 'REPORT ONLY (use --fix to repair)'}`);
  console.log(`Database: ${connectionString.replace(/\/\/.*@/, '//***@')}`);
  console.log();

  // 1. Overall stats
  const totalStats = await sql`
    SELECT COUNT(*) as total,
           COUNT(embedding) as with_embedding,
           COUNT(*) - COUNT(embedding) as null_embedding
    FROM datasets
  `;
  console.log(`Total records: ${totalStats[0].total}`);
  console.log(`With embedding: ${totalStats[0].with_embedding}`);
  console.log(`NULL embedding: ${totalStats[0].null_embedding}`);
  console.log();

  // 2. Dimension distribution
  const dimStats = await sql`
    SELECT vector_dims(embedding) as dims, COUNT(*) as cnt
    FROM datasets
    WHERE embedding IS NOT NULL
    GROUP BY vector_dims(embedding)
    ORDER BY dims
  `;
  console.log('Embedding dimension distribution:');
  for (const row of dimStats) {
    const marker = parseInt(row.dims) !== EXPECTED_DIMS ? ' ← WRONG' : '';
    console.log(`  ${row.dims} dims: ${row.cnt} records${marker}`);
  }
  console.log();

  // 3. Find records with wrong dimensions
  const badRecords = await sql`
    SELECT id, name, source, source_id, search_text,
           vector_dims(embedding) as dims
    FROM datasets
    WHERE embedding IS NOT NULL
      AND vector_dims(embedding) != ${EXPECTED_DIMS}
    ORDER BY name
  `;

  // 4. Find records with NULL embeddings that have search_text
  const nullRecords = await sql`
    SELECT id, name, source, source_id, search_text
    FROM datasets
    WHERE embedding IS NULL
      AND search_text IS NOT NULL
      AND search_text != ''
    ORDER BY name
  `;

  const totalToFix = badRecords.length + nullRecords.length;

  if (badRecords.length > 0) {
    console.log(`Records with wrong dimensions: ${badRecords.length}`);
    for (const r of badRecords.slice(0, 10)) {
      console.log(`  [${r.dims}d] ${r.name} (${r.source}/${r.source_id})`);
    }
    if (badRecords.length > 10) {
      console.log(`  ... and ${badRecords.length - 10} more`);
    }
    console.log();
  }

  if (nullRecords.length > 0) {
    console.log(`Records with NULL embedding (have search_text): ${nullRecords.length}`);
    for (const r of nullRecords.slice(0, 10)) {
      console.log(`  ${r.name} (${r.source}/${r.source_id})`);
    }
    if (nullRecords.length > 10) {
      console.log(`  ... and ${nullRecords.length - 10} more`);
    }
    console.log();
  }

  if (totalToFix === 0) {
    console.log('All embeddings are healthy. Nothing to fix.');
    await sql.end();
    return;
  }

  if (!fixMode) {
    console.log(`${totalToFix} records need fixing. Run with --fix to repair.`);
    await sql.end();
    return;
  }

  // Fix mode
  console.log(`Fixing ${totalToFix} records...`);
  console.log();

  const allToFix = [...badRecords, ...nullRecords];
  let fixed = 0;
  let errors = 0;

  for (let i = 0; i < allToFix.length; i += BATCH_SIZE) {
    const batch = allToFix.slice(i, i + BATCH_SIZE);

    for (const record of batch) {
      try {
        if (!record.search_text) {
          console.log(`  SKIP (no search_text): ${record.name}`);
          continue;
        }

        const embedding = await generateEmbedding(record.search_text);

        await sql`
          UPDATE datasets
          SET embedding = ${`[${embedding.join(',')}]`}::vector,
              updated_at = NOW()
          WHERE id = ${record.id}
        `;

        fixed++;
        const progress = `[${fixed + errors}/${totalToFix}]`;
        console.log(`  ${progress} Fixed: ${record.name}`);
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ERROR: ${record.name}: ${msg}`);
      }

      // Rate limit: ~50ms between embedding calls
      await new Promise((r) => setTimeout(r, 50));
    }

    // Pause between batches
    if (i + BATCH_SIZE < allToFix.length) {
      console.log(`  ... processed ${Math.min(i + BATCH_SIZE, allToFix.length)}/${allToFix.length}, pausing...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log();
  console.log('============================================================');
  console.log('Results');
  console.log('============================================================');
  console.log(`Fixed: ${fixed}`);
  console.log(`Errors: ${errors}`);

  await sql.end();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
