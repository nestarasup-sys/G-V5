using Avalonia.Headless.XUnit;
using GV5.Application.Contracts;
using GV5.Data.Diagnostics;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Modules.Fabricador.ViewModels;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class PrivacySafePersistenceLoggingTests
{
    [AvaloniaFact]
    public async Task FabricatorSave_LogsOutcomeAndCorrelationWithoutDraftContentOrFilePaths()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-safe-log-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        using var database = new SqliteDatabase(paths);
        var initializer = new SqliteMigrationRunner(database, [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration()]);
        var correlation = new OperationCorrelationContext();
        var logger = new StructuredFileLogger(paths, correlation);
        var viewModel = new FabricadorViewModel(
            new SqliteModelDraftRepository(database),
            initializer,
            logger: logger,
            correlationContext: correlation);

        try
        {
            const string privateName = "PRIVATE_DRAFT_NAME_73A1";
            viewModel.ModelName = privateName;
            await viewModel.SaveCommand.ExecuteAsync(null);

            var file = Assert.Single(Directory.GetFiles(paths.LogsDirectory, "gv5-*.jsonl"));
            var jsonLine = Assert.Single(await File.ReadAllLinesAsync(file, cancellationToken));
            Assert.Contains("modelDraftSaveCompleted", jsonLine, StringComparison.Ordinal);
            Assert.DoesNotContain(privateName, jsonLine, StringComparison.Ordinal);
            Assert.DoesNotContain(paths.DatabaseFile, jsonLine, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("message", jsonLine, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("modelName", jsonLine, StringComparison.OrdinalIgnoreCase);
            using var parsed = System.Text.Json.JsonDocument.Parse(jsonLine);
            Assert.NotEqual(Guid.Empty, parsed.RootElement.GetProperty("correlationId").GetGuid());
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }
}
