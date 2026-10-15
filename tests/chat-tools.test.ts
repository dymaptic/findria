/**
 * Tests for chat service tool execution, specifically for:
 * - count_features (ArcGIS and GeoParquet routing)
 * - query_statistics (ArcGIS and GeoParquet routing)
 * - spatial_query (param mapping, validation, source tracking)
 */

import { geoParquetService, GEOPARQUET_SOURCES } from '@/services/geoparquet.service';
import { featureQueryService } from '@/services/feature-query.service';
import { spatialQueryService } from '@/services/spatial-query.service';
import { queryOne } from '@/lib/db';

// Mock the services
jest.mock('@/services/geoparquet.service', () => ({
  geoParquetService: {
    getSource: jest.fn(),
    getCountForBbox: jest.fn(),
    queryStatistics: jest.fn(),
  },
  GEOPARQUET_SOURCES: [
    { id: 'overture-buildings', name: 'Overture Buildings', sourceUrl: 'https://docs.overturemaps.org/' },
    { id: 'overture-places', name: 'Overture Places', sourceUrl: 'https://docs.overturemaps.org/' },
    { id: 'overture-transportation', name: 'Overture Transportation', sourceUrl: 'https://docs.overturemaps.org/' },
    { id: 'overture-addresses', name: 'Overture Addresses', sourceUrl: 'https://docs.overturemaps.org/' },
    { id: 'overture-divisions', name: 'Overture Divisions', sourceUrl: 'https://docs.overturemaps.org/' },
    { id: 'overture-water', name: 'Overture Water', sourceUrl: 'https://docs.overturemaps.org/' },
  ],
}));

jest.mock('@/services/feature-query.service', () => ({
  featureQueryService: {
    countFeatures: jest.fn(),
    queryStatistics: jest.fn(),
  },
}));

jest.mock('@/services/spatial-query.service', () => ({
  spatialQueryService: {
    executeSpatialQuery: jest.fn(),
  },
}));

// Mock the db module for URL validation
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn().mockResolvedValue({ id: 'test-dataset-id' }), // Service URL found in index
}));

// Import the chat service after mocking
import { ChatService } from '@/services/chat.service';

