namespace GV5.Data.Migrations;

/// <summary>Persists the ten exclusive Fabricator model-slot assignments separately from editable content revisions.</summary>
public sealed class ModelSlotSchemaMigration : ISqliteMigration
{
    public int Version => 18;
    public string Name => "fabricator-model-slots";

    public string UpSql => """
        CREATE TABLE model_slots (
            slot_number INTEGER PRIMARY KEY CHECK (slot_number BETWEEN 1 AND 10),
            model_id TEXT NOT NULL UNIQUE REFERENCES models(model_id) ON DELETE RESTRICT,
            assigned_utc_ms INTEGER NOT NULL CHECK (assigned_utc_ms >= 0)
        );

        WITH ranked_slots AS (
            SELECT model_id,
                   slot,
                   ROW_NUMBER() OVER (
                       PARTITION BY slot
                       ORDER BY updated_utc_ms DESC, model_id COLLATE BINARY ASC
                   ) AS slot_rank
            FROM model_draft_contents
            WHERE slot IS NOT NULL
        )
        INSERT INTO model_slots(slot_number, model_id, assigned_utc_ms)
        SELECT ranked.slot, ranked.model_id, model.updated_utc_ms
        FROM ranked_slots AS ranked
        JOIN models AS model ON model.model_id = ranked.model_id
        WHERE ranked.slot_rank = 1;

        WITH available_slots(slot_number) AS (
            VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10)
        ),
        ranked_free_slots AS (
            SELECT slot_number,
                   ROW_NUMBER() OVER (ORDER BY slot_number) AS assignment_rank
            FROM available_slots
            WHERE slot_number NOT IN (SELECT slot_number FROM model_slots)
        ),
        ranked_unassigned_models AS (
            SELECT model_id,
                   ROW_NUMBER() OVER (
                       ORDER BY updated_utc_ms DESC, model_id COLLATE BINARY ASC
                   ) AS assignment_rank
            FROM models
            WHERE model_id NOT IN (SELECT model_id FROM model_slots)
        )
        INSERT INTO model_slots(slot_number, model_id, assigned_utc_ms)
        SELECT free.slot_number, model.model_id, model.updated_utc_ms
        FROM ranked_free_slots AS free
        JOIN ranked_unassigned_models AS unassigned USING (assignment_rank)
        JOIN models AS model ON model.model_id = unassigned.model_id;
        """;
}
