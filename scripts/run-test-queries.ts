/**
 * Automated test script for Data Librarian search queries
 * Run with: npx tsx scripts/run-test-queries.ts
 */

import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_HEADERS = { 'Content-Type': 'application/json', 'Origin': BASE_URL };

interface SearchResult {
  query: string;
  resultCount: number;
  sources: string[];
  topResults: string[];
  duration: number;
  error?: string;
}

interface ChatResult {
  question: string;
  success: boolean;
  response: string;
  toolsCalled: string[];
  duration: number;
  error?: string;
}

// Search queries to test
const SEARCH_QUERIES = [
  // Building Data
  'buildings',
  'building footprints',
  'buildings in New York City',
  'buildings in Los Angeles',
  'buildings in Chicago',
  'buildings in San Francisco',
  'buildings in Seattle',
  'buildings in Denver',
  'buildings in Portland',
  'commercial buildings',

  // Transportation
  'roads',
  'highways',
  'roads in California',
  'roads in Texas',
  'streets in Manhattan',
  'railroads',
  'airports',
  'transit routes',
  'bike lanes',
  'traffic data',

  // Water Features
  'water',
  'rivers',
  'lakes',
  'streams',
  'oceans',
  'watersheds',
  'wetlands',
  'water bodies in Colorado',
  'rivers in Oregon',
  'coastal areas',

  // Parks & Recreation
  'parks',
  'national parks',
  'state parks',
  'parks in Denver',
  'parks in Seattle',
  'recreation areas',
  'trails',
  'hiking trails',
  'campgrounds',
  'open spaces',

  // Boundaries
  'boundaries',
  'county boundaries',
  'state boundaries',
  'zip codes',
  'census tracts',
  'congressional districts',
  'school districts',
  'city limits',
  'neighborhoods',
  'voting precincts',

  // Points of Interest
  'hospitals',
  'schools',
  'fire stations',
  'police stations',
  'restaurants',
  'hotels',
  'gas stations',
  'grocery stores',
  'banks',
  'places in Portland',
];

// AI questions to test
const AI_QUESTIONS = [
  // Zoom requests
  'zoom to Denver, CO',
  'zoom to Seattle, WA',
  'zoom to New York City',
  'zoom to San Francisco',
  'zoom to Chicago',

  // Data discovery
  'What data is available for Denver?',
  'What building data exists?',
  'Show me what datasets cover Seattle',
  'What transportation data is available?',
  'Find water-related datasets',

  // Visualization
  'Show me parks in Denver on the map',
  'Display buildings in downtown Seattle',
  'Visualize roads in Portland',
  'Show county boundaries in Oregon',

  // Counting
  'How many counties are in Oregon?',
  'How many counties are in Colorado?',
  'How many parks are in Denver?',

  // Complex
  'Find parks in Denver and show them on the map',
  'Search for buildings in Seattle and zoom there',

  // Edge cases
  'clear the map',
  'What is this tool?',
];