describe('Chat Tool Routing', () => {
  let chatService: ChatService;
  const mockEmitEvent = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    chatService = new ChatService();
  });

  describe('count_features tool', () => {
    describe('input validation', () => {
      it('should return error when both serviceUrl and sourceId are provided', async () => {
        const result = await (chatService as any).executeTool(
          'count_features',
          {
            serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
            sourceId: 'overture-buildings',
            bbox: [-122.5, 45.4, -122.4, 45.5],
          },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('either serviceUrl or sourceId, not both');
      });

      it('should return error when neither serviceUrl nor sourceId is provided', async () => {
        const result = await (chatService as any).executeTool(
          'count_features',
          { bbox: [-122.5, 45.4, -122.4, 45.5] },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('Must provide either serviceUrl');
      });

      it('should return error when sourceId is provided without bbox', async () => {
        (geoParquetService.getSource as jest.Mock).mockReturnValue({
          id: 'overture-buildings',
          name: 'Overture Buildings',
          sourceUrl: 'https://docs.overturemaps.org/',
        });

        const result = await (chatService as any).executeTool(
          'count_features',
          { sourceId: 'overture-buildings' },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('bbox is required');
      });

      it('should return error for unknown sourceId', async () => {
        (geoParquetService.getSource as jest.Mock).mockReturnValue(undefined);

        const result = await (chatService as any).executeTool(
          'count_features',
          {
            sourceId: 'invalid-source',
            bbox: [-122.5, 45.4, -122.4, 45.5],
          },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('Unknown GeoParquet source');
      });
    });

    describe('GeoParquet routing', () => {
      it('should route to geoParquetService when sourceId is provided', async () => {
        const mockSource = {
          id: 'overture-buildings',
          name: 'Overture Buildings',
          sourceUrl: 'https://docs.overturemaps.org/',
        };
        (geoParquetService.getSource as jest.Mock).mockReturnValue(mockSource);
        (geoParquetService.getCountForBbox as jest.Mock).mockResolvedValue(12345);

        const bbox: [number, number, number, number] = [-122.5, 45.4, -122.4, 45.5];
        const result = await (chatService as any).executeTool(
          'count_features',
          { sourceId: 'overture-buildings', bbox },
          mockEmitEvent
        );

        expect(geoParquetService.getCountForBbox).toHaveBeenCalledWith('overture-buildings', bbox);
        expect(result.result).toEqual({
          count: 12345,
          sourceId: 'overture-buildings',
          sourceName: 'Overture Buildings',
        });
        expect(result.geoparquetSources).toHaveLength(1);
        expect(result.geoparquetSources[0].id).toBe('overture-buildings');
      });

      it('should include source metadata in geoparquetSources', async () => {
        const mockSource = {
          id: 'overture-places',
          name: 'Overture Places',
          sourceUrl: 'https://docs.overturemaps.org/',
        };
        (geoParquetService.getSource as jest.Mock).mockReturnValue(mockSource);
        (geoParquetService.getCountForBbox as jest.Mock).mockResolvedValue(5000);

        const result = await (chatService as any).executeTool(
          'count_features',
          {
            sourceId: 'overture-places',
            bbox: [-122.5, 45.4, -122.4, 45.5],
          },
          mockEmitEvent
        );

        expect(result.geoparquetSources).toEqual([
          {
            id: 'overture-places',
            name: 'Overture Places',
            source: 'geoparquet',
            sourceUrl: 'https://docs.overturemaps.org/',
            serviceUrl: undefined,
          },
        ]);
      });
    });

    describe('ArcGIS routing', () => {
      it('should route to featureQueryService when serviceUrl is provided', async () => {
        (featureQueryService.countFeatures as jest.Mock).mockResolvedValue(500);

        const result = await (chatService as any).executeTool(
          'count_features',
          {
            serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
            where: '1=1',
          },
          mockEmitEvent
        );

        expect(featureQueryService.countFeatures).toHaveBeenCalledWith({
          serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
          where: '1=1',
          bbox: undefined,
        });
        expect(result.result).toEqual({ count: 500 });
      });

      it('should pass bbox to featureQueryService when provided', async () => {
        (featureQueryService.countFeatures as jest.Mock).mockResolvedValue(150);

        const bbox: [number, number, number, number] = [-105, 39.5, -104.5, 40];
        await (chatService as any).executeTool(
          'count_features',
          {
            serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
            where: "STATE = 'Colorado'",
            bbox,
          },
          mockEmitEvent
        );

        expect(featureQueryService.countFeatures).toHaveBeenCalledWith({
          serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
          where: "STATE = 'Colorado'",
          bbox,
        });
      });
    });

    describe('error handling', () => {
      it('should handle GeoParquet service errors gracefully', async () => {
        (geoParquetService.getSource as jest.Mock).mockReturnValue({
          id: 'overture-buildings',
          name: 'Overture Buildings',
          sourceUrl: 'https://docs.overturemaps.org/',
        });
        (geoParquetService.getCountForBbox as jest.Mock).mockRejectedValue(
          new Error('DuckDB connection failed')
        );

        const result = await (chatService as any).executeTool(
          'count_features',
          {
            sourceId: 'overture-buildings',
            bbox: [-122.5, 45.4, -122.4, 45.5],
          },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('DuckDB connection failed');
      });

      it('should handle ArcGIS service errors gracefully', async () => {
        (featureQueryService.countFeatures as jest.Mock).mockRejectedValue(
          new Error('Service unavailable')
        );

        const result = await (chatService as any).executeTool(
          'count_features',
          {
            serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
          },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('Service unavailable');
      });
    });
  });

  describe('query_statistics tool', () => {
    describe('input validation', () => {
      it('should return error when both serviceUrl and sourceId are provided', async () => {
        const result = await (chatService as any).executeTool(
          'query_statistics',
          {
            serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
            sourceId: 'overture-places',
            groupByField: 'category',
            statisticType: 'count',
            bbox: [-122.5, 45.4, -122.4, 45.5],
          },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('either serviceUrl or sourceId, not both');
      });

      it('should return error when neither serviceUrl nor sourceId is provided', async () => {
        const result = await (chatService as any).executeTool(
          'query_statistics',
          {
            groupByField: 'category',
            statisticType: 'count',
          },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('Must provide either serviceUrl');
      });

      it('should return error when sourceId is provided without bbox', async () => {
        (geoParquetService.getSource as jest.Mock).mockReturnValue({
          id: 'overture-places',
          name: 'Overture Places',
          sourceUrl: 'https://docs.overturemaps.org/',
        });

        const result = await (chatService as any).executeTool(
          'query_statistics',
          {
            sourceId: 'overture-places',
            groupByField: 'category',
            statisticType: 'count',
          },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('bbox is required');
      });
    });

    describe('GeoParquet routing', () => {
      it('should route to geoParquetService.queryStatistics when sourceId is provided', async () => {
        const mockSource = {
          id: 'overture-places',
          name: 'Overture Places',
          sourceUrl: 'https://docs.overturemaps.org/',
        };
        const mockStats = {
          rows: [
            { category: 'restaurant', count: 150 },
            { category: 'hotel', count: 75 },
            { category: 'hospital', count: 25 },
          ],
          groupByField: 'category',
          statisticType: 'count',
          totalGroups: 3,
          truncated: false,
        };

        (geoParquetService.getSource as jest.Mock).mockReturnValue(mockSource);
        (geoParquetService.queryStatistics as jest.Mock).mockResolvedValue(mockStats);

        const bbox: [number, number, number, number] = [-122.5, 45.4, -122.4, 45.5];
        const result = await (chatService as any).executeTool(
          'query_statistics',
          {
            sourceId: 'overture-places',
            groupByField: 'category',
            statisticType: 'count',
            bbox,
            orderBy: 'desc',
            limit: 10,
          },
          mockEmitEvent
        );

        expect(geoParquetService.queryStatistics).toHaveBeenCalledWith(
          'overture-places',
          bbox,
          {
            groupByField: 'category',
            statisticType: 'count',
            statisticField: undefined,
            orderBy: 'desc',
            limit: 10,
          }
        );

        expect(result.result.rows).toEqual(mockStats.rows);
        expect(result.result.sourceId).toBe('overture-places');
        expect(result.result.sourceName).toBe('Overture Places');
        expect(result.geoparquetSources).toHaveLength(1);
      });

      it('should include source info in the result message', async () => {
        const mockSource = {
          id: 'overture-buildings',
          name: 'Overture Buildings',
          sourceUrl: 'https://docs.overturemaps.org/',
        };
        const mockStats = {
          rows: [{ name: 'Empire State', count: 1 }],
          groupByField: 'name',
          statisticType: 'count',
          totalGroups: 1,
          truncated: false,
        };

        (geoParquetService.getSource as jest.Mock).mockReturnValue(mockSource);
        (geoParquetService.queryStatistics as jest.Mock).mockResolvedValue(mockStats);

        const result = await (chatService as any).executeTool(
          'query_statistics',
          {
            sourceId: 'overture-buildings',
            groupByField: 'name',
            statisticType: 'count',
            bbox: [-74, 40.7, -73.9, 40.8],
          },
          mockEmitEvent
        );

        expect(result.result.message).toContain('Overture Buildings');
      });
    });

    describe('ArcGIS routing', () => {
      it('should route to featureQueryService.queryStatistics when serviceUrl is provided', async () => {
        const mockStats = {
          rows: [
            { STATE_NAME: 'California', count: 58 },
            { STATE_NAME: 'Texas', count: 254 },
          ],
          groupByField: 'STATE_NAME',
          statisticType: 'count',
          totalGroups: 50,
          truncated: true,
        };

        (featureQueryService.queryStatistics as jest.Mock).mockResolvedValue(mockStats);

        const result = await (chatService as any).executeTool(
          'query_statistics',
          {
            serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
            groupByField: 'STATE_NAME',
            statisticType: 'count',
            orderBy: 'desc',
            limit: 10,
          },
          mockEmitEvent
        );

        expect(featureQueryService.queryStatistics).toHaveBeenCalledWith({
          serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
          groupByField: 'STATE_NAME',
          statisticType: 'count',
          statisticField: undefined,
          where: undefined,
          orderBy: 'desc',
          limit: 10,
        });

        expect(result.result.rows).toEqual(mockStats.rows);
        expect(result.result.truncated).toBe(true);
      });

      it('should pass where clause to ArcGIS service', async () => {
        const mockStats = {
          rows: [{ COUNTY: 'Los Angeles', count: 1000 }],
          groupByField: 'COUNTY',
          statisticType: 'count',
          totalGroups: 1,
          truncated: false,
        };

        (featureQueryService.queryStatistics as jest.Mock).mockResolvedValue(mockStats);

        await (chatService as any).executeTool(
          'query_statistics',
          {
            serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
            groupByField: 'COUNTY',
            statisticType: 'count',
            where: "STATE = 'California'",
          },
          mockEmitEvent
        );

        expect(featureQueryService.queryStatistics).toHaveBeenCalledWith(
          expect.objectContaining({
            where: "STATE = 'California'",
          })
        );
      });

      it('should support sum/avg/min/max statistics with statisticField', async () => {
        const mockStats = {
          rows: [{ STATE: 'California', sum: 39000000 }],
          groupByField: 'STATE',
          statisticType: 'sum',
          statisticField: 'POPULATION',
          totalGroups: 1,
          truncated: false,
        };

        (featureQueryService.queryStatistics as jest.Mock).mockResolvedValue(mockStats);

        await (chatService as any).executeTool(
          'query_statistics',
          {
            serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
            groupByField: 'STATE',
            statisticType: 'sum',
            statisticField: 'POPULATION',
          },
          mockEmitEvent
        );

        expect(featureQueryService.queryStatistics).toHaveBeenCalledWith(
          expect.objectContaining({
            statisticType: 'sum',
            statisticField: 'POPULATION',
          })
        );
      });
    });

    describe('limit enforcement', () => {
      it('should cap limit at 20 for GeoParquet queries', async () => {
        const mockSource = {
          id: 'overture-places',
          name: 'Overture Places',
          sourceUrl: 'https://docs.overturemaps.org/',
        };
        const mockStats = {
          rows: [],
          groupByField: 'category',
          statisticType: 'count',
          totalGroups: 0,
          truncated: false,
        };

        (geoParquetService.getSource as jest.Mock).mockReturnValue(mockSource);
        (geoParquetService.queryStatistics as jest.Mock).mockResolvedValue(mockStats);

        await (chatService as any).executeTool(
          'query_statistics',
          {
            sourceId: 'overture-places',
            groupByField: 'category',
            statisticType: 'count',
            bbox: [-122.5, 45.4, -122.4, 45.5],
            limit: 100, // Request more than max
          },
          mockEmitEvent
        );

        expect(geoParquetService.queryStatistics).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            limit: 20, // Should be capped at 20
          })
        );
      });

      it('should cap limit at 20 for ArcGIS queries', async () => {
        const mockStats = {
          rows: [],
          groupByField: 'STATE',
          statisticType: 'count',
          totalGroups: 0,
          truncated: false,
        };

        (featureQueryService.queryStatistics as jest.Mock).mockResolvedValue(mockStats);

        await (chatService as any).executeTool(
          'query_statistics',
          {
            serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
            groupByField: 'STATE',
            statisticType: 'count',
            limit: 50, // Request more than max
          },
          mockEmitEvent
        );

        expect(featureQueryService.queryStatistics).toHaveBeenCalledWith(
          expect.objectContaining({
            limit: 20, // Should be capped at 20
          })
        );
      });
    });

    describe('error handling', () => {
      it('should handle GeoParquet service errors gracefully', async () => {
        (geoParquetService.getSource as jest.Mock).mockReturnValue({
          id: 'overture-places',
          name: 'Overture Places',
          sourceUrl: 'https://docs.overturemaps.org/',
        });
        (geoParquetService.queryStatistics as jest.Mock).mockRejectedValue(
          new Error('Query execution failed')
        );

        const result = await (chatService as any).executeTool(
          'query_statistics',
          {
            sourceId: 'overture-places',
            groupByField: 'category',
            statisticType: 'count',
            bbox: [-122.5, 45.4, -122.4, 45.5],
          },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('Query execution failed');
      });

      it('should handle ArcGIS service errors gracefully', async () => {
        (featureQueryService.queryStatistics as jest.Mock).mockRejectedValue(
          new Error('Statistics not supported')
        );

        const result = await (chatService as any).executeTool(
          'query_statistics',
          {
            serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
            groupByField: 'STATE',
            statisticType: 'count',
          },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('Statistics not supported');
      });
    });
  });

  describe('spatial_query tool', () => {
    describe('parameter mapping', () => {
      it('should map all spatial_query params to spatialQueryService', async () => {
        (spatialQueryService.executeSpatialQuery as jest.Mock).mockResolvedValue({
          sourceFeatureCount: 5,
          targetFeatureCount: 10,
          resultGeometryId: 'spatial-123',
          sampleFeatures: [],
        });

        await (chatService as any).executeTool(
          'spatial_query',
          {
            sourceServiceUrl: 'https://services.arcgis.com/fires/FeatureServer/0',
            sourceWhere: "FIRE_TYPE = 'Wildfire'",
            sourceBbox: [-123, 45, -122, 46],
            targetServiceUrl: 'https://services.arcgis.com/schools/FeatureServer/0',
            targetWhere: "TYPE = 'Elementary'",
            spatialRelation: 'within_distance',
            distance: 10,
            distanceUnit: 'miles',
            mode: 'features',
            label: 'Schools near wildfires',
          },
          mockEmitEvent
        );

        expect(spatialQueryService.executeSpatialQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            sourceServiceUrl: 'https://services.arcgis.com/fires/FeatureServer/0',
            sourceWhere: "FIRE_TYPE = 'Wildfire'",
            sourceBbox: [-123, 45, -122, 46],
            targetServiceUrl: 'https://services.arcgis.com/schools/FeatureServer/0',
            targetWhere: "TYPE = 'Elementary'",
            spatialRelation: 'within_distance',
            distance: 10,
            distanceUnit: 'miles',
            mode: 'features',
            label: 'Schools near wildfires',
          }),
          mockEmitEvent
        );
      });

      it('should map statistics params', async () => {
        (spatialQueryService.executeSpatialQuery as jest.Mock).mockResolvedValue({
          sourceFeatureCount: 5,
          resultGeometryId: 'spatial-456',
          statistics: [],
          totalMatching: 0,
        });

        await (chatService as any).executeTool(
          'spatial_query',
          {
            sourceServiceUrl: 'https://services.arcgis.com/fires/FeatureServer/0',
            targetServiceUrl: 'https://services.arcgis.com/schools/FeatureServer/0',
            spatialRelation: 'within_distance',
            distance: 5,
            mode: 'statistics',
            groupByField: 'SCHOOL_TYPE',
            statisticType: 'count',
          },
          mockEmitEvent
        );

        expect(spatialQueryService.executeSpatialQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            mode: 'statistics',
            groupByField: 'SCHOOL_TYPE',
            statisticType: 'count',
          }),
          mockEmitEvent
        );
      });

      it('should map sourceGeometryId for chaining', async () => {
        (spatialQueryService.executeSpatialQuery as jest.Mock).mockResolvedValue({
          sourceFeatureCount: 0,
          resultGeometryId: 'spatial-789',
        });

        await (chatService as any).executeTool(
          'spatial_query',
          {
            sourceGeometryId: 'spatial-previous-123',
            targetServiceUrl: 'https://services.arcgis.com/hospitals/FeatureServer/0',
            spatialRelation: 'intersects',
          },
          mockEmitEvent
        );

        expect(spatialQueryService.executeSpatialQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            sourceGeometryId: 'spatial-previous-123',
            spatialRelation: 'intersects',
          }),
          mockEmitEvent
        );
      });
    });

    describe('service URL validation', () => {
      it('should validate source service URL against index', async () => {
        (spatialQueryService.executeSpatialQuery as jest.Mock).mockResolvedValue({
          sourceFeatureCount: 0,
          resultGeometryId: '',
          error: 'No source features found',
        });

        (queryOne as jest.Mock).mockResolvedValue({ id: 'dataset-1' });

        const result = await (chatService as any).executeTool(
          'spatial_query',
          {
            sourceServiceUrl: 'https://services.arcgis.com/fires/FeatureServer/0',
            targetServiceUrl: 'https://services.arcgis.com/schools/FeatureServer/0',
            spatialRelation: 'intersects',
          },
          mockEmitEvent
        );

        // Should have been called — URL validation queries the db
        expect(queryOne).toHaveBeenCalled();
      });
    });

    describe('GeoParquet source tracking', () => {
      it('should track GeoParquet sources for source and target', async () => {
        (geoParquetService.getSource as jest.Mock)
          .mockReturnValueOnce({
            id: 'overture-buildings',
            name: 'Overture Buildings',
            sourceUrl: 'https://docs.overturemaps.org/',
          })
          .mockReturnValueOnce({
            id: 'overture-places',
            name: 'Overture Places',
            sourceUrl: 'https://docs.overturemaps.org/',
          });

        (spatialQueryService.executeSpatialQuery as jest.Mock).mockResolvedValue({
          sourceFeatureCount: 10,
          targetFeatureCount: 20,
          resultGeometryId: 'spatial-abc',
          sampleFeatures: [],
        });

        const result = await (chatService as any).executeTool(
          'spatial_query',
          {
            sourceId: 'overture-buildings',
            sourceBbox: [-122.7, 45.4, -122.5, 45.6],
            targetId: 'overture-places',
            spatialRelation: 'within_distance',
            distance: 1,
          },
          mockEmitEvent
        );

        expect(result.geoparquetSources).toHaveLength(2);
        expect(result.geoparquetSources[0].id).toBe('overture-buildings');
        expect(result.geoparquetSources[1].id).toBe('overture-places');
      });
    });

    describe('error handling', () => {
      it('should catch and return errors from spatial query service', async () => {
        (spatialQueryService.executeSpatialQuery as jest.Mock).mockRejectedValue(
          new Error('Spatial query timed out')
        );

        const result = await (chatService as any).executeTool(
          'spatial_query',
          {
            sourceServiceUrl: 'https://services.arcgis.com/fires/FeatureServer/0',
            targetServiceUrl: 'https://services.arcgis.com/schools/FeatureServer/0',
            spatialRelation: 'intersects',
          },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('Spatial query timed out');
      });

      it('should return error when source URL validation fails', async () => {
        (queryOne as jest.Mock).mockResolvedValue(null); // URL not in index

        const result = await (chatService as any).executeTool(
          'spatial_query',
          {
            sourceServiceUrl: 'https://evil.example.com/FeatureServer/0',
            targetServiceUrl: 'https://services.arcgis.com/schools/FeatureServer/0',
            spatialRelation: 'intersects',
          },
          mockEmitEvent
        );

        expect(result.result).toHaveProperty('error');
        expect(result.result.error).toContain('Source');
      });
    });
  });
});

describe('GeoParquet Source Registry', () => {
  it('should have all expected Overture sources defined', () => {
    const expectedSources = [
      'overture-buildings',
      'overture-places',
      'overture-transportation',
      'overture-addresses',
      'overture-divisions',
      'overture-water',
    ];

    const sourceIds = GEOPARQUET_SOURCES.map((s) => s.id);
    expectedSources.forEach((expected) => {
      expect(sourceIds).toContain(expected);
    });
  });
});
