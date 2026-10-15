# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Findria (formerly Alexandria / Data Librarian) is an AI-powered semantic search engine for discovering public geospatial data. It indexes metadata from ArcGIS Living Atlas (~15K datasets) and Overture Maps (6 themes), enabling natural language queries with automatic location detection and spatial filtering.

**Tech Stack**: Next.js 16 (App Router), TypeScript, PostgreSQL + pgvector + PostGIS, DuckDB (for GeoParquet queries), Tailwind CSS, ArcGIS Maps SDK (CDN-loaded)

## Commands

```bash
# Development
npm run dev              # Start Next.js dev server

# Build
npm run build            # Build for production
npm run start            # Start production server
npm run lint             # Run ESLint

# Database
npm run db:migrate       # Run database migrations

# Unified Indexing CLI
npm run index -- help                           # Show all commands
npm run index -- living-atlas --recipe          # Index from Living Atlas using saved filters
npm run index -- living-atlas --query="parks"   # Search and index specific term
npm run index -- custom-orgs                    # Index from custom organization sources
npm run index -- custom-orgs --filter=portland  # Filter orgs by name/region
npm run index -- url <URL>                      # Index a single URL (ArcGIS Server, FeatureServer, Hub)
npm run index -- geoparquet                     # Index GeoParquet sources (Overture, etc.)

# Legacy individual commands (still work)
npm run index:living-atlas   # Harvest Living Atlas metadata
npm run index:geoparquet     # Index GeoParquet sources
npm run index:coverage       # Compute H3 coverage for Feature Services
npm run index:custom         # Index custom organization sources
npm run index:url            # Index a single URL
npm run index:all            # Run all indexers sequentially
```

## Architecture

### Data Flow
1. **Search**: User query → Claude parses (extracts topics/location) → ArcGIS geocodes location → OpenAI embeds query → pgvector similarity search + PostGIS spatial filter
2. **Preview**: Dataset selected → DuckDB queries GeoParquet (Overture) or ArcGIS REST queries Feature Service (Living Atlas) → GeoJSON returned for map display

### Key Directories
- `app/` - Next.js App Router pages and API routes
- `app/api/` - API endpoints (search, datasets, preview, coverage, health)
- `components/` - React components (SearchBar, ResultsList, MapPanel, DatasetModal)
- `services/` - Business logic (search, embedding, query-parser, preview, geoparquet, arcgis, geocoding)
- `lib/` - Database client, utilities, React hooks
- `scripts/` - CLI indexing scripts (migrate, index-living-atlas, index-geoparquet, compute-coverage)

### Database Schema
- `datasets` - Main table with embeddings (pgvector), extent (PostGIS), source metadata
- `coverage` - H3 hexagon coverage index (Living Atlas Feature Services only)
- `search_logs` - Anonymous search analytics
- `chat_conversations` - AI chat conversations (for sharing and analytics)
- `indexing_jobs` - Queue for URL submissions and admin-triggered indexing jobs

### Data Sources
- **ArcGIS (Living Atlas)**: `source='living_atlas'` - Indexed via ArcGIS REST API, supports H3 coverage queries for Feature Services
- **GeoParquet**: `source='geoparquet'` - Defined in `GEOPARQUET_SOURCES` registry in `geoparquet.service.ts`, queried via DuckDB at runtime
- **Custom Organizations**: `source='custom_org'` - Defined in `config/custom-sources.ts`, indexed from specific ArcGIS Online organizations
- **User Submitted**: `source='user_submitted'` - URLs submitted via /submit page or admin area

## Important Constraints

### ArcGIS SDK - CDN Only
**Do NOT install `@arcgis/core` as npm dependency.** Load from CDN in `layout.tsx`:
```tsx
<Script src="https://js.arcgis.com/4.31/" strategy="beforeInteractive" />
```
Bundling @arcgis/core causes 1+ hour build times.

### Environment Variables Required
- `DATABASE_URL` - PostgreSQL connection string
- `ANTHROPIC_API_KEY` - Claude API for query parsing
- `OPENAI_API_KEY` - text-embedding-3-small for embeddings
- `ARCGIS_API_KEY` / `NEXT_PUBLIC_ARCGIS_API_KEY` - Basemaps and geocoding
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` - Basic auth for /admin area
- `BASE_URL` - Public site URL for metadata/OG images
- Optional: `NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL` (analytics; omitted when unset), `SUBMISSION_RATE_LIMIT_PER_HOUR`, `NEXT_PUBLIC_BASE_URL` (MCP endpoint), `TEST_BASE_URL` (test harness scripts)
- `.env.example` lists every variable; keep it in sync when adding a new `process.env.*` read

### Brand Colors (Dymaptic)
- Coral (#E24E42): Primary actions, Living Atlas badge
- Teal (#1D809F): Secondary actions, Overture badge, map preview overlays
- Brand Gray (#A7A7A7): Disabled states, borders
- Dark BG (#1A1A1A): Dark mode, footer

## Adding New GeoParquet Sources

1. Inspect schema: `DESCRIBE SELECT * FROM read_parquet('s3://.../*.parquet') LIMIT 1;`
2. Add entry to `GEOPARQUET_SOURCES` in `services/geoparquet.service.ts`
3. Run `npm run index:geoparquet`

## URL Submission Feature

Users can submit URLs for indexing at `/submit`. The system:
1. Validates the URL type (ArcGIS Server, FeatureServer/MapServer, Hub)
2. Checks rate limiting (`SUBMISSION_RATE_LIMIT_PER_HOUR`, default 25 submissions/hour per IP)
3. Enforces 24-hour cooldown for re-indexing same URL
4. Adds to queue for background processing

### Admin Area (/admin)

Protected by Basic HTTP auth. Provides:
- **Dashboard**: Dataset counts by source, queue status, activity stats
- **Queue**: View/manage indexing jobs (pending, processing, completed, failed)
- **Indexing**: Trigger indexing jobs, reference CLI commands
- **Analytics**: Recent searches, popular terms, searches with no results, chat logs

### Queue Processing

Submitted URLs are processed by `scripts/process-queue.ts`, compiled to `dist/process-queue.js` during `npm run build` (via `scripts/build-scripts.js`). Any scheduler can run `node dist/process-queue.js` every few minutes with the app's environment variables.

`azure-webjob/` is an example for Azure App Service WebJobs: zip `run.sh` and `settings.job`, upload as a Triggered WebJob in the Azure Portal. It runs every 5 minutes (`0 */5 * * * *`).

## Deployment

- Any Node.js 20+ host; the build uses Next.js `output: 'standalone'`
- PostgreSQL with pgvector + postgis extensions; run `npm run db:migrate` to apply `scripts/init-db.sql`
- `NEXT_PUBLIC_*` vars (and env read by statically rendered pages) are resolved at build time
- The hosted instance is findria.dymaptic.ai; this repo does not include a production deploy pipeline (CI in `.github/workflows/ci.yml` only runs type check + unit tests)
- See README "Deploying" for the full checklist

## Licensing

MIT (see `LICENSE`). dymaptic/Findria names and logos are trademarks and not MIT-licensed (see README "Trademarks").
