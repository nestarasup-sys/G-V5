using System.Text.Json;
using GV5.Application.Contracts;
using GV5.Data.Diagnostics;
using GV5.Data.Storage;
using Xunit;

namespace GV5.Data.Tests;

public sealed class StructuredFileLoggerTests
{
    [Fact]
    public async Task Logger_WritesFixedAllowlistedFieldsWithTheCurrentCorrelationId()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var correlation = new OperationCorrelationContext();
        var logger = new StructuredFileLogger(paths, correlation);
        var cancellationToken = TestContext.Current.CancellationToken;
        var expectedId = Guid.NewGuid();
        try
        {
            using (correlation.BeginScope(expectedId))
            {
                await logger.WriteAsync(
                    DiagnosticEventCode.BackupCreated,
                    DiagnosticOutcome.Success,
                    durationMilliseconds: 41,
                    cancellationToken: cancellationToken);
            }

            var file = Assert.Single(Directory.GetFiles(paths.LogsDirectory, "gv5-*.jsonl"));
            var line = Assert.Single(await File.ReadAllLinesAsync(file, cancellationToken));
            using var json = JsonDocument.Parse(line);
            var record = json.RootElement;
            Assert.Equal("backupCreated", record.GetProperty("eventCode").GetString());
            Assert.Equal("success", record.GetProperty("outcome").GetString());
            Assert.Equal(expectedId, record.GetProperty("correlationId").GetGuid());
            Assert.Equal(41, record.GetProperty("durationMilliseconds").GetInt64());
            Assert.True(record.TryGetProperty("timestampUtc", out _));
            Assert.Equal(
                new[] { "timestampUtc", "eventCode", "outcome", "correlationId", "durationMilliseconds", "errorCode" }.Order(StringComparer.Ordinal),
                record.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal));
            Assert.DoesNotContain("message", line, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("path", line, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("payload", line, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task Logger_RotatesBySizeAndKeepsOnlyConfiguredNumberOfFiles()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var correlation = new OperationCorrelationContext();
        var logger = new StructuredFileLogger(paths, correlation, new StructuredLogSettings(MaximumFileBytes: 256, RetainedFileCount: 2));
        var cancellationToken = TestContext.Current.CancellationToken;
        try
        {
            for (var index = 0; index < 8; index++)
            {
                await logger.WriteAsync(
                    DiagnosticEventCode.ModelDraftSaveFailed,
                    DiagnosticOutcome.Failure,
                    DiagnosticErrorCode.StorageFailure,
                    durationMilliseconds: index,
                    cancellationToken: cancellationToken);
            }

            var files = Directory.GetFiles(paths.LogsDirectory, "gv5-*.jsonl");
            Assert.Equal(2, files.Length);
            Assert.All(files, file => Assert.True(new FileInfo(file).Length <= 256));
            var retainedLines = files.SelectMany(File.ReadAllLines).ToArray();
            Assert.Equal(2, retainedLines.Length);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public void CorrelationScopes_InheritForNestedCalls_AndRestoreParentAfterExit()
    {
        var context = new OperationCorrelationContext();
        var outerId = Guid.NewGuid();
        var childId = Guid.NewGuid();

        using (context.BeginScope(outerId))
        {
            Assert.Equal(outerId, context.CurrentId);
            using (context.BeginScope())
            {
                Assert.Equal(outerId, context.CurrentId);
            }

            using (context.BeginScope(childId))
            {
                Assert.Equal(childId, context.CurrentId);
            }

            Assert.Equal(outerId, context.CurrentId);
        }

        Assert.Equal(Guid.Empty, context.CurrentId);
    }

    private static string NewTempRoot() => Path.Combine(Path.GetTempPath(), $"gv5-logs-{Guid.NewGuid():N}");

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
