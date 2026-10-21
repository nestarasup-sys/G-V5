namespace GV5.Data.Migrations;

/// <summary>Stores immutable pending checkpoints that can be replayed after an interrupted save.</summary>
public sealed class ModelDraftCheckpointSchemaMigration : ISqliteMigration
{
    public int Version => 3;
    public string Name => "model-draft-checkpoints";

    public string UpSql => """
        CREATE TABLE model_draft_checkpoints (
            checkpoint_id TEXT PRIMARY KEY NOT NULL CHECK (length(checkpoint_id) = 36),
            model_id TEXT NOT NULL CHECK (length(model_id) = 36),
            expected_revision INTEGER NULL CHECK (expected_revision IS NULL OR expected_revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            created_utc_ms INTEGER NOT NULL CHECK (created_utc_ms >= 0)
        );

        CREATE INDEX idx_model_draft_checkpoints_model_created
            ON model_draft_checkpoints(model_id, created_utc_ms, checkpoint_id);
        """;
}
