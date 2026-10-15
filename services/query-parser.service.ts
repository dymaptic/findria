import Anthropic from '@anthropic-ai/sdk';
import type { ParsedQuery } from '@/types';
import { geocodingService } from './geocoding.service';

// Lazy initialization to avoid build-time errors
let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return _client;
}

const SYSTEM_PROMPT = `You are a query parser for a geospatial data search engine.
Extract structured information from natural language queries about finding GIS/map data.

Return a JSON object with:
- topics: array of key topic words (e.g., ["buildings", "footprints"])
- location: location name if mentioned (e.g., "Portland, Oregon") or null
- dataTypes: likely geometry types (e.g., ["polygon"]) based on the topic, or empty array
- filters: any other filters mentioned as key-value pairs

IMPORTANT: Always include ALL non-stopword terms from the query in topics. Unknown words, acronyms, and organization names (e.g., "lojic", "SANDAG", "DVRPC") are likely dataset names or publisher names — always keep them as topics. Never drop a word just because you don't recognize it.

Examples:
"building footprints in Portland Oregon" ->
  {"topics": ["building", "footprints"], "location": "Portland, Oregon", "dataTypes": ["polygon"], "filters": {}}

"roads and highways near Denver" ->
  {"topics": ["roads", "highways"], "location": "Denver", "dataTypes": ["line"], "filters": {}}

"land use zoning data" ->
  {"topics": ["land use", "zoning"], "location": null, "dataTypes": ["polygon"], "filters": {}}

"recent flood zones" ->
  {"topics": ["flood", "zones"], "location": null, "dataTypes": ["polygon"], "filters": {"recency": "recent"}}

"parks in Seattle Washington" ->
  {"topics": ["parks"], "location": "Seattle, Washington", "dataTypes": ["polygon"], "filters": {}}

"addresses in manhattan" ->
  {"topics": ["addresses"], "location": "Manhattan, New York", "dataTypes": ["point"], "filters": {}}

"transportation network california" ->
  {"topics": ["transportation", "network"], "location": "California", "dataTypes": ["line"], "filters": {}}

Return ONLY valid JSON, no explanation.`;

export class QueryParserService {
  async parse(query: string): Promise<ParsedQuery> {
    try {
      const response = await getClient().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: query }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      // Strip markdown code blocks if present (Claude sometimes wraps JSON in ```json ... ```)
      let jsonText = content.text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      const parsed = JSON.parse(jsonText);

      // Geocode location if present
      let locationBbox: [number, number, number, number] | null = null;
      if (parsed.location) {
        locationBbox = await geocodingService.geocode(parsed.location);
      }

      return {
        originalQuery: query,
        topics: parsed.topics || [],
        location: parsed.location || null,
        locationBbox,
        dataTypes: parsed.dataTypes || [],
        filters: parsed.filters || {},
      };
    } catch (error) {
      console.error('Query parsing error:', error);
      // Fallback: treat entire query as topics
      return {
        originalQuery: query,
        topics: query.split(/\s+/).filter((w) => w.length > 2),
        location: null,
        locationBbox: null,
        dataTypes: [],
        filters: {},
      };
    }
  }
}

export const queryParserService = new QueryParserService();
