namespace GV5.Data.Migrations;

/// <summary>Creates the shared asset metadata foundation; file import and lifecycle arrive in F03.</summary>
public sealed class InitialAssetSchemaMigration : ISqliteMigration
{
    public int Version => 1;
    public string Name => "initial-asset-metadata";

    public string UpSql => """
        CREATE TABLE assets (
            asset_id TEXT PRIMARY KEY NOT NULL CHECK (length(asset_id) = 36),
            sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
            relative_path TEXT NOT NULL UNIQUE CHECK (length(trim(relative_path)) > 0),
            mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) > 0),
            byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
            verification_state TEXT NOT NULL CHECK (verification_state IN ('available', 'missing', 'corrupt')),
            created_utc_ms INTEGER NOT NULL CHECK (created_utc_ms >= 0)
        );

        CREATE TABLE asset_derivatives (
            derivative_id TEXT PRIMARY KEY NOT NULL CHECK (length(derivative_id) = 36),
            source_asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE RESTRICT,
            derivative_asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE RESTRICT,
            kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
            generator_version TEXT NOT NULL CHECK (length(trim(generator_version)) > 0),
            recipe_hash TEXT NOT NULL CHECK (length(recipe_hash) = 64 AND recipe_hash NOT GLOB '*[^0-9a-f]*'),
            created_utc_ms INTEGER NOT NULL CHECK (created_utc_ms >= 0),
            UNIQUE (source_asset_id, kind, generator_version, recipe_hash),
            CHECK (source_asset_id <> derivative_asset_id)
        );

        CREATE INDEX idx_assets_verification_state ON assets(verification_state);
        CREATE INDEX idx_asset_derivatives_source ON asset_derivatives(source_asset_id);
        """;
}
