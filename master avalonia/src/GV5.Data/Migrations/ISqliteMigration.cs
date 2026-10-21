namespace GV5.Data.Migrations;

/// <summary>An immutable, ordered SQLite schema change.</summary>
public interface ISqliteMigration
{
    int Version { get; }
    string Name { get; }
    string UpSql { get; }
}
