using GV5.Geometry;
using SkiaSharp;

namespace GV5.Rendering;

public sealed record SkiaRendererLimits
{
    public int MaximumDimension { get; }
    public long MaximumPixels { get; }

    public SkiaRendererLimits(int maximumDimension = 8192, long maximumPixels = 32_000_000)
    {
        if (maximumDimension < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumDimension));
        }
        if (maximumPixels < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumPixels));
        }
        MaximumDimension = maximumDimension;
        MaximumPixels = maximumPixels;
    }
}

/// <summary>Rasterizes immutable render snapshots using Skia's CPU raster surface.</summary>
public sealed class SkiaRenderer(IRenderAssetProvider assets, SkiaRendererLimits? limits = null) : IRenderSceneRenderer
{
    private readonly IRenderAssetProvider _assets = assets ?? throw new ArgumentNullException(nameof(assets));
    private readonly SkiaRendererLimits _limits = limits ?? new SkiaRendererLimits();

    public Task<RenderedFrame> RenderAsync(RenderScene scene, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(scene);
        ValidateDimensions(scene.Width, scene.Height);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.Run(() => RenderCoreAsync(scene, cancellationToken), cancellationToken);
    }

    private async Task<RenderedFrame> RenderCoreAsync(RenderScene scene, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var info = new SKImageInfo(scene.Width, scene.Height, SKColorType.Rgba8888, SKAlphaType.Premul);
        using var surface = SKSurface.Create(info) ?? throw new InvalidOperationException("Skia could not create a raster surface.");
        var canvas = surface.Canvas;
        canvas.Clear(SKColors.Transparent);

        foreach (var layer in scene.Layers)
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var lease = await _assets.AcquireAsync(layer.AssetId, cancellationToken).ConfigureAwait(false);
            DrawLayer(canvas, layer, lease.Bitmap, scene.Height);
        }

        cancellationToken.ThrowIfCancellationRequested();
        using var snapshot = surface.Snapshot();
        var bitmap = SKBitmap.FromImage(snapshot) ?? throw new InvalidOperationException("Skia could not copy the raster surface.");
        try
        {
            return new RenderedFrame(bitmap);
        }
        catch
        {
            bitmap.Dispose();
            throw;
        }
    }

    private void ValidateDimensions(int width, int height)
    {
        if (width > _limits.MaximumDimension || height > _limits.MaximumDimension || (long)width * height > _limits.MaximumPixels)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "Render target exceeds the configured dimension or pixel budget.");
        }
    }

    internal SKRect? GetLayerCullRect(RenderLayer layer, int targetWidth, int targetHeight)
    {
        var cropBounds = new Rect2D(0, 0, layer.Crop.Width, layer.Crop.Height);
        var bounds = CreateLayerMatrix(layer, targetHeight).TransformBounds(cropBounds);
        // Keep a one-pixel guard for linear sampling, while retaining the scene's full-coordinate transform.
        var left = (int)Math.Clamp(Math.Floor(bounds.Left) - 1, 0, targetWidth);
        var top = (int)Math.Clamp(Math.Floor(bounds.Top) - 1, 0, targetHeight);
        var right = (int)Math.Clamp(Math.Ceiling(bounds.Right) + 1, 0, targetWidth);
        var bottom = (int)Math.Clamp(Math.Ceiling(bounds.Bottom) + 1, 0, targetHeight);
        return right <= left || bottom <= top ? null : SKRect.Create(left, top, right - left, bottom - top);
    }

    internal static void DrawLayer(SKCanvas canvas, RenderLayer layer, SKBitmap bitmap, int targetHeight)
    {
        var crop = layer.Crop;
        var viewMatrix = CreateLayerMatrix(layer, targetHeight);

        var saveCount = canvas.Save();
        try
        {
            canvas.Concat(new SKMatrix
            {
                ScaleX = (float)viewMatrix.M11,
                SkewY = (float)viewMatrix.M12,
                SkewX = (float)viewMatrix.M21,
                ScaleY = (float)viewMatrix.M22,
                TransX = (float)viewMatrix.OffsetX,
                TransY = (float)viewMatrix.OffsetY,
                Persp0 = 0,
                Persp1 = 0,
                Persp2 = 1
            });

            using var paint = new SKPaint
            {
                Color = new SKColor(255, 255, 255, (byte)Math.Round(layer.Alpha * 255)),
                BlendMode = ToSkiaBlendMode(layer.BlendMode),
                IsAntialias = false
            };
            var source = new SKRect((float)crop.X, (float)crop.Y, (float)crop.Right, (float)crop.Bottom);
            var destination = new SKRect(0, 0, (float)crop.Width, (float)crop.Height);
            using var image = SKImage.FromBitmap(bitmap);
            canvas.DrawImage(image, source, destination, new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.None), paint);
        }
        finally
        {
            canvas.RestoreToCount(saveCount);
        }
    }

    private static Matrix2D CreateLayerMatrix(RenderLayer layer, int targetHeight)
    {
        var yFlip = Matrix2D.CreateScale(1, -1);
        var viewMatrix = Matrix2D.CreateTranslation(0, targetHeight)
            * yFlip
            * layer.Transform.Matrix
            * Matrix2D.CreateTranslation(0, layer.Crop.Height)
            * yFlip;

        return viewMatrix;
    }

    internal static SKBlendMode ToSkiaBlendMode(RenderBlendMode blendMode) => blendMode switch
    {
        RenderBlendMode.Normal => SKBlendMode.SrcOver,
        RenderBlendMode.Multiply => SKBlendMode.Multiply,
        RenderBlendMode.Screen => SKBlendMode.Screen,
        RenderBlendMode.Add => SKBlendMode.Plus,
        _ => throw new ArgumentOutOfRangeException(nameof(blendMode))
    };
}
