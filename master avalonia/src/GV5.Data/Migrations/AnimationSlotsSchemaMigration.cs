namespace GV5.Data.Migrations;

/// <summary>Provides up to twelve stable animation slots per model without deleting older drafts.</summary>
public sealed class AnimationSlotsSchemaMigration : ISqliteMigration
{
    public int Version => 17;
    public string Name => "fabricator-animation-slots";

    public string UpSql => """
        CREATE UNIQUE INDEX ux_animation_draft_model ON animation_drafts(animation_id, model_id);

        CREATE TABLE animation_slots (
            model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT,
            slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 12),
            animation_id TEXT NOT NULL UNIQUE,
            assigned_utc_ms INTEGER NOT NULL CHECK (assigned_utc_ms >= 0),
            PRIMARY KEY (model_id, slot_number),
            FOREIGN KEY (animation_id, model_id)
                REFERENCES animation_drafts(animation_id, model_id) ON DELETE CASCADE
        );

        WITH ranked_animations AS (
            SELECT model_id, animation_id,
                ROW_NUMBER() OVER (
                    PARTITION BY model_id
                    ORDER BY updated_utc_ms, display_name COLLATE NOCASE, animation_id
                ) AS slot_number
            FROM animation_drafts
        )
        INSERT INTO animation_slots(model_id, slot_number, animation_id, assigned_utc_ms)
        SELECT model_id, slot_number, animation_id, 0
        FROM ranked_animations
        WHERE slot_number <= 12;

        CREATE INDEX idx_animation_slots_animation ON animation_slots(animation_id);
        """;
}
