'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { ChatMessage } from '@/components/ChatMessage';
import { MapPanel, MapPanelRef } from '@/components/MapPanel';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { ChatMessage as ChatMessageType, SourceDataset, MapAction } from '@/types/chat';

interface SharedConversation {
  id: string;
  question: string;
  messages: ChatMessageType[];
  sources: SourceDataset[] | null;
  createdAt: string;
}

// Map-related tools that we can replay
const MAP_TOOLS = ['add_filtered_layer', 'geocode_location', 'query_overture'];

interface SharedChatViewProps {
  id: string;
}

export function SharedChatView({ id }: SharedChatViewProps) {
  const [conversation, setConversation] = useState<SharedConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [replayComplete, setReplayComplete] = useState(false);

  const mapRef = useRef<MapPanelRef>(null);
  const hasReplayedRef = useRef(false);

  // Check if conversation has any map actions
  const hasMapActions = useCallback((conv: SharedConversation): boolean => {
    for (const message of conv.messages) {
      // New format: persisted actions array
      if (message.actions && message.actions.length > 0) {
        return true;
      }
      // Legacy format: reconstruct from contentBlocks
      if (message.contentBlocks) {
        for (const block of message.contentBlocks) {
          if (block.type === 'tool_call' && block.step.tool && MAP_TOOLS.includes(block.step.tool)) {
            return true;
          }
        }
      }
    }
    return false;
  }, []);

  // Replay a single MapAction on the map
  const replayAction = useCallback((action: MapAction) => {
    if (!mapRef.current) return;
    switch (action.type) {
      case 'add_feature_layer':
        mapRef.current.addFeatureLayer(action.serviceUrl, action.definitionExpression, action.label, action.style, action.bbox);
        break;
      case 'add_geojson':
        mapRef.current.addGeoJSON(action.geojson, action.style, action.label);
        break;
      case 'add_marker':
        mapRef.current.addMarker(action.coordinates, action.label, action.color);
        break;
      case 'zoom_to_extent':
        mapRef.current.zoomToExtent(action.bbox, action.maxScale);
        break;
      case 'add_layer':
        mapRef.current.addLayer(action.features, action.style, action.label);
        break;
      case 'clear_layers':
        mapRef.current.clearLayers();
        break;
    }
  }, []);

  // Extract and replay map actions from content blocks
  const replayMapActions = useCallback(async (conv: SharedConversation) => {
    if (!mapRef.current || hasReplayedRef.current) return;
    hasReplayedRef.current = true;

    // Primary path: replay from persisted actions array
    const mapActionTypes = new Set(['add_feature_layer', 'add_geojson', 'add_marker', 'zoom_to_extent', 'add_layer', 'clear_layers']);
    const persistedActions: MapAction[] = [];
    for (const message of conv.messages) {
      if (message.actions && message.actions.length > 0) {
        for (const action of message.actions) {
          if (mapActionTypes.has(action.type)) {
            persistedActions.push(action as MapAction);
          }
        }
      }
    }

    if (persistedActions.length > 0) {
      for (let i = 0; i < persistedActions.length; i++) {
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        try {
          replayAction(persistedActions[i]);
        } catch (err) {
          console.error('Error replaying map action:', persistedActions[i].type, err);
        }
      }
      setReplayComplete(true);
      return;
    }

    // Fallback: reconstruct from contentBlocks (old conversations without persisted actions)
    const legacyActions: Array<{ tool: string; input: Record<string, unknown>; result?: unknown }> = [];

    for (const message of conv.messages) {
      if (message.contentBlocks) {
        for (const block of message.contentBlocks) {
          if (block.type === 'tool_call' && block.step.tool && MAP_TOOLS.includes(block.step.tool)) {
            const result = block.step.result as { error?: string } | undefined;
            if (result?.error) {
              continue;
            }
            legacyActions.push({
              tool: block.step.tool,
              input: block.step.input || {},
              result: block.step.result,
            });
          }
        }
      }
    }

    for (let i = 0; i < legacyActions.length; i++) {
      const action = legacyActions[i];

      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      try {
        switch (action.tool) {
          case 'add_filtered_layer': {
            const { serviceUrl, where, label, style } = action.input as {
              serviceUrl: string;
              where: string;
              label: string;
              zoomToLocation?: string;
              style?: { color?: string; fillOpacity?: number; strokeWidth?: number };
            };
            const result = action.result as {
              featureCount?: number;
              zoomBbox?: [number, number, number, number];
              minScale?: number;
            } | undefined;
            mapRef.current.addFeatureLayer(serviceUrl, where, label, style, result?.zoomBbox);

            if (result?.zoomBbox) {
              await new Promise(resolve => setTimeout(resolve, 200));
              mapRef.current.zoomToExtent(result.zoomBbox, result.minScale);
            }
            break;
          }

          case 'geocode_location': {
            const { location, addMarker, zoomTo } = action.input as {
              location: string;
              addMarker?: boolean;
              zoomTo?: boolean;
            };
            const result = action.result as { bbox?: [number, number, number, number]; center?: [number, number] } | undefined;

            if (result) {
              if (addMarker !== false && result.center) {
                mapRef.current.addMarker(result.center, location, '#E24E42');
              }
              if (zoomTo !== false && result.bbox) {
                mapRef.current.zoomToExtent(result.bbox);
              }
            }
            break;
          }

          case 'query_overture': {
            const input = action.input as {
              dataType: string;
              location: string;
              category?: string;
              nameContains?: string;
              limit?: number;
            };

            try {
              const params = new URLSearchParams({
                dataType: input.dataType,
                location: input.location,
              });
              if (input.category) params.set('category', input.category);
              if (input.nameContains) params.set('nameContains', input.nameContains);
              if (input.limit) params.set('limit', String(input.limit));

              const response = await fetch(`/api/overture?${params.toString()}`);
              if (response.ok) {
                const data = await response.json();

                if (data.features && data.features.length > 0) {
                  const label = input.category
                    ? `Overture ${input.category} in ${input.location}`
                    : `Overture ${input.dataType} in ${input.location}`;

                  mapRef.current.addGeoJSON(data, {
                    color: '#1D809F',
                    fillOpacity: 0.4,
                  }, label);

                  if (data.bbox) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    mapRef.current.zoomToExtent(data.bbox);
                  }
                }
              }
            } catch (err) {
              console.error('Error re-querying Overture data:', err);
            }
            break;
          }
        }
      } catch (err) {
        console.error('Error replaying map action:', action.tool, err);
      }
    }

    setReplayComplete(true);
  }, [replayAction]);

  // Fetch conversation
  useEffect(() => {
    async function fetchConversation() {
      try {
        const response = await fetch(`/api/share/${id}`);
        if (!response.ok) {
          if (response.status === 404) {
            setError('Conversation not found');
          } else {
            setError('Failed to load conversation');
          }
          return;
        }
        const data = await response.json();
        setConversation(data);
      } catch {
        setError('Failed to load conversation');
      } finally {
        setLoading(false);
      }
    }

    fetchConversation();
  }, [id]);

  // Replay map actions when both conversation and map are ready
  useEffect(() => {
    if (conversation && mapReady && !hasReplayedRef.current) {
      // Small delay to ensure map is fully initialized
      const timer = setTimeout(() => {
        replayMapActions(conversation);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [conversation, mapReady, replayMapActions]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-dark-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-teal border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading conversation...</p>
        </div>
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div className="min-h-screen bg-white dark:bg-dark-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4 mx-auto">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-medium text-gray-900 dark:text-white mb-2">{error || 'Not found'}</h2>
          <p className="text-slate-500 dark:text-slate-400 mb-4">This conversation may have been deleted or the link is invalid.</p>
          <a
            href="/"
            className="inline-block px-4 py-2 bg-teal text-white rounded-lg hover:bg-teal-light transition-colors"
          >
            Go to Findria
          </a>
        </div>
      </div>
    );
  }

  const formattedDate = new Date(conversation.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const showMap = hasMapActions(conversation);

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-dark-bg">
      {/* Header */}
      <header className="flex-shrink-0 bg-gray-50 dark:bg-dark-bg-light border-b border-gray-200 dark:border-slate-700 px-4 py-3 md:py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 md:gap-3">
              <a href="/" className="text-lg md:text-xl font-bold text-gray-900 dark:text-white hover:text-teal dark:hover:text-teal-light transition-colors">
                Findria
              </a>
              <span className="text-xs md:text-sm text-slate-500 dark:text-slate-400 hidden sm:inline">by</span>
              <img
                src="/images/dymaptic-logo.svg"
                alt="dymaptic"
                className="hidden sm:inline h-4 md:h-5 opacity-60"
              />
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/?mode=ask"
                className="text-xs md:text-sm text-teal dark:text-teal-light hover:text-teal dark:hover:text-teal transition-colors"
              >
                Ask a new question
              </a>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Shared conversation notice */}
      <div className="flex-shrink-0 bg-gray-100/50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-700 px-4 py-2">
        <div className="max-w-6xl mx-auto flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span>Shared conversation from {formattedDate}</span>
        </div>
      </div>

      {/* AI Disclaimer */}
      <div className="flex-shrink-0 bg-amber-100 dark:bg-amber-900/20 border-b border-amber-300 dark:border-amber-800/30 px-4 py-2">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs text-amber-800 dark:text-amber-200/80 flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              <strong>AI-Generated Content:</strong> This response was generated by an AI assistant. Information may be incomplete or inaccurate. Always verify data from original sources before making decisions.
            </span>
          </p>
        </div>
      </div>

      {/* Main content - split view when map actions exist */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Chat messages */}
        <div className={`${showMap ? 'flex-1 md:w-1/2 md:border-r border-gray-200 dark:border-slate-700' : 'w-full'} overflow-y-auto`}>
          <div className={`${showMap ? 'max-w-none' : 'max-w-3xl mx-auto'} px-4 py-4 md:py-6`}>
            <div className="space-y-4">
              {conversation.messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
            </div>
          </div>
        </div>

        {/* Map panel - only shown if there are map actions */}
        {showMap && (
          <div className="h-[40vh] md:h-auto md:w-1/2 flex flex-col overflow-hidden relative border-t md:border-t-0 border-gray-200 dark:border-slate-700">
            <MapPanel
              ref={mapRef}
              onMapReady={() => setMapReady(true)}
            />
            {/* Replay indicator */}
            {!replayComplete && mapReady && (
              <div className="absolute top-4 left-4 bg-gray-50/90 dark:bg-dark-bg-light/90 text-sm text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-teal border-t-transparent rounded-full animate-spin" />
                <span>Loading map data...</span>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 bg-white dark:bg-dark-bg text-gray-500 dark:text-gray-400 px-4 py-4 text-xs border-t border-gray-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div>
            Powered by Esri | Data from Overture Maps Foundation | &copy; OpenStreetMap contributors
          </div>
          <div className="flex items-center gap-4">
            <a href="/privacy" className="hover:text-gray-900 dark:hover:text-white transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-gray-900 dark:hover:text-white transition-colors">Terms</a>
            <a href="/cookies" className="hover:text-gray-900 dark:hover:text-white transition-colors">Cookies</a>
            <a href="https://www.dymaptic.com" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1.5">
              <span>&copy; {new Date().getFullYear()}</span>
              <img src="/images/dymaptic-logo.svg" alt="dymaptic" className="h-3.5 opacity-60" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