async function testSearch(query: string): Promise<SearchResult> {
  const start = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/api/search`, {
      method: 'POST',
      headers: TEST_HEADERS,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const duration = Date.now() - start;

    const sources = [...new Set(data.datasets?.map((d: { source: string }) => d.source) || [])] as string[];
    const topResults = data.datasets?.slice(0, 3).map((d: { title: string }) => d.title) as string[] || [];

    return {
      query,
      resultCount: data.datasets?.length || 0,
      sources,
      topResults,
      duration,
    };
  } catch (error) {
    return {
      query,
      resultCount: 0,
      sources: [],
      topResults: [],
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function testChat(question: string): Promise<ChatResult> {
  const start = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: TEST_HEADERS,
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Read streaming response
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullResponse = '';
    const toolsCalled: string[] = [];
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'text') {
            fullResponse += event.content;
          } else if (event.type === 'tool_call') {
            toolsCalled.push(event.tool);
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    return {
      question,
      success: true,
      response: fullResponse.slice(0, 200) + (fullResponse.length > 200 ? '...' : ''),
      toolsCalled: [...new Set(toolsCalled)],
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      question,
      success: false,
      response: '',
      toolsCalled: [],
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('DATA LIBRARIAN TEST SUITE');
  console.log('='.repeat(80));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log();

  // Test searches
  console.log('SEARCH TESTS');
  console.log('-'.repeat(80));

  const searchResults: SearchResult[] = [];
  let searchPass = 0;
  let searchFail = 0;
  let searchNoData = 0;

  for (const query of SEARCH_QUERIES) {
    const result = await testSearch(query);
    searchResults.push(result);

    const status = result.error ? 'ERROR' : result.resultCount > 0 ? 'PASS' : 'NO DATA';
    if (result.error) searchFail++;
    else if (result.resultCount > 0) searchPass++;
    else searchNoData++;

    console.log(`[${status.padEnd(7)}] "${query}" => ${result.resultCount} results (${result.duration}ms)`);
    if (result.sources.length > 0) {
      console.log(`          Sources: ${result.sources.join(', ')}`);
    }
    if (result.error) {
      console.log(`          Error: ${result.error}`);
    }
  }

  console.log();
  console.log(`Search Summary: ${searchPass} pass, ${searchNoData} no data, ${searchFail} errors`);
  console.log();

  // Test AI chat
  console.log('AI CHAT TESTS');
  console.log('-'.repeat(80));

  const chatResults: ChatResult[] = [];
  let chatPass = 0;
  let chatFail = 0;

  for (const question of AI_QUESTIONS) {
    const result = await testChat(question);
    chatResults.push(result);

    const status = result.success ? 'PASS' : 'FAIL';
    if (result.success) chatPass++;
    else chatFail++;

    console.log(`[${status.padEnd(7)}] "${question}" (${result.duration}ms)`);
    if (result.toolsCalled.length > 0) {
      console.log(`          Tools: ${result.toolsCalled.join(', ')}`);
    }
    if (result.error) {
      console.log(`          Error: ${result.error}`);
    }
  }

  console.log();
  console.log(`Chat Summary: ${chatPass} pass, ${chatFail} fail`);
  console.log();

  // Generate summary report
  console.log('='.repeat(80));
  console.log('SUMMARY REPORT');
  console.log('='.repeat(80));

  console.log('\nQueries with NO DATA (potential indexing gaps):');
  const noDataQueries = searchResults.filter(r => !r.error && r.resultCount === 0);
  for (const r of noDataQueries) {
    console.log(`  - "${r.query}"`);
  }

  console.log('\nQueries with ERRORS:');
  const errorQueries = [...searchResults.filter(r => r.error), ...chatResults.filter(r => !r.success)];
  for (const r of errorQueries) {
    console.log(`  - "${'query' in r ? r.query : r.question}": ${r.error}`);
  }

  console.log('\nData sources found:');
  const allSources = new Set(searchResults.flatMap(r => r.sources));
  for (const source of allSources) {
    const count = searchResults.filter(r => r.sources.includes(source)).length;
    console.log(`  - ${source}: ${count} queries`);
  }

  console.log('\nTools used by AI:');
  const allTools = new Set(chatResults.flatMap(r => r.toolsCalled));
  for (const tool of allTools) {
    const count = chatResults.filter(r => r.toolsCalled.includes(tool)).length;
    console.log(`  - ${tool}: ${count} queries`);
  }

  // Write results to JSON for further analysis
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    searchResults,
    chatResults,
    summary: {
      searchTotal: SEARCH_QUERIES.length,
      searchPass,
      searchNoData,
      searchFail,
      chatTotal: AI_QUESTIONS.length,
      chatPass,
      chatFail,
      noDataQueries: noDataQueries.map(r => r.query),
      sourcesFound: [...allSources],
      toolsUsed: [...allTools],
    },
  };

  const fs = await import('fs');
  fs.mkdirSync('./test-results', { recursive: true });
  const reportPath = `./test-results/test-results-${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report saved to: ${reportPath}`);
}

main().catch(console.error);
