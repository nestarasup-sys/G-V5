namespace GV5.Data.Migrations;

/// <summary>Stores optimistic hair drafts and immutable style publications pinned to model revisions.</summary>
public sealed class HairStyleRepositorySchemaMigration : ISqliteMigration
{
    public int Version => 13;
    public string Name => "fabricator-hair-drafts-and-revisions";

    public string UpSql => """
        CREATE TABLE hair_drafts (
            hair_id TEXT PRIMARY KEY NOT NULL CHECK (length(hair_id) = 36),
            model_revision_id TEXT NOT NULL REFERENCES model_revisions(revision_id) ON DELETE RESTRICT,
            model_revision_sequence INTEGER NOT NULL CHECK (model_revision_sequence >= 1),
            model_snapshot_sha256 TEXT NOT NULL CHECK (length(model_snapshot_sha256) = 64 AND model_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
            model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            draft_json TEXT NOT NULL CHECK (length(draft_json) > 0),
            draft_sha256 TEXT NOT NULL CHECK (length(draft_sha256) = 64 AND draft_sha256 NOT GLOB '*[^0-9a-f]*'),
            updated_utc_ms INTEGER NOT NULL CHECK (updated_utc_ms >= 0)
        );

        CREATE INDEX idx_hair_drafts_model ON hair_drafts(model_revision_id, display_name COLLATE NOCASE, hair_id);

        CREATE TABLE hair_revisions (
            hair_revision_id TEXT PRIMARY KEY NOT NULL CHECK (length(hair_revision_id) = 36),
            hair_id TEXT NOT NULL CHECK (length(hair_id) = 36),
            model_revision_id TEXT NOT NULL REFERENCES model_revisions(revision_id) ON DELETE RESTRICT,
            model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            published_utc_ms INTEGER NOT NULL CHECK (published_utc_ms >= 0),
            snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) > 0),
            snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
            UNIQUE (hair_id, revision)
        );

        CREATE INDEX idx_hair_revisions_hair ON hair_revisions(hair_id, revision DESC);
        CREATE TRIGGER trg_hair_revisions_no_update BEFORE UPDATE ON hair_revisions
        BEGIN SELECT RAISE(ABORT, 'published hair revisions are immutable'); END;
        CREATE TRIGGER trg_hair_revisions_no_delete BEFORE DELETE ON hair_revisions
        BEGIN SELECT RAISE(ABORT, 'published hair revisions are immutable'); END;
        """;
}
