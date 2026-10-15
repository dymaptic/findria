'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SearchBar } from './SearchBar';
import { ParsedQueryDisplay } from './ParsedQueryDisplay';
import { DatasetCard } from './DatasetCard';
import { DatasetDetail } from './DatasetDetail';
import { Spinner } from './ui/Spinner';
import { ModeToggle } from './ModeToggle';
import { ThemeToggle } from './ThemeToggle';
import { ChatPanel } from './ChatPanel';
import { MapPanel, MapPanelRef } from './MapPanel';
import { useSearch, usePreview, useRecentSearches } from '@/lib/hooks';
import type { Dataset } from '@/types';
import type { MapAction, UIAction } from '@/types/chat';

interface SearchContainerProps {
  initialQuery?: string;
}

export function SearchContainer({ initialQuery = '' }: SearchContainerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Track current query for SearchBar (so examples update the input)
  const [currentQuery, setCurrentQuery] = useState(initialQuery);

  // Mode state: 'search' or 'ask' - initialize from URL param
  const urlMode = searchParams.get('mode');
  const [mode, setMode] = useState<'search' | 'ask'>(
    urlMode === 'ask' ? 'ask' : 'search'
  );
  const mapRef = useRef<MapPanelRef>(null);

  const {
    datasets,
    total,
    parsedQuery,
    isSearching,
    error,
    performSearch,
    clearResults,
  } = useSearch();

  const {
    previewData,
    isLoadingPreview,
    loadPreview,
    clearPreview,
  } = usePreview();

  const { addRecentSearch } = useRecentSearches();

  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  // Show map when in ask mode (including if loaded from URL)
  const [showMap, setShowMap] = useState(urlMode === 'ask');
  // Mobile map expanded state (for ask mode on small screens)
  const [mobileMapExpanded, setMobileMapExpanded] = useState(false);
  // Track current map scale for AI context
  const [mapScale, setMapScale] = useState<number | undefined>(undefined);
  // Mobile menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Landing state: Google-style centered search (no query performed yet)
  const isLanding = mode === 'search' && !currentQuery && datasets.length === 0 && !isSearching && !error;

  // Perform search on initial load if query provided
  useEffect(() => {
    if (initialQuery) {
      performSearch(initialQuery);
      addRecentSearch(initialQuery);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync state with URL on browser navigation (back/forward)
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';

    // Only update if URL query differs from current state
    if (urlQuery !== currentQuery) {
      setCurrentQuery(urlQuery);

      if (urlQuery) {
        // URL has a query - perform search
        performSearch(urlQuery);
      } else {
        // URL has no query - clear search results
        clearResults();
      }
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle search
  const handleSearch = useCallback(
    async (query: string) => {
      // Update query state (for SearchBar sync)
      setCurrentQuery(query);

      // Update URL
      const params = new URLSearchParams(searchParams.toString());
      params.set('q', query);
      router.push(`?${params.toString()}`, { scroll: false });

      // Clear selection
      setSelectedDataset(null);
      clearPreview();

      // Perform search
      await performSearch(query);
      addRecentSearch(query);
    },
    [router, searchParams, performSearch, addRecentSearch, clearPreview]
  );

  // Handle dataset selection
  const handleSelectDataset = useCallback(
    (dataset: Dataset) => {
      setSelectedDataset(dataset);

      // Prefer the search location bbox over the dataset's extent
      // This way, if user searched "buildings in portland", we show Portland, not the whole world
      const searchBbox = parsedQuery?.locationBbox;

      // Validate dataset extent as fallback
      const ext = dataset.extentBbox;
      const hasValidDatasetExtent = ext &&
        typeof ext.xmin === 'number' && !isNaN(ext.xmin) &&
        typeof ext.ymin === 'number' && !isNaN(ext.ymin) &&
        typeof ext.xmax === 'number' && !isNaN(ext.xmax) &&
        typeof ext.ymax === 'number' && !isNaN(ext.ymax) &&
        ext.xmin !== ext.xmax && ext.ymin !== ext.ymax;

      // Priority: 1) Search location, 2) Dataset extent, 3) Continental US fallback
      const bbox: [number, number, number, number] = searchBbox
        ? searchBbox
        : hasValidDatasetExtent
          ? [ext.xmin, ext.ymin, ext.xmax, ext.ymax]
          : [-125, 24, -66, 50];

      loadPreview(dataset.id, bbox);
    },
    [loadPreview, parsedQuery?.locationBbox]
  );

  // Handle close detail
  const handleCloseDetail = useCallback(() => {
    setSelectedDataset(null);
    clearPreview();
  }, [clearPreview]);

  // Handle mode change
  const handleModeChange = useCallback((newMode: 'search' | 'ask') => {
    setMode(newMode);

    // Update URL to reflect mode
    const params = new URLSearchParams(searchParams.toString());
    if (newMode === 'ask') {
      params.set('mode', 'ask');
      setShowMap(true);
    } else {
      params.delete('mode');
    }
    router.push(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // Handle map actions from chat
  const handleMapAction = useCallback((action: MapAction) => {
    if (!mapRef.current) return;

    switch (action.type) {
      case 'add_layer':
        mapRef.current.addLayer(action.features, action.style, action.label);
        setShowMap(true);
        break;
      case 'add_feature_layer':
        mapRef.current.addFeatureLayer(action.serviceUrl, action.definitionExpression, action.label, action.style, action.bbox);
        setShowMap(true);
        break;
      case 'add_geojson':
        mapRef.current.addGeoJSON(action.geojson, action.style, action.label);
        setShowMap(true);
        break;
      case 'add_marker':
        mapRef.current.addMarker(action.coordinates, action.label, action.color);
        setShowMap(true);
        break;
      case 'zoom_to_extent':
        mapRef.current.zoomToExtent(action.bbox, action.maxScale);
        setShowMap(true);
        break;
      case 'clear_layers':
        mapRef.current.clearLayers();
        break;
    }
  }, []);

  // Handle UI actions from chat
  const handleUIAction = useCallback((action: UIAction) => {
    switch (action.type) {
      case 'show_dataset_card':
        setSelectedDataset(action.dataset);
        break;
    }
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white dark:bg-dark-bg">
      {/* CTA Banner */}
      <div className="flex-shrink-0 bg-gradient-to-r from-teal/10 to-coral/10 dark:from-teal/20 dark:to-coral/20 border-b border-gray-200 dark:border-slate-700 px-4 py-2">
        <div className="max-w-6xl mx-auto flex items-center justify-center gap-2 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Want this for your own data?</span>
          <a
            href="https://www.dymaptic.com/lets-talk/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal dark:text-teal-light hover:text-coral font-medium transition-colors"
          >
            Let&apos;s talk →
          </a>
        </div>
      </div>

      {/* Header */}
      <header className={`flex-shrink-0 bg-gray-50 dark:bg-dark-bg-light border-b border-gray-200 dark:border-slate-700 px-4 ${isLanding ? 'py-3' : 'py-4 md:py-6'}`}>
        <div className="max-w-6xl mx-auto">
          <div className={`flex items-center justify-between ${isLanding ? '' : 'mb-4 md:mb-6'}`}>
            <div className="flex items-center gap-2 md:gap-3">
              <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
                Findria
              </h1>
              <span className="text-xs md:text-sm text-slate-500 dark:text-slate-400 hidden sm:inline">by</span>
              <img
                src="/images/dymaptic-logo.svg"
                alt="dymaptic"
                className="hidden sm:inline h-4 md:h-5 opacity-60"
              />
            </div>

            {/* Desktop navigation */}
            <nav className="hidden md:flex items-center gap-4">
              <ModeToggle mode={mode} onModeChange={handleModeChange} />
              <a
                href="/submit"
                className="text-sm text-slate-600 dark:text-slate-300 hover:text-teal dark:hover:text-teal-light transition-colors"
              >
                Add Data
              </a>
              <a
                href="/about"
                className="text-sm text-slate-600 dark:text-slate-300 hover:text-teal dark:hover:text-teal-light transition-colors"
              >
                About
              </a>
              <ThemeToggle />
            </nav>

            {/* Mobile navigation */}
            <div className="flex md:hidden items-center gap-2">
              <ModeToggle mode={mode} onModeChange={handleModeChange} compact />
              <ThemeToggle />
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 text-slate-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                aria-label="Menu"
                aria-expanded={mobileMenuOpen}
              >
                <svg className="w-6 h-6" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile menu dropdown */}
          {mobileMenuOpen && (
            <div className="md:hidden mb-4 pb-4 border-b border-gray-200 dark:border-slate-700">
              <div className="flex flex-col gap-3">
                <a
                  href="/submit"
                  className="text-sm text-slate-600 dark:text-slate-300 hover:text-teal dark:hover:text-teal-light transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Add Data
                </a>
                <a
                  href="/about"
                  className="text-sm text-slate-600 dark:text-slate-300 hover:text-teal dark:hover:text-teal-light transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  About
                </a>
              </div>
            </div>
          )}

          {/* Only show search bar in header when search has been performed */}
          {mode === 'search' && !isLanding && (
            <>
              <SearchBar
                initialQuery={currentQuery}
                onSearch={handleSearch}
                isSearching={isSearching}
              />

              {parsedQuery && (
                <div className="mt-4">
                  <ParsedQueryDisplay query={parsedQuery} />
                </div>
              )}
            </>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {mode === 'search' ? (
          isLanding ? (
            // Landing state: Google-style centered search
            <div className="flex-1 flex items-center justify-center px-4">
              <div className="w-full max-w-xl text-center -mt-16">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal/20 to-coral/20 dark:from-teal/30 dark:to-coral/30 flex items-center justify-center mb-6 mx-auto" aria-hidden="true">
                  <svg className="w-10 h-10 text-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
                  Discover Geospatial Data
                </h2>
                <p className="text-slate-500 dark:text-slate-400 mb-8">
                  Search across ArcGIS and Overture Maps using natural language.
                </p>

                <div className="mb-8">
                  <SearchBar
                    initialQuery=""
                    onSearch={handleSearch}
                    isSearching={isSearching}
                  />
                </div>

                <div className="flex flex-wrap justify-center gap-2">
                  {['building footprints', 'roads in Seattle', 'parks in Denver', 'water bodies'].map((example) => (
                    <button
                      key={example}
                      onClick={() => handleSearch(example)}
                      className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-full border border-gray-300 dark:border-transparent hover:bg-gray-200 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white transition-colors"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            // Results layout
            <div className="flex-1 overflow-y-auto px-4 py-8">
              <div className="max-w-4xl mx-auto">
                {/* Loading state */}
                {isSearching && (
                  <div className="flex flex-col items-center justify-center py-16" aria-live="polite">
                    <Spinner size="lg" />
                    <p className="mt-4 text-slate-500 dark:text-slate-400">Searching for datasets...</p>
                  </div>
                )}

                {/* Error state */}
                {error && !isSearching && (
                  <div className="flex flex-col items-center justify-center py-16 text-center" role="alert">
                    <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4" aria-hidden="true">
                      <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-2">Search failed</h3>
                    <p className="text-slate-500 dark:text-slate-400">{error}</p>
                  </div>
                )}

                {/* No results state */}
                {!isSearching && !error && datasets.length === 0 && currentQuery && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-slate-800 flex items-center justify-center mb-4" aria-hidden="true">
                      <svg className="w-8 h-8 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-2">No results found</h3>
                    <p className="text-slate-500 dark:text-slate-400 max-w-sm mb-4">
                      Try using different search terms or broader queries.
                    </p>
                    <a
                      href="/submit"
                      className="text-sm text-teal dark:text-teal-light hover:text-teal hover:underline transition-colors"
                    >
                      Know a data source we&apos;re missing? Add it here →
                    </a>
                  </div>
                )}

                {/* Results */}
                {!isSearching && datasets.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                        {total > 0 ? `${total} results` : `${datasets.length} results`}
                      </h2>
                    </div>

                    <div className="space-y-4">
                      {datasets.map((dataset) => (
                        <DatasetCard
                          key={dataset.id}
                          dataset={dataset}
                          isSelected={selectedDataset?.id === dataset.id}
                          onClick={() => handleSelectDataset(dataset)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          // Ask AI mode layout - split view with chat and map
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Chat panel - left side on desktop, full width on mobile */}
            <div className="flex-1 md:w-1/2 md:border-r border-gray-200 dark:border-slate-700 flex flex-col overflow-hidden">
              <ChatPanel
                onMapAction={handleMapAction}
                onUIAction={handleUIAction}
                mapScale={mapScale}
              />
            </div>

            {/* Mobile map toggle button */}
            <div className="md:hidden flex-shrink-0 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-dark-bg-light">
              <button
                onClick={() => setMobileMapExpanded(!mobileMapExpanded)}
                aria-expanded={mobileMapExpanded}
                className="w-full px-4 py-3 flex items-center justify-center gap-2 text-sm text-teal dark:text-teal-light hover:text-teal transition-colors"
              >
                <svg className="w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                {mobileMapExpanded ? 'Hide Map' : 'Show Map'}
                <svg
                  className={`w-4 h-4 transition-transform ${mobileMapExpanded ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Map panel - right side on desktop, collapsible on mobile */}
            <div className={`
              md:w-1/2 flex flex-col overflow-hidden
              ${mobileMapExpanded ? 'h-[50vh]' : 'h-0 md:h-auto'}
              transition-[height] duration-300 ease-in-out
            `}>
              {showMap ? (
                <MapPanel ref={mapRef} onScaleChange={setMapScale} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
                  <div className="text-center">
                    <svg className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    <p>Map will appear when you ask a question</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Dataset Detail Panel - only in search mode */}
      {mode === 'search' && selectedDataset && (
        <DatasetDetail
          dataset={selectedDataset}
          previewData={previewData}
          isLoadingPreview={isLoadingPreview}
          searchBbox={parsedQuery?.locationBbox || undefined}
          onClose={handleCloseDetail}
        />
      )}

      {/* Footer */}
      <footer className="flex-shrink-0 bg-white dark:bg-dark-bg text-gray-500 dark:text-gray-400 px-4 py-3 md:py-4 text-xs border-t border-gray-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-2">
          <div className="text-center md:text-left">
            <span className="hidden sm:inline">Powered by Esri | Data from Overture Maps Foundation | </span>
            <span className="sm:hidden">Powered by Esri | </span>© OpenStreetMap contributors
            <span className="text-gray-400 dark:text-gray-600 ml-2">v{process.env.NEXT_PUBLIC_BUILD_DATE}</span>
          </div>
          <div className="flex items-center gap-3 md:gap-4">
            <a href="/privacy" className="hover:text-gray-900 dark:hover:text-white transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-gray-900 dark:hover:text-white transition-colors">Terms</a>
            <a href="/cookies" className="hover:text-gray-900 dark:hover:text-white transition-colors">Cookies</a>
            <a href="https://www.dymaptic.com" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1.5">
              <span>© {new Date().getFullYear()}</span>
              <img src="/images/dymaptic-logo.svg" alt="dymaptic" className="h-3.5 opacity-60" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
