import { readFileSync } from 'fs';
import { join } from 'path';
import postgres from 'postgres';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://datalibrarian:datalibrarian@localhost:5432/datalibrarian';

async function migrate() {
  console.log('Running database migrations...');

  const sql = postgres(connectionString);

  try {
    // Read and execute init-db.sql
    const initSqlPath = join(__dirname, 'init-db.sql');
    const initSql = readFileSync(initSqlPath, 'utf-8');

    // Drop full-line comments first: they may precede statements or contain
    // semicolons, either of which would break naive splitting below.
    const statements = initSql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      try {
        await sql.unsafe(statement);
        console.log(
          `  ✓ ${statement.substring(0, 50).replace(/\n/g, ' ')}...`
        );
      } catch (error) {
        // Ignore "already exists" errors
        if (
          error instanceof Error &&
          !error.message.includes('already exists')
        ) {
          console.error(`  ✗ Error: ${error.message}`);
          console.error(`    Statement: ${statement.substring(0, 100)}...`);
        }
      }
    }

    console.log('\nMigration complete!');

    // Show current stats
    const stats = await sql`
      SELECT
        (SELECT COUNT(*) FROM datasets) as datasets,
        (SELECT COUNT(*) FROM coverage) as coverage,
        (SELECT COUNT(*) FROM search_logs) as search_logs
    `;

    console.log('\nCurrent database stats:');
    console.log(`  Datasets: ${stats[0]?.datasets || 0}`);
    console.log(`  Coverage records: ${stats[0]?.coverage || 0}`);
    console.log(`  Search logs: ${stats[0]?.search_logs || 0}`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

migrate();
