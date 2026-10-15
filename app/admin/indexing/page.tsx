'use client';

import { useState } from 'react';
import type { ArcGISOnlineSearchResult } from '@/services/arcgis.service';

type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid' | 'indexing' | 'complete';

interface ValidationResult {
  valid: boolean;
  urlType?: string;
  name?: string;
  serviceCount?: number;
  layerCount?: number;
  error?: string;
}

interface SearchResult extends ArcGISOnlineSearchResult {
  alreadyIndexed: boolean;
}

export default function IndexingPage() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ValidationState>('idle');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [result, setResult] = useState<{ indexed: number; skipped: number; errors: number } | null>(null);

  // Search & Index state
  const [searchKeywords, setSearchKeywords] = useState('');
  const [searchLocation, setSearchLocation] = useState('');
  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'results' | 'queuing' | 'queued'>('idle');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [queueResult, setQueueResult] = useState<{ queued: number; skipped: number } | null>(null);

  const handleSearch = async () => {
    if (!searchKeywords.trim()) return;

    setSearchState('searching');
    setSearchError(null);
    setSearchResults([]);
    setSelectedIds(new Set());
    setQueueResult(null);

    try {
      const response = await fetch('/api/admin/search-arcgis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: searchKeywords.trim(),
          location: searchLocation.trim() || undefined,
          num: 25,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Search failed');
      }

      const data = await response.json();
      setSearchResults(data.results);
      setSearchTotal(data.total);

      // Auto-select new (non-indexed) items
      const newIds = new Set<string>(
        data.results
          .filter((r: SearchResult) => !r.alreadyIndexed)
          .map((r: SearchResult) => r.id)
      );
      setSelectedIds(newIds);
      setSearchState('results');
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
      setSearchState('idle');
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllNew = () => {
    const newIds = new Set<string>(
      searchResults
        .filter((r) => !r.alreadyIndexed)
        .map((r) => r.id)
    );
    setSelectedIds(newIds);
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleQueueSelected = async () => {
    const items = searchResults
      .filter((r) => selectedIds.has(r.id))
      .map((r) => ({ id: r.id, title: r.title, url: r.url, type: r.type }));

    if (items.length === 0) return;

    setSearchState('queuing');

    try {
      const response = await fetch('/api/admin/search-arcgis/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Queue failed');
      }

      const data = await response.json();
      setQueueResult({ queued: data.queued, skipped: data.skipped });
      setSearchState('queued');
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to queue items');
      setSearchState('results');
    }
  };

  const formatViews = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  // --- URL Indexing handlers (existing) ---

  const handleValidate = async () => {
    if (!url.trim()) return;

    setState('validating');
    setValidation(null);
    setResult(null);

    try {
      const response = await fetch('/api/sources/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data: ValidationResult = await response.json();
      setValidation(data);
      setState(data.valid ? 'valid' : 'invalid');
    } catch {
      setValidation({ valid: false, error: 'Failed to validate URL' });
      setState('invalid');
    }
  };

  const handleIndex = async () => {
    if (!validation?.valid) return;

    setState('indexing');

    try {
      const response = await fetch('/api/admin/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), reindex: true }),
      });

      const data = await response.json();
      if (data.success) {
        setState('complete');
        setResult({ indexed: 0, skipped: 0, errors: 0 });
      } else {
        setValidation({ ...validation, error: data.error });
        setState('valid');
      }
    } catch {
      setValidation({ ...validation!, error: 'Failed to queue indexing job' });
      setState('valid');
    }
  };

  const handleReset = () => {
    setUrl('');
    setState('idle');
    setValidation(null);
    setResult(null);
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trigger Indexing</h1>

      {/* Search & Index from ArcGIS Online */}
      <section className="bg-gray-50 dark:bg-dark-bg-light rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Search &amp; Index from ArcGIS Online</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Search ArcGIS Online for datasets to index. Results are sorted by popularity.
        </p>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={searchKeywords}
              onChange={(e) => setSearchKeywords(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Keywords (e.g. streets, parcels)"
              className="flex-1 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg px-4 py-3 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-teal-light"
              disabled={searchState === 'searching' || searchState === 'queuing'}
            />
            <input
              type="text"
              value={searchLocation}
              onChange={(e) => setSearchLocation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Location (optional, e.g. New Mexico)"
              className="flex-1 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg px-4 py-3 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-teal-light"
              disabled={searchState === 'searching' || searchState === 'queuing'}
            />
            <button
              onClick={handleSearch}
              disabled={!searchKeywords.trim() || searchState === 'searching' || searchState === 'queuing'}
              className="px-6 py-3 bg-teal text-white font-medium rounded-lg hover:bg-teal-dark transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {searchState === 'searching' ? 'Searching...' : 'Search'}
            </button>
          </div>

          {searchError && (
            <div className="bg-red-950/30 border border-red-700 rounded-lg p-4">
              <div className="text-red-400">{searchError}</div>
            </div>
          )}

          {/* Results table */}
          {(searchState === 'results' || searchState === 'queuing') && searchResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllNew}
                    className="text-sm text-teal dark:text-teal-light hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    Select All New
                  </button>
                  <span className="text-gray-300 dark:text-slate-600">|</span>
                  <button
                    onClick={handleDeselectAll}
                    className="text-sm text-teal dark:text-teal-light hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    Deselect All
                  </button>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Showing {searchResults.length} of {searchTotal.toLocaleString()} results
                </div>
              </div>

              <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-100/50 dark:bg-slate-800/50">
                      <th className="w-10 px-3 py-2 text-left"></th>
                      <th className="px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-medium">Title</th>
                      <th className="px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-medium hidden md:table-cell">Type</th>
                      <th className="px-3 py-2 text-right text-gray-500 dark:text-gray-400 font-medium hidden sm:table-cell">Views</th>
                      <th className="px-3 py-2 text-center text-gray-500 dark:text-gray-400 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-b border-gray-200/50 dark:border-slate-700/50 hover:bg-gray-100/30 dark:hover:bg-slate-800/30 cursor-pointer ${
                          r.alreadyIndexed ? 'opacity-60' : ''
                        }`}
                        onClick={() => handleToggleSelect(r.id)}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(r.id)}
                            onChange={() => handleToggleSelect(r.id)}
                            className="rounded border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-teal focus:ring-teal"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-gray-900 dark:text-white font-medium">{r.title}</div>
                          {r.snippet && (
                            <div className="text-gray-500 dark:text-gray-400 text-xs mt-0.5 line-clamp-1">{r.snippet}</div>
                          )}
                          <div className="text-gray-600 dark:text-gray-400 text-xs mt-0.5">{r.owner}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap hidden md:table-cell">
                          {r.type.replace(' Service', '')}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                          {formatViews(r.numViews)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {r.alreadyIndexed ? (
                            <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-gray-400">
                              Indexed
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-emerald-900/40 text-emerald-400">
                              New
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={handleQueueSelected}
                disabled={selectedIds.size === 0 || searchState === 'queuing'}
                className="px-6 py-3 bg-coral text-white font-medium rounded-lg hover:bg-coral-dark transition-colors disabled:opacity-50"
              >
                {searchState === 'queuing'
                  ? 'Queuing...'
                  : `Queue ${selectedIds.size} Selected for Indexing`}
              </button>
            </div>
          )}

          {searchState === 'results' && searchResults.length === 0 && !searchError && (
            <div className="text-gray-500 dark:text-gray-400 text-sm">No results found. Try different keywords or remove the location filter.</div>
          )}

          {/* Queue success */}
          {searchState === 'queued' && queueResult && (
            <div className="bg-emerald-950/30 border border-emerald-700 rounded-lg p-4 space-y-2">
              <div className="text-emerald-400">
                {queueResult.queued} item{queueResult.queued !== 1 ? 's' : ''} queued for indexing
                {queueResult.skipped > 0 && ` (${queueResult.skipped} skipped — no service URL)`}
              </div>
              <div className="flex gap-3">
                <a
                  href="/admin/queue"
                  className="text-sm text-teal dark:text-teal-light hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  View Queue &rarr;
                </a>
                <button
                  onClick={() => {
                    setSearchState('idle');
                    setSearchResults([]);
                    setQueueResult(null);
                    setSearchKeywords('');
                    setSearchLocation('');
                  }}
                  className="text-sm text-teal dark:text-teal-light hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  Search Again
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Quick URL Index */}
      <section className="bg-gray-50 dark:bg-dark-bg-light rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Index a URL</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Enter an ArcGIS Server root, FeatureServer, or Hub URL to index.
        </p>

        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://gis.example.gov/arcgis/rest/services"
              className="flex-1 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg px-4 py-3 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-teal-light"
              disabled={state === 'validating' || state === 'indexing'}
            />
            <button
              onClick={handleValidate}
              disabled={!url.trim() || state === 'validating' || state === 'indexing'}
              className="px-6 py-3 bg-teal text-white font-medium rounded-lg hover:bg-teal-dark transition-colors disabled:opacity-50"
            >
              {state === 'validating' ? 'Checking...' : 'Validate'}
            </button>
          </div>

          {/* Validation result */}
          {validation && (
            <div
              className={`rounded-lg p-4 ${
                validation.valid
                  ? 'bg-emerald-950/30 border border-emerald-700'
                  : 'bg-red-950/30 border border-red-700'
              }`}
            >
              {validation.valid ? (
                <div className="space-y-3">
                  <div className="text-emerald-400">
                    {validation.urlType === 'arcgis_server' && 'ArcGIS Server'}
                    {validation.urlType === 'single_service' && 'Feature/Map Service'}
                    {validation.urlType === 'hub' && 'Open Data Hub'}
                    {validation.name && `: "${validation.name}"`}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {validation.serviceCount && `${validation.serviceCount} service(s)`}
                    {validation.layerCount && ` / ${validation.layerCount} layer(s)`}
                  </div>
                  <button
                    onClick={handleIndex}
                    disabled={state === 'indexing'}
                    className="px-4 py-2 bg-coral text-white font-medium rounded-lg hover:bg-coral-dark transition-colors disabled:opacity-50"
                  >
                    {state === 'indexing' ? 'Queuing...' : 'Queue for Indexing'}
                  </button>
                </div>
              ) : (
                <div className="text-red-400">{validation.error}</div>
              )}
            </div>
          )}

          {/* Success */}
          {state === 'complete' && (
            <div className="bg-emerald-950/30 border border-emerald-700 rounded-lg p-4">
              <div className="text-emerald-400 mb-2">Job queued successfully!</div>
              <button
                onClick={handleReset}
                className="text-sm text-teal dark:text-teal-light hover:text-gray-900 dark:hover:text-white"
              >
                Index another URL
              </button>
            </div>
          )}
        </div>
      </section>

      {/* CLI Commands Reference */}
      <section className="bg-gray-50 dark:bg-dark-bg-light rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">CLI Commands</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          For bulk indexing operations, use the CLI commands directly on the server.
        </p>

        <div className="space-y-4">
          <CommandBlock
            title="Living Atlas"
            description="Index from ArcGIS Living Atlas"
            commands={[
              'npm run index -- living-atlas --recipe',
              'npm run index -- living-atlas --query="parks"',
            ]}
          />
          <CommandBlock
            title="Custom Organizations"
            description="Index from custom organization sources"
            commands={[
              'npm run index -- custom-orgs',
              'npm run index -- custom-orgs --filter=portland',
            ]}
          />
          <CommandBlock
            title="Single URL"
            description="Index a specific URL immediately"
            commands={[
              'npm run index -- url https://gis.city.gov/arcgis/rest/services',
              'npm run index -- url https://services.arcgis.com/.../FeatureServer',
            ]}
          />
          <CommandBlock
            title="GeoParquet"
            description="Index GeoParquet sources (Overture, etc.)"
            commands={['npm run index -- geoparquet']}
          />
        </div>
      </section>
    </div>
  );
}

function CommandBlock({
  title,
  description,
  commands,
}: {
  title: string;
  description: string;
  commands: string[];
}) {
  return (
    <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-4">
      <h3 className="font-medium text-gray-900 dark:text-white">{title}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{description}</p>
      <div className="space-y-2">
        {commands.map((cmd, i) => (
          <code
            key={i}
            className="block text-sm text-teal dark:text-teal-light bg-gray-100 dark:bg-slate-800 px-3 py-2 rounded font-mono"
          >
            {cmd}
          </code>
        ))}
      </div>
    </div>
  );
}
