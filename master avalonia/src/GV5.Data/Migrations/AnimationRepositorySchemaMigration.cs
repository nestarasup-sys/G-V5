namespace GV5.Data.Migrations;

/// <summary>Stores editable animations pinned to immutable model publications.</summary>
public sealed class AnimationRepositorySchemaMigration : ISqliteMigration
{
    public int Version => 11;
    public string Name => "fabricator-animation-drafts";

    public string UpSql => """
        CREATE TABLE animation_drafts (
            animation_id TEXT PRIMARY KEY NOT NULL CHECK (length(animation_id) = 36),
            model_revision_id TEXT NOT NULL REFERENCES model_revisions(revision_id) ON DELETE RESTRICT,
            model_revision_sequence INTEGER NOT NULL CHECK (model_revision_sequence >= 1),
            model_snapshot_sha256 TEXT NOT NULL CHECK (length(model_snapshot_sha256) = 64 AND model_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
            model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            animation_json TEXT NOT NULL CHECK (length(animation_json) > 0),
            animation_sha256 TEXT NOT NULL CHECK (length(animation_sha256) = 64 AND animation_sha256 NOT GLOB '*[^0-9a-f]*'),
            updated_utc_ms INTEGER NOT NULL CHECK (updated_utc_ms >= 0)
        );

        CREATE INDEX idx_animation_drafts_model_revision ON animation_drafts(model_revision_id, display_name COLLATE NOCASE, animation_id);
        """;
}
