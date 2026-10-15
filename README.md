# Findria

AI-powered semantic search for discovering public geospatial data. Find the right GIS data in seconds, not hours.

## Features

- **Natural Language Search**: Search for datasets using plain English queries like "building footprints in Portland"
- **Automatic Location Detection**: Location references are automatically geocoded and used as spatial filters
- **Multiple Data Sources**: Indexes ArcGIS Living Atlas (~15K datasets), Overture Maps (buildings, roads, places), and public agency data (cities, counties, states, federal)
- **Map Preview**: View sample data on an interactive map before accessing the full dataset
- **Semantic Search**: Uses AI embeddings to find datasets that match your intent, not just keywords

## Getting Started

### Prerequisites

- Node.js 20+ (CI runs on Node 22)
- Docker and Docker Compose (for the local database)
- API Keys:
  - OpenAI API key (for embeddings)
  - Anthropic API key (for query parsing, chat, and guardrails)
  - ArcGIS location services API key (for basemaps in the browser)

### Local Development Setup

1. **Clone the repository**

```bash
git clone https://github.com/dymaptic/findria.git
cd findria
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your API keys. At minimum:

```env
DATABASE_URL=postgresql://datalibrarian:datalibrarian@localhost:5432/datalibrarian
ANTHROPIC_API_KEY=your-anthropic-api-key
OPENAI_API_KEY=your-openai-api-key
NEXT_PUBLIC_ARCGIS_API_KEY=your-arcgis-api-key
```

See [`.env.example`](.env.example) for every supported variable.

> The Next.js app and most indexing scripts load `.env.local` automatically. `npm run db:migrate` and
> `npm run index:coverage` do not; they fall back to the local Docker database URL above, or you can
> export `DATABASE_URL` in your shell.

4. **Start the database**

```bash
docker-compose up -d
```

This starts PostgreSQL with pgvector and PostGIS extensions. The database schema is automatically initialized.

5. **Run database migrations** (applies `scripts/init-db.sql`; safe to re-run)

```bash
npm run db:migrate
```

6. **Index the data sources**

```bash
# Index Overture Maps sources (quick, ~6 sources)
npm run index:geoparquet

# Index ArcGIS Living Atlas (takes longer, ~15K items)
npm run index:living-atlas

# Index custom ArcGIS organizations (cities, counties, states, federal)
npm run index:custom

# Optional: Compute H3 coverage for Living Atlas Feature Services
npm run index:coverage
```

You can also use the unified indexing CLI (`npm run index -- help` lists all commands), e.g.
`npm run index -- url <ArcGIS service URL>` to index a single service.

**Living Atlas indexer options:**
```bash
npm run index:living-atlas -- --clear              # Clear existing and re-index
npm run index:living-atlas -- --limit=100          # Index only 100 items (for testing)
npm run index:living-atlas -- --delay=1000         # 1 second between items (default: 500ms)
npm run index:living-atlas -- --batch-delay=5000   # 5 seconds between batches (default: 2000ms)
npm run index:living-atlas -- --query=buildings    # Filter by keyword
```

7. **Start the development server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

## Project Structure

```
findria/
├── app/                    # Next.js App Router
│   ├── api/                # API routes (search, chat, datasets, preview, coverage,
│   │                       #   overture, sources, share, mcp, health, admin)
│   ├── admin/              # Admin area (HTTP Basic auth)
│   ├── about/              # About page
│   ├── chat/               # Shared chat conversations
│   ├── submit/             # URL submission page
│   ├── privacy/            # Privacy policy (dymaptic-specific, replace in forks)
│   ├── terms/              # Terms of service (dymaptic-specific, replace in forks)
│   └── cookies/            # Cookie policy (dymaptic-specific, replace in forks)
├── components/             # React components
├── config/                 # Custom organization sources
├── lib/                    # Utilities (db, rate limiter, hooks)
├── services/               # Business logic (search, chat, embeddings, geocoding, ...)
├── scripts/                # CLI scripts (migrations, indexers, queue processor, test harnesses)
├── azure-webjob/           # Example scheduled job for the submission queue (Azure App Service)
├── tests/                  # Jest unit tests
└── types/                  # TypeScript types
```

## Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production (also compiles dist/process-queue.js)
npm run start        # Start production server
npm test             # Run unit tests (Jest)
npx tsc --noEmit     # Type check

npm run db:migrate   # Run database migrations

npm run index -- help        # Unified indexing CLI
npm run index:living-atlas   # Index ArcGIS Living Atlas
npm run index:geoparquet     # Index GeoParquet sources (Overture)
npm run index:custom         # Index custom ArcGIS organizations
npm run index:url            # Index a single URL
npm run index:coverage       # Compute H3 coverage
npm run index:all            # Run all indexers
npm run index:queue          # Process the URL submission queue once (dev, via tsx)
npm run queue                # Process the submission queue once (compiled, after build)

# Integration test harnesses (require a running server; TEST_BASE_URL defaults to http://localhost:3000)
npm run test:guardrails
npm run test:queries
npm run test:comprehensive
```

