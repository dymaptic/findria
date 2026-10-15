/**
 * Tests for spatial-query.service.ts
 * Covers: parameter validation, geometry caching, spatial filter computation,
 * polygon union/simplification, unit conversion, execution flow, and map layer emission.
 */

import type { GeoJSONFeature } from '@/types';
import type { StreamEvent } from '@/types/chat';

// Mock the dependencies before importing the service
jest.mock('@/services/feature-query.service', () => ({
  featureQueryService: {
    queryFeaturesWithGeometry: jest.fn(),
    queryFeaturesWithPolygonFilter: jest.fn(),
  },
}));

jest.mock('@/services/geoparquet.service', () => ({
  geoParquetService: {
    getSource: jest.fn(),
    queryFeaturesWithGeometry: jest.fn(),
    querySpatialJoin: jest.fn(),
  },
}));

import { SpatialQueryService, type SpatialQueryParams } from '@/services/spatial-query.service';
import { featureQueryService } from '@/services/feature-query.service';
import { geoParquetService } from '@/services/geoparquet.service';

describe('SpatialQueryService', () => {
  let service: SpatialQueryService;
  let emitEvent: jest.Mock<void, [StreamEvent]>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SpatialQueryService();
    emitEvent = jest.fn();
  });

  // --- Parameter Validation ---

  describe('parameter validation', () => {
    it('should reject when no source is provided', async () => {
      const result = await service.executeSpatialQuery({
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
      }, emitEvent);

      expect(result.error).toContain('Provide exactly ONE of');
      expect(result.sourceFeatureCount).toBe(0);
    });

    it('should reject when multiple sources are provided', async () => {
      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        sourceId: 'overture-places',
        sourceBbox: [-122.5, 45.4, -122.4, 45.5],
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(result.error).toContain('Provide exactly ONE of');
    });

    it('should reject when no target is provided', async () => {
      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'intersects',
      }, emitEvent);

      expect(result.error).toContain('Provide exactly ONE of: targetServiceUrl or targetId');
    });

    it('should reject when multiple targets are provided', async () => {
      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
        targetId: 'overture-buildings',
      }, emitEvent);

      expect(result.error).toContain('Provide exactly ONE of: targetServiceUrl or targetId');
    });

    it('should reject within_distance without distance', async () => {
      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(result.error).toContain('distance is required');
    });

    it('should reject within_distance with zero distance', async () => {
      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 0,
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(result.error).toContain('distance is required and must be positive');
    });

    it('should reject within_distance with negative distance', async () => {
      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: -5,
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(result.error).toContain('distance is required and must be positive');
    });

    it('should reject excessively large distance', async () => {
      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 6000,
        distanceUnit: 'miles',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(result.error).toContain('Distance too large');
      expect(result.error).toContain('5000 miles');
    });

    it('should reject excessively large distance in kilometers', async () => {
      // 5001 miles = ~8047 km
      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 10000,
        distanceUnit: 'kilometers',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(result.error).toContain('Distance too large');
    });

    it('should accept valid distance in miles', async () => {
      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue([]);

      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 10,
        distanceUnit: 'miles',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      // Should pass validation but fail on no source features
      expect(result.error).toContain('No source features found');
    });

    it('should require sourceBbox when using sourceId (GeoParquet)', async () => {
      const result = await service.executeSpatialQuery({
        sourceId: 'overture-buildings',
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
      }, emitEvent);

      expect(result.error).toContain('sourceBbox is required');
    });

    it('should require groupByField for statistics mode', async () => {
      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
        mode: 'statistics',
      }, emitEvent);

      expect(result.error).toContain('groupByField is required for statistics mode');
    });

    it('should require statisticField for non-count aggregations', async () => {
      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
        mode: 'statistics',
        groupByField: 'TYPE',
        statisticType: 'sum',
      }, emitEvent);

      expect(result.error).toContain('statisticField is required for sum aggregation');
    });

    it('should allow count aggregation without statisticField', async () => {
      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue([]);

      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
        mode: 'statistics',
        groupByField: 'TYPE',
        statisticType: 'count',
      }, emitEvent);

      // Should pass validation (fails on no source features, not validation)
      expect(result.error).toContain('No source features found');
    });
  });

  // --- ArcGIS Source → ArcGIS Target Flow ---

  describe('ArcGIS source → ArcGIS target', () => {
    const makePointFeature = (x: number, y: number, props: Record<string, unknown> = {}): GeoJSONFeature => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [x, y] },
      properties: { OBJECTID: 1, NAME: 'Test', ...props },
    });

    const makePolygonFeature = (coords: number[][][], props: Record<string, unknown> = {}): GeoJSONFeature => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: coords },
      properties: { OBJECTID: 1, NAME: 'Test', ...props },
    });

    it('should execute within_distance query with point sources', async () => {
      const sourceFeatures: GeoJSONFeature[] = [
        makePointFeature(-122.6, 45.5, { NAME: 'Fire 1' }),
        makePointFeature(-122.7, 45.6, { NAME: 'Fire 2' }),
      ];

      const targetFeatures: GeoJSONFeature[] = [
        makePointFeature(-122.65, 45.55, { NAME: 'School A' }),
        makePointFeature(-122.68, 45.52, { NAME: 'School B' }),
      ];

      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(sourceFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: targetFeatures,
        count: 2,
      });

      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/fires/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 5,
        distanceUnit: 'miles',
        targetServiceUrl: 'https://services.arcgis.com/schools/FeatureServer/0',
        label: 'Schools near fires',
      }, emitEvent);

      expect(result.error).toBeUndefined();
      expect(result.sourceFeatureCount).toBe(2);
      expect(result.targetFeatureCount).toBe(2);
      expect(result.resultGeometryId).toMatch(/^spatial-/);
      expect(result.sampleFeatures).toHaveLength(2);

      // Verify source was queried
      expect(featureQueryService.queryFeaturesWithGeometry).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceUrl: 'https://services.arcgis.com/fires/FeatureServer/0',
          limit: 200,
        })
      );

      // Verify target was queried with polygon filter
      expect(featureQueryService.queryFeaturesWithPolygonFilter).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceUrl: 'https://services.arcgis.com/schools/FeatureServer/0',
          spatialRel: 'esriSpatialRelIntersects', // within_distance uses Intersects (already buffered)
          limit: 500,
        })
      );
    });

    it('should execute intersects query with polygon sources', async () => {
      const sourceFeatures: GeoJSONFeature[] = [
        makePolygonFeature([[[-122.7, 45.4], [-122.5, 45.4], [-122.5, 45.6], [-122.7, 45.6], [-122.7, 45.4]]]),
      ];

      const targetFeatures: GeoJSONFeature[] = [
        makePointFeature(-122.6, 45.5, { NAME: 'Hospital A' }),
      ];

      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(sourceFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: targetFeatures,
        count: 1,
      });

      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/floodzone/FeatureServer/0',
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/hospitals/FeatureServer/0',
        label: 'Hospitals in flood zones',
      }, emitEvent);

      expect(result.error).toBeUndefined();
      expect(result.sourceFeatureCount).toBe(1);
      expect(result.targetFeatureCount).toBe(1);
    });

    it('should handle no source features found', async () => {
      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue([]);

      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(result.error).toContain('No source features found');
      expect(result.sourceFeatureCount).toBe(0);
    });

    it('should handle no target features found', async () => {
      const sourceFeatures: GeoJSONFeature[] = [
        makePointFeature(-122.6, 45.5),
      ];

      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(sourceFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: [],
        count: 0,
      });

      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 5,
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(result.error).toBeUndefined();
      expect(result.targetFeatureCount).toBe(0);
    });

    it('should pass sourceWhere and targetWhere to queries', async () => {
      const sourceFeatures: GeoJSONFeature[] = [
        makePointFeature(-122.6, 45.5, { FIRE_TYPE: 'Wildfire' }),
      ];

      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(sourceFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: [],
        count: 0,
      });

      await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/fires/FeatureServer/0',
        sourceWhere: "FIRE_TYPE = 'Wildfire'",
        spatialRelation: 'within_distance',
        distance: 10,
        targetServiceUrl: 'https://services.arcgis.com/schools/FeatureServer/0',
        targetWhere: "TYPE = 'Elementary'",
      }, emitEvent);

      expect(featureQueryService.queryFeaturesWithGeometry).toHaveBeenCalledWith(
        expect.objectContaining({
          where: "FIRE_TYPE = 'Wildfire'",
        })
      );

      expect(featureQueryService.queryFeaturesWithPolygonFilter).toHaveBeenCalledWith(
        expect.objectContaining({
          where: "TYPE = 'Elementary'",
        })
      );
    });

    it('should use correct spatial relation for contains', async () => {
      const sourceFeatures: GeoJSONFeature[] = [
        makePolygonFeature([[[-122.7, 45.4], [-122.5, 45.4], [-122.5, 45.6], [-122.7, 45.6], [-122.7, 45.4]]]),
      ];

      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(sourceFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: [],
        count: 0,
      });

      await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'contains',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(featureQueryService.queryFeaturesWithPolygonFilter).toHaveBeenCalledWith(
        expect.objectContaining({
          spatialRel: 'esriSpatialRelContains',
        })
      );
    });

    it('should use correct spatial relation for within', async () => {
      const sourceFeatures: GeoJSONFeature[] = [
        makePolygonFeature([[[-122.7, 45.4], [-122.5, 45.4], [-122.5, 45.6], [-122.7, 45.6], [-122.7, 45.4]]]),
      ];

      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(sourceFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: [],
        count: 0,
      });

      await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(featureQueryService.queryFeaturesWithPolygonFilter).toHaveBeenCalledWith(
        expect.objectContaining({
          spatialRel: 'esriSpatialRelWithin',
        })
      );
    });

    it('should truncate sampleFeatures to 10', async () => {
      const sourceFeatures: GeoJSONFeature[] = [makePointFeature(-122.6, 45.5)];
      const targetFeatures: GeoJSONFeature[] = Array.from({ length: 15 }, (_, i) =>
        makePointFeature(-122.6 + i * 0.01, 45.5, { NAME: `Feature ${i}` })
      );

      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(sourceFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: targetFeatures,
        count: 15,
      });

      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 10,
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(result.sampleFeatures).toHaveLength(10);
    });
  });

  // --- Map Layer Emission ---

  describe('map layer emission', () => {
    const makePointFeature = (x: number, y: number): GeoJSONFeature => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [x, y] },
      properties: { OBJECTID: 1 },
    });

    it('should emit source, buffer, result, and zoom layers for within_distance', async () => {
      const sourceFeatures = [makePointFeature(-122.6, 45.5)];
      const targetFeatures = [makePointFeature(-122.65, 45.55)];

      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(sourceFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: targetFeatures,
        count: 1,
      });

      await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/fires/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 5,
        distanceUnit: 'miles',
        targetServiceUrl: 'https://services.arcgis.com/schools/FeatureServer/0',
        label: 'Schools near fires',
      }, emitEvent);

      const events = emitEvent.mock.calls.map(c => c[0]);
      const mapActions = events.filter(e => e.type === 'map_action').map(e => e.action);

      // Should have: source layer, buffer zone, target layer, zoom
      expect(mapActions.length).toBe(4);

      // Source layer (coral) — actual queried features as GeoJSON
      expect(mapActions[0]).toMatchObject({
        type: 'add_geojson',
        label: 'Source features',
        style: { color: '#E24E42', fillOpacity: 0.5 },
      });
      expect((mapActions[0] as any).geojson.features).toHaveLength(1); // 1 source feature

      // Buffer zone (teal)
      expect(mapActions[1]).toMatchObject({
        type: 'add_geojson',
        style: { color: '#1D809F', fillOpacity: 0.15 },
      });

      // Result features (green) — actual spatially-filtered features as GeoJSON
      expect(mapActions[2]).toMatchObject({
        type: 'add_geojson',
        style: { color: '#4CAF50', fillOpacity: 0.4 },
      });
      expect((mapActions[2] as any).geojson.features).toHaveLength(1); // 1 target feature

      // Zoom to extent
      expect(mapActions[3]).toMatchObject({
        type: 'zoom_to_extent',
      });
      expect((mapActions[3] as any).bbox).toBeDefined();
    });

    it('should not emit buffer layer for intersects queries', async () => {
      const sourceFeatures = [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[[-122.7, 45.4], [-122.5, 45.4], [-122.5, 45.6], [-122.7, 45.6], [-122.7, 45.4]]],
          },
          properties: { OBJECTID: 1 },
        },
      ];

      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(sourceFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: [makePointFeature(-122.6, 45.5)],
        count: 1,
      });

      await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      const events = emitEvent.mock.calls.map(c => c[0]);
      const mapActions = events.filter(e => e.type === 'map_action').map(e => e.action);

      // Should have: source, result, zoom (no buffer)
      expect(mapActions.length).toBe(3);
      expect(mapActions.some((a: any) => a.style?.color === '#1D809F')).toBe(false);
    });

    it('should not emit result layer in statistics mode', async () => {
      const sourceFeatures = [makePointFeature(-122.6, 45.5)];

      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(sourceFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: [],
        count: 5,
      });

      await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 5,
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
        mode: 'statistics',
        groupByField: 'TYPE',
        statisticType: 'count',
      }, emitEvent);

      const events = emitEvent.mock.calls.map(c => c[0]);
      const mapActions = events.filter(e => e.type === 'map_action').map(e => e.action);

      // Should have: source, buffer, zoom (no result layer in stats mode)
      const resultLayers = mapActions.filter((a: any) => a.style?.color === '#4CAF50');
      expect(resultLayers.length).toBe(0);
    });
  });

  // --- GeoParquet → GeoParquet path ---

  describe('GeoParquet-to-GeoParquet optimization', () => {
    it('should use querySpatialJoin for GeoParquet-to-GeoParquet queries', async () => {
      const mockFeatures = [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [-122.6, 45.5] },
          properties: { id: '1', name: 'Place 1', source: 'overture-places' },
        },
      ];

      (geoParquetService.querySpatialJoin as jest.Mock).mockResolvedValue({
        features: mockFeatures,
        count: 1,
      });

      const result = await service.executeSpatialQuery({
        sourceId: 'overture-buildings',
        sourceBbox: [-122.7, 45.4, -122.5, 45.6],
        spatialRelation: 'within_distance',
        distance: 1,
        distanceUnit: 'kilometers',
        targetId: 'overture-places',
        label: 'Places near buildings',
      }, emitEvent);

      expect(geoParquetService.querySpatialJoin).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: 'overture-buildings',
          targetId: 'overture-places',
          spatialRelation: 'within_distance',
          distance: 1,
          distanceUnit: 'kilometers',
        })
      );

      expect(result.error).toBeUndefined();
      expect(result.targetFeatureCount).toBe(1);
      expect(result.resultGeometryId).toMatch(/^spatial-/);
    });

    it('should emit GeoJSON layer for GeoParquet results', async () => {
      const mockFeatures = [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [-122.6, 45.5] },
          properties: { id: '1', name: 'Place 1' },
        },
      ];

      (geoParquetService.querySpatialJoin as jest.Mock).mockResolvedValue({
        features: mockFeatures,
        count: 1,
      });

      await service.executeSpatialQuery({
        sourceId: 'overture-buildings',
        sourceBbox: [-122.7, 45.4, -122.5, 45.6],
        spatialRelation: 'intersects',
        targetId: 'overture-places',
      }, emitEvent);

      const events = emitEvent.mock.calls.map(c => c[0]);
      const geojsonActions = events
        .filter(e => e.type === 'map_action')
        .map(e => e.action)
        .filter((a: any) => a.type === 'add_geojson');

      expect(geojsonActions.length).toBeGreaterThan(0);
      expect(geojsonActions[0]).toMatchObject({
        type: 'add_geojson',
        style: { color: '#4CAF50', fillOpacity: 0.4 },
      });
    });

    it('should handle statistics mode for GeoParquet-to-GeoParquet', async () => {
      (geoParquetService.querySpatialJoin as jest.Mock).mockResolvedValue({
        features: [],
        count: 42,
        statistics: [
          { category: 'restaurant', count: 25 },
          { category: 'cafe', count: 17 },
        ],
      });

      const result = await service.executeSpatialQuery({
        sourceId: 'overture-buildings',
        sourceBbox: [-122.7, 45.4, -122.5, 45.6],
        spatialRelation: 'within_distance',
        distance: 1,
        targetId: 'overture-places',
        mode: 'statistics',
        groupByField: 'category',
        statisticType: 'count',
      }, emitEvent);

      expect(result.statistics).toHaveLength(2);
      expect(result.totalMatching).toBe(42);
    });
  });

  // --- GeoParquet source → ArcGIS target ---

  describe('GeoParquet source → ArcGIS target', () => {
    it('should query GeoParquet for source and ArcGIS for target', async () => {
      const geoParquetFeatures = [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [-122.6, 45.5] },
          properties: { id: '1', name: 'Building 1' },
        },
      ];

      (geoParquetService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(geoParquetFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-122.65, 45.55] },
            properties: { NAME: 'School A' },
          },
        ],
        count: 1,
      });

      const result = await service.executeSpatialQuery({
        sourceId: 'overture-buildings',
        sourceBbox: [-122.7, 45.4, -122.5, 45.6],
        spatialRelation: 'within_distance',
        distance: 1,
        targetServiceUrl: 'https://services.arcgis.com/schools/FeatureServer/0',
      }, emitEvent);

      expect(geoParquetService.queryFeaturesWithGeometry).toHaveBeenCalledWith('overture-buildings', {
        bbox: [-122.7, 45.4, -122.5, 45.6],
        where: undefined,
        limit: 200,
      });

      expect(result.error).toBeUndefined();
      expect(result.targetFeatureCount).toBe(1);
    });
  });

  // --- Geometry Cache / Chaining ---

  describe('geometry cache and chaining', () => {
    it('should return a resultGeometryId that can be used as sourceGeometryId', async () => {
      // First query
      const sourceFeatures: GeoJSONFeature[] = [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-122.6, 45.5] },
        properties: { OBJECTID: 1 },
      }];

      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue(sourceFeatures);
      (featureQueryService.queryFeaturesWithPolygonFilter as jest.Mock).mockResolvedValue({
        features: [],
        count: 0,
      });

      const firstResult = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 5,
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(firstResult.resultGeometryId).toBeTruthy();

      // Second query using cached geometry
      const result = await service.executeSpatialQuery({
        sourceGeometryId: firstResult.resultGeometryId,
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/2',
      }, emitEvent);

      // Should work without error (uses cached polygon)
      expect(result.error).toBeUndefined();
    });

    it('should error when cached geometry has expired', async () => {
      const result = await service.executeSpatialQuery({
        sourceGeometryId: 'spatial-nonexistent-abc123',
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
      }, emitEvent);

      expect(result.error).toContain('expired');
    });
  });

  // --- Error Handling ---

  describe('error handling', () => {
    it('should catch and return errors from feature query service', async () => {
      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockRejectedValue(
        new Error('Network error: fetch failed')
      );

      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(result.error).toContain('Network error');
    });

    it('should catch and return errors from geoparquet spatial join', async () => {
      (geoParquetService.querySpatialJoin as jest.Mock).mockRejectedValue(
        new Error('DuckDB query failed')
      );

      const result = await service.executeSpatialQuery({
        sourceId: 'overture-buildings',
        sourceBbox: [-122.7, 45.4, -122.5, 45.6],
        spatialRelation: 'intersects',
        targetId: 'overture-places',
      }, emitEvent);

      expect(result.error).toContain('DuckDB query failed');
    });

    it('should catch and return errors from geoparquet source query', async () => {
      (geoParquetService.queryFeaturesWithGeometry as jest.Mock).mockRejectedValue(
        new Error('Unknown GeoParquet source: invalid-source')
      );

      const result = await service.executeSpatialQuery({
        sourceId: 'invalid-source',
        sourceBbox: [-122.7, 45.4, -122.5, 45.6],
        spatialRelation: 'intersects',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
      }, emitEvent);

      expect(result.error).toContain('Unknown GeoParquet source');
    });
  });

  // --- Unit Conversion ---

  describe('unit conversion (toMiles)', () => {
    // Access private method via bracket notation
    it('should convert miles correctly', () => {
      expect((service as any).toMiles(100, 'miles')).toBe(100);
    });

    it('should convert kilometers to miles', () => {
      const miles = (service as any).toMiles(100, 'kilometers');
      expect(miles).toBeCloseTo(62.1371, 2);
    });

    it('should convert meters to miles', () => {
      const miles = (service as any).toMiles(1609.34, 'meters');
      expect(miles).toBeCloseTo(1, 1);
    });
  });

  // --- Distance limits with different units ---

  describe('distance limit enforcement across units', () => {
    it('should accept 4000 miles', async () => {
      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue([]);

      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 4000,
        distanceUnit: 'miles',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      // Passes validation — fails on no source features
      expect(result.error).toContain('No source features');
    });

    it('should accept 5000 km (~3107 miles)', async () => {
      (featureQueryService.queryFeaturesWithGeometry as jest.Mock).mockResolvedValue([]);

      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 5000,
        distanceUnit: 'kilometers',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      // 5000 km ≈ 3107 miles, under 5000 limit
      expect(result.error).toContain('No source features');
    });

    it('should reject 9000 km (~5592 miles)', async () => {
      const result = await service.executeSpatialQuery({
        sourceServiceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        spatialRelation: 'within_distance',
        distance: 9000,
        distanceUnit: 'kilometers',
        targetServiceUrl: 'https://services.arcgis.com/test/FeatureServer/1',
      }, emitEvent);

      expect(result.error).toContain('Distance too large');
    });
  });
});
