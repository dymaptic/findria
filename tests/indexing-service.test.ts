/**
 * Tests for IndexingService shared URL indexing methods:
 * - fetchServiceAsItem (service JSON → ArcGISItem)
 * - indexSingleService (layer URL or service root)
 * - indexArcGISServer (recursive folder crawl)
 * - indexHub (DCAT feed → FeatureServer extraction)
 */

import { IndexingService, IndexResult, LayerInfo } from '@/services/indexing.service';

// safeFetch resolves hostnames before fetching; keep tests offline by
// resolving every host to a public documentation-free address.
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

// Save and restore original fetch
const originalFetch = global.fetch;

describe('IndexingService - URL Indexing Methods', () => {
  let service: IndexingService;
  let mockFetch: jest.Mock;

  // Minimal mocks — these methods don't use sql/openai directly when spied
  const mockSql = jest.fn(() => Promise.resolve([])) as any;
  const mockOpenAI = {
    embeddings: {
      create: jest.fn().mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0) }],
      }),
    },
  } as any;

  beforeEach(() => {
    jest.restoreAllMocks();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    service = new IndexingService(mockSql, mockOpenAI);
    // Make sleep a no-op in tests
    jest.spyOn(service, 'sleep').mockResolvedValue(undefined);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  // ─── fetchServiceAsItem ──────────────────────────────────────────

  describe('fetchServiceAsItem', () => {
    it('should parse a FeatureServer response correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            name: 'Test Service',
            description: 'A test feature service',
            serviceDescription: 'Service desc',
            documentInfo: {
              Title: 'Doc Title',
              Subject: 'Doc Subject',
              Keywords: 'parks,recreation,trails',
              Author: 'testuser',
            },
            fullExtent: { xmin: -122.5, ymin: 37.5, xmax: -122.0, ymax: 38.0 },
          }),
      });

      const result = await service.fetchServiceAsItem(
        'https://services.arcgis.com/test/FeatureServer'
      );

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Service');
      expect(result!.type).toBe('Feature Service');
      expect(result!.description).toBe('A test feature service');
      expect(result!.snippet).toBe('Doc Subject');
      expect(result!.tags).toEqual(['parks', 'recreation', 'trails']);
      expect(result!.extent).toEqual([
        [-122.5, 37.5],
        [-122.0, 38.0],
      ]);
      expect(result!.owner).toBe('testuser');
      expect(result!.access).toBe('public');
    });

    it('should detect MapServer type from URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: 'Map Service' }),
      });

      const result = await service.fetchServiceAsItem(
        'https://example.com/arcgis/rest/services/Basemap/MapServer'
      );

      expect(result!.type).toBe('Map Service');
    });

    it('should generate a deterministic ID from URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: 'Test' }),
      });

      const url = 'https://services.arcgis.com/test/FeatureServer';
      const result = await service.fetchServiceAsItem(url);
      const expectedId = Buffer.from(url).toString('base64').substring(0, 32);
      expect(result!.id).toBe(expectedId);
    });

    it('should use fallback title when name is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            documentInfo: { Title: 'Fallback Title' },
          }),
      });

      const result = await service.fetchServiceAsItem('https://example.com/FeatureServer');
      expect(result!.title).toBe('Fallback Title');
    });

    it('should use "Unnamed Service" when no title info exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await service.fetchServiceAsItem('https://example.com/FeatureServer');
      expect(result!.title).toBe('Unnamed Service');
    });

    it('should handle missing fullExtent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: 'No Extent' }),
      });

      const result = await service.fetchServiceAsItem('https://example.com/FeatureServer');
      expect(result!.extent).toBeNull();
    });

    it('should return null for error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ error: { message: 'Not found' } }),
      });

      const result = await service.fetchServiceAsItem('https://example.com/FeatureServer');
      expect(result).toBeNull();
    });

    it('should return null for HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await service.fetchServiceAsItem('https://example.com/FeatureServer');
      expect(result).toBeNull();
    });

    it('should return null for network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.fetchServiceAsItem('https://example.com/FeatureServer');
      expect(result).toBeNull();
    });

    it('should append ?f=json to the URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: 'Test' }),
      });

      await service.fetchServiceAsItem('https://example.com/FeatureServer');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/FeatureServer?f=json',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  // ─── indexSingleService ──────────────────────────────────────────

  describe('indexSingleService', () => {
    const mockItem = {
      id: 'test-id',
      title: 'Test Service',
      url: 'https://example.com/FeatureServer',
      type: 'Feature Service' as const,
    };

    const mockLayers: LayerInfo[] = [
      { id: 0, name: 'Parks', geometryType: 'esriGeometryPolygon' },
      { id: 1, name: 'Trails', geometryType: 'esriGeometryPolyline' },
    ];

    it('should index a single layer URL', async () => {
      jest.spyOn(service, 'fetchServiceAsItem').mockResolvedValue(mockItem);
      jest.spyOn(service, 'fetchServiceLayers').mockResolvedValue(mockLayers);
      jest.spyOn(service, 'indexLayer').mockResolvedValue({
        status: 'indexed',
        sourceId: 'test-id_layer_1',
      });

      const result = await service.indexSingleService(
        'https://example.com/FeatureServer/1'
      );

      // Should strip layer ID from URL for fetchServiceAsItem
      expect(service.fetchServiceAsItem).toHaveBeenCalledWith(
        'https://example.com/FeatureServer'
      );
      expect(service.fetchServiceLayers).toHaveBeenCalledWith(
        'https://example.com/FeatureServer'
      );
      // Should pass the matching layer and base URL to indexLayer
      expect(service.indexLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          item: expect.objectContaining({ url: 'https://example.com/FeatureServer' }),
          layer: expect.objectContaining({ id: 1, name: 'Trails' }),
          source: 'user_submitted',
        })
      );
      expect(result).toEqual({
        indexed: 1,
        skipped: 0,
        errors: 0,
        sourceIds: ['test-id_layer_1'],
      });
    });

    it('should handle trailing slash in layer URL', async () => {
      jest.spyOn(service, 'fetchServiceAsItem').mockResolvedValue(mockItem);
      jest.spyOn(service, 'fetchServiceLayers').mockResolvedValue(mockLayers);
      jest.spyOn(service, 'indexLayer').mockResolvedValue({
        status: 'indexed',
        sourceId: 'test-id_layer_0',
      });

      await service.indexSingleService('https://example.com/FeatureServer/0/');

      expect(service.fetchServiceAsItem).toHaveBeenCalledWith(
        'https://example.com/FeatureServer'
      );
    });

    it('should return error if layer not found', async () => {
      jest.spyOn(service, 'fetchServiceAsItem').mockResolvedValue(mockItem);
      jest.spyOn(service, 'fetchServiceLayers').mockResolvedValue(mockLayers);

      const result = await service.indexSingleService(
        'https://example.com/FeatureServer/99'
      );

      expect(result.errors).toBe(1);
      expect(result.indexed).toBe(0);
    });

    it('should return error if service fetch fails for layer URL', async () => {
      jest.spyOn(service, 'fetchServiceAsItem').mockResolvedValue(null);

      const result = await service.indexSingleService(
        'https://example.com/FeatureServer/0'
      );

      expect(result.errors).toBe(1);
      expect(result.indexed).toBe(0);
    });

    it('should index all layers for a service root URL', async () => {
      jest.spyOn(service, 'fetchServiceAsItem').mockResolvedValue(mockItem);
      jest.spyOn(service, 'fetchServiceLayers').mockResolvedValue(mockLayers);
      jest.spyOn(service, 'indexLayer').mockResolvedValue({
        status: 'indexed',
        sourceId: 'test-id_layer_0',
      });

      const result = await service.indexSingleService(
        'https://example.com/FeatureServer'
      );

      expect(service.indexLayer).toHaveBeenCalledTimes(2);
      expect(result.indexed).toBe(2);
    });

    it('should index as single item when no layers found', async () => {
      jest.spyOn(service, 'fetchServiceAsItem').mockResolvedValue(mockItem);
      jest.spyOn(service, 'fetchServiceLayers').mockResolvedValue([]);
      jest.spyOn(service, 'indexLayer').mockResolvedValue({
        status: 'indexed',
        sourceId: 'test-id',
      });

      const result = await service.indexSingleService(
        'https://example.com/FeatureServer'
      );

      expect(service.indexLayer).toHaveBeenCalledWith(
        expect.objectContaining({ layer: null })
      );
      expect(result.indexed).toBe(1);
    });

    it('should return error if service fetch fails for root URL', async () => {
      jest.spyOn(service, 'fetchServiceAsItem').mockResolvedValue(null);

      const result = await service.indexSingleService(
        'https://example.com/FeatureServer'
      );

      expect(result.errors).toBe(1);
      expect(result.indexed).toBe(0);
    });

    it('should count skipped layers', async () => {
      jest.spyOn(service, 'fetchServiceAsItem').mockResolvedValue(mockItem);
      jest.spyOn(service, 'fetchServiceLayers').mockResolvedValue(mockLayers);
      jest.spyOn(service, 'indexLayer').mockResolvedValue({
        status: 'skipped',
        sourceId: 'test-id_layer_0',
      });

      const result = await service.indexSingleService(
        'https://example.com/FeatureServer'
      );

      expect(result.skipped).toBe(2);
      expect(result.indexed).toBe(0);
    });

    it('should count errors from indexLayer', async () => {
      jest.spyOn(service, 'fetchServiceAsItem').mockResolvedValue(mockItem);
      jest.spyOn(service, 'fetchServiceLayers').mockResolvedValue(mockLayers);
      jest.spyOn(service, 'indexLayer').mockResolvedValue({
        status: 'error',
        sourceId: 'test-id_layer_0',
        error: 'Embedding failed',
      });

      const result = await service.indexSingleService(
        'https://example.com/FeatureServer'
      );

      expect(result.errors).toBe(2);
      expect(result.indexed).toBe(0);
    });
  });

  // ─── indexArcGISServer ───────────────────────────────────────────

  describe('indexArcGISServer', () => {
    it('should crawl services at root level', async () => {
      // Root catalog response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            folders: [],
            services: [
              { name: 'Parks', type: 'Feature Service' },
              { name: 'Basemap', type: 'Map Service' },
              { name: 'Utilities/GP', type: 'Geoprocessing Service' }, // unsupported
            ],
          }),
      });

      jest.spyOn(service, 'indexSingleService').mockResolvedValue({
        indexed: 1,
        skipped: 0,
        errors: 0,
        sourceIds: ['id1'],
      });

      const result = await service.indexArcGISServer(
        'https://gis.city.gov/arcgis/rest/services'
      );

      // Should index 2 supported services, skip geoprocessing
      expect(service.indexSingleService).toHaveBeenCalledTimes(2);
      expect(service.indexSingleService).toHaveBeenCalledWith(
        'https://gis.city.gov/arcgis/rest/services/Parks/FeatureService'
      );
      expect(service.indexSingleService).toHaveBeenCalledWith(
        'https://gis.city.gov/arcgis/rest/services/Basemap/MapService'
      );
      expect(result.indexed).toBe(2);
    });

    it('should recurse into folders', async () => {
      // Root catalog
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            folders: ['Environmental'],
            services: [],
          }),
      });

      // Folder catalog
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            folders: [],
            services: [{ name: 'Environmental/WaterQuality', type: 'Feature Service' }],
          }),
      });

      jest.spyOn(service, 'indexSingleService').mockResolvedValue({
        indexed: 1,
        skipped: 0,
        errors: 0,
        sourceIds: ['id1'],
      });

      const result = await service.indexArcGISServer(
        'https://gis.city.gov/arcgis/rest/services'
      );

      expect(service.indexSingleService).toHaveBeenCalledTimes(1);
      expect(result.indexed).toBe(1);
    });

    it('should return error when server returns an error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ error: { message: 'Access denied' } }),
      });

      const result = await service.indexArcGISServer(
        'https://gis.city.gov/arcgis/rest/services'
      );

      expect(result.errors).toBe(1);
      expect(result.indexed).toBe(0);
    });

    it('should handle folder fetch failures gracefully', async () => {
      // Root catalog with a folder
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            folders: ['BrokenFolder'],
            services: [],
          }),
      });

      // Folder fetch fails
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));

      const result = await service.indexArcGISServer(
        'https://gis.city.gov/arcgis/rest/services'
      );

      expect(result.errors).toBe(1);
      expect(result.indexed).toBe(0);
    });

    it('should strip trailing slash from base URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ folders: [], services: [] }),
      });

      await service.indexArcGISServer(
        'https://gis.city.gov/arcgis/rest/services/'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://gis.city.gov/arcgis/rest/services?f=json',
        expect.anything()
      );
    });

    it('should accumulate results from multiple services', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            folders: [],
            services: [
              { name: 'A', type: 'Feature Service' },
              { name: 'B', type: 'Feature Service' },
            ],
          }),
      });

      jest
        .spyOn(service, 'indexSingleService')
        .mockResolvedValueOnce({ indexed: 3, skipped: 1, errors: 0, sourceIds: ['a1', 'a2', 'a3'] })
        .mockResolvedValueOnce({ indexed: 1, skipped: 0, errors: 1, sourceIds: ['b1'] });

      const result = await service.indexArcGISServer(
        'https://gis.city.gov/arcgis/rest/services'
      );

      expect(result.indexed).toBe(4);
      expect(result.skipped).toBe(1);
      expect(result.errors).toBe(1);
      expect(result.sourceIds).toEqual(['a1', 'a2', 'a3', 'b1']);
    });
  });

  // ─── indexHub ────────────────────────────────────────────────────

  describe('indexHub', () => {
    const makeDcatResponse = (datasets: any[]) => ({
      ok: true,
      json: () => Promise.resolve({ dataset: datasets }),
    });

    it('should fetch the DCAT feed and index FeatureServer URLs', async () => {
      // DCAT response
      mockFetch.mockResolvedValueOnce(
        makeDcatResponse([
          {
            title: 'Bike Lanes',
            distribution: [
              { accessURL: 'https://services.arcgis.com/abc/FeatureServer', format: 'Esri REST' },
              { accessURL: 'https://example.com/data.csv', format: 'CSV' },
            ],
          },
          {
            title: 'Fire Stations',
            distribution: [
              { accessURL: 'https://services.arcgis.com/def/FeatureServer', format: 'Esri REST' },
            ],
          },
        ])
      );
      // Org ID discovery — no org ID found (skip org search)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html><title>Test</title></html>'),
      });

      jest.spyOn(service, 'indexSingleService').mockResolvedValue({
        indexed: 1,
        skipped: 0,
        errors: 0,
        sourceIds: ['id1'],
      });

      const result = await service.indexHub('https://data.lojic.org');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://data.lojic.org/api/feed/dcat-us/1.1.json',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(service.indexSingleService).toHaveBeenCalledTimes(2);
      expect(service.indexSingleService).toHaveBeenCalledWith(
        'https://services.arcgis.com/abc/FeatureServer',
        { title: 'Bike Lanes' }
      );
      expect(service.indexSingleService).toHaveBeenCalledWith(
        'https://services.arcgis.com/def/FeatureServer',
        { title: 'Fire Stations' }
      );
      expect(result.indexed).toBe(2);
    });

    it('should also match MapServer URLs in distributions', async () => {
      // DCAT response
      mockFetch.mockResolvedValueOnce(
        makeDcatResponse([
          {
            title: 'Imagery',
            distribution: [
              { accessURL: 'https://services.arcgis.com/xyz/MapServer', format: 'Esri REST' },
            ],
          },
        ])
      );
      // Org ID discovery — no org ID found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html><title>Test</title></html>'),
      });

      jest.spyOn(service, 'indexSingleService').mockResolvedValue({
        indexed: 1,
        skipped: 0,
        errors: 0,
        sourceIds: ['id1'],
      });

      const result = await service.indexHub('https://data.example.org');

      expect(service.indexSingleService).toHaveBeenCalledWith(
        'https://services.arcgis.com/xyz/MapServer',
        { title: 'Imagery' }
      );
      expect(result.indexed).toBe(1);
    });

    it('should skip datasets without FeatureServer/MapServer distribution', async () => {
      // DCAT response with no service URLs
      mockFetch.mockResolvedValueOnce(
        makeDcatResponse([
          {
            title: 'CSV Only',
            distribution: [
              { accessURL: 'https://example.com/data.csv', format: 'CSV' },
              { accessURL: 'https://example.com/data.geojson', format: 'GeoJSON' },
            ],
          },
          {
            title: 'No Distribution',
          },
        ])
      );
      // Org ID discovery (hub HTML) — return no org ID
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html><title>Test</title></html>'),
      });

      jest.spyOn(service, 'indexSingleService');

      const result = await service.indexHub('https://data.example.org');

      expect(service.indexSingleService).not.toHaveBeenCalled();
      expect(result.indexed).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('should strip trailing slash from hub URL', async () => {
      // Empty DCAT
      mockFetch.mockResolvedValueOnce(makeDcatResponse([]));
      // Org ID discovery (hub HTML) — no org ID found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html><title>Test</title></html>'),
      });

      const result = await service.indexHub('https://data.example.org/');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://data.example.org/api/feed/dcat-us/1.1.json',
        expect.anything()
      );
      expect(result.indexed).toBe(0);
    });

    it('should throw when DCAT feed fails and no org ID found', async () => {
      // DCAT returns error
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // Org ID discovery (hub HTML) — no org ID found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html><title>Test</title></html>'),
      });

      await expect(
        service.indexHub('https://data.example.org')
      ).rejects.toThrow('No indexable content found');
    });

    it('should return empty results when DCAT has no service URLs and no org ID', async () => {
      // Empty DCAT (valid but no datasets)
      mockFetch.mockResolvedValueOnce(makeDcatResponse([]));
      // Org ID discovery (hub HTML) — no org ID found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html><title>Test</title></html>'),
      });

      const result = await service.indexHub('https://data.example.org');

      expect(result.indexed).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('should handle indexSingleService errors gracefully per dataset', async () => {
      // DCAT response
      mockFetch.mockResolvedValueOnce(
        makeDcatResponse([
          {
            title: 'Good Dataset',
            distribution: [
              { accessURL: 'https://services.arcgis.com/good/FeatureServer' },
            ],
          },
          {
            title: 'Bad Dataset',
            distribution: [
              { accessURL: 'https://services.arcgis.com/bad/FeatureServer' },
            ],
          },
        ])
      );
      // Org ID discovery — no org ID found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html><title>Test</title></html>'),
      });

      jest
        .spyOn(service, 'indexSingleService')
        .mockResolvedValueOnce({ indexed: 1, skipped: 0, errors: 0, sourceIds: ['good1'] })
        .mockRejectedValueOnce(new Error('Connection reset'));

      const result = await service.indexHub('https://data.example.org');

      // Good dataset indexed, bad dataset caught as error
      expect(result.indexed).toBe(1);
      expect(result.errors).toBe(1);
      expect(result.sourceIds).toEqual(['good1']);
    });

    it('should accumulate results across multiple datasets', async () => {
      // DCAT response
      mockFetch.mockResolvedValueOnce(
        makeDcatResponse([
          {
            title: 'DS1',
            distribution: [
              { accessURL: 'https://services.arcgis.com/a/FeatureServer' },
            ],
          },
          {
            title: 'DS2',
            distribution: [
              { accessURL: 'https://services.arcgis.com/b/FeatureServer' },
            ],
          },
        ])
      );
      // Org ID discovery — no org ID found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html><title>Test</title></html>'),
      });

      jest
        .spyOn(service, 'indexSingleService')
        .mockResolvedValueOnce({ indexed: 2, skipped: 0, errors: 1, sourceIds: ['a1', 'a2'] })
        .mockResolvedValueOnce({ indexed: 1, skipped: 1, errors: 0, sourceIds: ['b1'] });

      const result = await service.indexHub('https://data.example.org');

      expect(result.indexed).toBe(3);
      expect(result.skipped).toBe(1);
      expect(result.errors).toBe(1);
      expect(result.sourceIds).toEqual(['a1', 'a2', 'b1']);
    });

    it('should use org search to find items DCAT missed', async () => {
      // DCAT response — only 1 service URL
      mockFetch.mockResolvedValueOnce(
        makeDcatResponse([
          {
            title: 'One Dataset',
            distribution: [
              { accessURL: 'https://services1.arcgis.com/abc/FeatureServer', format: 'Esri REST' },
            ],
          },
        ])
      );
      // Org ID discovery — org found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            '<html><script>{"orgId":"TESTORG123","orgName":"Test Org"}</script></html>'
          ),
      });
      // Org search: Feature Services page 1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            total: 2,
            results: [
              {
                id: 'item-abc',
                title: 'Already From DCAT',
                url: 'https://services1.arcgis.com/abc/FeatureServer',
                type: 'Feature Service',
                tags: [],
              },
              {
                id: 'item-def',
                title: 'Voting Precincts 2023',
                url: 'https://gis.example.org/maps/rest/services/OpenData/MapServer/12',
                type: 'Feature Service',
                tags: ['voting', 'precincts'],
              },
            ],
            nextStart: -1,
          }),
      });
      // Org search: Map Services page 1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            total: 0,
            results: [],
            nextStart: -1,
          }),
      });

      jest.spyOn(service, 'indexSingleService').mockResolvedValue({
        indexed: 1,
        skipped: 0,
        errors: 0,
        sourceIds: ['dcat1'],
      });

      // The org search path calls fetchServiceLayers + indexLayer directly
      jest.spyOn(service, 'fetchServiceLayers').mockResolvedValue([]);
      jest.spyOn(service, 'existsInLivingAtlas').mockResolvedValue(false);
      jest.spyOn(service, 'indexLayer').mockResolvedValue({
        status: 'indexed',
        sourceId: 'item-def',
      });

      const result = await service.indexHub('https://data.example.org');

      // 1 from DCAT + 1 from org search (the DCAT item skipped in org search)
      expect(result.indexed).toBe(2);
      expect(service.indexSingleService).toHaveBeenCalledTimes(1); // Only DCAT
      expect(service.indexLayer).toHaveBeenCalledTimes(1); // Only the new org item
      expect(service.indexLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          item: expect.objectContaining({ title: 'Voting Precincts 2023' }),
          source: 'user_submitted',
          orgDisplayName: 'Test Org',
        })
      );
    });

    it('should skip org search items already in Living Atlas', async () => {
      // Empty DCAT
      mockFetch.mockResolvedValueOnce(makeDcatResponse([]));
      // Org ID discovery — org found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve('<html><script>{"orgId":"TESTORG"}</script></html>'),
      });
      // Org search: Feature Services
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            total: 1,
            results: [
              {
                id: 'living-atlas-item',
                title: 'USA Counties',
                url: 'https://services.arcgis.com/la/FeatureServer',
                type: 'Feature Service',
                tags: [],
              },
            ],
            nextStart: -1,
          }),
      });
      // Org search: Map Services
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ total: 0, results: [], nextStart: -1 }),
      });

      jest.spyOn(service, 'existsInLivingAtlas').mockResolvedValue(true);
      jest.spyOn(service, 'indexLayer');

      const result = await service.indexHub('https://data.example.org');

      expect(result.skipped).toBe(1);
      expect(result.indexed).toBe(0);
      expect(service.indexLayer).not.toHaveBeenCalled();
    });
  });
});
