using GV5.Assets.Decoding;
using GV5.Core.Identity;

namespace GV5.Rendering;

/// <summary>Returns a disposable decoded image lease for an asset referenced by a render layer.</summary>
public interface IRenderAssetProvider
{
    Task<AssetImageLease> AcquireAsync(AssetId assetId, CancellationToken cancellationToken = default);
}
