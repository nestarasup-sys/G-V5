namespace GV5.Data.Migrations;

/// <summary>Stores editable model rig connections with the model draft lifecycle.</summary>
public sealed class ModelRigJointSchemaMigration : ISqliteMigration
{
    public int Version => 9;
    public string Name => "model-rig-joints";

    public string UpSql => """
        CREATE TABLE model_draft_rig_joints (
            model_id TEXT NOT NULL REFERENCES model_draft_contents(model_id) ON DELETE CASCADE,
            joint_id TEXT NOT NULL CHECK (length(joint_id) = 36),
            joint_index INTEGER NOT NULL CHECK (joint_index >= 0),
            parent_part_id TEXT NOT NULL,
            child_part_id TEXT NOT NULL,
            parent_anchor_x REAL NOT NULL,
            parent_anchor_y REAL NOT NULL,
            child_anchor_x REAL NOT NULL,
            child_anchor_y REAL NOT NULL,
            mode INTEGER NOT NULL CHECK (mode IN (1, 2)),
            is_suggested INTEGER NOT NULL CHECK (is_suggested IN (0, 1)),
            PRIMARY KEY (model_id, joint_id),
            UNIQUE (model_id, joint_index),
            UNIQUE (model_id, child_part_id),
            FOREIGN KEY (model_id, parent_part_id) REFERENCES model_draft_parts(model_id, part_id) ON DELETE CASCADE,
            FOREIGN KEY (model_id, child_part_id) REFERENCES model_draft_parts(model_id, part_id) ON DELETE CASCADE
        );
        """;
}
