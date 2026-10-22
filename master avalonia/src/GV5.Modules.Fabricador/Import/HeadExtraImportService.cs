using System.Runtime.InteropServices;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using SkiaSharp;

namespace GV5.Modules.Fabricador.Import;

/// <summary>Applies the legacy green-key and transparent-edge crop to a single head accessory image.</summary>
public sealed class HeadExtraImportService(AssetImportStager stager, AssetImageDecoder decoder)
{
    private readonly AssetImportStager _stager = stager ?? throw new ArgumentNullException(nameof(stager));
    private readonly AssetImageDecoder _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));

    public async Task<PreparedHeadExtra> PrepareAsync(Stream source, string mediaType,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        await using var staged = await _stager.StageAsync(source, mediaType, cancellationToken).ConfigureAwait(false);
        await using var input = await staged.OpenReadAsync(cancellationToken).ConfigureAwait(false);
        var decoded = await _decoder.DecodeAsync(input, cancellationToken).ConfigureAwait(false);
        if (decoded.IsFailure)
            throw new InvalidDataException(decoded.Error!.Message);

        using var image = decoded.Image!;
        return await Task.Run(() => Process(image.Bitmap, cancellationToken), cancellationToken).ConfigureAwait(false);
    }

    private static PreparedHeadExtra Process(SKBitmap source, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (source.ColorType != SKColorType.Rgba8888 || source.AlphaType != SKAlphaType.Unpremul)
            throw new InvalidDataException("A imagem do extra de cabeça não pode ser processada neste formato.");

        using var processed = source.Copy() ?? throw new InvalidOperationException("Não foi possível preparar o extra de cabeça.");
        var key = SampleGreenKey(source, cancellationToken);
        var removed = key is { } greenKey ? RemoveGreen(processed, greenKey, cancellationToken) : 0;
        var bounds = FindVisibleBounds(processed, cancellationToken);
        if (bounds is null)
            throw new InvalidDataException("Não restou nenhum desenho visível após preparar o extra de cabeça.");

        using var cropped = Crop(processed, bounds.Value, cancellationToken);
        using var encodedImage = SKImage.FromBitmap(cropped);
        using var encoded = encodedImage.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("Não foi possível codificar o extra de cabeça como PNG.");
        return new PreparedHeadExtra(cropped.Width, cropped.Height, encoded.ToArray(), removed, key.HasValue);
    }

    private static SKColor? SampleGreenKey(SKBitmap source, CancellationToken cancellationToken)
    {
        var stride = Math.Max(1, Math.Min(source.Width, source.Height) / 180);
        var samples = new List<SKColor>((source.Width + source.Height) / stride * 2 + 4);
        var row = new byte[checked(source.Width * 4)];
        for (var y = 0; y < source.Height; y += stride)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(source.GetPixels(), checked(y * source.RowBytes)), row, 0, row.Length);
            AddGreenSample(samples, row, 0);
            AddGreenSample(samples, row, (source.Width - 1) * 4);
        }

        Marshal.Copy(source.GetPixels(), row, 0, row.Length);
        var top = row.ToArray();
        Marshal.Copy(IntPtr.Add(source.GetPixels(), checked((source.Height - 1) * source.RowBytes)), row, 0, row.Length);
        var bottom = row.ToArray();
        for (var x = 0; x < source.Width; x += stride)
        {
            AddGreenSample(samples, top, x * 4);
            AddGreenSample(samples, bottom, x * 4);
        }

        var perimeterSampleCount = (int)Math.Ceiling(source.Width / (double)stride) * 2
            + (int)Math.Ceiling(source.Height / (double)stride) * 2;
        if (samples.Count < Math.Max(4, perimeterSampleCount * .12)) return null;
        return new SKColor(Median(samples.Select(color => color.Red)), Median(samples.Select(color => color.Green)),
            Median(samples.Select(color => color.Blue)));
    }

    private static void AddGreenSample(List<SKColor> samples, byte[] row, int offset)
    {
        var red = row[offset];
        var green = row[offset + 1];
        var blue = row[offset + 2];
        if (row[offset + 3] > 16 && green > red * 1.15 && green > blue * 1.08
            && green - Math.Max(red, blue) > 18)
            samples.Add(new SKColor(red, green, blue));
    }

    private static byte Median(IEnumerable<byte> values)
    {
        var ordered = values.Order().ToArray();
        return ordered[ordered.Length / 2];
    }

    private static int RemoveGreen(SKBitmap bitmap, SKColor key, CancellationToken cancellationToken)
    {
        const double hardTolerance = 105;
        const double featherTolerance = 190;
        var row = new byte[checked(bitmap.Width * 4)];
        var removed = 0;
        for (var y = 0; y < bitmap.Height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var address = IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes));
            Marshal.Copy(address, row, 0, row.Length);
            for (var x = 0; x < bitmap.Width; x++)
            {
                var offset = x * 4;
                var alpha = row[offset + 3];
                var red = row[offset];
                var green = row[offset + 1];
                var blue = row[offset + 2];
                if (alpha == 0 || green <= red * 1.12 || green <= blue * 1.06
                    || green - Math.Max(red, blue) < 12) continue;
                var distance = Math.Sqrt(Math.Pow(red - key.Red, 2) + Math.Pow(green - key.Green, 2)
                    + Math.Pow(blue - key.Blue, 2));
                if (distance >= featherTolerance) continue;
                var softness = Math.Clamp((distance - hardTolerance) / (featherTolerance - hardTolerance), 0, 1);
                row[offset + 3] = (byte)Math.Round(alpha * softness);
                var spill = green - Math.Max(red, blue);
                if (spill > 0) row[offset + 1] = (byte)Math.Clamp((int)Math.Round(green - spill * (1 - softness)), 0, 255);
                if (row[offset + 3] == 0) removed++;
            }
            Marshal.Copy(row, 0, address, row.Length);
        }
        return removed;
    }

    private static ImageBounds? FindVisibleBounds(SKBitmap bitmap, CancellationToken cancellationToken)
    {
        var row = new byte[checked(bitmap.Width * 4)];
        var minX = bitmap.Width;
        var minY = bitmap.Height;
        var maxX = -1;
        var maxY = -1;
        for (var y = 0; y < bitmap.Height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes)), row, 0, row.Length);
            for (var x = 0; x < bitmap.Width; x++)
            {
                if (row[x * 4 + 3] <= 8) continue;
                minX = Math.Min(minX, x); minY = Math.Min(minY, y);
                maxX = Math.Max(maxX, x); maxY = Math.Max(maxY, y);
            }
        }
        if (maxX < minX || maxY < minY) return null;
        var padding = Math.Max(2, (int)Math.Round(Math.Min(maxX - minX + 1, maxY - minY + 1) * .025));
        var left = Math.Max(0, minX - padding);
        var top = Math.Max(0, minY - padding);
        var right = Math.Min(bitmap.Width - 1, maxX + padding);
        var bottom = Math.Min(bitmap.Height - 1, maxY + padding);
        return new ImageBounds(left, top, right - left + 1, bottom - top + 1);
    }

    private static SKBitmap Crop(SKBitmap source, ImageBounds bounds, CancellationToken cancellationToken)
    {
        var result = new SKBitmap(new SKImageInfo(bounds.Width, bounds.Height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        try
        {
            var row = new byte[checked(bounds.Width * 4)];
            for (var y = 0; y < bounds.Height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var sourceAddress = IntPtr.Add(source.GetPixels(), checked((bounds.Y + y) * source.RowBytes + bounds.X * 4));
                var targetAddress = IntPtr.Add(result.GetPixels(), checked(y * result.RowBytes));
                Marshal.Copy(sourceAddress, row, 0, row.Length);
                Marshal.Copy(row, 0, targetAddress, row.Length);
            }
            return result;
        }
        catch
        {
            result.Dispose();
            throw;
        }
    }

    private readonly record struct ImageBounds(int X, int Y, int Width, int Height);
}

public sealed record PreparedHeadExtra(int Width, int Height, byte[] PngBytes, int RemovedBackgroundPixels,
    bool GreenKeyDetected);
