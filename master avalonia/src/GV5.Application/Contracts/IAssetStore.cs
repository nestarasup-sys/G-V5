using GV5.Core.Identity;

namespace GV5.Application.Contracts;

/// <summary>Application boundary for importing, reading and referencing binary assets.</summary>
public interface IAssetStore
{
    /// <summary>
    /// Imports bytes from the stream's current position. The caller retains ownership of the input stream.
    /// No physical path or Base64 representation is exposed to callers.
    /// </summary>
    Task<Result<AssetMetadata>> ImportAsync(
        Stream content,
        string mediaType,
        CancellationToken cancellationToken = default);

    /// <summary>Returns a readable stream owned by the caller, or NotFound if the ID is unknown.</summary>
    Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default);

    /// <summary>Returns metadata for an asset without exposing its storage path.</summary>
    Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Adds the stable owner/slot relation. Repeating the same relation is idempotent;
    /// assigning an occupied key to a different asset returns Conflict.
    /// </summary>
    Task<Result<Unit>> AddReferenceAsync(
        AssetId assetId,
        AssetReferenceKey reference,
        CancellationToken cancellationToken = default);

    /// <summary>Removes only the owner/slot relation; it never deletes the referenced asset bytes.</summary>
    Task<Result<Unit>> ReleaseReferenceAsync(
        AssetReferenceKey reference,
        CancellationToken cancellationToken = default);
}

/// <summary>Public, path-free facts about an asset's stored content.</summary>
public sealed record AssetMetadata(
    AssetId Id,
    string Sha256,
    string MediaType,
    long ByteLength,
    AssetVerificationState VerificationState,
    long CreatedUtcMs);

public enum AssetVerificationState
{
    Available = 1,
    Missing = 2,
    Corrupt = 3
}
