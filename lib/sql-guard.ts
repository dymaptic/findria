/**
 * SQL guard: validation helpers for SQL fragments that come from untrusted
 * input (end users or LLM tool calls) and are interpolated into DuckDB SQL or
 * forwarded to ArcGIS REST `where` parameters.
 *
 * The WHERE-clause validator is a strict allowlist, not a full SQL parser. It:
 *   - tokenizes single-quoted string literals (with '' escapes) so keyword and
 *     function checks only look at SQL *outside* literals;
 *   - rejects backslashes and other characters that enable alternate quoting
 *     (E'..', U&'..', $$..$$) which would desync our tokenizer from DuckDB's;
 *   - rejects statement separators, comments, unbalanced parentheses;
 *   - rejects keywords that introduce subqueries or side effects (SELECT, FROM,
 *     UNION, WITH, VALUES, TABLE, ATTACH, COPY, INSTALL, LOAD, SET, ...);
 *   - only allows calls to an allowlist of scalar/spatial functions, which
 *     blocks DuckDB table/reader functions (read_parquet, read_csv, glob,
 *     getenv, ...);
 *   - rejects string literals containing URLs (s3://, az://, https://, ...).
 */

// Keywords that are never allowed (matched as whole words outside string literals)
const FORBIDDEN_KEYWORDS = [
  // DDL / DML / side effects
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE',
  'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'ATTACH', 'DETACH', 'COPY',
  'EXPORT', 'IMPORT', 'INSTALL', 'LOAD', 'PRAGMA', 'SET', 'RESET', 'CALL',
  'CHECKPOINT', 'VACUUM', 'DESCRIBE', 'SUMMARIZE', 'SHOW', 'MERGE',
  'PREPARE', 'DEALLOCATE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'RETURNING', 'INTO',
  // Subquery / set-operation introducers (DuckDB supports FROM-first queries,
  // `TABLE x`, `VALUES (...)`, and replacement scans like FROM 'file.csv')
  'SELECT', 'FROM', 'UNION', 'INTERSECT', 'EXCEPT', 'WITH', 'VALUES',
  'TABLE', 'PIVOT', 'UNPIVOT', 'LATERAL', 'JOIN', 'QUALIFY', 'WINDOW', 'OVER',
];

// DuckDB table/reader/system functions, called out explicitly for clearer
// errors. (Anything not in the allowlist below is rejected regardless.)
const FORBIDDEN_FUNCTIONS = [
  'read_parquet', 'parquet_scan', 'parquet_metadata', 'parquet_schema', 'parquet_file_metadata',
  'read_csv', 'read_csv_auto', 'sniff_csv', 'read_json', 'read_json_auto', 'read_json_objects',
  'read_ndjson', 'read_ndjson_auto', 'read_ndjson_objects', 'read_text', 'read_blob',
  'glob', 'getenv', 'current_setting', 'which_secret', 'query', 'query_table',
  'st_read', 'st_read_meta', 'st_drivers', 'httpfs', 'http_get', 'http_post',
  'iceberg_scan', 'delta_scan', 'sqlite_scan', 'postgres_scan', 'mysql_scan',
];

// Scalar SQL built-ins (and keywords that may precede a parenthesis)
const ALLOWED_BUILTIN_FUNCTIONS = [
  'count', 'sum', 'avg', 'min', 'max',
  'upper', 'lower', 'trim', 'ltrim', 'rtrim',
  'cast', 'coalesce', 'nullif', 'ifnull',
  'abs', 'round', 'ceil', 'ceiling', 'floor', 'mod', 'power', 'sqrt',
  'length', 'char_length', 'substr', 'substring', 'replace', 'concat',
  'date_part', 'date_trunc', 'current_date', 'current_timestamp',
  // SQL keywords that can precede parentheses: IN (...), NOT (...), etc.
  'in', 'not', 'between', 'like', 'ilike', 'and', 'or', 'is', 'case', 'when', 'then', 'else', 'end',
];

