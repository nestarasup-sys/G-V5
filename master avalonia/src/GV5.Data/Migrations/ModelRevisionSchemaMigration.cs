namespace GV5.Data.Migrations;

/// <summary>Creates append-only model publication snapshots and their durable asset ownership.</summary>
public sealed class ModelRevisionSchemaMigration : ISqliteMigration
{
    public int Version => 8;
    public string Name => "immutable-model-revisions";

    public string UpSql => """
        CREATE TABLE model_revisions (
            revision_id TEXT PRIMARY KEY NOT NULL CHECK (length(revision_id) = 36),
            model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            published_utc_ms INTEGER NOT NULL CHECK (published_utc_ms >= 0),
            snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) > 0),
            snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
            UNIQUE (model_id, revision)
        );

        CREATE INDEX idx_model_revisions_model_revision ON model_revisions(model_id, revision DESC);

        CREATE TRIGGER trg_model_revisions_no_update
        BEFORE UPDATE ON model_revisions
        BEGIN
            SELECT RAISE(ABORT, 'published model revisions are immutable');
        END;

        CREATE TRIGGER trg_model_revisions_no_delete
        BEFORE DELETE ON model_revisions
        BEGIN
            SELECT RAISE(ABORT, 'published model revisions are immutable');
        END;
        """;
}
