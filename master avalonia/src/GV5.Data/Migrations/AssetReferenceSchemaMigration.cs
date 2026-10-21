namespace GV5.Data.Migrations;

/// <summary>Persists stable owner/slot relationships without coupling asset bytes to domain rows.</summary>
public sealed class AssetReferenceSchemaMigration : ISqliteMigration
{
    public int Version => 5;
    public string Name => "asset-references";

    public string UpSql => """
        CREATE TABLE asset_references (
            owner_type TEXT NOT NULL CHECK (length(owner_type) BETWEEN 1 AND 80),
            owner_id TEXT NOT NULL CHECK (length(owner_id) = 36),
            slot TEXT NOT NULL CHECK (length(slot) BETWEEN 1 AND 64),
            asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE RESTRICT,
            created_utc_ms INTEGER NOT NULL CHECK (created_utc_ms >= 0),
            PRIMARY KEY (owner_type, owner_id, slot)
        );

        CREATE INDEX idx_asset_references_asset ON asset_references(asset_id);
        """;
}
