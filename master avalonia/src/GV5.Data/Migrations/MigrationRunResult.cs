namespace GV5.Data.Migrations;

public sealed record MigrationRunResult(int CurrentVersion, IReadOnlyList<int> AppliedVersions);
