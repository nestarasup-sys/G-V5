namespace GV5.Data.Migrations;

/// <summary>Stores editable poses pinned to immutable model revisions and append-only pose publications.</summary>
public sealed class PoseRepositorySchemaMigration : ISqliteMigration
{
    public int Version => 10;
    public string Name => "pose-drafts-and-revisions";

    public string UpSql => """
        CREATE TABLE pose_drafts (
            pose_id TEXT PRIMARY KEY NOT NULL CHECK (length(pose_id) = 36),
            model_revision_id TEXT NOT NULL REFERENCES model_revisions(revision_id) ON DELETE RESTRICT,
            model_revision_sequence INTEGER NOT NULL CHECK (model_revision_sequence >= 1),
            model_snapshot_sha256 TEXT NOT NULL CHECK (length(model_snapshot_sha256) = 64 AND model_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
            model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            pose_json TEXT NOT NULL CHECK (length(pose_json) > 0),
            pose_sha256 TEXT NOT NULL CHECK (length(pose_sha256) = 64 AND pose_sha256 NOT GLOB '*[^0-9a-f]*'),
            updated_utc_ms INTEGER NOT NULL CHECK (updated_utc_ms >= 0)
        );

        CREATE INDEX idx_pose_drafts_model_revision ON pose_drafts(model_revision_id, display_name COLLATE NOCASE, pose_id);

        CREATE TABLE pose_revisions (
            pose_revision_id TEXT PRIMARY KEY NOT NULL CHECK (length(pose_revision_id) = 36),
            pose_id TEXT NOT NULL CHECK (length(pose_id) = 36),
            model_revision_id TEXT NOT NULL REFERENCES model_revisions(revision_id) ON DELETE RESTRICT,
            model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
            published_utc_ms INTEGER NOT NULL CHECK (published_utc_ms >= 0),
            snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) > 0),
            snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
            UNIQUE (pose_id, revision)
        );

        CREATE INDEX idx_pose_revisions_pose_revision ON pose_revisions(pose_id, revision DESC);

        CREATE TRIGGER trg_pose_revisions_no_update
        BEFORE UPDATE ON pose_revisions
        BEGIN
            SELECT RAISE(ABORT, 'published pose revisions are immutable');
        END;

        CREATE TRIGGER trg_pose_revisions_no_delete
        BEFORE DELETE ON pose_revisions
        BEGIN
            SELECT RAISE(ABORT, 'published pose revisions are immutable');
        END;
        """;
}
