import {
  validateWhereClause,
  isValidIdentifier,
  assertValidIdentifier,
  normalizeSortDirection,
  assertStatisticType,
  toFiniteNumber,
  clampLimit,
} from '@/lib/sql-guard';

const valid = (w: string) => validateWhereClause(w).valid;

describe('validateWhereClause', () => {
  describe('accepts normal filter expressions', () => {
    it.each([
      "population > 1000 AND state = 'OR'",
      '1=1',
      '',
      "NAME = 'Portland'",
      "NAME LIKE '%Park%'",
      "STATE IN ('OR', 'WA', 'CA')",
      'POP2020 BETWEEN 1000 AND 50000',
      'FIELD IS NOT NULL',
      "UPPER(NAME) LIKE '%PORTLAND%'",
      "name = 'O''Brien'",
      // Keywords inside string literals are data, not SQL
      "name = 'Union Station'",
      "name = 'Select Comfort -- outlet; drop in'",
      "class = 'motorway' OR class = 'trunk'",
      'height > 10 * 3 + 2',
      '"Field Name" = 5',
      "ST_Intersects(geometry, ST_GeomFromText('POINT(1 2)'))",
      "date_field > DATE '2020-01-01'",
    ])('%s', (w) => {
      expect(validateWhereClause(w)).toEqual({ valid: true });
    });
  });

  describe('rejects quote-escaping / break-out tricks', () => {
    it.each([
      // close the literal and inject
      "name = 'x' UNION SELECT * FROM read_text('/etc/passwd') --'",
      // unterminated literal
      "name = 'x",
      // backslash escape attempts (E-strings)
      "name = E'\\' OR 1=1 OR '\\''",
      "name = 'a\\' OR 1=1",
      // prefixed literal forms
      "name = X'41'",
      "name = U&'\\0041'",
      // dollar quoting
      'name = $$x$$',
      // breaking out of the wrapping parentheses
      '1=1) OR (1=1',
      'x = 1) LIMIT 1 --',
      '(x = 1',
      // double-quoted identifier used to smuggle a function call or content
      '"read_parquet"(\'x\') IS NOT NULL',
      '"a\'; DROP TABLE x; --" = 1',
    ])('%s', (w) => {
      expect(valid(w)).toBe(false);
    });
  });

  describe('rejects statement separators and comments', () => {
    it.each([
      'x = 1; DROP TABLE datasets',
      'x = 1 -- comment',
      'x = 1 /* c */',
      'x = 1 */',
    ])('%s', (w) => expect(valid(w)).toBe(false));
  });

  describe('rejects UNION / subqueries / set operations', () => {
    it.each([
      'x = 1 UNION ALL x = 2',
      'x IN (SELECT id FROM t)',
      "x IN (FROM 'data.csv')",
      'x IN (TABLE secrets)',
      'x IN (VALUES (1))',
      'EXISTS (SELECT 1)',
      'x = 1 INTERSECT x = 2',
      'x = 1 EXCEPT x = 2',
      'WITH a AS (1) x = 1',
      'select_count > 1 AND x IN (select 1)',
    ])('%s', (w) => expect(valid(w)).toBe(false));
  });

  describe('rejects DDL/DML/side-effect keywords', () => {
    it.each([
      'DROP TABLE x',
      'x = 1 OR DELETE',
      'INSERT x',
      'UPDATE x',
      "ATTACH 'evil.db'",
      "COPY x TO '/tmp/x'",
      'INSTALL httpfs',
      'LOAD httpfs',
      "SET enable_external_access = true",
      'PRAGMA version',
      'CALL x',
    ])('%s', (w) => expect(valid(w)).toBe(false));
  });

  describe('rejects DuckDB table/reader/system functions', () => {
    it.each([
      "read_parquet('s3://bucket/x.parquet') IS NOT NULL",
      "length(read_text('/etc/passwd')) > 0",
      "read_csv('/etc/passwd') IS NULL",
      "read_csv_auto('/etc/passwd') IS NULL",
      "read_json('x.json') IS NULL",
      "read_blob('/etc/passwd') IS NULL",
      "glob('/*') IS NULL",
      "getenv('ANTHROPIC_API_KEY') = 'x'",
      "current_setting('s3_secret_access_key') = 'x'",
      "st_read('/etc/passwd') IS NULL",
      "READ_PARQUET ('x') IS NULL",
      "main.read_parquet('x') IS NULL",
      "system('cmd') = 1",
      "query('select 1') IS NULL",
    ])('%s', (w) => expect(valid(w)).toBe(false));
  });

  describe('rejects URLs and odd characters', () => {
    it.each([
      "name = 'https://evil.example.com/x.parquet'",
      "name = 's3://bucket/key'",
      "name = 'az://release/x'",
      'name = $variable',
      'name = @param',
      'name::VARCHAR = 1',
      'x = 1 \u0000',
      'x = 1',
    ])('%s', (w) => expect(valid(w)).toBe(false));
  });

  it('rejects overly long clauses', () => {
    expect(valid('x = 1 AND '.repeat(500) + 'x = 1')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(validateWhereClause(42 as unknown as string).valid).toBe(false);
  });
});

describe('identifier validation', () => {
  it.each(['NAME', 'POP2020', '_x', 'categories.primary', 'names.primary', 'a_b.c_d'])(
    'accepts %s',
    (id) => {
      expect(isValidIdentifier(id)).toBe(true);
      expect(assertValidIdentifier(id)).toBe(id);
    }
  );

  it.each([
    '',
    '1abc',
    'name; DROP TABLE x',
    'name)',
    "name'",
    'name"',
    'a b',
    'a..b',
    'a.',
    'COUNT(*)',
    'x--',
    'a'.repeat(200),
    null,
    undefined,
    42,
  ])('rejects %p', (id) => {
    expect(isValidIdentifier(id)).toBe(false);
    expect(() => assertValidIdentifier(id, 'groupByField')).toThrow(/Invalid groupByField/);
  });
});

describe('normalizeSortDirection', () => {
  it('accepts asc/desc in any case', () => {
    expect(normalizeSortDirection('asc')).toBe('ASC');
    expect(normalizeSortDirection('DESC')).toBe('DESC');
    expect(normalizeSortDirection(' Desc ')).toBe('DESC');
  });
  it('falls back when omitted', () => {
    expect(normalizeSortDirection(undefined)).toBe('DESC');
    expect(normalizeSortDirection(undefined, 'ASC')).toBe('ASC');
  });
  it('rejects anything else', () => {
    expect(() => normalizeSortDirection('desc; DROP TABLE x')).toThrow();
    expect(() => normalizeSortDirection('random()')).toThrow();
    expect(() => normalizeSortDirection(1)).toThrow();
  });
});

describe('assertStatisticType', () => {
  it('accepts allowed types', () => {
    for (const t of ['count', 'sum', 'avg', 'min', 'max']) {
      expect(assertStatisticType(t)).toBe(t);
    }
  });
  it('rejects others', () => {
    expect(() => assertStatisticType('read_text')).toThrow();
    expect(() => assertStatisticType('sum(x)) FROM y --')).toThrow();
  });
});

describe('numeric coercion', () => {
  it('toFiniteNumber accepts numbers and numeric strings', () => {
    expect(toFiniteNumber(1.5)).toBe(1.5);
    expect(toFiniteNumber('-122.5')).toBe(-122.5);
  });
  it('toFiniteNumber rejects non-finite and injection strings', () => {
    expect(() => toFiniteNumber(NaN)).toThrow();
    expect(() => toFiniteNumber(Infinity)).toThrow();
    expect(() => toFiniteNumber('1) OR (1=1')).toThrow();
  });
  it('clampLimit coerces to a bounded positive integer', () => {
    expect(clampLimit(50, 100, 200)).toBe(50);
    expect(clampLimit(5000, 100, 200)).toBe(200);
    expect(clampLimit(NaN, 100, 200)).toBe(100);
    expect(clampLimit('10; DROP', 100, 200)).toBe(100);
    expect(clampLimit(-5, 100, 200)).toBe(100);
    expect(clampLimit(7.9, 100, 200)).toBe(7);
  });
});
