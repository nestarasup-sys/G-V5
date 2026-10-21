using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Core.Identity;
using GV5.Rendering;

namespace GV5.App.Presentation;

/// <summary>Adapts the durable asset store and shared decoded-image cache to the renderer contract.</summary>
internal sealed class AssetStoreRenderProvider(
    IAssetStore assetStore,
    AssetImageDecoder decoder,
    AssetBitmapCache cache) : IRenderAssetProvider
{
    private const int DecoderVersion = 1;

    public async Task<AssetImageLease> AcquireAsync(AssetId assetId, CancellationToken cancellationToken = default)
    {
        var metadataResult = await assetStore.GetMetadataAsync(assetId, cancellationToken).ConfigureAwait(false);
        if (metadataResult.IsFailure || metadataResult.Value.VerificationState != AssetVerificationState.Available)
        {
            throw new InvalidOperationException("The model preview references an unavailable image asset.");
        }

        var key = AssetImageCacheKey.Create(metadataResult.Value.Sha256, DecoderVersion);
        var cached = await cache.AcquireAsync(key, async token =>
        {
            var streamResult = await assetStore.OpenReadAsync(assetId, token).ConfigureAwait(false);
            if (streamResult.IsFailure)
            {
                throw new FileNotFoundException("The referenced image asset could not be opened.");
            }

            await using var stream = streamResult.Value;
            return await decoder.DecodeAsync(stream, token).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);

        if (cached.IsFailure)
        {
            throw new InvalidOperationException(cached.Error!.Message);
        }

        return cached.Lease!;
    }
}
