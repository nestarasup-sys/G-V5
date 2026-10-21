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
    public void AssetId_New_CreatesValidRoundTrippableIdentity()
    {
        var id = AssetId.New();

        Assert.True(id.IsValid);
        Assert.Equal(id, AssetId.Parse(id.ToString()));
        Assert.True(AssetId.TryParse(id.ToString(), out var parsed));
        Assert.Equal(id, parsed);
    }

    [Fact]
    public void AssetId_RejectsEmptyOrMalformedValues()
    {
        Assert.Throws<ArgumentException>(() => AssetId.From(Guid.Empty));
        Assert.Throws<FormatException>(() => AssetId.Parse("not-an-id"));
        Assert.False(AssetId.TryParse(Guid.Empty.ToString("D"), out var parsed));
        Assert.False(parsed.IsValid);
    }

    [Fact]
    public void AssetReferenceKey_RequiresStableNonEmptyIdentifiers()
    {
        var ownerId = Guid.NewGuid();
        var key = AssetReferenceKey.Create("fabricator.model-part", ownerId, "sprite");

        Assert.Equal("fabricator.model-part", key.OwnerType);
        Assert.Equal(ownerId, key.OwnerId);
        Assert.Equal("sprite", key.Slot);
        Assert.Throws<ArgumentException>(() => AssetReferenceKey.Create("fabricator.model-part", Guid.Empty, "sprite"));
        Assert.Throws<ArgumentException>(() => AssetReferenceKey.Create("Fabricator.Model-Part", ownerId, "sprite"));
        Assert.Throws<ArgumentException>(() => AssetReferenceKey.Create("fabricator.model-part", ownerId, "../sprite"));
    }

    [Fact]
    public void Revision_RejectsNonPositiveValues()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Revision.From(0));
        Assert.Throws<ArgumentOutOfRangeException>(() => Revision.From(-1));
    }
}
