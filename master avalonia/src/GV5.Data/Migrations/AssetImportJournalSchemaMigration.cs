namespace GV5.Data.Migrations;

/// <summary>Records file publication intent so interrupted AssetStore imports can be recovered safely.</summary>
public sealed class AssetImportJournalSchemaMigration : ISqliteMigration
{
    public int Version => 4;
    public string Name => "asset-import-journal";

    public string UpSql => """
        CREATE TABLE asset_import_journal (
            operation_id TEXT PRIMARY KEY NOT NULL CHECK (length(operation_id) = 36),
            asset_id TEXT NOT NULL CHECK (length(asset_id) = 36),
            sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
            relative_path TEXT NOT NULL UNIQUE CHECK (length(trim(relative_path)) > 0),
            staged_file_name TEXT NOT NULL UNIQUE CHECK (length(trim(staged_file_name)) > 0),
            media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
            byte_length INTEGER NOT NULL CHECK (byte_length > 0),
            pixel_width INTEGER NOT NULL CHECK (pixel_width > 0),
            pixel_height INTEGER NOT NULL CHECK (pixel_height > 0),
            created_utc_ms INTEGER NOT NULL CHECK (created_utc_ms >= 0)
        );

        CREATE INDEX idx_asset_import_journal_sha256 ON asset_import_journal(sha256);
        """;
}
