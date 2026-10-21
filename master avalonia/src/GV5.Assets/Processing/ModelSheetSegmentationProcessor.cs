using System.Buffers;
using SkiaSharp;
using GV5.Assets.Decoding;

namespace GV5.Assets.Processing;

/// <summary>One connected model component, cropped from the processed sheet with its legacy source coordinates.</summary>
public sealed record SegmentedModelPart(string Name, ImageCropBounds SourceBounds, byte[] PngBytes);

/// <summary>Owned PNG payloads and diagnostics from splitting a chroma-keyed model sheet.</summary>
public sealed record ModelSheetSegmentationResult(
    IReadOnlyList<SegmentedModelPart> Parts,
    SKColor SampledBackground,
    int RemovedPixelCount,
    int DespilledPixelCount);

/// <summary>
/// Ports the legacy four-neighbour connected-component split. Components smaller than 80 visible pixels are ignored,
/// accepted crops receive a four-pixel margin and are named from their location on the source sheet.
/// </summary>
public sealed class ModelSheetSegmentationProcessor(ChromaCropProcessor chromaProcessor)
{
    private const int MinimumVisibleAlpha = 24;
    private const int MinimumComponentPixels = 80;
    private const int CropMargin = 4;
    private readonly ChromaCropProcessor _chromaProcessor = chromaProcessor ?? throw new ArgumentNullException(nameof(chromaProcessor));

    public async Task<ModelSheetSegmentationResult> ProcessAsync(
        DecodedAssetImage source,
        int tolerance = 74,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        using var chroma = await PreviewChromaAsync(source, tolerance, cancellationToken).ConfigureAwait(false);

        var bitmap = chroma.Image.Bitmap;
        var pixelCount = checked(bitmap.Width * bitmap.Height);
        var visited = ArrayPool<byte>.Shared.Rent(pixelCount);
        var foreground = ArrayPool<byte>.Shared.Rent(pixelCount);
        var queue = ArrayPool<int>.Shared.Rent(pixelCount);
        var parts = new List<SegmentedModelPart>();
        try
        {
            Array.Clear(visited, 0, pixelCount);
            for (var y = 0; y < bitmap.Height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                for (var x = 0; x < bitmap.Width; x++)
                {
                    foreground[y * bitmap.Width + x] = bitmap.GetPixel(x, y).Alpha > MinimumVisibleAlpha ? (byte)1 : (byte)0;
                }
            }

            for (var start = 0; start < pixelCount; start++)
            {
                if ((start & 0x3FFFF) == 0)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                }
                if (visited[start] != 0 || foreground[start] == 0)
                {
                    continue;
                }

                var read = 0;
                var write = 0;
                queue[write++] = start;
                visited[start] = 1;
                var minX = bitmap.Width;
                var minY = bitmap.Height;
                var maxX = 0;
                var maxY = 0;
                while (read < write)
                {
                    if ((read & 0x3FFF) == 0)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                    }

                    var index = queue[read++];
                    var x = index % bitmap.Width;
                    var y = index / bitmap.Width;
                    minX = Math.Min(minX, x);
                    minY = Math.Min(minY, y);
                    maxX = Math.Max(maxX, x);
                    maxY = Math.Max(maxY, y);
                    if (x > 0) Visit(index - 1);
                    if (x + 1 < bitmap.Width) Visit(index + 1);
                    if (y > 0) Visit(index - bitmap.Width);
                    if (y + 1 < bitmap.Height) Visit(index + bitmap.Width);
                }

                if (write < MinimumComponentPixels)
                {
                    continue;
                }

                var left = Math.Max(0, minX - CropMargin);
                var top = Math.Max(0, minY - CropMargin);
                var right = Math.Min(bitmap.Width - 1, maxX + CropMargin);
                var bottom = Math.Min(bitmap.Height - 1, maxY + CropMargin);
                var bounds = new ImageCropBounds(
                    chroma.SourceBounds.X + left,
                    chroma.SourceBounds.Y + top,
                    right - left + 1,
                    bottom - top + 1);
                using var partBitmap = new SKBitmap(new SKImageInfo(bounds.Width, bounds.Height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
                if (partBitmap.GetPixels() == IntPtr.Zero)
                {
                    throw new InvalidOperationException("A model component image buffer could not be allocated.");
                }
                partBitmap.Erase(SKColors.Transparent);
                for (var cursor = 0; cursor < write; cursor++)
                {
                    var index = queue[cursor];
                    var x = index % bitmap.Width;
                    var y = index / bitmap.Width;
                    partBitmap.SetPixel(x - left, y - top, bitmap.GetPixel(x, y));
                }

                using var image = SKImage.FromBitmap(partBitmap);
                using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
                    ?? throw new InvalidOperationException("A separated model component could not be encoded as PNG.");
                var absoluteMinX = chroma.SourceBounds.X + minX;
                var absoluteMinY = chroma.SourceBounds.Y + minY;
                var absoluteMaxX = chroma.SourceBounds.X + maxX;
                var absoluteMaxY = chroma.SourceBounds.Y + maxY;
                parts.Add(new SegmentedModelPart(
                    GuessName(absoluteMinX, absoluteMinY, absoluteMaxX, absoluteMaxY, source.Width, source.Height),
                    bounds,
                    encoded.ToArray()));

                void Visit(int next)
                {
                    if (visited[next] != 0 || foreground[next] == 0)
                    {
                        return;
                    }
                    visited[next] = 1;
                    queue[write++] = next;
                }
            }

            parts.Sort(static (left, right) => left.SourceBounds.Y != right.SourceBounds.Y
                ? left.SourceBounds.Y.CompareTo(right.SourceBounds.Y)
                : left.SourceBounds.X.CompareTo(right.SourceBounds.X));
            return new ModelSheetSegmentationResult(parts.AsReadOnly(), chroma.SampledBackground, chroma.RemovedPixelCount, chroma.DespilledPixelCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(visited, clearArray: true);
            ArrayPool<byte>.Shared.Return(foreground, clearArray: true);
            ArrayPool<int>.Shared.Return(queue, clearArray: false);
        }
    }

    /// <summary>Applies the same chroma settings used by model segmentation without mutating the source.</summary>
    public Task<ChromaCropResult> PreviewChromaAsync(
        DecodedAssetImage source,
        int tolerance,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        return _chromaProcessor.ProcessAsync(
            source,
            new ChromaCropOptions(Tolerance: tolerance, Feather: 44, CropMargin: CropMargin),
            cancellationToken);
    }

    private static string GuessName(int minX, int minY, int maxX, int maxY, int width, int height)
    {
        var centerX = (minX + maxX) / 2d / width;
        var centerY = (minY + maxY) / 2d / height;
        if (centerY < 0.27) return "Cabeça";
        if (centerY > 0.70) return $"Canela {(centerX < 0.5 ? "esquerda" : "direita")}";
        if (centerY > 0.52) return $"Coxa {(centerX < 0.5 ? "esquerda" : "direita")}";
        if (centerY > 0.23 && centerY < 0.52 && centerX > 0.31 && centerX < 0.69) return "Tronco";
        if (centerX < 0.35 || centerX > 0.65) return centerY < 0.40
            ? $"Braço {(centerX < 0.5 ? "esquerdo" : "direito")}"
            : $"Antebraço {(centerX < 0.5 ? "esquerdo" : "direito")}";
        return "Peça do modelo";
    }
}
