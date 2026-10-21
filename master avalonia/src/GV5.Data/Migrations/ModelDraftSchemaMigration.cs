namespace GV5.Data.Migrations;

/// <summary>Adds the mutable model aggregate root. Published revisions and child geometry are separate tables.</summary>
public sealed class ModelDraftSchemaMigration : ISqliteMigration
{
    public int Version => 2;
    public string Name => "model-draft-metadata";

    public string UpSql => """
        CREATE TABLE models (
            model_id TEXT PRIMARY KEY NOT NULL CHECK (length(model_id) = 36),
            revision INTEGER NOT NULL CHECK (revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            created_utc_ms INTEGER NOT NULL CHECK (created_utc_ms >= 0),
            updated_utc_ms INTEGER NOT NULL CHECK (updated_utc_ms >= created_utc_ms)
        );

        CREATE INDEX idx_models_updated ON models(updated_utc_ms DESC, model_id);
        """;
}
