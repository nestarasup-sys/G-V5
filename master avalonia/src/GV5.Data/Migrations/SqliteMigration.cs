namespace GV5.Data.Migrations;

public sealed class SqliteMigration : ISqliteMigration
{
    public SqliteMigration(int version, string name, string upSql)
    {
        if (version < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(version), "Migration versions start at 1.");
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(upSql);
        Version = version;
        Name = name;
        UpSql = upSql;
    }

    public int Version { get; }
    public string Name { get; }
    public string UpSql { get; }
}
