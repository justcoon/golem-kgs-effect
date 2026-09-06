-- =============================================================================
-- Migration 004: Connector Sync Checkpoints
-- =============================================================================

CREATE TABLE IF NOT EXISTS sync_checkpoints (
    connector_id VARCHAR(255) PRIMARY KEY,
    cursor_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_sync_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(50) NOT NULL DEFAULT 'IDLE',
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
