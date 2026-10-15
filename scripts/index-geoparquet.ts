import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

import postgres from 'postgres';
import OpenAI from 'openai';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://datalibrarian:datalibrarian@localhost:5432/datalibrarian';

const sql = postgres(connectionString);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_MODEL = 'text-embedding-3-small';

// Registry of GeoParquet sources (same as in geoparquet.service.ts)
const GEOPARQUET_SOURCES = [
  {
    id: 'overture-buildings',
    name: 'Overture Buildings',
    description:
      'Global building footprints from Microsoft, Google, OpenStreetMap. 2.3B+ buildings worldwide with height, class, and source information.',
    sourceUrl: 'https://docs.overturemaps.org/guides/buildings/',
    attribution: 'Overture Maps Foundation',
    license: 'ODbL',
    dataType: 'polygon',
    supportsRealtimeCount: true,
  },
  {
    id: 'overture-places',
    name: 'Overture Places',
    description:
      'Points of interest including businesses, landmarks, amenities. 100M+ places globally with categories, names, and addresses.',
    sourceUrl: 'https://docs.overturemaps.org/guides/places/',
    attribution: 'Overture Maps Foundation',
    license: 'ODbL',
    dataType: 'point',
    supportsRealtimeCount: true,
  },
  {
    id: 'overture-transportation',
    name: 'Overture Transportation',
    description:
      'Global road network with road classification, connectivity, and routing information. Includes highways, streets, paths, and more.',
    sourceUrl: 'https://docs.overturemaps.org/guides/transportation/',
    attribution: 'Overture Maps Foundation',
    license: 'ODbL',
    dataType: 'line',
    supportsRealtimeCount: true,
  },
  {
    id: 'overture-addresses',
    name: 'Overture Addresses',
    description:
      'Global address points with structured components including street, city, region, and postal code.',
    sourceUrl: 'https://docs.overturemaps.org/guides/addresses/',
    attribution: 'Overture Maps Foundation',
    license: 'ODbL + CDLA',
    dataType: 'point',
    supportsRealtimeCount: true,
  },
  {
    id: 'overture-divisions',
    name: 'Overture Administrative Divisions',
    description:
      'Administrative boundaries including countries, states, provinces, counties, municipalities, and other administrative regions.',
    sourceUrl: 'https://docs.overturemaps.org/guides/divisions/',
    attribution: 'Overture Maps Foundation',
    license: 'ODbL',
    dataType: 'polygon',
    supportsRealtimeCount: true,
  },
  {
    id: 'overture-water',
    name: 'Overture Water Features',
    description:
      'Water bodies including lakes, rivers, streams, coastlines, and other hydrographic features.',
    sourceUrl: 'https://docs.overturemaps.org/guides/base/',
    attribution: 'Overture Maps Foundation',
    license: 'ODbL',
    dataType: 'polygon',
    supportsRealtimeCount: true,
  },
];

async function generateEmbedding(text: string): Promise<number[]> {
  const cleanedText = text.replace(/\s+/g, ' ').trim().substring(0, 30000);

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: cleanedText,
  });

  return response.data[0]!.embedding;
}

async function indexGeoParquetSources() {
  console.log('Indexing GeoParquet sources...');
  console.log(`Found ${GEOPARQUET_SOURCES.length} registered sources\n`);

  for (const source of GEOPARQUET_SOURCES) {
    console.log(`Processing: ${source.name}`);

    try {
      // Build rich search text
      const searchText = [
        source.name,
        source.description,
        source.attribution,
        source.license,
        source.dataType,
        'overture',
        'geoparquet',
        'cloud',
        'global',
      ].join(' ');

      // Generate embedding
      const embedding = await generateEmbedding(searchText);

      // Insert/update dataset record
      await sql`
        INSERT INTO datasets (
          source,
          source_id,
          name,
          description,
          snippet,
          data_type,
          extent,
          extent_bbox,
          source_url,
          access_type,
          geoparquet_source_id,
          supports_coverage_query,
          search_text,
          embedding
        ) VALUES (
          'geoparquet',
          ${source.id},
          ${source.name},
          ${source.description},
          ${source.description.substring(0, 200)},
          ${source.dataType},
          ST_MakeEnvelope(-180, -90, 180, 90, 4326),
          ${'{"xmin": -180, "ymin": -90, "xmax": 180, "ymax": 90}'},
          ${source.sourceUrl},
          'public',
          ${source.id},
          ${source.supportsRealtimeCount},
          ${searchText},
          ${`[${embedding.join(',')}]`}
        )
        ON CONFLICT (source, source_id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          snippet = EXCLUDED.snippet,
          source_url = EXCLUDED.source_url,
          supports_coverage_query = EXCLUDED.supports_coverage_query,
          embedding = EXCLUDED.embedding,
          updated_at = NOW()
      `;

      console.log(`  ✓ ${source.name} (${source.attribution})`);
    } catch (error) {
      console.error(`  ✗ Error: ${error}`);
    }
  }

  console.log(`\nIndexed ${GEOPARQUET_SOURCES.length} GeoParquet sources.`);
  await sql.end();
}

indexGeoParquetSources().catch((error) => {
  console.error('Indexing failed:', error);
  process.exit(1);
});
