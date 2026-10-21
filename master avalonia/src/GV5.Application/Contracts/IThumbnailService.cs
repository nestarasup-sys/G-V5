using GV5.Core.Identity;

namespace GV5.Application.Contracts;

public enum ThumbnailFitMode
{
    Contain = 1,
    Cover = 2,
    Stretch = 3
}

/// <summary>Immutable transformation settings used to identify a derived thumbnail on disk.</summary>
public sealed record ThumbnailRecipe
{
    public int Width { get; }
    public int Height { get; }
    public ThumbnailFitMode FitMode { get; }

    private ThumbnailRecipe(int width, int height, ThumbnailFitMode fitMode)
    {
        Width = width;
        Height = height;
        FitMode = fitMode;
    }

    public static ThumbnailRecipe Create(int width, int height, ThumbnailFitMode fitMode = ThumbnailFitMode.Contain)
    {
        const int maximumDimension = 4096;
        const long maximumPixels = 16_777_216;
        if (width < 1 || height < 1 || width > maximumDimension || height > maximumDimension || (long)width * height > maximumPixels)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "Thumbnail dimensions must be positive and stay within 4096 × 4096 pixels.");
        }

        if (!Enum.IsDefined(fitMode))
        {
            throw new ArgumentOutOfRangeException(nameof(fitMode));
        }

        return new ThumbnailRecipe(width, height, fitMode);
    }
}

/// <summary>Returns caller-owned streams for thumbnails derived from immutable asset content.</summary>
public interface IThumbnailService
{
    Task<Result<Stream>> GetOrCreateAsync(
        AssetId assetId,
        ThumbnailRecipe recipe,
        CancellationToken cancellationToken = default);
}
