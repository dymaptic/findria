-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Main datasets table
CREATE TABLE IF NOT EXISTS datasets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Source identification
    source VARCHAR(50) NOT NULL CHECK (source IN ('living_atlas', 'geoparquet', 'custom_org', 'user_submitted')),
    source_id VARCHAR(255) NOT NULL,

    -- Core metadata
    name VARCHAR(500) NOT NULL,
    description TEXT,
    snippet TEXT,

    -- Classification
    tags TEXT[],
    categories TEXT[],
    data_type VARCHAR(50),

    -- Spatial extent (stored as PostGIS geometry for spatial queries)
    extent GEOMETRY(POLYGON, 4326),
    extent_bbox JSONB,

    -- Access information
    source_url VARCHAR(1000),
    service_url VARCHAR(1000),
    access_type VARCHAR(50),

    -- GeoParquet-specific
    geoparquet_source_id VARCHAR(100),

    -- Living Atlas-specific
    arcgis_item_id VARCHAR(50),
    arcgis_owner VARCHAR(255),
    arcgis_type VARCHAR(100),
    supports_coverage_query BOOLEAN DEFAULT false,
    is_authoritative BOOLEAN DEFAULT false,

    -- Full original metadata for reference
    metadata_json JSONB,

    -- Search optimization
    search_text TEXT,
    embedding VECTOR(1536),

    -- Audit fields
    indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique constraint on source + source_id
    UNIQUE(source, source_id)
);

-- Search logs (anonymous analytics)
CREATE TABLE IF NOT EXISTS search_logs (
    id SERIAL PRIMARY KEY,

    -- Query info (no user identification)
    query_text TEXT NOT NULL,
    parsed_topics TEXT[],
    parsed_location VARCHAR(500),
    parsed_bbox JSONB,

    -- Results
    result_count INTEGER,
    top_result_ids UUID[],

    -- Performance
    search_duration_ms INTEGER,
    embedding_duration_ms INTEGER,

    -- Context (anonymous)
    session_hash VARCHAR(64),
    referrer_domain VARCHAR(255),

    -- Timestamp
    searched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Spatial coverage index (H3 hexagons)
CREATE TABLE IF NOT EXISTS coverage (
    id SERIAL PRIMARY KEY,
    dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    h3_index BIGINT NOT NULL,
    feature_count INTEGER NOT NULL DEFAULT 0,
    indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(dataset_id, h3_index)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_datasets_source ON datasets(source);
CREATE INDEX IF NOT EXISTS idx_datasets_embedding ON datasets USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_datasets_extent ON datasets USING GIST (extent);
CREATE INDEX IF NOT EXISTS idx_datasets_tags ON datasets USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_datasets_search_text ON datasets USING GIN (to_tsvector('english', search_text));

CREATE INDEX IF NOT EXISTS idx_coverage_dataset ON coverage(dataset_id);
CREATE INDEX IF NOT EXISTS idx_coverage_h3 ON coverage(h3_index);
CREATE INDEX IF NOT EXISTS idx_coverage_h3_count ON coverage(h3_index, feature_count) WHERE feature_count > 0;

CREATE INDEX IF NOT EXISTS idx_search_logs_searched_at ON search_logs(searched_at);
CREATE INDEX IF NOT EXISTS idx_search_logs_topics ON search_logs USING GIN(parsed_topics);

-- Chat conversations (for sharing and analytics)
CREATE TABLE IF NOT EXISTS chat_conversations (
    id VARCHAR(36) PRIMARY KEY,  -- 16-char base64url (96-bit CSPRNG) share IDs, legacy 8-char IDs still fit, widened from VARCHAR(12) by the ALTER below

    -- Conversation content
    question TEXT NOT NULL,
    messages JSONB NOT NULL,
    sources JSONB,

    -- Analytics fields
    tools_called TEXT[],
    datasets_referenced UUID[],

    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_created ON chat_conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_tools ON chat_conversations USING GIN(tools_called);
ALTER TABLE chat_conversations ALTER COLUMN id TYPE VARCHAR(36);

-- Indexing jobs queue (for user submissions and admin-triggered jobs)
CREATE TABLE IF NOT EXISTS indexing_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Job info
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('user_submission', 'living_atlas', 'custom_orgs', 'single_url_admin')),
    url TEXT,                           -- For URL-based jobs
    url_type VARCHAR(50),               -- 'arcgis_server' | 'single_service' | 'hub'
    config JSONB,                       -- Job-specific config (filters, limits, etc.)

    -- Validation results (for URL jobs)
    validated_at TIMESTAMP WITH TIME ZONE,
    service_count INTEGER,              -- How many services/datasets discovered
    server_name TEXT,                   -- e.g., "City of Portland GIS"
    validation_error TEXT,

    -- Queue status
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'paused')),
    priority INTEGER DEFAULT 10,        -- Lower = higher priority (user=1, admin=10)
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,

    -- Progress tracking (for chunked/long-running jobs)
    current_offset INTEGER DEFAULT 0,
    total_items INTEGER,
    items_processed INTEGER DEFAULT 0,
    items_indexed INTEGER DEFAULT 0,
    items_skipped INTEGER DEFAULT 0,

    -- Re-index tracking
    is_reindex BOOLEAN DEFAULT FALSE,

    -- Deletion scope (set based on job type and whether filtered)
    -- NULL = no deletion, otherwise the service_url LIKE pattern to scope deletion
    deletion_scope TEXT,

    -- Rate limiting
    submitter_ip VARCHAR(45)            -- IPv4 or IPv6 address
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON indexing_jobs(status, priority, submitted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON indexing_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_jobs_url ON indexing_jobs(url);
CREATE INDEX IF NOT EXISTS idx_jobs_submitter ON indexing_jobs(submitter_ip, submitted_at)
