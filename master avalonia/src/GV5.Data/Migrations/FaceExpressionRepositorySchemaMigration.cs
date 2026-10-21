namespace GV5.Data.Migrations;

/// <summary>Stores model-scoped face-expression collections and optimistic preset drafts.</summary>
public sealed class FaceExpressionRepositorySchemaMigration : ISqliteMigration
{
    public int Version => 15;
    public string Name => "fabricator-face-expression-drafts";

    public string UpSql => """
        CREATE TABLE face_expression_collections (
            collection_id TEXT PRIMARY KEY NOT NULL CHECK (length(collection_id) = 36),
            model_revision_id TEXT NOT NULL REFERENCES model_revisions(revision_id) ON DELETE RESTRICT,
            model_revision_sequence INTEGER NOT NULL CHECK (model_revision_sequence >= 1),
            model_snapshot_sha256 TEXT NOT NULL CHECK (length(model_snapshot_sha256) = 64 AND model_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
            model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
            created_utc_ms INTEGER NOT NULL CHECK (created_utc_ms >= 0),
            updated_utc_ms INTEGER NOT NULL CHECK (updated_utc_ms >= created_utc_ms)
        );
        CREATE INDEX idx_face_expression_collections_model ON face_expression_collections(model_revision_id, display_name COLLATE NOCASE, collection_id);

        CREATE TABLE face_expression_presets (
            preset_id TEXT PRIMARY KEY NOT NULL CHECK (length(preset_id) = 36),
            collection_id TEXT NOT NULL REFERENCES face_expression_collections(collection_id) ON DELETE CASCADE,
            face_id TEXT NOT NULL REFERENCES face_catalog_drafts(face_id) ON DELETE RESTRICT,
            face_revision INTEGER NOT NULL CHECK (face_revision >= 1),
            revision INTEGER NOT NULL CHECK (revision >= 1),
            expression_index INTEGER NOT NULL CHECK (expression_index BETWEEN 0 AND 999),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
            draft_json TEXT NOT NULL CHECK (length(draft_json) > 0),
            draft_sha256 TEXT NOT NULL CHECK (length(draft_sha256) = 64 AND draft_sha256 NOT GLOB '*[^0-9a-f]*'),
            updated_utc_ms INTEGER NOT NULL CHECK (updated_utc_ms >= 0),
            UNIQUE (collection_id, expression_index)
        );
        CREATE INDEX idx_face_expression_presets_collection ON face_expression_presets(collection_id, expression_index, preset_id);
        """;
}
