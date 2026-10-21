using GV5.Core.Identity;
using Xunit;

namespace GV5.Core.Tests;

public sealed class TypedIdentityTests
{
    [Fact]
    public void ModelId_New_CreatesValidRoundTrippableIdentity()
    {
        var id = ModelId.New();

        Assert.True(id.IsValid);
        Assert.Equal(id, ModelId.Parse(id.ToString()));
    }

    [Fact]
    public void ModelId_From_RejectsEmptyGuid()
    {
        Assert.Throws<ArgumentException>(() => ModelId.From(Guid.Empty));
    }

    [Fact]
    public void Revision_RejectsNonPositiveValues()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Revision.From(0));
        Assert.Throws<ArgumentOutOfRangeException>(() => Revision.From(-1));
    }
}
