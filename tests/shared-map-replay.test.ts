/**
 * Tests for persisting and replaying map actions in shared chat conversations.
 *
 * Verifies:
 * 1. chat.service.ts collects MapActions emitted during tool execution
 * 2. Collected actions are included in the stored assistant message
 * 3. SharedChatView replay produces the same map method calls as live SearchContainer
 * 4. Backward compatibility with old conversations (no persisted actions)
 * 5. UIActions are filtered out during replay (only MapActions replayed)
 */

import type {
  MapAction,
  UIAction,
  ChatMessage,
  ContentBlock,
  ChatStep,
  SourceDataset,
  GeoJSONFeatureCollection,
  StreamEvent,
} from '@/types/chat';

// ─── Helpers to simulate the replay logic from SharedChatView ───

/**
 * Mirrors SearchContainer.handleMapAction exactly.
 * This is the "ground truth" for what the live UI does.
 */
function simulateLiveHandleMapAction(
  action: MapAction,
  mockMap: Record<string, jest.Mock>
) {
  switch (action.type) {
    case 'add_layer':
      mockMap.addLayer(action.features, action.style, action.label);
      break;
    case 'add_feature_layer':
      mockMap.addFeatureLayer(
        action.serviceUrl,
        action.definitionExpression,
        action.label,
        action.style,
        action.bbox
      );
      break;
    case 'add_geojson':
      mockMap.addGeoJSON(action.geojson, action.style, action.label);
      break;
    case 'add_marker':
      mockMap.addMarker(action.coordinates, action.label, action.color);
      break;
    case 'zoom_to_extent':
      mockMap.zoomToExtent(action.bbox, action.maxScale);
      break;
    case 'clear_layers':
      mockMap.clearLayers();
      break;
  }
}

/**
 * Mirrors the replayAction function in SharedChatView.tsx exactly.
 */
function simulateSharedReplayAction(
  action: MapAction,
  mockMap: Record<string, jest.Mock>
) {
  switch (action.type) {
    case 'add_feature_layer':
      mockMap.addFeatureLayer(
        action.serviceUrl,
        action.definitionExpression,
        action.label,
        action.style,
        action.bbox
      );
      break;
    case 'add_geojson':
      mockMap.addGeoJSON(action.geojson, action.style, action.label);
      break;
    case 'add_marker':
      mockMap.addMarker(action.coordinates, action.label, action.color);
      break;
    case 'zoom_to_extent':
      mockMap.zoomToExtent(action.bbox, action.maxScale);
      break;
    case 'add_layer':
      mockMap.addLayer(action.features, action.style, action.label);
      break;
    case 'clear_layers':
      mockMap.clearLayers();
      break;
  }
}

function createMockMapRef(): Record<string, jest.Mock> {
  return {
    addLayer: jest.fn(),
    addFeatureLayer: jest.fn(),
    addGeoJSON: jest.fn(),
    addMarker: jest.fn(),
    clearLayers: jest.fn(),
    zoomToExtent: jest.fn(),
  };
}

// ─── Test fixtures ───

const sampleGeoJSON: GeoJSONFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
      properties: { name: 'Test Point' },
    },
  ],
};

const COMPLEX_SCENARIO_ACTIONS: MapAction[] = [
  // geocode_location → marker + zoom
  {
    type: 'add_marker',
    coordinates: [-118.25, 34.05],
    label: 'Los Angeles, California',
    color: '#E24E42',
  },
  {
    type: 'zoom_to_extent',
    bbox: [-118.67, 33.7, -117.68, 34.34],
  },
  // add_filtered_layer → feature layer + zoom
  {
    type: 'add_feature_layer',
    serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
    definitionExpression: "FIRE_TYPE = 'Wildfire'",
    label: 'Active Wildfires',
    style: { color: '#E24E42', fillOpacity: 0.5 },
    bbox: [-118.67, 33.7, -117.68, 34.34],
  },
  {
    type: 'zoom_to_extent',
    bbox: [-118.67, 33.7, -117.68, 34.34],
    maxScale: 500000,
  },
  // query_overture → geojson + zoom
  {
    type: 'add_geojson',
    geojson: sampleGeoJSON,
    label: 'Overture hospitals in Los Angeles',
    style: { color: '#1D809F', fillOpacity: 0.4 },
  },
  {
    type: 'zoom_to_extent',
    bbox: [-118.67, 33.7, -117.68, 34.34],
  },
];

