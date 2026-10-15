/**
 * SQL-safety tests for GeoParquetService. DuckDB is mocked; we inspect the SQL
 * text and bound parameters that would be sent to it.
 */

const mockAll = jest.fn();
const mockExec = jest.fn();

jest.mock('duckdb-async', () => ({
  Database: {
    create: jest.fn(async () => ({ all: mockAll, exec: mockExec })),
  },
}));

import { GeoParquetService } from '@/services/geoparquet.service';

const BBOX: [number, number, number, number] = [-122.7, 45.5, -122.6, 45.6];

function lastCall(): { sql: string; params: unknown[] } {
  const call = mockAll.mock.calls[mockAll.mock.calls.length - 1];
  return { sql: call[0] as string, params: call.slice(1) };
}

describe('GeoParquetService SQL safety', () => {
  let service: GeoParquetService;

  beforeEach(() => {
    mockAll.mockReset();
    mockExec.mockReset();
    mockAll.mockResolvedValue([]);
    mockExec.mockResolvedValue(undefined);
    service = new GeoParquetService();
  });

  describe('getDb initialization', () => {
    it('locks down DuckDB after extensions and secrets are configured', async () => {
      await service.queryPlaces(BBOX, {});
      const execSql = mockExec.mock.calls.map((c) => c[0] as string).join('\n');
      const loadIdx = execSql.indexOf('LOAD azure');
      const secretIdx = execSql.indexOf('CREATE SECRET');
      const disableIdx = execSql.indexOf("SET disabled_filesystems = 'LocalFileSystem'");
      const lockIdx = execSql.indexOf('SET lock_configuration = true');
      expect(loadIdx).toBeGreaterThanOrEqual(0);
      expect(disableIdx).toBeGreaterThan(secretIdx);
      expect(disableIdx).toBeGreaterThan(loadIdx);
      expect(lockIdx).toBeGreaterThan(disableIdx);
    });

    it('initializes only once under concurrent use', async () => {
      await Promise.all([
        service.queryPlaces(BBOX, {}),
        service.queryBuildings(BBOX, {}),
        service.getCountForBbox('overture-buildings', BBOX),
      ]);
      const lockCalls = mockExec.mock.calls.filter((c) => String(c[0]).includes('lock_configuration'));
      expect(lockCalls).toHaveLength(1);
    });
  });

  describe('queryPlaces category / nameContains', () => {
    const malicious = "x%' UNION SELECT content, content, content, content FROM read_text('/etc/passwd') --";

    it('never interpolates a malicious category into the SQL text', async () => {
      await service.queryPlaces(BBOX, { category: malicious });
      const { sql, params } = lastCall();
      expect(sql).not.toContain('UNION');
      expect(sql).not.toContain('read_text');
      expect(sql).not.toContain('/etc/passwd');
      expect(sql).not.toContain("x%'");
      // Value is passed as bound parameters (lower-cased), once per placeholder
      expect(params).toEqual([malicious.toLowerCase(), malicious.toLowerCase()]);
      expect((sql.match(/\?/g) || []).length).toBe(2);
    });

    it('binds nameContains as a parameter as well', async () => {
      await service.queryPlaces(BBOX, { category: 'hospital', nameContains: "O'Brien'); DROP TABLE x; --" });
      const { sql, params } = lastCall();
      expect(sql).not.toContain('DROP');
      expect(sql).not.toContain("O'Brien");
      expect(params).toEqual(['hospital', 'hospital', "o'brien'); drop table x; --"]);
    });

    it('binds nameContains for buildings', async () => {
      await service.queryBuildings(BBOX, { nameContains: "a' OR 1=1 --" });
      const { sql, params } = lastCall();
      expect(sql).not.toContain('OR 1=1');
      expect(params).toEqual(["a' or 1=1 --"]);
    });

    it('coerces limit to a bounded integer', async () => {
      await service.queryPlaces(BBOX, { limit: NaN });
      expect(lastCall().sql).toMatch(/LIMIT 100\s*$/);
      await service.queryPlaces(BBOX, { limit: 10_000_000 });
      expect(lastCall().sql).toMatch(/LIMIT 5000\s*$/);
    });
  });

  describe('numeric inputs', () => {
    it('rejects a bbox containing non-numeric values', async () => {
      const evilBbox = ['0) OR (1=1', 0, 1, 1] as unknown as [number, number, number, number];
      await expect(service.queryPlaces(evilBbox, {})).rejects.toThrow(/Invalid bbox/);
      await expect(service.queryFeatures('overture-buildings', evilBbox)).rejects.toThrow(/Invalid bbox/);
      await expect(service.getCountForBbox('overture-buildings', evilBbox)).rejects.toThrow(/Invalid bbox/);
      expect(mockAll).not.toHaveBeenCalled();
    });

    it('rejects non-finite spatial join distance', async () => {
      await expect(
        service.querySpatialJoin({
          sourceId: 'overture-places',
          sourceBbox: BBOX,
          targetId: 'overture-buildings',
          spatialRelation: 'within_distance',
          distance: '1); DROP TABLE x; --' as unknown as number,
        })
      ).rejects.toThrow(/Invalid distance/);
    });
  });

  describe('queryStatistics identifiers', () => {
    it('accepts mapped and raw identifier fields', async () => {
      await service.queryStatistics('overture-places', BBOX, {
        groupByField: 'category',
        statisticType: 'count',
        orderBy: 'asc',
      });
      const { sql } = lastCall();
      expect(sql).toContain('categories.primary as group_value');
      expect(sql).toContain('ORDER BY stat_value ASC');
    });

    it('rejects an injected groupByField', async () => {
      await expect(
        service.queryStatistics('overture-places', BBOX, {
          groupByField: "names.primary, (SELECT content FROM read_text('/etc/passwd'))",
          statisticType: 'count',
        })
      ).rejects.toThrow(/Invalid field name/);
      expect(mockAll).not.toHaveBeenCalled();
    });

    it('rejects an injected statisticField', async () => {
      await expect(
        service.queryStatistics('overture-places', BBOX, {
          groupByField: 'category',
          statisticType: 'sum',
          statisticField: 'x) FROM y --',
        })
      ).rejects.toThrow(/Invalid field name/);
    });

    it('rejects an invalid sort direction and statistic type', async () => {
      await expect(
        service.queryStatistics('overture-places', BBOX, {
          groupByField: 'category',
          statisticType: 'count',
          orderBy: 'desc; DROP TABLE x' as unknown as 'desc',
        })
      ).rejects.toThrow(/sort direction/);
      await expect(
        service.queryStatistics('overture-places', BBOX, {
          groupByField: 'category',
          statisticType: 'getenv' as unknown as 'count',
        })
      ).rejects.toThrow(/statisticType/);
    });
  });

  describe('WHERE fragments', () => {
    it('queryFeaturesWithGeometry rejects a malicious where clause', async () => {
      await expect(
        service.queryFeaturesWithGeometry('overture-places', {
          bbox: BBOX,
          where: "1=1) UNION SELECT * FROM read_text('/etc/passwd') --",
        })
      ).rejects.toThrow(/Invalid WHERE clause/);
      expect(mockAll).not.toHaveBeenCalled();
    });

    it('queryFeaturesWithGeometry wraps a valid where clause in parentheses', async () => {
      await service.queryFeaturesWithGeometry('overture-places', {
        bbox: BBOX,
        where: "categories.primary = 'hospital' OR categories.primary = 'clinic'",
      });
      expect(lastCall().sql).toContain("(categories.primary = 'hospital' OR categories.primary = 'clinic')");
    });

    it('querySpatialJoin rejects malicious source/target where and field names', async () => {
      const base = {
        sourceId: 'overture-places',
        sourceBbox: BBOX,
        targetId: 'overture-buildings',
        spatialRelation: 'intersects',
      };
      await expect(
        service.querySpatialJoin({ ...base, sourceWhere: "x = 1; COPY (SELECT 1) TO '/tmp/x'" })
      ).rejects.toThrow(/Invalid sourceWhere/);
      await expect(
        service.querySpatialJoin({ ...base, targetWhere: "getenv('HOME') = 'x'" })
      ).rejects.toThrow(/Invalid targetWhere/);
      await expect(
        service.querySpatialJoin({ ...base, mode: 'statistics', groupByField: 'name) --' })
      ).rejects.toThrow(/Invalid field name/);
      await expect(
        service.querySpatialJoin({
          ...base,
          mode: 'statistics',
          groupByField: 'name',
          statisticType: 'sum',
          statisticField: 'height) FROM x --',
        })
      ).rejects.toThrow(/Invalid field name/);
      expect(mockAll).not.toHaveBeenCalled();
    });
  });
});