## API Endpoints

### POST /api/search

Search for datasets.

```json
{
  "query": "building footprints in Portland Oregon",
  "bbox": [-123.0, 45.4, -122.4, 45.6],
  "sources": ["living_atlas", "geoparquet"],
  "limit": 20
}
```

### GET /api/datasets/:id

Get full metadata for a dataset.

### GET /api/preview/:id?bbox=xmin,ymin,xmax,ymax

Get GeoJSON preview of a dataset within a bounding box.

### POST /api/chat

AI chat endpoint (streams newline-delimited JSON events). Questions pass input validation and an AI guardrail classifier first.

### POST /api/sources/submit

Submit an ArcGIS URL for indexing (rate limited; processed by the background queue).

### GET /api/health

Health check with database stats.

### POST /api/mcp

MCP (Model Context Protocol) endpoint for AI assistant integration.

**Available tools:**
- `search_datasets` - Search for geospatial datasets using natural language
- `get_dataset` - Get detailed metadata for a dataset by ID
- `get_service_url` - Get the ArcGIS service URL for adding to ArcGIS Pro
- `list_sources` - List available data sources and counts

**Usage with Claude:**
Add this MCP server URL in Claude settings:
```
https://findria.dymaptic.ai/api/mcp
```

## Adding New GeoParquet Sources

To add a new cloud-hosted GeoParquet dataset:

1. Inspect the schema:
```sql
DESCRIBE SELECT * FROM read_parquet('s3://bucket/path/*.parquet') LIMIT 1;
```

2. Add an entry to `GEOPARQUET_SOURCES` in `services/geoparquet.service.ts`

3. Run the indexer:
```bash
npm run index:geoparquet
```

## Architecture

- **Frontend**: Next.js 16 with App Router, React, Tailwind CSS
- **Map**: ArcGIS Maps SDK for JavaScript (loaded from CDN)
- **Database**: PostgreSQL with pgvector (embeddings) and PostGIS (spatial)
- **GeoParquet**: DuckDB in-process for querying cloud-hosted Parquet files
- **AI**: Claude for query parsing, OpenAI for embeddings

## Deploying

Findria runs on any host that can run a Node.js 20+ server (a VM, container platform, Azure App Service, Vercel, etc.).

1. **Database**: provision PostgreSQL with the `vector` (pgvector) and `postgis` extensions available
   (e.g. Azure Database for PostgreSQL Flexible Server, Supabase, Neon, or the `Dockerfile.db` image).
2. **Environment variables**: set at least `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `NEXT_PUBLIC_ARCGIS_API_KEY`, `BASE_URL`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD`. See
   [`.env.example`](.env.example) for the full list. `NEXT_PUBLIC_*` variables (and values used by statically
   rendered pages, such as `BASE_URL` and `NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL`) are applied at build time, so set them
   in the build environment too.
3. **Migrate and index**: run `npm run db:migrate` against the production database, then run the indexers you need
   (see [Index the data sources](#local-development-setup)).
4. **Build and start**: `npm ci && npm run build`. The app builds as a Next.js
   [standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) output; start it with
   `node .next/standalone/server.js` (copy `public/` and `.next/static/` alongside it) or `npm run start`.
5. **Submission queue**: URLs submitted via `/submit` or the admin area are queued in the database. Schedule
   `node dist/process-queue.js` (built by `npm run build`) to run every few minutes with the same environment
   variables, using cron, a scheduled container job, or similar. `azure-webjob/` contains an example for Azure
   App Service WebJobs.
6. **Rate limiting behind a proxy**: per-IP rate limits use the `cf-connecting-ip`, `X-Forwarded-For`, and
   `X-Real-IP` headers. These are only trustworthy if clients cannot reach your origin directly, so restrict
   inbound traffic to your CDN or reverse proxy (or make sure it overwrites these headers).

The `docker-compose.yml` provides a PostgreSQL database for local development only.

## License

Findria is released under the [MIT License](LICENSE). Copyright (c) 2026 dymaptic.

## Trademarks

The dymaptic and Findria names and logos are trademarks of dymaptic and are **not** licensed under the MIT License.
If you fork or deploy this project publicly, you must remove or replace the dymaptic and Findria names and logos,
the dymaptic legal pages (`app/privacy`, `app/terms`, `app/cookies`), and dymaptic contact details before deploying.

## Contributing and Security

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contact

For questions or feedback, contact [support@dymaptic.com](mailto:support@dymaptic.com).