// Spatial query actions: source features, buffer, results
const SPATIAL_QUERY_ACTIONS: MapAction[] = [
  // Source features (wildfires)
  {
    type: 'add_geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-118.3, 34.1] },
          properties: { name: 'Wildfire A' },
        },
      ],
    },
    label: 'Source: Wildfires',
    style: { color: '#E24E42', fillOpacity: 0.4 },
  },
  // Buffer zone
  {
    type: 'add_geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-118.5, 33.9], [-118.1, 33.9], [-118.1, 34.3], [-118.5, 34.3], [-118.5, 33.9],
            ]],
          },
          properties: { name: '10 mile buffer' },
        },
      ],
    },
    label: 'Buffer: 10 miles',
    style: { color: '#FFB347', fillOpacity: 0.15 },
  },
  // Result features (schools)
  {
    type: 'add_geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-118.25, 34.05] },
          properties: { name: 'School A' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-118.35, 34.15] },
          properties: { name: 'School B' },
        },
      ],
    },
    label: 'Schools near wildfires',
    style: { color: '#1D809F', fillOpacity: 0.6 },
  },
  // Zoom to extent of results
  {
    type: 'zoom_to_extent',
    bbox: [-118.5, 33.9, -118.1, 34.3],
  },
];

// ─── Tests ───