// DuckDB spatial functions allowed in WHERE clauses
const ALLOWED_SPATIAL_FUNCTIONS = [
  'ST_Intersects', 'ST_Contains', 'ST_Within', 'ST_DWithin',
  'ST_Distance', 'ST_Area', 'ST_Length', 'ST_Buffer',
  'ST_Union', 'ST_Intersection', 'ST_Centroid', 'ST_Envelope',
  'ST_AsGeoJSON', 'ST_AsText', 'ST_AsWKB',
  'ST_GeomFromText', 'ST_GeomFromGeoJSON', 'ST_GeomFromWKB',
  'ST_Point', 'ST_MakeLine', 'ST_MakePolygon', 'ST_MakeEnvelope',
  'ST_X', 'ST_Y', 'ST_SRID', 'ST_Transform',
  'ST_Collect', 'ST_ConvexHull', 'ST_Simplify',
  'ST_IsEmpty', 'ST_IsValid', 'ST_Dimension', 'ST_GeometryType',
  'ST_NumGeometries', 'ST_NumPoints',
  'ST_Boundary', 'ST_Difference', 'ST_SymDifference',
];

const ALLOWED_FUNCTIONS = new Set([
  ...ALLOWED_SPATIAL_FUNCTIONS.map((f) => f.toLowerCase()),
  ...ALLOWED_BUILTIN_FUNCTIONS,
]);

const FORBIDDEN_KEYWORD_PATTERN = new RegExp(`\\b(${FORBIDDEN_KEYWORDS.join('|')})\\b`, 'i');

// Characters allowed outside string literals / quoted identifiers.
// Notably excludes ; \ $ ? : { } [ ] | & ` @ # ^ ~ and double quotes.
const ALLOWED_CHARS_OUTSIDE_LITERALS = /^[A-Za-z0-9_ \t\r\n.,()<>=!+\-*/%]*$/;

// Content allowed inside a double-quoted identifier
const QUOTED_IDENTIFIER_CONTENT = /^[A-Za-z0-9_ .]+$/;

const MAX_WHERE_LENGTH = 4000;

export interface WhereValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Split a SQL fragment into "code" (outside literals) with string literals
 * replaced by '' and double-quoted identifiers replaced by a placeholder.
 * Returns an error for unterminated literals or disallowed literal content.
 */
function stripLiterals(sql: string): { code: string; error?: string } {
  let code = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      // Single-quoted string literal; '' is an escaped quote.
      let j = i + 1;
      let content = '';
      let closed = false;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            content += "'";
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        content += sql[j];
        j++;
      }
      if (!closed) return { code, error: 'Unterminated string literal in WHERE clause.' };
      if (/[a-z][a-z0-9+.-]*:\/\//i.test(content)) {
        return { code, error: 'URLs are not allowed in WHERE clause string literals.' };
      }
      // A literal glued to a preceding identifier (E'..', X'..', U&'..') is an
      // alternate literal syntax; reject so our tokenizer can't be desynced.
      if (/[A-Za-z0-9_&]$/.test(code)) {
        return { code, error: 'Prefixed string literals are not allowed in WHERE clauses.' };
      }
      code += "''";
      i = j + 1;
    } else if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      if (end === -1) return { code, error: 'Unterminated quoted identifier in WHERE clause.' };
      const content = sql.slice(i + 1, end);
      if (!QUOTED_IDENTIFIER_CONTENT.test(content)) {
        return { code, error: 'Quoted identifiers may only contain letters, digits, spaces, underscores and dots.' };
      }
      code += '__quoted_ident__';
      i = end + 1;
    } else {
      code += ch;
      i++;
    }
  }
  return { code };
}

/**
 * Validate a WHERE clause for DuckDB queries and ArcGIS Feature Service
 * queries. Prevents SQL injection while allowing standard filter expressions
 * such as `population > 1000 AND state = 'OR'`.
 */
