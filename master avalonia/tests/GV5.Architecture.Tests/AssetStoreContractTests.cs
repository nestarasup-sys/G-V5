using GV5.Application.Contracts;
using GV5.Core.Identity;
using Xunit;

namespace GV5.Architecture.Tests;

public sealed class AssetStoreContractTests
{
    [Fact]
    public void AssetStore_ExposesImportReadMetadataAndReferenceOperations()
    {
        var methods = typeof(IAssetStore).GetMethods().ToDictionary(method => method.Name, StringComparer.Ordinal);

        Assert.Equal(
            ["AddReferenceAsync", "GetMetadataAsync", "ImportAsync", "OpenReadAsync", "ReleaseReferenceAsync"],
            methods.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(typeof(Stream), methods[nameof(IAssetStore.ImportAsync)].GetParameters()[0].ParameterType);
        Assert.Equal(typeof(AssetId), methods[nameof(IAssetStore.OpenReadAsync)].GetParameters()[0].ParameterType);
        Assert.Equal(typeof(AssetId), methods[nameof(IAssetStore.GetMetadataAsync)].GetParameters()[0].ParameterType);
        Assert.Equal(typeof(AssetId), methods[nameof(IAssetStore.AddReferenceAsync)].GetParameters()[0].ParameterType);
        Assert.Equal(typeof(AssetReferenceKey), methods[nameof(IAssetStore.ReleaseReferenceAsync)].GetParameters()[0].ParameterType);
    }

    [Fact]
    public void AssetMetadata_DoesNotExposePhysicalPathsOrEmbeddedContent()
    {
        var propertyNames = typeof(AssetMetadata).GetProperties().Select(property => property.Name).ToArray();

        Assert.Contains(nameof(AssetMetadata.Id), propertyNames);
        Assert.Contains(nameof(AssetMetadata.Sha256), propertyNames);
        Assert.Contains(nameof(AssetMetadata.ByteLength), propertyNames);
        Assert.DoesNotContain(propertyNames, name => name.Contains("path", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(propertyNames, name => name.Contains("base64", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(propertyNames, name => name.Contains("bytes", StringComparison.OrdinalIgnoreCase));
    }
}
