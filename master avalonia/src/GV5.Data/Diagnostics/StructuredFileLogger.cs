using System.Text.Json;
using System.Text.Json.Serialization;
using GV5.Application.Contracts;

namespace GV5.Data.Diagnostics;

/// <summary>Best-effort JSONL diagnostics with a fixed, non-sensitive schema and bounded rotation.</summary>
public sealed class StructuredFileLogger : IStructuredDiagnosticLogger
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    private readonly IAppDataPaths _paths;
    private readonly IOperationCorrelationContext _correlationContext;
    private readonly long _maximumFileBytes;
    private readonly int _retainedFileCount;
    private readonly SemaphoreSlim _writeGate = new(1, 1);

    public StructuredFileLogger(
        IAppDataPaths paths,
        IOperationCorrelationContext correlationContext,
        StructuredLogSettings? settings = null)
    {
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _correlationContext = correlationContext ?? throw new ArgumentNullException(nameof(correlationContext));
        settings ??= new StructuredLogSettings();
        if (settings.MaximumFileBytes < 128)
        {
            throw new ArgumentOutOfRangeException(nameof(settings), "Each log file must allow at least 128 bytes.");
        }

        if (settings.RetainedFileCount < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(settings), "At least one log file must be retained.");
        }

        _maximumFileBytes = settings.MaximumFileBytes;
        _retainedFileCount = settings.RetainedFileCount;
    }

    public async Task WriteAsync(
        DiagnosticEventCode eventCode,
        DiagnosticOutcome outcome,
        DiagnosticErrorCode? errorCode = null,
        long? durationMilliseconds = null,
        CancellationToken cancellationToken = default)
    {
        if (!Enum.IsDefined(eventCode) || !Enum.IsDefined(outcome) || (errorCode is not null && !Enum.IsDefined(errorCode.Value)))
        {
            throw new ArgumentOutOfRangeException(nameof(eventCode), "Diagnostic values must use the allowlisted enums.");
        }

        if (durationMilliseconds < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(durationMilliseconds));
        }

        var timestamp = DateTimeOffset.UtcNow;
        var correlationId = _correlationContext.CurrentId;
        if (correlationId == Guid.Empty)
        {
            correlationId = Guid.NewGuid();
        }

        var record = new DiagnosticLogRecord(timestamp, eventCode, outcome, correlationId, durationMilliseconds, errorCode);
        var json = JsonSerializer.SerializeToUtf8Bytes(record, JsonOptions);
        Array.Resize(ref json, json.Length + 1);
        json[^1] = (byte)'\n';

        try
        {
            await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                Directory.CreateDirectory(_paths.LogsDirectory);
                var path = SelectFilePath(timestamp, json.Length);
                await using (var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan))
                {
                    await stream.WriteAsync(json, cancellationToken).ConfigureAwait(false);
                    await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                }

                TrimOldFiles(path);
            }
            finally
            {
                _writeGate.Release();
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Diagnostics must never make persistence or recovery fail.
        }
    }

    private string SelectFilePath(DateTimeOffset timestamp, int nextRecordSize)
    {
        var day = timestamp.UtcDateTime.ToString("yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture);
        for (var segment = 0; segment < 100_000; segment++)
        {
            var fileName = segment == 0
                ? $"gv5-{day}.jsonl"
                : $"gv5-{day}-{segment:D3}.jsonl";
            var path = Path.Combine(_paths.LogsDirectory, fileName);
            if (!File.Exists(path) || new FileInfo(path).Length + nextRecordSize <= _maximumFileBytes)
            {
                return path;
            }
        }

        throw new IOException("No structured log segment is available.");
    }

    private void TrimOldFiles(string currentPath)
    {
        var files = Directory.EnumerateFiles(_paths.LogsDirectory, "gv5-*.jsonl")
            .Select(path => new FileInfo(path))
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .ThenByDescending(file => file.Name, StringComparer.Ordinal)
            .ToArray();

        foreach (var oldFile in files.Skip(_retainedFileCount))
        {
            if (!string.Equals(oldFile.FullName, currentPath, StringComparison.OrdinalIgnoreCase))
            {
                oldFile.Delete();
            }
        }
    }

    private sealed record DiagnosticLogRecord(
        DateTimeOffset TimestampUtc,
        DiagnosticEventCode EventCode,
        DiagnosticOutcome Outcome,
        Guid CorrelationId,
        long? DurationMilliseconds,
        DiagnosticErrorCode? ErrorCode);
}