export function validateWhereClause(where: string): WhereValidationResult {
  if (typeof where !== 'string') return { valid: false, error: 'WHERE clause must be a string.' };
  const trimmed = where.trim();
  if (!trimmed || trimmed === '1=1') return { valid: true };

  if (trimmed.length > MAX_WHERE_LENGTH) {
    return { valid: false, error: `WHERE clause exceeds ${MAX_WHERE_LENGTH} characters.` };
  }

  // Backslashes enable escape-string syntax in some dialects; NUL and other
  // control characters have no business in a filter expression.
  if (/[\\\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) {
    return { valid: false, error: 'Backslashes and control characters are not allowed in WHERE clauses.' };
  }

  const { code, error } = stripLiterals(trimmed);
  if (error) return { valid: false, error };

  if (code.includes(';')) {
    return { valid: false, error: 'Semicolons not allowed in WHERE clause.' };
  }
  if (code.includes('--') || code.includes('/*') || code.includes('*/')) {
    return { valid: false, error: 'SQL comments are not allowed in WHERE clauses.' };
  }
  if (!ALLOWED_CHARS_OUTSIDE_LITERALS.test(code.replace(/''/g, ''))) {
    return { valid: false, error: 'WHERE clause contains disallowed characters.' };
  }

  // Parentheses must balance so the clause can't close the wrapping "( ... )".
  let depth = 0;
  for (const ch of code) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) break;
    }
  }
  if (depth !== 0) {
    return { valid: false, error: 'Unbalanced parentheses in WHERE clause.' };
  }

  const kw = code.match(FORBIDDEN_KEYWORD_PATTERN);
  if (kw) {
    const upper = kw[1].toUpperCase();
    if (upper === 'SELECT') {
      return { valid: false, error: 'Subqueries (SELECT) are not allowed in WHERE clauses.' };
    }
    return { valid: false, error: `Forbidden keyword "${upper}" in WHERE clause.` };
  }

  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\s*\\(`, 'i').test(code)) {
      return { valid: false, error: `Forbidden table function "${fn}" in WHERE clause.` };
    }
  }

  const functionCallPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = functionCallPattern.exec(code)) !== null) {
    if (!ALLOWED_FUNCTIONS.has(match[1].toLowerCase())) {
      return { valid: false, error: `Function "${match[1]}" is not allowed in WHERE clauses.` };
    }
  }

  return { valid: true };
}

// Field/column identifier: letters, digits, underscores, with dotted struct
// access (e.g. categories.primary). No quoting, whitespace or punctuation.
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const MAX_IDENTIFIER_LENGTH = 128;

/** True if `name` is a safe, unquoted SQL/ArcGIS field identifier. */
export function isValidIdentifier(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length <= MAX_IDENTIFIER_LENGTH &&
    IDENTIFIER_PATTERN.test(name) &&
    !name.includes('..') &&
    !name.endsWith('.')
  );
}

/** Throw if `name` is not a safe identifier. Returns the name for chaining. */
export function assertValidIdentifier(name: unknown, label = 'field'): string {
  if (!isValidIdentifier(name)) {
    throw new Error(`Invalid ${label} name: must match ^[A-Za-z_][A-Za-z0-9_.]*$`);
  }
  return name;
}

/** Normalize a sort direction; anything other than asc/desc is rejected. */
export function normalizeSortDirection(dir: unknown, fallback: 'ASC' | 'DESC' = 'DESC'): 'ASC' | 'DESC' {
  if (dir === undefined || dir === null || dir === '') return fallback;
  if (typeof dir === 'string') {
    const upper = dir.trim().toUpperCase();
    if (upper === 'ASC' || upper === 'DESC') return upper;
  }
  throw new Error('Invalid sort direction: must be ASC or DESC');
}

export const STATISTIC_TYPES = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type AllowedStatisticType = (typeof STATISTIC_TYPES)[number];

/** Throw unless `type` is one of count/sum/avg/min/max. */
export function assertStatisticType(type: unknown): AllowedStatisticType {
  if (typeof type === 'string' && (STATISTIC_TYPES as readonly string[]).includes(type.toLowerCase())) {
    return type.toLowerCase() as AllowedStatisticType;
  }
  throw new Error(`Invalid statisticType: must be one of ${STATISTIC_TYPES.join(', ')}`);
}

/** Coerce to a finite number or throw (for values interpolated into SQL). */
export function toFiniteNumber(value: unknown, label = 'value'): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid ${label}: must be a finite number`);
  }
  return n;
}

/** Coerce a limit to a positive integer within [1, max]; falls back on bad input. */
export function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) return Math.min(fallback, max);
  return Math.min(Math.floor(n), max);
}

export { ALLOWED_SPATIAL_FUNCTIONS };
