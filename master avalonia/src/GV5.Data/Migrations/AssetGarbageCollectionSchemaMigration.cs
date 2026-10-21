namespace GV5.Data.Migrations;

/// <summary>Tracks unreferenced asset grace periods and recoverable garbage collection operations.</summary>
public sealed class AssetGarbageCollectionSchemaMigration : ISqliteMigration
{
    public int Version => 6;
    public string Name => "asset-garbage-collection";

    public string UpSql => """
        CREATE TABLE asset_gc_candidates (
            asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
            unreferenced_since_utc_ms INTEGER NOT NULL CHECK (unreferenced_since_utc_ms >= 0)
        );

        CREATE INDEX idx_asset_gc_candidates_since ON asset_gc_candidates(unreferenced_since_utc_ms, asset_id);

        CREATE TABLE asset_gc_operations (
            operation_id TEXT PRIMARY KEY NOT NULL CHECK (length(operation_id) = 36),
            asset_id TEXT NOT NULL CHECK (length(asset_id) = 36),
            sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
            relative_path TEXT NOT NULL CHECK (length(trim(relative_path)) > 0),
            trash_relative_path TEXT NOT NULL UNIQUE CHECK (length(trim(trash_relative_path)) > 0),
            backup_directory_name TEXT NOT NULL CHECK (length(trim(backup_directory_name)) > 0),
            trashed_utc_ms INTEGER NOT NULL CHECK (trashed_utc_ms >= 0),
            purged_utc_ms INTEGER CHECK (purged_utc_ms IS NULL OR purged_utc_ms >= trashed_utc_ms)
        );

        CREATE INDEX idx_asset_gc_operations_trash ON asset_gc_operations(purged_utc_ms, trashed_utc_ms);
        """;
}
