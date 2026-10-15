import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL is not set. Using local fallback connection string.');
}

const connectionString = process.env.DATABASE_URL || 'postgresql://datalibrarian:datalibrarian@localhost:5432/datalibrarian';

export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlParam = any;

export async function query<T>(
  sqlQuery: string,
  params: SqlParam[] = []
): Promise<T[]> {
  const result = await sql.unsafe(sqlQuery, params);
  return result as unknown as T[];
}

export async function queryOne<T>(
  sqlQuery: string,
  params: SqlParam[] = []
): Promise<T | null> {
  const result = await query<T>(sqlQuery, params);
  return result[0] || null;
}

export async function execute(
  sqlQuery: string,
  params: SqlParam[] = []
): Promise<void> {
  await sql.unsafe(sqlQuery, params);
}

export default sql;
