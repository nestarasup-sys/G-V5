using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Data.Assets;
using GV5.Data.Migrations;
using GV5.Data.Storage;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteAssetCatalogTests
{
    [Fact]
    public async Task GetPageAsync_UsesStableKeysetOrderAcrossReopenWithoutRepeatsOrSkips()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-asset-catalog-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var created = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var expected = Enumerable.Range(0, 7)
            .Select(_ => AssetId.New())
            .OrderByDescending(id => id.ToString(), StringComparer.Ordinal)
            .ToArray();

        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                var initializer = CreateInitializer(database);
                await initializer.InitializeAsync(cancellationToken);
                await database.ExecuteWriteAsync(async (connection, transaction, token) =>
                {
                    for (var index = 0; index < expected.Length; index++)
                    {
                        await using var command = connection.CreateCommand();
                        command.Transaction = transaction;
                        command.CommandText = "INSERT INTO assets(asset_id, sha256, relative_path, mime_type, byte_length, verification_state, created_utc_ms) VALUES ($id, $hash, $path, 'image/png', 1, 'available', $created);";
                        command.Parameters.AddWithValue("$id", expected[index].ToString());
                        command.Parameters.AddWithValue("$hash", index.ToString("x64"));
                        command.Parameters.AddWithValue("$path", $"sha256/{index:x2}/{index:x64}");
                        command.Parameters.AddWithValue("$created", created);
                        await command.ExecuteNonQueryAsync(token);
                    }

                    return true;
                }, cancellationToken);

                var firstCatalog = new SqliteAssetCatalog(database, initializer);
                var first = await firstCatalog.GetPageAsync(AssetPageRequest.Create(3), cancellationToken);
                Assert.True(first.IsSuccess, first.Error?.Message);
                Assert.True(first.Value.HasMore);
                Assert.NotNull(first.Value.NextCursor);
                Assert.Equal(expected.Take(3), first.Value.Items.Select(item => item.Id));
                Assert.Equal(created, first.Value.Items[0].CreatedUtcMs);
            }

            using var reopenedDatabase = new SqliteDatabase(paths);
            var reopenedInitializer = CreateInitializer(reopenedDatabase);
            var catalog = new SqliteAssetCatalog(reopenedDatabase, reopenedInitializer);
            var collected = new List<AssetId>();
            AssetPageCursor? cursor = null;
            do
            {
                var page = await catalog.GetPageAsync(AssetPageRequest.Create(3, cursor), cancellationToken);
                Assert.True(page.IsSuccess, page.Error?.Message);
                collected.AddRange(page.Value.Items.Select(item => item.Id));
                cursor = page.Value.NextCursor;
                if (page.Value.HasMore)
                {
                    Assert.NotNull(cursor);
                }
            } while (cursor is not null);

            Assert.Equal(expected, collected);
            Assert.Equal(collected.Count, collected.Distinct().Count());
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Fact]
    public async Task GetPageAsync_EmptyCatalogReturnsNoCursorOrMorePages()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-asset-catalog-empty-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        try
        {
            using var database = new SqliteDatabase(paths);
            var initializer = CreateInitializer(database);
            var result = await new SqliteAssetCatalog(database, initializer)
                .GetPageAsync(AssetPageRequest.Create(10), cancellationToken);
            Assert.True(result.IsSuccess, result.Error?.Message);
            Assert.Empty(result.Value.Items);
            Assert.Null(result.Value.NextCursor);
            Assert.False(result.Value.HasMore);
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    private static SqliteMigrationRunner CreateInitializer(SqliteDatabase database) => new(
        database,
        [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration(), new ModelDraftCheckpointSchemaMigration(), new AssetImportJournalSchemaMigration(), new AssetReferenceSchemaMigration()]);
}
