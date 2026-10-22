namespace GV5.Data.Migrations;

/// <summary>Stores independently revised facial-detail libraries per Fabricator model slot.</summary>
public sealed class FaceDetailLibrarySchemaMigration : ISqliteMigration
{
    public int Version => 20;
    public string Name => "fabricator-face-detail-libraries";

    public string UpSql => """
        CREATE TABLE face_detail_libraries (
            library_id TEXT PRIMARY KEY NOT NULL CHECK (length(library_id) = 36),
            model_slot INTEGER NOT NULL UNIQUE CHECK (model_slot BETWEEN 1 AND 10),
            revision INTEGER NOT NULL CHECK (revision >= 1),
            draft_json TEXT NOT NULL CHECK (length(draft_json) > 0),
            draft_sha256 TEXT NOT NULL CHECK (length(draft_sha256) = 64 AND draft_sha256 NOT GLOB '*[^0-9a-f]*'),
            updated_utc_ms INTEGER NOT NULL CHECK (updated_utc_ms >= 0)
        );
        CREATE INDEX idx_face_detail_libraries_slot ON face_detail_libraries(model_slot);
        """;
}
