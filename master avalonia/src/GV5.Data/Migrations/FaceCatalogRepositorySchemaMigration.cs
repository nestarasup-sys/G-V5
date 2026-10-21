namespace GV5.Data.Migrations;

/// <summary>Stores model-pinned facial catalogs with stable component and asset references.</summary>
public sealed class FaceCatalogRepositorySchemaMigration : ISqliteMigration
{
    public int Version => 14;
    public string Name => "fabricator-face-catalog-drafts";

    public string UpSql => """
        CREATE TABLE face_catalog_drafts (
            face_id TEXT PRIMARY KEY NOT NULL CHECK (length(face_id) = 36),
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

        CREATE INDEX idx_face_catalog_drafts_model ON face_catalog_drafts(model_revision_id, display_name COLLATE NOCASE, face_id);
        """;
}
