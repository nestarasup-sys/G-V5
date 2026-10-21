namespace GV5.Data.Migrations;

/// <summary>Persists wardrobe drafts and append-only publication snapshots pinned to model revisions.</summary>
public sealed class WardrobeRepositorySchemaMigration : ISqliteMigration
{
    public int Version => 12;
    public string Name => "fabricator-wardrobe-drafts-and-revisions";

    public string UpSql => """
        CREATE TABLE wardrobe_drafts (
            wardrobe_id TEXT PRIMARY KEY NOT NULL CHECK (length(wardrobe_id) = 36),
            model_revision_id TEXT NOT NULL REFERENCES model_revisions(revision_id) ON DELETE RESTRICT,
            model_revision_sequence INTEGER NOT NULL CHECK (model_revision_sequence >= 1),
            model_snapshot_sha256 TEXT NOT NULL CHECK (length(model_snapshot_sha256) = 64 AND model_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
            model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            wardrobe_json TEXT NOT NULL CHECK (length(wardrobe_json) > 0),
            wardrobe_sha256 TEXT NOT NULL CHECK (length(wardrobe_sha256) = 64 AND wardrobe_sha256 NOT GLOB '*[^0-9a-f]*'),
            updated_utc_ms INTEGER NOT NULL CHECK (updated_utc_ms >= 0)
        );

        CREATE INDEX idx_wardrobe_drafts_model ON wardrobe_drafts(model_revision_id, display_name COLLATE NOCASE, wardrobe_id);

        CREATE TABLE wardrobe_revisions (
            wardrobe_revision_id TEXT PRIMARY KEY NOT NULL CHECK (length(wardrobe_revision_id) = 36),
            wardrobe_id TEXT NOT NULL CHECK (length(wardrobe_id) = 36),
            model_revision_id TEXT NOT NULL REFERENCES model_revisions(revision_id) ON DELETE RESTRICT,
            model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            published_utc_ms INTEGER NOT NULL CHECK (published_utc_ms >= 0),
            snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) > 0),
            snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
            UNIQUE (wardrobe_id, revision)
        );

        CREATE INDEX idx_wardrobe_revisions_wardrobe ON wardrobe_revisions(wardrobe_id, revision DESC);
        CREATE INDEX idx_wardrobe_revisions_model ON wardrobe_revisions(model_revision_id, published_utc_ms DESC, wardrobe_revision_id DESC);

        CREATE TRIGGER trg_wardrobe_revisions_no_update
        BEFORE UPDATE ON wardrobe_revisions
        BEGIN
            SELECT RAISE(ABORT, 'published wardrobe revisions are immutable');
        END;

        CREATE TRIGGER trg_wardrobe_revisions_no_delete
        BEFORE DELETE ON wardrobe_revisions
        BEGIN
            SELECT RAISE(ABORT, 'published wardrobe revisions are immutable');
        END;
        """;
}
