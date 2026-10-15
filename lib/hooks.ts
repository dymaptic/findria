'use client';

import { useState, useCallback, useEffect } from 'react';
import { search, getPreview } from './api';
import type {
  Dataset,
  ParsedQuery,
  PreviewResponse,
  SearchRequest,
} from '@/types';

interface UseSearchResult {
  datasets: Dataset[];
  total: number;
  parsedQuery: ParsedQuery | null;
  isSearching: boolean;
  error: string | null;
  performSearch: (query: string, bbox?: [number, number, number, number]) => Promise<void>;
  clearResults: () => void;
}

export function useSearch(): UseSearchResult {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [total, setTotal] = useState(0);
  const [parsedQuery, setParsedQuery] = useState<ParsedQuery | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performSearch = useCallback(
    async (query: string, bbox?: [number, number, number, number]) => {
      setIsSearching(true);
      setError(null);

      try {
        const request: SearchRequest = {
          query,
          bbox,
          limit: 50,
        };

        const result = await search(request);

        setDatasets(result.datasets);
        setTotal(result.total);
        setParsedQuery(result.query);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setDatasets([]);
        setTotal(0);
        setParsedQuery(null);
      } finally {
        setIsSearching(false);
      }
    },
    []
  );

  const clearResults = useCallback(() => {
    setDatasets([]);
    setTotal(0);
    setParsedQuery(null);
    setError(null);
  }, []);

  return {
    datasets,
    total,
    parsedQuery,
    isSearching,
    error,
    performSearch,
    clearResults,
  };
}

interface UsePreviewResult {
  previewData: PreviewResponse | null;
  isLoadingPreview: boolean;
  previewError: string | null;
  loadPreview: (
    datasetId: string,
    bbox: [number, number, number, number]
  ) => Promise<void>;
  clearPreview: () => void;
}

export function usePreview(): UsePreviewResult {
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const loadPreview = useCallback(
    async (datasetId: string, bbox: [number, number, number, number]) => {
      setIsLoadingPreview(true);
      setPreviewError(null);

      try {
        const data = await getPreview(datasetId, bbox, 100);
        setPreviewData(data);
      } catch (err) {
        setPreviewError(
          err instanceof Error ? err.message : 'Failed to load preview'
        );
        setPreviewData(null);
      } finally {
        setIsLoadingPreview(false);
      }
    },
    []
  );

  const clearPreview = useCallback(() => {
    setPreviewData(null);
    setPreviewError(null);
  }, []);

  return {
    previewData,
    isLoadingPreview,
    previewError,
    loadPreview,
    clearPreview,
  };
}

// Recent searches stored in localStorage
const RECENT_SEARCHES_KEY = 'data-librarian-recent-searches';
const MAX_RECENT_SEARCHES = 10;

export function useRecentSearches(): {
  recentSearches: string[];
  addRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
} {
  // Initialize with empty array to avoid hydration mismatch
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // Load from localStorage after hydration
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const addRecentSearch = useCallback((query: string) => {
    setRecentSearches((prev) => {
      const filtered = prev.filter((q) => q !== query);
      const updated = [query, ...filtered].slice(0, MAX_RECENT_SEARCHES);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // Ignore storage errors
    }
  }, []);

  return {
    recentSearches,
    addRecentSearch,
    clearRecentSearches,
  };
}