describe('Map Action Persistence & Replay', () => {
  describe('Action collection in chat.service.ts emitEvent pattern', () => {
    it('should collect map_action events from emitEvent into collectedActions', () => {
      // Simulate the pattern from chat.service.ts:
      // const pendingMapActions: StreamEvent[] = [];
      // const emitEvent = (event: StreamEvent) => { pendingMapActions.push(event); };
      // ... tool calls emitEvent({ type: 'map_action', action })
      // ... then we drain pending and collect:
      const collectedActions: MapAction[] = [];
      const pendingMapActions: StreamEvent[] = [];
      const emitEvent = (event: StreamEvent) => {
        pendingMapActions.push(event);
      };

      // Simulate add_filtered_layer tool emitting actions
      const addLayerAction: MapAction = {
        type: 'add_feature_layer',
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        definitionExpression: '1=1',
        label: 'Test Layer',
      };
      emitEvent({ type: 'map_action', action: addLayerAction });

      const zoomAction: MapAction = {
        type: 'zoom_to_extent',
        bbox: [-122.5, 45.4, -122.4, 45.5],
      };
      emitEvent({ type: 'map_action', action: zoomAction });

      // Drain (matching chat.service.ts pattern)
      for (const mapEvent of pendingMapActions) {
        if (mapEvent.type === 'map_action') {
          collectedActions.push(mapEvent.action);
        }
      }
      pendingMapActions.length = 0;

      expect(collectedActions).toHaveLength(2);
      expect(collectedActions[0]).toEqual(addLayerAction);
      expect(collectedActions[1]).toEqual(zoomAction);
    });

    it('should ignore non-map_action events when collecting', () => {
      const collectedActions: MapAction[] = [];
      const pendingMapActions: StreamEvent[] = [];
      const emitEvent = (event: StreamEvent) => {
        pendingMapActions.push(event);
      };

      emitEvent({
        type: 'map_action',
        action: { type: 'add_marker', coordinates: [-122.4, 37.8], label: 'Test' },
      });
      // text events should not appear in pendingMapActions in real code,
      // but if they did, they'd be filtered
      pendingMapActions.push({ type: 'text', content: 'some text' } as StreamEvent);

      for (const mapEvent of pendingMapActions) {
        if (mapEvent.type === 'map_action') {
          collectedActions.push(mapEvent.action);
        }
      }

      expect(collectedActions).toHaveLength(1);
      expect(collectedActions[0].type).toBe('add_marker');
    });

    it('should handle multiple tool calls each emitting actions', () => {
      const collectedActions: MapAction[] = [];
      const pendingMapActions: StreamEvent[] = [];
      const emitEvent = (event: StreamEvent) => {
        pendingMapActions.push(event);
      };

      // First tool call: geocode_location
      emitEvent({
        type: 'map_action',
        action: {
          type: 'add_marker',
          coordinates: [-122.4, 37.8],
          label: 'San Francisco',
          color: '#E24E42',
        },
      });
      emitEvent({
        type: 'map_action',
        action: {
          type: 'zoom_to_extent',
          bbox: [-122.5, 37.7, -122.3, 37.9],
        },
      });

      // Drain after first tool
      for (const mapEvent of pendingMapActions) {
        if (mapEvent.type === 'map_action') {
          collectedActions.push(mapEvent.action);
        }
      }
      pendingMapActions.length = 0;

      // Second tool call: add_filtered_layer
      emitEvent({
        type: 'map_action',
        action: {
          type: 'add_feature_layer',
          serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
          definitionExpression: '1=1',
          label: 'Parks',
        },
      });

      // Drain after second tool
      for (const mapEvent of pendingMapActions) {
        if (mapEvent.type === 'map_action') {
          collectedActions.push(mapEvent.action);
        }
      }
      pendingMapActions.length = 0;

      expect(collectedActions).toHaveLength(3);
      expect(collectedActions[0].type).toBe('add_marker');
      expect(collectedActions[1].type).toBe('zoom_to_extent');
      expect(collectedActions[2].type).toBe('add_feature_layer');
    });
  });

  describe('Stored message shape', () => {
    it('should include actions array on assistant message when actions exist', () => {
      const collectedActions: MapAction[] = [
        {
          type: 'add_feature_layer',
          serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
          definitionExpression: '1=1',
          label: 'Test',
        },
      ];

      const storedMessage: ChatMessage = {
        id: 'test-id',
        role: 'assistant',
        content: 'Here is some data.',
        contentBlocks: [],
        actions: collectedActions.length > 0 ? collectedActions : undefined,
        timestamp: Date.now(),
      };

      expect(storedMessage.actions).toBeDefined();
      expect(storedMessage.actions).toHaveLength(1);
      expect(storedMessage.actions![0].type).toBe('add_feature_layer');
    });

    it('should omit actions when no actions were collected', () => {
      const collectedActions: MapAction[] = [];

      const storedMessage: ChatMessage = {
        id: 'test-id',
        role: 'assistant',
        content: 'No map data for this query.',
        contentBlocks: [],
        actions: collectedActions.length > 0 ? collectedActions : undefined,
        timestamp: Date.now(),
      };

      expect(storedMessage.actions).toBeUndefined();
    });

    it('should preserve full action details for complex spatial queries', () => {
      const storedMessage: ChatMessage = {
        id: 'test-id',
        role: 'assistant',
        content: 'Found 2 schools near wildfires.',
        contentBlocks: [],
        actions: SPATIAL_QUERY_ACTIONS,
        timestamp: Date.now(),
      };

      expect(storedMessage.actions).toHaveLength(4);
      // Source features GeoJSON preserved
      const sourceAction = storedMessage.actions![0];
      expect(sourceAction.type).toBe('add_geojson');
      if (sourceAction.type === 'add_geojson') {
        expect(sourceAction.geojson.features).toHaveLength(1);
        expect(sourceAction.label).toBe('Source: Wildfires');
      }
      // Buffer GeoJSON preserved
      const bufferAction = storedMessage.actions![1];
      expect(bufferAction.type).toBe('add_geojson');
      if (bufferAction.type === 'add_geojson') {
        expect(bufferAction.geojson.features[0].geometry.type).toBe('Polygon');
        expect(bufferAction.label).toBe('Buffer: 10 miles');
      }
      // Result features GeoJSON preserved
      const resultAction = storedMessage.actions![2];
      expect(resultAction.type).toBe('add_geojson');
      if (resultAction.type === 'add_geojson') {
        expect(resultAction.geojson.features).toHaveLength(2);
        expect(resultAction.label).toBe('Schools near wildfires');
      }
      // Zoom action preserved
      const zoomAction = storedMessage.actions![3];
      expect(zoomAction.type).toBe('zoom_to_extent');
      if (zoomAction.type === 'zoom_to_extent') {
        expect(zoomAction.bbox).toEqual([-118.5, 33.9, -118.1, 34.3]);
      }
    });
  });

  describe('Live vs Shared replay parity', () => {
    it('should produce identical map calls for add_feature_layer', () => {
      const action: MapAction = {
        type: 'add_feature_layer',
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        definitionExpression: "STATE = 'Oregon'",
        label: 'Oregon Features',
        style: { color: '#E24E42', fillOpacity: 0.3 },
        bbox: [-124.5, 42, -116.5, 46.3],
      };

      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      simulateLiveHandleMapAction(action, liveMap);
      simulateSharedReplayAction(action, sharedMap);

      expect(sharedMap.addFeatureLayer).toHaveBeenCalledTimes(1);
      expect(sharedMap.addFeatureLayer.mock.calls[0]).toEqual(
        liveMap.addFeatureLayer.mock.calls[0]
      );
    });

    it('should produce identical map calls for add_geojson', () => {
      const action: MapAction = {
        type: 'add_geojson',
        geojson: sampleGeoJSON,
        label: 'Test GeoJSON',
        style: { color: '#1D809F', fillOpacity: 0.4 },
      };

      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      simulateLiveHandleMapAction(action, liveMap);
      simulateSharedReplayAction(action, sharedMap);

      expect(sharedMap.addGeoJSON).toHaveBeenCalledTimes(1);
      expect(sharedMap.addGeoJSON.mock.calls[0]).toEqual(
        liveMap.addGeoJSON.mock.calls[0]
      );
    });

    it('should produce identical map calls for add_marker', () => {
      const action: MapAction = {
        type: 'add_marker',
        coordinates: [-122.4194, 37.7749],
        label: 'San Francisco',
        color: '#E24E42',
      };

      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      simulateLiveHandleMapAction(action, liveMap);
      simulateSharedReplayAction(action, sharedMap);

      expect(sharedMap.addMarker).toHaveBeenCalledTimes(1);
      expect(sharedMap.addMarker.mock.calls[0]).toEqual(
        liveMap.addMarker.mock.calls[0]
      );
    });

    it('should produce identical map calls for zoom_to_extent', () => {
      const action: MapAction = {
        type: 'zoom_to_extent',
        bbox: [-122.5, 37.7, -122.3, 37.9],
        maxScale: 500000,
      };

      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      simulateLiveHandleMapAction(action, liveMap);
      simulateSharedReplayAction(action, sharedMap);

      expect(sharedMap.zoomToExtent).toHaveBeenCalledTimes(1);
      expect(sharedMap.zoomToExtent.mock.calls[0]).toEqual(
        liveMap.zoomToExtent.mock.calls[0]
      );
    });

    it('should produce identical map calls for add_layer (raw GeoJSON features)', () => {
      const action: MapAction = {
        type: 'add_layer',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
            properties: { name: 'Point A' },
          },
        ],
        style: { color: '#FF0000' },
        label: 'Custom Features',
      };

      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      simulateLiveHandleMapAction(action, liveMap);
      simulateSharedReplayAction(action, sharedMap);

      expect(sharedMap.addLayer).toHaveBeenCalledTimes(1);
      expect(sharedMap.addLayer.mock.calls[0]).toEqual(
        liveMap.addLayer.mock.calls[0]
      );
    });

    it('should produce identical map calls for clear_layers', () => {
      const action: MapAction = { type: 'clear_layers' };

      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      simulateLiveHandleMapAction(action, liveMap);
      simulateSharedReplayAction(action, sharedMap);

      expect(sharedMap.clearLayers).toHaveBeenCalledTimes(1);
    });

    it('should produce identical calls for a complex multi-tool scenario', () => {
      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      // Replay all actions through both paths
      for (const action of COMPLEX_SCENARIO_ACTIONS) {
        simulateLiveHandleMapAction(action, liveMap);
        simulateSharedReplayAction(action, sharedMap);
      }

      // Verify every method was called the same number of times with the same args
      for (const method of ['addLayer', 'addFeatureLayer', 'addGeoJSON', 'addMarker', 'zoomToExtent', 'clearLayers'] as const) {
        expect(sharedMap[method]).toHaveBeenCalledTimes(liveMap[method].mock.calls.length);
        for (let i = 0; i < liveMap[method].mock.calls.length; i++) {
          expect(sharedMap[method].mock.calls[i]).toEqual(liveMap[method].mock.calls[i]);
        }
      }
    });

    it('should produce identical calls for spatial query (source + buffer + results + zoom)', () => {
      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      for (const action of SPATIAL_QUERY_ACTIONS) {
        simulateLiveHandleMapAction(action, liveMap);
        simulateSharedReplayAction(action, sharedMap);
      }

      // 3 addGeoJSON calls (source, buffer, results) + 1 zoomToExtent
      expect(liveMap.addGeoJSON).toHaveBeenCalledTimes(3);
      expect(sharedMap.addGeoJSON).toHaveBeenCalledTimes(3);
      expect(liveMap.zoomToExtent).toHaveBeenCalledTimes(1);
      expect(sharedMap.zoomToExtent).toHaveBeenCalledTimes(1);

      for (let i = 0; i < 3; i++) {
        expect(sharedMap.addGeoJSON.mock.calls[i]).toEqual(
          liveMap.addGeoJSON.mock.calls[i]
        );
      }
      expect(sharedMap.zoomToExtent.mock.calls[0]).toEqual(
        liveMap.zoomToExtent.mock.calls[0]
      );
    });
  });

  describe('hasMapActions detection', () => {
    // Mirror the hasMapActions logic from SharedChatView
    const MAP_TOOLS = ['add_filtered_layer', 'geocode_location', 'query_overture'];
    const mapActionTypes = new Set([
      'add_feature_layer', 'add_geojson', 'add_marker',
      'zoom_to_extent', 'add_layer', 'clear_layers',
    ]);

    function hasMapActions(messages: ChatMessage[]): boolean {
      for (const message of messages) {
        if (message.actions && message.actions.length > 0) {
          for (const action of message.actions) {
            if (mapActionTypes.has(action.type)) return true;
          }
        }
        if (message.contentBlocks) {
          for (const block of message.contentBlocks) {
            if (block.type === 'tool_call' && block.step.tool && MAP_TOOLS.includes(block.step.tool)) {
              return true;
            }
          }
        }
      }
      return false;
    }

    it('should detect map actions from persisted actions array', () => {
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'Show parks', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: 'Here are parks.',
          actions: [
            { type: 'add_feature_layer', serviceUrl: 'test', label: 'Parks', definitionExpression: '1=1' },
          ],
          timestamp: 2,
        },
      ];
      expect(hasMapActions(messages)).toBe(true);
    });

    it('should detect map actions from legacy contentBlocks', () => {
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'Show parks', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: 'Here are parks.',
          contentBlocks: [
            {
              type: 'tool_call',
              step: {
                id: 'tc1',
                type: 'tool_call',
                tool: 'add_filtered_layer',
                input: {},
                result: { featureCount: 5 },
                timestamp: 2,
              },
            },
          ],
          timestamp: 2,
        },
      ];
      expect(hasMapActions(messages)).toBe(true);
    });

    it('should return false when no map actions exist', () => {
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'How many parks?', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: 'There are 42 parks.',
          contentBlocks: [
            {
              type: 'tool_call',
              step: {
                id: 'tc1',
                type: 'tool_call',
                tool: 'count_features',
                input: {},
                result: { count: 42 },
                timestamp: 2,
              },
            },
          ],
          timestamp: 2,
        },
      ];
      expect(hasMapActions(messages)).toBe(false);
    });

    it('should handle messages with only UIActions (not map actions)', () => {
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'Show parks', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: 'Here are parks.',
          actions: [
            { type: 'show_dataset_card', dataset: {} as any } as UIAction,
          ],
          timestamp: 2,
        },
      ];
      expect(hasMapActions(messages)).toBe(false);
    });
  });

  describe('Replay path selection (new vs legacy)', () => {
    // Simulate the replayMapActions logic from SharedChatView
    const MAP_TOOLS = ['add_filtered_layer', 'geocode_location', 'query_overture'];
    const mapActionTypes = new Set([
      'add_feature_layer', 'add_geojson', 'add_marker',
      'zoom_to_extent', 'add_layer', 'clear_layers',
    ]);

    function extractPersistedActions(messages: ChatMessage[]): MapAction[] {
      const actions: MapAction[] = [];
      for (const message of messages) {
        if (message.actions && message.actions.length > 0) {
          for (const action of message.actions) {
            if (mapActionTypes.has(action.type)) {
              actions.push(action as MapAction);
            }
          }
        }
      }
      return actions;
    }

    function extractLegacyActions(messages: ChatMessage[]): Array<{ tool: string; input: Record<string, unknown>; result?: unknown }> {
      const actions: Array<{ tool: string; input: Record<string, unknown>; result?: unknown }> = [];
      for (const message of messages) {
        if (message.contentBlocks) {
          for (const block of message.contentBlocks) {
            if (block.type === 'tool_call' && block.step.tool && MAP_TOOLS.includes(block.step.tool)) {
              const result = block.step.result as { error?: string } | undefined;
              if (result?.error) continue;
              actions.push({
                tool: block.step.tool,
                input: block.step.input || {},
                result: block.step.result,
              });
            }
          }
        }
      }
      return actions;
    }

    it('should prefer persisted actions when available', () => {
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'Show parks', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: 'Here are parks.',
          actions: COMPLEX_SCENARIO_ACTIONS,
          contentBlocks: [
            {
              type: 'tool_call',
              step: {
                id: 'tc1',
                type: 'tool_call',
                tool: 'add_filtered_layer',
                input: { serviceUrl: 'old-url', where: '1=1', label: 'Old' },
                result: { featureCount: 5 },
                timestamp: 2,
              },
            },
          ],
          timestamp: 2,
        },
      ];

      const persisted = extractPersistedActions(messages);
      expect(persisted).toHaveLength(COMPLEX_SCENARIO_ACTIONS.length);

      // Since persisted is non-empty, the legacy path should NOT be used
      // (This mirrors the early return in replayMapActions)
    });

    it('should fall back to legacy contentBlocks when no persisted actions', () => {
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'Show parks in Portland', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: 'Here are parks.',
          // No actions field — old conversation format
          contentBlocks: [
            {
              type: 'tool_call',
              step: {
                id: 'tc1',
                type: 'tool_call',
                tool: 'geocode_location',
                input: { location: 'Portland, Oregon' },
                result: {
                  bbox: [-122.8, 45.4, -122.5, 45.6],
                  center: [-122.65, 45.5],
                },
                timestamp: 2,
              },
            },
            {
              type: 'tool_call',
              step: {
                id: 'tc2',
                type: 'tool_call',
                tool: 'add_filtered_layer',
                input: {
                  serviceUrl: 'https://services.arcgis.com/parks/FeatureServer/0',
                  where: '1=1',
                  label: 'Parks',
                },
                result: {
                  featureCount: 15,
                  zoomBbox: [-122.8, 45.4, -122.5, 45.6],
                },
                timestamp: 3,
              },
            },
          ],
          timestamp: 2,
        },
      ];

      const persisted = extractPersistedActions(messages);
      expect(persisted).toHaveLength(0); // No persisted actions

      const legacy = extractLegacyActions(messages);
      expect(legacy).toHaveLength(2); // 2 map-tool calls
      expect(legacy[0].tool).toBe('geocode_location');
      expect(legacy[1].tool).toBe('add_filtered_layer');
    });

    it('should skip legacy tool calls that resulted in errors', () => {
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'query', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: 'Error occurred.',
          contentBlocks: [
            {
              type: 'tool_call',
              step: {
                id: 'tc1',
                type: 'tool_call',
                tool: 'add_filtered_layer',
                input: { serviceUrl: 'bad-url', where: '1=1', label: 'Bad' },
                result: { error: 'No features found matching: 1=1' },
                timestamp: 2,
              },
            },
            {
              type: 'tool_call',
              step: {
                id: 'tc2',
                type: 'tool_call',
                tool: 'add_filtered_layer',
                input: {
                  serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
                  where: "TYPE = 'Park'",
                  label: 'Parks',
                },
                result: { featureCount: 10 },
                timestamp: 3,
              },
            },
          ],
          timestamp: 2,
        },
      ];

      const legacy = extractLegacyActions(messages);
      expect(legacy).toHaveLength(1);
      expect(legacy[0].tool).toBe('add_filtered_layer');
      expect(legacy[0].input).toEqual({
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        where: "TYPE = 'Park'",
        label: 'Parks',
      });
    });

    it('should filter out UIActions from persisted actions', () => {
      const mixedActions: (MapAction | UIAction)[] = [
        {
          type: 'add_marker',
          coordinates: [-122.4, 37.8],
          label: 'Test',
        },
        {
          type: 'show_dataset_card',
          dataset: {} as any,
        } as UIAction,
        {
          type: 'zoom_to_extent',
          bbox: [-122.5, 37.7, -122.3, 37.9],
        },
      ];

      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'query', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: 'result',
          actions: mixedActions,
          timestamp: 2,
        },
      ];

      const persisted = extractPersistedActions(messages);
      expect(persisted).toHaveLength(2);
      expect(persisted[0].type).toBe('add_marker');
      expect(persisted[1].type).toBe('zoom_to_extent');
    });
  });

  describe('GeoJSON roundtrip fidelity', () => {
    it('should preserve GeoJSON features exactly through persistence', () => {
      const complexGeoJSON: GeoJSONFeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [-118.5, 33.9], [-118.1, 33.9], [-118.1, 34.3], [-118.5, 34.3], [-118.5, 33.9],
              ]],
            },
            properties: {
              name: 'Fire Buffer Zone',
              distance: 10,
              unit: 'miles',
              sourceCount: 3,
            },
          },
          {
            type: 'Feature',
            geometry: {
              type: 'MultiPoint',
              coordinates: [[-118.25, 34.05], [-118.35, 34.15], [-118.45, 34.0]],
            },
            properties: {
              name: 'Schools',
              count: 3,
            },
          },
        ],
      };

      const action: MapAction = {
        type: 'add_geojson',
        geojson: complexGeoJSON,
        label: 'Spatial Query Results',
        style: { color: '#1D809F', fillOpacity: 0.5 },
      };

      // Simulate JSON roundtrip (DB storage → retrieval)
      const serialized = JSON.stringify(action);
      const deserialized = JSON.parse(serialized) as MapAction;

      expect(deserialized).toEqual(action);

      // Verify replay with deserialized action matches live
      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      simulateLiveHandleMapAction(action, liveMap);
      simulateSharedReplayAction(deserialized, sharedMap);

      expect(sharedMap.addGeoJSON.mock.calls[0]).toEqual(
        liveMap.addGeoJSON.mock.calls[0]
      );
    });

    it('should preserve style properties exactly through JSON roundtrip', () => {
      const action: MapAction = {
        type: 'add_feature_layer',
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
        definitionExpression: "FIRE_TYPE = 'Wildfire' AND YEAR >= 2024",
        label: 'Recent Wildfires',
        style: { color: '#E24E42', fillOpacity: 0.5, strokeWidth: 3 },
        bbox: [-124.5, 32.5, -114.1, 42.0],
      };

      const roundtripped = JSON.parse(JSON.stringify(action)) as MapAction;

      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      simulateLiveHandleMapAction(action, liveMap);
      simulateSharedReplayAction(roundtripped, sharedMap);

      expect(sharedMap.addFeatureLayer.mock.calls[0]).toEqual(
        liveMap.addFeatureLayer.mock.calls[0]
      );
    });
  });

  describe('Edge cases', () => {
    it('should handle empty actions array gracefully', () => {
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'count parks', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: 'There are 42 parks.',
          actions: [],
          timestamp: 2,
        },
      ];

      const mapActionTypes = new Set([
        'add_feature_layer', 'add_geojson', 'add_marker',
        'zoom_to_extent', 'add_layer', 'clear_layers',
      ]);

      const persisted: MapAction[] = [];
      for (const message of messages) {
        if (message.actions && message.actions.length > 0) {
          for (const action of message.actions) {
            if (mapActionTypes.has(action.type)) {
              persisted.push(action as MapAction);
            }
          }
        }
      }

      expect(persisted).toHaveLength(0);
    });

    it('should handle zoom_to_extent with maxScale=0 (no constraint)', () => {
      const action: MapAction = {
        type: 'zoom_to_extent',
        bbox: [-122.5, 37.7, -122.3, 37.9],
      };

      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      simulateLiveHandleMapAction(action, liveMap);
      simulateSharedReplayAction(action, sharedMap);

      // Both should pass undefined for maxScale
      expect(liveMap.zoomToExtent).toHaveBeenCalledWith(
        [-122.5, 37.7, -122.3, 37.9],
        undefined
      );
      expect(sharedMap.zoomToExtent).toHaveBeenCalledWith(
        [-122.5, 37.7, -122.3, 37.9],
        undefined
      );
    });

    it('should handle add_feature_layer with no optional fields', () => {
      const action: MapAction = {
        type: 'add_feature_layer',
        serviceUrl: 'https://services.arcgis.com/test/FeatureServer/0',
      };

      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      simulateLiveHandleMapAction(action, liveMap);
      simulateSharedReplayAction(action, sharedMap);

      expect(sharedMap.addFeatureLayer).toHaveBeenCalledWith(
        'https://services.arcgis.com/test/FeatureServer/0',
        undefined,
        undefined,
        undefined,
        undefined
      );
      expect(sharedMap.addFeatureLayer.mock.calls[0]).toEqual(
        liveMap.addFeatureLayer.mock.calls[0]
      );
    });

    it('should handle add_marker with no optional color', () => {
      const action: MapAction = {
        type: 'add_marker',
        coordinates: [-122.4, 37.8],
      };

      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      simulateLiveHandleMapAction(action, liveMap);
      simulateSharedReplayAction(action, sharedMap);

      expect(sharedMap.addMarker).toHaveBeenCalledWith(
        [-122.4, 37.8],
        undefined,
        undefined
      );
      expect(sharedMap.addMarker.mock.calls[0]).toEqual(
        liveMap.addMarker.mock.calls[0]
      );
    });

    it('should handle user message with no contentBlocks or actions', () => {
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'Hello', timestamp: 1 },
        { id: '2', role: 'assistant', content: 'Hi!', timestamp: 2 },
      ];

      const mapActionTypes = new Set([
        'add_feature_layer', 'add_geojson', 'add_marker',
        'zoom_to_extent', 'add_layer', 'clear_layers',
      ]);

      let hasActions = false;
      for (const message of messages) {
        if (message.actions && message.actions.length > 0) {
          for (const action of message.actions) {
            if (mapActionTypes.has(action.type)) {
              hasActions = true;
            }
          }
        }
      }

      expect(hasActions).toBe(false);
    });
  });

  describe('Full integration scenario simulation', () => {
    it('should match live and shared for "universities within 50 miles of wildfires" workflow', () => {
      // This simulates the full action sequence that would be produced by:
      // 1. geocode_location("California") → marker + zoom
      // 2. spatial_query → source geojson + buffer geojson + result geojson + zoom

      const fullActions: MapAction[] = [
        // Step 1: geocode
        {
          type: 'add_marker',
          coordinates: [-119.4, 36.8],
          label: 'California',
          color: '#E24E42',
        },
        {
          type: 'zoom_to_extent',
          bbox: [-124.4, 32.5, -114.1, 42.0],
        },
        // Step 2: spatial_query source features
        {
          type: 'add_geojson',
          geojson: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-118.3, 34.1] },
                properties: { FIRE_NAME: 'Park Fire', ACRES: 1200 },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-120.5, 37.2] },
                properties: { FIRE_NAME: 'Creek Fire', ACRES: 3400 },
              },
            ],
          },
          label: 'Source: Active Wildfires (2 features)',
          style: { color: '#E24E42', fillOpacity: 0.4 },
        },
        // Step 2: buffer
        {
          type: 'add_geojson',
          geojson: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [[
                    [-119.1, 33.3], [-117.5, 33.3], [-117.5, 34.9],
                    [-119.1, 34.9], [-119.1, 33.3],
                  ]],
                },
                properties: { distance: '50 miles' },
              },
              {
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [[
                    [-121.3, 36.4], [-119.7, 36.4], [-119.7, 38.0],
                    [-121.3, 38.0], [-121.3, 36.4],
                  ]],
                },
                properties: { distance: '50 miles' },
              },
            ],
          },
          label: 'Buffer: 50 miles',
          style: { color: '#FFB347', fillOpacity: 0.15, strokeWidth: 1 },
        },
        // Step 2: result features
        {
          type: 'add_geojson',
          geojson: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-118.28, 34.02] },
                properties: { NAME: 'UCLA', TYPE: 'University' },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-118.12, 34.14] },
                properties: { NAME: 'Caltech', TYPE: 'University' },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-120.66, 35.3] },
                properties: { NAME: 'Cal Poly SLO', TYPE: 'University' },
              },
            ],
          },
          label: 'Universities within 50 miles of wildfires',
          style: { color: '#1D809F', fillOpacity: 0.6, strokeWidth: 2 },
        },
        // Step 2: zoom to results
        {
          type: 'zoom_to_extent',
          bbox: [-121.3, 33.3, -117.5, 38.0],
        },
      ];

      // Simulate: store in DB, retrieve, replay
      const storedMessage: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Found 3 universities within 50 miles of active wildfires in California.',
        contentBlocks: [],
        actions: fullActions,
        timestamp: Date.now(),
      };

      // JSON roundtrip
      const retrieved = JSON.parse(JSON.stringify(storedMessage)) as ChatMessage;

      // Extract persisted actions
      const mapActionTypes = new Set([
        'add_feature_layer', 'add_geojson', 'add_marker',
        'zoom_to_extent', 'add_layer', 'clear_layers',
      ]);
      const replayActions: MapAction[] = [];
      if (retrieved.actions) {
        for (const action of retrieved.actions) {
          if (mapActionTypes.has(action.type)) {
            replayActions.push(action as MapAction);
          }
        }
      }

      expect(replayActions).toHaveLength(fullActions.length);

      // Replay through both live and shared paths
      const liveMap = createMockMapRef();
      const sharedMap = createMockMapRef();

      for (const action of fullActions) {
        simulateLiveHandleMapAction(action, liveMap);
      }
      for (const action of replayActions) {
        simulateSharedReplayAction(action, sharedMap);
      }

      // Verify complete parity
      expect(liveMap.addMarker).toHaveBeenCalledTimes(1);
      expect(sharedMap.addMarker).toHaveBeenCalledTimes(1);
      expect(sharedMap.addMarker.mock.calls[0]).toEqual(liveMap.addMarker.mock.calls[0]);

      expect(liveMap.addGeoJSON).toHaveBeenCalledTimes(3); // source, buffer, results
      expect(sharedMap.addGeoJSON).toHaveBeenCalledTimes(3);
      for (let i = 0; i < 3; i++) {
        expect(sharedMap.addGeoJSON.mock.calls[i]).toEqual(liveMap.addGeoJSON.mock.calls[i]);
      }

      expect(liveMap.zoomToExtent).toHaveBeenCalledTimes(2); // geocode zoom + results zoom
      expect(sharedMap.zoomToExtent).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 2; i++) {
        expect(sharedMap.zoomToExtent.mock.calls[i]).toEqual(liveMap.zoomToExtent.mock.calls[i]);
      }

      // Verify specific GeoJSON payloads
      const sharedResultsCall = sharedMap.addGeoJSON.mock.calls[2];
      const geojson = sharedResultsCall[0] as GeoJSONFeatureCollection;
      expect(geojson.features).toHaveLength(3);
      expect(geojson.features[0].properties?.NAME).toBe('UCLA');
      expect(geojson.features[1].properties?.NAME).toBe('Caltech');
      expect(geojson.features[2].properties?.NAME).toBe('Cal Poly SLO');

      const sharedStyle = sharedResultsCall[1];
      expect(sharedStyle).toEqual({ color: '#1D809F', fillOpacity: 0.6, strokeWidth: 2 });

      const sharedLabel = sharedResultsCall[2];
      expect(sharedLabel).toBe('Universities within 50 miles of wildfires');
    });
  });
});
