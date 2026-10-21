namespace GV5.Data.Migrations;

/// <summary>Stores append-only facial catalog and expression publications.</summary>
public sealed class FacePublicationSchemaMigration : ISqliteMigration
{
    public int Version => 16;
    public string Name => "fabricator-face-and-expression-publications";

    public string UpSql => """
        CREATE TABLE face_revisions (
            face_revision_id TEXT PRIMARY KEY NOT NULL CHECK (length(face_revision_id) = 36),
            face_id TEXT NOT NULL REFERENCES face_catalog_drafts(face_id) ON DELETE RESTRICT,
            model_revision_id TEXT NOT NULL REFERENCES model_revisions(revision_id) ON DELETE RESTRICT,
            model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            published_utc_ms INTEGER NOT NULL CHECK (published_utc_ms >= 0),
            snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) > 0),
            snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
            UNIQUE (face_id, revision)
        );
        CREATE INDEX idx_face_revisions_face ON face_revisions(face_id, revision DESC);
        CREATE TRIGGER trg_face_revisions_no_update BEFORE UPDATE ON face_revisions
        BEGIN SELECT RAISE(ABORT, 'published face revisions are immutable'); END;
        CREATE TRIGGER trg_face_revisions_no_delete BEFORE DELETE ON face_revisions
        BEGIN SELECT RAISE(ABORT, 'published face revisions are immutable'); END;

        CREATE TABLE face_expression_revisions (
            expression_revision_id TEXT PRIMARY KEY NOT NULL CHECK (length(expression_revision_id) = 36),
            preset_id TEXT NOT NULL REFERENCES face_expression_presets(preset_id) ON DELETE RESTRICT,
            face_revision_id TEXT NOT NULL REFERENCES face_revisions(face_revision_id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),
            published_utc_ms INTEGER NOT NULL CHECK (published_utc_ms >= 0),
            snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) > 0),
            snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
            UNIQUE (preset_id, revision)
        );
        CREATE INDEX idx_face_expression_revisions_preset ON face_expression_revisions(preset_id, revision DESC);
        CREATE TRIGGER trg_face_expression_revisions_no_update BEFORE UPDATE ON face_expression_revisions
        BEGIN SELECT RAISE(ABORT, 'published expression revisions are immutable'); END;
        CREATE TRIGGER trg_face_expression_revisions_no_delete BEFORE DELETE ON face_expression_revisions
        BEGIN SELECT RAISE(ABORT, 'published expression revisions are immutable'); END;
        """;
}
