namespace GV5.Application.Contracts;

public enum DiagnosticEventCode
{
    ModelDraftSaveCompleted = 1,
    ModelDraftSaveFailed = 2,
    DraftRecoveryAvailable = 3,
    DraftRecoveryCompleted = 4,
    DraftRecoveryConflict = 5,
    BackupCreated = 6,
    BackupVerificationFailed = 7,
    BackupRestored = 8,
    BackupOperationFailed = 9,
    DraftCheckpointDiscarded = 10,
    AssetImportCompleted = 11,
    AssetImportFailed = 12,
    AssetRecoveryCompleted = 13,
    AssetRecoveryFailed = 14
}

public enum DiagnosticOutcome
{
    Success = 1,
    Warning = 2,
    Failure = 3
}

public enum DiagnosticErrorCode
{
    StorageFailure = 1,
    AccessDenied = 2,
    DiskFull = 3,
    RevisionConflict = 4,
    InvalidBackup = 5,
    Cancelled = 6,
    Unknown = 7,
    InvalidAsset = 8
}

public interface IOperationCorrelationContext
{
    Guid CurrentId { get; }
    IDisposable BeginScope(Guid? correlationId = null);
}

/// <summary>Writes allowlisted diagnostic fields only; event values carry no free-form message or document data.</summary>
public interface IStructuredDiagnosticLogger
{
    Task WriteAsync(
        DiagnosticEventCode eventCode,
        DiagnosticOutcome outcome,
        DiagnosticErrorCode? errorCode = null,
        long? durationMilliseconds = null,
        CancellationToken cancellationToken = default);
}

/// <summary>Test-tunable file retention policy. Production defaults to 5 MiB per file and 10 files.</summary>
public sealed record StructuredLogSettings(long MaximumFileBytes = 5 * 1024 * 1024, int RetainedFileCount = 10);
