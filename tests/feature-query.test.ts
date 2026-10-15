/**
 * Tests for feature-query.service.ts
 * Covers: WHERE clause validation, Esri-to-GeoJSON conversion, layer URL resolution,
 * polygon filter queries, query support checks, and statistics queries.
 */

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { FeatureQueryService } from '@/services/feature-query.service';
import { validateWhereClause } from '@/lib/sql-guard';

describe('FeatureQueryService', () => {
  let service: FeatureQueryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FeatureQueryService();
  });

  // --- WHERE Clause Validation ---

  describe('WHERE clause validation (validateWhereClause)', () => {
    // Use the shared validateWhereClause from lib/sql-guard
    const testValidation = (where: string | null | undefined) => {
      if (where === null || where === undefined) return true;
      return validateWhereClause(where).valid;
    };

    it('should accept empty string', () => {
      expect(testValidation('')).toBe(true);
    });

    it('should accept null/undefined', () => {
      expect(testValidation(null as unknown as string)).toBe(true);
      expect(testValidation(undefined as unknown as string)).toBe(true);
    });

    it('should accept simple equality', () => {
      expect(testValidation("STATE = 'Oregon'")).toBe(true);
    });

    it('should accept comparison operators', () => {
      expect(testValidation('POPULATION > 10000')).toBe(true);
      expect(testValidation('AREA <= 500.5')).toBe(true);
      expect(testValidation("STATUS <> 'CLOSED'")).toBe(true);
    });

    it('should accept LIKE operator', () => {
      expect(testValidation("NAME LIKE '%Park%'")).toBe(true);
    });

    it('should accept IN operator', () => {
      expect(testValidation("TYPE IN ('School', 'Hospital')")).toBe(true);
    });

    it('should accept IS NULL / IS NOT NULL', () => {
      expect(testValidation('NAME IS NOT NULL')).toBe(true);
      expect(testValidation('DESCRIPTION IS NULL')).toBe(true);
    });

    it('should accept AND/OR combinations', () => {
      expect(testValidation("STATE = 'OR' AND TYPE = 'Park'")).toBe(true);
      expect(testValidation("TYPE = 'School' OR TYPE = 'Hospital'")).toBe(true);
    });

    it('should accept BETWEEN', () => {
      expect(testValidation('YEAR BETWEEN 2000 AND 2024')).toBe(true);
    });

    it('should reject semicolons (SQL injection)', () => {
      expect(testValidation("NAME = 'test'; DROP TABLE datasets")).toBe(false);
    });

    it('should reject SQL comments', () => {
      expect(testValidation("NAME = 'test' -- comment")).toBe(false);
      expect(testValidation("NAME = 'test' /* comment */")).toBe(false);
    });

    it('should reject DROP statements', () => {
      expect(testValidation('DROP TABLE datasets')).toBe(false);
    });

    it('should reject DELETE statements', () => {
      expect(testValidation("DELETE FROM datasets WHERE 1=1")).toBe(false);
    });

    it('should reject UPDATE statements', () => {
      expect(testValidation("UPDATE datasets SET name = 'hacked'")).toBe(false);
    });

    it('should reject INSERT statements', () => {
      expect(testValidation("INSERT INTO datasets VALUES ('x')")).toBe(false);
    });

    it('should reject EXEC/EXECUTE', () => {
      expect(testValidation('EXEC xp_cmdshell')).toBe(false);
      expect(testValidation("EXECUTE sp_configure 'show'")).toBe(false);
    });

    it('should reject TRUNCATE', () => {
      expect(testValidation('TRUNCATE TABLE datasets')).toBe(false);
    });

    it('should reject ALTER', () => {
      expect(testValidation('ALTER TABLE datasets ADD COLUMN x INT')).toBe(false);
    });

    it('should reject special characters outside allowed set', () => {
      expect(testValidation('NAME = $variable')).toBe(false);
      expect(testValidation('NAME = @param')).toBe(false);
    });

    it('should reject dangerous function calls', () => {
      expect(testValidation("system('cmd')")).toBe(false);
      expect(testValidation("read_parquet('evil.parquet')")).toBe(false);
    });
  });

  // --- Esri to GeoJSON Conversion ---

  describe('Esri to GeoJSON conversion (esriToGeoJSON)', () => {
    const convert = (features: any[]) => {
      return (service as any).esriToGeoJSON(features);
    };

    it('should convert point geometry', () => {
      const result = convert([{
        attributes: { OBJECTID: 1, NAME: 'Test' },
        geometry: { x: -122.6, y: 45.5 },
      }]);

      expect(result).toHaveLength(1);
      expect(result[0].geometry).toEqual({
        type: 'Point',
        coordinates: [-122.6, 45.5],
      });
      expect(result[0].properties).toEqual({ OBJECTID: 1, NAME: 'Test' });
    });

    it('should convert multipoint geometry', () => {
      const result = convert([{
        attributes: { OBJECTID: 1 },
        geometry: { points: [[-122.6, 45.5], [-122.7, 45.6]] },
      }]);

      expect(result[0].geometry).toEqual({
        type: 'MultiPoint',
        coordinates: [[-122.6, 45.5], [-122.7, 45.6]],
      });
    });

    it('should convert single-path linestring', () => {
      const result = convert([{
        attributes: { OBJECTID: 1 },
        geometry: { paths: [[[-122.6, 45.5], [-122.7, 45.6]]] },
      }]);

      expect(result[0].geometry).toEqual({
        type: 'LineString',
        coordinates: [[-122.6, 45.5], [-122.7, 45.6]],
      });
    });

    it('should convert multi-path to MultiLineString', () => {
      const result = convert([{
        attributes: { OBJECTID: 1 },
        geometry: {
          paths: [
            [[-122.6, 45.5], [-122.7, 45.6]],
            [[-122.8, 45.7], [-122.9, 45.8]],
          ],
        },
      }]);

      expect(result[0].geometry.type).toBe('MultiLineString');
      expect(result[0].geometry.coordinates).toHaveLength(2);
    });

    it('should convert single-ring polygon', () => {
      const ring = [[-122.7, 45.4], [-122.5, 45.4], [-122.5, 45.6], [-122.7, 45.6], [-122.7, 45.4]];
      const result = convert([{
        attributes: { OBJECTID: 1 },
        geometry: { rings: [ring] },
      }]);

      expect(result[0].geometry.type).toBe('Polygon');
      expect(result[0].geometry.coordinates).toEqual([ring]);
    });

    it('should convert multi-ring to MultiPolygon', () => {
      const ring1 = [[-122.7, 45.4], [-122.5, 45.4], [-122.5, 45.6], [-122.7, 45.6], [-122.7, 45.4]];
      const ring2 = [[-122.3, 45.2], [-122.1, 45.2], [-122.1, 45.4], [-122.3, 45.4], [-122.3, 45.2]];
      const result = convert([{
        attributes: { OBJECTID: 1 },
        geometry: { rings: [ring1, ring2] },
      }]);

      expect(result[0].geometry.type).toBe('MultiPolygon');
    });

    it('should handle missing geometry', () => {
      const result = convert([{
        attributes: { OBJECTID: 1 },
      }]);

      expect(result[0].geometry).toEqual({
        type: 'Point',
        coordinates: [0, 0],
      });
    });

    it('should handle empty geometry object', () => {
      const result = convert([{
        attributes: { OBJECTID: 1 },
        geometry: {},
      }]);

      expect(result[0].geometry).toEqual({
        type: 'Point',
        coordinates: [0, 0],
      });
    });

    it('should handle missing attributes', () => {
      const result = convert([{
        geometry: { x: -122.6, y: 45.5 },
      }]);

      expect(result[0].properties).toEqual({});
    });

    it('should handle multiple features', () => {
      const result = convert([
        { attributes: { ID: 1 }, geometry: { x: -122.6, y: 45.5 } },
        { attributes: { ID: 2 }, geometry: { x: -122.7, y: 45.6 } },
        { attributes: { ID: 3 }, geometry: { x: -122.8, y: 45.7 } },
      ]);

      expect(result).toHaveLength(3);
      expect(result.every((f: any) => f.type === 'Feature')).toBe(true);
    });
  });

  // --- Layer URL Resolution ---

  describe('resolveLayerUrl', () => {
    const resolve = (url: string) => {
      return (service as any).resolveLayerUrl(url);
    };

    it('should keep URL with existing layer index', async () => {
      const result = await resolve('https://services.arcgis.com/test/FeatureServer/3');
      expect(result).toBe('https://services.arcgis.com/test/FeatureServer/3');
    });

    it('should append /0 to FeatureServer without layer index', async () => {
      const result = await resolve('https://services.arcgis.com/test/FeatureServer');
      expect(result).toBe('https://services.arcgis.com/test/FeatureServer/0');
    });

    it('should find first non-group layer for MapServer', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          layers: [
            { id: 0, type: 'Group Layer', subLayerIds: [1, 2] },
            { id: 1, type: 'Feature Layer', subLayerIds: null },
            { id: 2, type: 'Feature Layer', subLayerIds: null },
          ],
        }),
      });

      const result = await resolve('https://services.arcgis.com/test/MapServer');
      expect(result).toBe('https://services.arcgis.com/test/MapServer/1');
    });

    it('should fall back to /0 when MapServer fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await resolve('https://services.arcgis.com/test/MapServer');
      expect(result).toBe('https://services.arcgis.com/test/MapServer/0');
    });

    it('should fall back to /0 when MapServer returns no layers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ layers: [] }),
      });

      const result = await resolve('https://services.arcgis.com/test/MapServer');
      expect(result).toBe('https://services.arcgis.com/test/MapServer/0');
    });

    it('should handle trailing slash', async () => {
      const result = await resolve('https://services.arcgis.com/test/FeatureServer/');
      // The regex replaces trailing /? with /0, so trailing slash becomes clean /0
      expect(result).toBe('https://services.arcgis.com/test/FeatureServer/0');
    });
  });

  // --- Query Support Check ---

  describe('checkQuerySupport', () => {
    const check = (url: string) => {
      return (service as any).checkQuerySupport(url);
    };

    it('should detect tiles-only layers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          capabilities: 'Map,TilesOnly',
        }),
      });

      const result = await check('https://services.arcgis.com/test/MapServer/0');
      expect(result.supported).toBe(false);
      expect(result.reason).toContain('does not support feature queries');
    });

    it('should detect queryable layers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          capabilities: 'Query,Data',
          supportedQueryFormats: 'JSON, geoJSON',
        }),
      });

      const result = await check('https://services.arcgis.com/test/FeatureServer/0');
      expect(result.supported).toBe(true);
      expect(result.supportsGeoJson).toBe(true);
    });

    it('should detect when GeoJSON is not supported', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          capabilities: 'Query,Data',
          supportedQueryFormats: 'JSON',
        }),
      });

      const result = await check('https://services.arcgis.com/test/FeatureServer/0');
      expect(result.supported).toBe(true);
      expect(result.supportsGeoJson).toBe(false);
    });

    it('should assume supported when check fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await check('https://services.arcgis.com/test/FeatureServer/0');
      expect(result.supported).toBe(true);
    });

    it('should assume supported for non-standard URL formats', async () => {
      const result = await check('https://example.com/custom-api/data');
      expect(result.supported).toBe(true);
    });

    it('should fall back to service-level check when layer check fails', async () => {
      // Layer check fails
      mockFetch.mockResolvedValueOnce({ ok: false });
      // Service check returns tilesonly
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          capabilities: 'Map,TilesOnly',
        }),
      });

      const result = await check('https://services.arcgis.com/test/MapServer/0');
      expect(result.supported).toBe(false);
    });
  });

  // --- queryFeaturesWithPolygonFilter ---

  describe('queryFeaturesWithPolygonFilter', () => {
    it('should convert GeoJSON polygon to Esri rings format', async () => {
      // Mock checkQuerySupport
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            capabilities: 'Query',
            supportedQueryFormats: 'JSON, geoJSON',
          }),
        })
        // Features query (count query is now deferred - only made when truncated)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [-122.6, 45.5] },
              properties: { NAME: 'Test' },
            }],
          }),
        });

      const polygon: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [[[-122.7, 45.4], [-122.5, 45.4], [-122.5, 45.6], [-122.7, 45.6], [-122.7, 45.4]]],
      };

      await service.queryFeaturesWithPolygonFilter({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        polygon,
        spatialRel: 'esriSpatialRelIntersects',
      });

      // Features query is 2nd call (no upfront count query) — uses POST
      const featuresCall = mockFetch.mock.calls[1];
      const url = featuresCall[0] as string;
      const opts = featuresCall[1] as { method: string; body: string };
      expect(url).toContain('/query');
      expect(opts.method).toBe('POST');
      expect(opts.body).toContain('esriGeometryPolygon');
      expect(opts.body).toContain('esriSpatialRelIntersects');
    });

    it('should handle count-only mode', async () => {
      // Mock checkQuerySupport
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: 'Query' }),
        })
        // Count query
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ count: 42 }),
        });

      const polygon: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [[[-122.7, 45.4], [-122.5, 45.4], [-122.5, 45.6], [-122.7, 45.6], [-122.7, 45.4]]],
      };

      const result = await service.queryFeaturesWithPolygonFilter({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        polygon,
        spatialRel: 'esriSpatialRelIntersects',
        returnCountOnly: true,
      });

      expect(result.count).toBe(42);
      expect(result.features).toHaveLength(0);
    });

    it('should convert MultiPolygon coordinates to flat rings', async () => {
      // Mock checkQuerySupport
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: 'Query' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ count: 0 }),
        });

      const multiPolygon: GeoJSON.MultiPolygon = {
        type: 'MultiPolygon',
        coordinates: [
          [[[-122.7, 45.4], [-122.5, 45.4], [-122.5, 45.6], [-122.7, 45.6], [-122.7, 45.4]]],
          [[[-122.3, 45.2], [-122.1, 45.2], [-122.1, 45.4], [-122.3, 45.4], [-122.3, 45.2]]],
        ],
      };

      await service.queryFeaturesWithPolygonFilter({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        polygon: multiPolygon,
        spatialRel: 'esriSpatialRelIntersects',
        returnCountOnly: true,
      });

      // The geometry should have flattened rings — now sent via POST body
      const countCall = mockFetch.mock.calls[1];
      const opts = countCall[1] as { method: string; body: string };
      expect(opts.method).toBe('POST');
      const bodyParams = new URLSearchParams(opts.body);
      const geometryParam = bodyParams.get('geometry');
      expect(geometryParam).toBeTruthy();
      const parsed = JSON.parse(geometryParam!);
      expect(parsed.rings).toHaveLength(2); // Two rings from the flattened MultiPolygon
    });

    it('should reject invalid WHERE clause in polygon filter', async () => {
      // Mock checkQuerySupport
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ capabilities: 'Query' }),
      });

      const polygon: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [[[-122.7, 45.4], [-122.5, 45.4], [-122.5, 45.6], [-122.7, 45.6], [-122.7, 45.4]]],
      };

      await expect(service.queryFeaturesWithPolygonFilter({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        polygon,
        spatialRel: 'esriSpatialRelIntersects',
        where: "NAME = 'test'; DROP TABLE datasets",
      })).rejects.toThrow('Invalid WHERE clause');
    });
  });

  // --- queryFeatures ---

  describe('queryFeatures', () => {
    it('should enforce chat query limit', async () => {
      // Mock checkQuerySupport
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            capabilities: 'Query',
            supportedQueryFormats: 'JSON, geoJSON',
          }),
        })
        // Features query
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            type: 'FeatureCollection',
            features: [],
          }),
        })
        // Count query (checkQuerySupport again)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: 'Query' }),
        })
        // Count
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ count: 100 }),
        });

      const result = await service.queryFeatures({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        limit: 50, // Exceeds CHAT_QUERY_LIMIT of 10
      });

      // Check that resultRecordCount was limited to 10
      const featuresCall = mockFetch.mock.calls[1];
      const url = featuresCall[0] as string;
      expect(url).toContain('resultRecordCount=10');

      expect(result.totalCount).toBe(100);
      expect(result.truncated).toBe(true);
    });

    it('should reject invalid WHERE clause', async () => {
      // Mock checkQuerySupport
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ capabilities: 'Query' }),
      });

      await expect(service.queryFeatures({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        where: "1=1; DELETE FROM users",
      })).rejects.toThrow('Invalid WHERE clause');
    });

    it('should handle ArcGIS error responses', async () => {
      // Mock checkQuerySupport
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: 'Query' }),
        })
        // Features query returns error
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            error: {
              code: 400,
              message: 'Invalid field name',
              details: ['Field INVALID does not exist'],
            },
          }),
        });

      await expect(service.queryFeatures({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        where: "INVALID = 'test'",
      })).rejects.toThrow('Feature service error');
    });

    it('should fall back to Esri JSON conversion when GeoJSON not supported', async () => {
      // Mock checkQuerySupport — no GeoJSON support
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            capabilities: 'Query',
            supportedQueryFormats: 'JSON',
          }),
        })
        // Features query (Esri JSON format)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            features: [{
              attributes: { OBJECTID: 1, NAME: 'Park' },
              geometry: { x: -122.6, y: 45.5 },
            }],
          }),
        })
        // Count query checkQuerySupport
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: 'Query' }),
        })
        // Count
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ count: 1 }),
        });

      const result = await service.queryFeatures({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
      });

      expect(result.features).toHaveLength(1);
      expect(result.features[0].geometry).toEqual({
        type: 'Point',
        coordinates: [-122.6, 45.5],
      });
    });
  });

  // --- queryStatistics ---

  describe('queryStatistics', () => {
    it('should require statisticField for non-count aggregations', async () => {
      await expect(service.queryStatistics({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        groupByField: 'TYPE',
        statisticType: 'sum',
        // Missing statisticField
      })).rejects.toThrow('statisticField is required for sum aggregation');
    });

    it('should build correct outStatistics for count', async () => {
      // Mock checkQuerySupport
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: 'Query' }),
        })
        // Stats query
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            features: [
              { attributes: { TYPE: 'Park', count: 15 } },
              { attributes: { TYPE: 'School', count: 10 } },
            ],
          }),
        });

      const result = await service.queryStatistics({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        groupByField: 'TYPE',
        statisticType: 'count',
      });

      expect(result.rows).toHaveLength(2);
      expect(result.groupByField).toBe('TYPE');
      expect(result.statisticType).toBe('count');
    });

    it('should enforce max limit of 20', async () => {
      // Mock checkQuerySupport
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: 'Query' }),
        })
        // Stats query returns 25 results
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            features: Array.from({ length: 25 }, (_, i) => ({
              attributes: { TYPE: `Type${i}`, count: 25 - i },
            })),
          }),
        });

      const result = await service.queryStatistics({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        groupByField: 'TYPE',
        statisticType: 'count',
        limit: 100, // Exceeds MAX_LIMIT
      });

      expect(result.rows).toHaveLength(20);
      expect(result.totalGroups).toBe(25);
      expect(result.truncated).toBe(true);
    });

    it('should handle statistics not supported error', async () => {
      // Mock checkQuerySupport
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: 'Query' }),
        })
        // Stats query returns error
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            error: {
              code: 400,
              message: 'outStatistics parameter is not supported',
            },
          }),
        });

      await expect(service.queryStatistics({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        groupByField: 'TYPE',
        statisticType: 'count',
      })).rejects.toThrow('does not support statistics queries');
    });
  });

  // --- getLayerFields ---

  describe('getLayerFields', () => {
    it('should return field information', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          fields: [
            { name: 'OBJECTID', type: 'esriFieldTypeOID', alias: 'Object ID' },
            { name: 'NAME', type: 'esriFieldTypeString', alias: 'Name' },
            { name: 'POPULATION', type: 'esriFieldTypeInteger' },
          ],
        }),
      });

      const fields = await service.getLayerFields('https://services.arcgis.com/test/FeatureServer/0');

      expect(fields).toHaveLength(3);
      expect(fields[0]).toEqual({ name: 'OBJECTID', type: 'esriFieldTypeOID', alias: 'Object ID' });
      expect(fields[2]).toEqual({ name: 'POPULATION', type: 'esriFieldTypeInteger', alias: null });
    });

    it('should append /0 to URL without layer index', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ fields: [] }),
      });

      await service.getLayerFields('https://services.arcgis.com/test/FeatureServer');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('FeatureServer/0?f=json')
      );
    });
  });

  // --- queryFeaturesWithGeometry ---

  describe('queryFeaturesWithGeometry', () => {
    it('should use higher limit than queryFeatures', async () => {
      // Mock checkQuerySupport
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            capabilities: 'Query',
            supportedQueryFormats: 'JSON, geoJSON',
          }),
        })
        // Features query
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            type: 'FeatureCollection',
            features: [],
          }),
        });

      await service.queryFeaturesWithGeometry({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        limit: 200,
      });

      // queryFeaturesWithGeometry now uses POST — check body params
      const featuresCall = mockFetch.mock.calls[1];
      const opts = featuresCall[1] as { method: string; body: string };
      expect(opts.method).toBe('POST');
      expect(opts.body).toContain('resultRecordCount=200');
    });

    it('should include bbox as spatial filter', async () => {
      // Mock checkQuerySupport
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            capabilities: 'Query',
            supportedQueryFormats: 'JSON, geoJSON',
          }),
        })
        // Features query
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            type: 'FeatureCollection',
            features: [],
          }),
        });

      await service.queryFeaturesWithGeometry({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        bbox: [-122.7, 45.4, -122.5, 45.6],
      });

      // queryFeaturesWithGeometry now uses POST — check body params
      const featuresCall = mockFetch.mock.calls[1];
      const opts = featuresCall[1] as { method: string; body: string };
      expect(opts.method).toBe('POST');
      expect(opts.body).toContain('geometryType=esriGeometryEnvelope');
      expect(opts.body).toContain('spatialRel=esriSpatialRelIntersects');
    });
  });
});
