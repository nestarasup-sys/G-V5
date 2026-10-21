namespace GV5.Application.Contracts;

public sealed record DataBackupArtifact(
    string DirectoryPath,
    string DatabasePath,
    string ManifestPath,
    string Sha256,
    long SizeBytes,
    DateTimeOffset CreatedUtc,
    int SchemaVersion);

public sealed record DataBackupVerification(bool IsValid, string? Error, DataBackupArtifact? Artifact);

public sealed record DataBackupRestoreResult(string DatabasePath, string DestinationRoot, int SchemaVersion);

/// <summary>Creates, verifies and restores self-contained, versioned snapshots of the current data platform.</summary>
public interface IDataPlatformBackupService
{
    Task<DataBackupArtifact> CreateAsync(CancellationToken cancellationToken = default);
    Task<DataBackupVerification> VerifyAsync(string backupDirectory, CancellationToken cancellationToken = default);
    Task<DataBackupRestoreResult> RestoreToNewRootAsync(
        string backupDirectory,
        string destinationRoot,
        CancellationToken cancellationToken = default);
}
