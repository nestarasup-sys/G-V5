using GV5.Core.Identity;
using GV5.Core.Models;
using Xunit;

namespace GV5.Core.Tests;

public sealed class ModelDraftTests
{
    [Fact]
    public void Create_TrimsNameAndStartsAtRevisionOne()
    {
        var draft = ModelDraft.Create("  Base G5  ", 1234);

        Assert.True(draft.Id.IsValid);
        Assert.Equal(Revision.Initial, draft.Revision);
        Assert.Equal("Base G5", draft.Name);
        Assert.Equal(1234, draft.CreatedUtcMs);
        Assert.Equal(1234, draft.UpdatedUtcMs);
    }

    [Fact]
    public void Rename_IncrementsRevisionOnlyWhenNameChanges()
    {
        var initial = ModelDraft.Create("Base", 100);
        var unchanged = initial.Rename(" Base ", 100);
        var renamed = initial.Rename("Novo nome", 200);

        Assert.Same(initial, unchanged);
        Assert.Equal(Revision.From(2), renamed.Revision);
        Assert.Equal(initial.CreatedUtcMs, renamed.CreatedUtcMs);
        Assert.Equal(200, renamed.UpdatedUtcMs);
    }

    [Fact]
    public void CreateAndRename_RejectInvalidNamesAndTimeRegression()
    {
        Assert.Throws<ArgumentException>(() => ModelDraft.Create("  ", 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => ModelDraft.Create(new string('x', 121), 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => ModelDraft.Create("Base", -1));

        var draft = ModelDraft.Create("Base", 100);
        Assert.Throws<ArgumentOutOfRangeException>(() => draft.Rename("Alterado", 99));
    }

    [Fact]
    public void Checkpoint_PreservesStableDraftIdentityAndExpectedRevision()
    {
        var modelId = ModelId.New();
        var checkpoint = ModelDraftCheckpoint.Create(modelId, Revision.From(3), "  Recuperar  ", 456);

        var draft = ModelDraft.Create(checkpoint.ModelId, checkpoint.Name, checkpoint.CreatedUtcMs);

        Assert.Equal(modelId, draft.Id);
        Assert.Equal("Recuperar", draft.Name);
        Assert.Equal(Revision.Initial, draft.Revision);
        Assert.Equal(Revision.From(3), checkpoint.ExpectedRevision);
        Assert.NotEqual(Guid.Empty, checkpoint.CheckpointId);
    }

    [Fact]
    public void Checkpoint_RejectsInvalidIdentityRevisionNameAndTime()
    {
        Assert.Throws<ArgumentException>(() => ModelDraftCheckpoint.Create(default, null, "Modelo", 1));
        Assert.Throws<ArgumentException>(() => ModelDraftCheckpoint.Create(ModelId.New(), default(Revision), "Modelo", 1));
        Assert.Throws<ArgumentException>(() => ModelDraftCheckpoint.Create(ModelId.New(), null, " ", 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => ModelDraftCheckpoint.Create(ModelId.New(), null, new string('x', 121), 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => ModelDraftCheckpoint.Create(ModelId.New(), null, "Modelo", -1));
    }
}
