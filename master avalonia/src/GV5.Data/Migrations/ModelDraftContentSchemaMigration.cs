namespace GV5.Data.Migrations;

/// <summary>Stores versioned Fabricator metadata separately from hash-addressed image bytes.</summary>
public sealed class ModelDraftContentSchemaMigration : ISqliteMigration
{
    public int Version => 7;
    public string Name => "model-draft-content";

    public string UpSql => """
        CREATE TABLE model_draft_contents (
            model_id TEXT PRIMARY KEY NOT NULL REFERENCES models(model_id) ON DELETE CASCADE,
            content_revision INTEGER NOT NULL CHECK (content_revision >= 1),
            schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
            slot INTEGER CHECK (slot IS NULL OR slot BETWEEN 1 AND 10),
            source_asset_id TEXT REFERENCES assets(asset_id) ON DELETE RESTRICT,
            source_width INTEGER,
            source_height INTEGER,
            updated_utc_ms INTEGER NOT NULL CHECK (updated_utc_ms >= 0),
            CHECK ((source_asset_id IS NULL AND source_width IS NULL AND source_height IS NULL) OR
                    (source_asset_id IS NOT NULL AND source_width > 0 AND source_height > 0))
        );

        CREATE TABLE model_draft_parts (
            model_id TEXT NOT NULL REFERENCES model_draft_contents(model_id) ON DELETE CASCADE,
            part_id TEXT NOT NULL CHECK (length(part_id) = 36),
            part_index INTEGER NOT NULL CHECK (part_index >= 0),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE RESTRICT,
            crop_x REAL NOT NULL,
            crop_y REAL NOT NULL,
            crop_width REAL NOT NULL CHECK (crop_width > 0),
            crop_height REAL NOT NULL CHECK (crop_height > 0),
            transform_x REAL NOT NULL,
            transform_y REAL NOT NULL,
            scale_x REAL NOT NULL,
            scale_y REAL NOT NULL,
            rotation_radians REAL NOT NULL,
            pivot_x REAL NOT NULL,
            pivot_y REAL NOT NULL,
            flip_x INTEGER NOT NULL CHECK (flip_x IN (0, 1)),
            flip_y INTEGER NOT NULL CHECK (flip_y IN (0, 1)),
            source_crop_x REAL NOT NULL,
            source_crop_y REAL NOT NULL,
            source_crop_width REAL NOT NULL CHECK (source_crop_width > 0),
            source_crop_height REAL NOT NULL CHECK (source_crop_height > 0),
            source_transform_x REAL NOT NULL,
            source_transform_y REAL NOT NULL,
            source_scale_x REAL NOT NULL,
            source_scale_y REAL NOT NULL,
            source_rotation_radians REAL NOT NULL,
            source_pivot_x REAL NOT NULL,
            source_pivot_y REAL NOT NULL,
            source_flip_x INTEGER NOT NULL CHECK (source_flip_x IN (0, 1)),
            source_flip_y INTEGER NOT NULL CHECK (source_flip_y IN (0, 1)),
            is_visible INTEGER NOT NULL CHECK (is_visible IN (0, 1)),
            PRIMARY KEY (model_id, part_id),
            UNIQUE (model_id, part_index)
        );

        CREATE TABLE model_draft_layer_order (
            model_id TEXT NOT NULL,
            layer_index INTEGER NOT NULL CHECK (layer_index >= 0),
            part_id TEXT NOT NULL,
            PRIMARY KEY (model_id, layer_index),
            UNIQUE (model_id, part_id),
            FOREIGN KEY (model_id, part_id) REFERENCES model_draft_parts(model_id, part_id) ON DELETE CASCADE
        );

        CREATE INDEX idx_model_draft_parts_asset ON model_draft_parts(asset_id);
        CREATE INDEX idx_model_draft_contents_source ON model_draft_contents(source_asset_id);
        """;
}
