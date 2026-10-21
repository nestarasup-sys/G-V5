using System.Runtime.InteropServices;
using GV5.Assets.Decoding;
using GV5.Core.Models;
using SkiaSharp;

namespace GV5.Assets.Processing;

public sealed record HairRoleTintOptions(bool PreserveNearWhite = false,
    IReadOnlySet<HairColorRole>? AllowNearWhiteRoles = null);

/// <summary>Owns a tinted bitmap. Its transient role counts are diagnostic only and are never persisted.</summary>
public sealed class HairRoleTintResult : IDisposable
{
    private int _disposed;

    internal HairRoleTintResult(DecodedAssetImage image, IReadOnlyDictionary<HairColorRole, int> roleCounts,
        int recoloredPixels)
    {
        Image = image;
        RoleCounts = roleCounts;
        RecoloredPixelCount = recoloredPixels;
    }

    public DecodedAssetImage Image { get; }
    public IReadOnlyDictionary<HairColorRole, int> RoleCounts { get; }
    public int RecoloredPixelCount { get; }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0) Image.Dispose();
    }
}

/// <summary>Classifies hair pixels into the five legacy roles, applies optional palette overrides and preserves alpha.</summary>
public sealed class HairRoleTintProcessor
{
    private static readonly HairColorRole[] Roles = Enum.GetValues<HairColorRole>();
    private const byte ProfileAlphaThreshold = 160;

    public Task<HairRoleTintResult> ProcessAsync(DecodedAssetImage source,
        IReadOnlyDictionary<HairColorRole, SKColor>? overrides = null, HairRoleTintOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (source.Bitmap.ColorType != SKColorType.Rgba8888 || source.Bitmap.AlphaType != SKAlphaType.Unpremul)
            throw new ArgumentException("Hair role tinting requires RGBA8888 unpremultiplied pixels.", nameof(source));
        if (overrides is not null && overrides.Keys.Any(role => !Enum.IsDefined(role)))
            throw new ArgumentOutOfRangeException(nameof(overrides));
        if (options?.AllowNearWhiteRoles?.Any(role => !Enum.IsDefined(role)) == true)
            throw new ArgumentOutOfRangeException(nameof(options));
        cancellationToken.ThrowIfCancellationRequested();
        return Task.Run(() => ProcessCore(source.Bitmap, overrides, options ?? new HairRoleTintOptions(), cancellationToken),
            CancellationToken.None);
    }

    private static HairRoleTintResult ProcessCore(SKBitmap source,
        IReadOnlyDictionary<HairColorRole, SKColor>? overrides, HairRoleTintOptions options,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var result = source.Copy() ?? throw new InvalidOperationException("The hair tint buffer could not be copied.");
        try
        {
        if (result.GetPixels() == IntPtr.Zero) throw new InvalidOperationException("The hair tint buffer could not be allocated.");

        var profile = BuildProfile(source, cancellationToken);
        var roleCounts = Roles.ToDictionary(role => role, _ => 0);
        var luminanceTotals = Roles.ToDictionary(role => role, _ => 0d);
        var sourceRow = new byte[checked(source.Width * 4)];
        for (var y = 0; y < source.Height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(source.GetPixels(), checked(y * source.RowBytes)), sourceRow, 0, sourceRow.Length);
            for (var x = 0; x < source.Width; x++)
            {
                var offset = x * 4;
                if (sourceRow[offset + 3] < ProfileAlphaThreshold) continue;
                var luminance = Luminance(sourceRow[offset], sourceRow[offset + 1], sourceRow[offset + 2]);
                var role = Classify(sourceRow[offset], sourceRow[offset + 1], sourceRow[offset + 2], profile);
                roleCounts[role]++;
                luminanceTotals[role] += luminance;
            }
        }

        var changed = 0;
        if (overrides is { Count: > 0 })
        {
            var row = new byte[checked(source.Width * 4)];
            var originalRow = new byte[row.Length];
            for (var y = 0; y < source.Height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var address = IntPtr.Add(result.GetPixels(), checked(y * result.RowBytes));
                Marshal.Copy(address, row, 0, row.Length);
                Marshal.Copy(IntPtr.Add(source.GetPixels(), checked(y * source.RowBytes)), originalRow, 0, originalRow.Length);
                for (var x = 0; x < source.Width; x++)
                {
                    var offset = x * 4;
                    if (row[offset + 3] == 0) continue;
                    var role = Classify(row[offset], row[offset + 1], row[offset + 2], profile);
                    if (!overrides.TryGetValue(role, out var target)) continue;
                    var red = row[offset];
                    var green = row[offset + 1];
                    var blue = row[offset + 2];
                    var luminance = Luminance(red, green, blue);
                    var nearWhite = luminance >= 220 && Math.Max(red, Math.Max(green, blue))
                        - Math.Min(red, Math.Min(green, blue)) <= 32;
                    if (options.PreserveNearWhite && nearWhite && options.AllowNearWhiteRoles?.Contains(role) != true) continue;
                    var sourceLuminance = Math.Max(1, luminance);
                    var referenceLuminance = roleCounts[role] > 0
                        ? luminanceTotals[role] / roleCounts[role]
                        : sourceLuminance;
                    var shade = Math.Clamp(sourceLuminance / Math.Max(1, referenceLuminance), 0.48, 1.52);
                    row[offset] = Clamp(target.Red * shade);
                    row[offset + 1] = Clamp(target.Green * shade);
                    row[offset + 2] = Clamp(target.Blue * shade);
                    if (row[offset] != originalRow[offset] || row[offset + 1] != originalRow[offset + 1]
                        || row[offset + 2] != originalRow[offset + 2]) changed++;
                }
                Marshal.Copy(row, 0, address, row.Length);
            }
        }

        return new HairRoleTintResult(new DecodedAssetImage(result), roleCounts, changed);
        }
        catch
        {
            result.Dispose();
            throw;
        }
    }

    private static ColorProfile BuildProfile(SKBitmap bitmap, CancellationToken cancellationToken)
    {
        var luminanceHistogram = new int[256];
        var hueHistogram = new int[24];
        var count = 0;
        var chromatic = 0;
        var row = new byte[checked(bitmap.Width * 4)];
        for (var y = 0; y < bitmap.Height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes)), row, 0, row.Length);
            for (var x = 0; x < bitmap.Width; x++)
            {
                var offset = x * 4;
                if (row[offset + 3] < ProfileAlphaThreshold) continue;
                var red = row[offset]; var green = row[offset + 1]; var blue = row[offset + 2];
                var luminance = Luminance(red, green, blue);
                luminanceHistogram[Math.Clamp((int)Math.Round(luminance), 0, 255)]++;
                count++;
                var maximum = Math.Max(red, Math.Max(green, blue));
                var minimum = Math.Min(red, Math.Min(green, blue));
                if (maximum > 40 && (maximum - minimum) / (double)maximum > 0.3 && luminance > 35)
                {
                    hueHistogram[Math.Clamp((int)(Hue(red, green, blue) / 15), 0, 23)]++;
                    chromatic++;
                }
            }
        }

        if (count == 0) return new ColorProfile(0, 255, 7.5, false);
        var hueIndex = 0;
        for (var index = 1; index < hueHistogram.Length; index++)
            if (hueHistogram[index] > hueHistogram[hueIndex]) hueIndex = index;
        return new ColorProfile(Percentile(luminanceHistogram, count, 0.01),
            Percentile(luminanceHistogram, count, 0.98), hueIndex * 15 + 7.5, chromatic > count * 0.03);
    }

    private static HairColorRole Classify(byte red, byte green, byte blue, ColorProfile profile)
    {
        var luminance = Luminance(red, green, blue);
        var maximum = Math.Max(red, Math.Max(green, blue));
        var minimum = Math.Min(red, Math.Min(green, blue));
        var saturation = maximum == 0 ? 0 : (maximum - minimum) / (double)maximum;
        var hueDistance = Math.Abs(Hue(red, green, blue) - profile.Hue);
        if (profile.HasAccent && saturation > 0.3 && Math.Min(hueDistance, 360 - hueDistance) > 48 && luminance > 35)
            return HairColorRole.Accent;
        var range = profile.High - profile.Low;
        if (range < 18) return HairColorRole.Base;
        var position = (luminance - profile.Low) / range;
        if (position < 0.16) return HairColorRole.Outline;
        if (position < 0.43) return HairColorRole.Fade;
        if (position < 0.82) return HairColorRole.Base;
        return HairColorRole.Highlight;
    }

    private static int Percentile(int[] histogram, int count, double fraction)
    {
        var target = count * fraction;
        var seen = 0;
        for (var value = 0; value < histogram.Length; value++)
        {
            seen += histogram[value];
            if (seen >= target) return value;
        }
        return 255;
    }

    private static double Hue(byte red, byte green, byte blue)
    {
        var maximum = Math.Max(red, Math.Max(green, blue));
        var difference = maximum - Math.Min(red, Math.Min(green, blue));
        if (difference == 0) return 0;
        var section = maximum == red ? ((green - blue) / (double)difference) % 6
            : maximum == green ? (blue - red) / (double)difference + 2
            : (red - green) / (double)difference + 4;
        return (section * 60 + 360) % 360;
    }

    private static double Luminance(byte red, byte green, byte blue) => red * 0.2126 + green * 0.7152 + blue * 0.0722;
    private static byte Clamp(double value) => (byte)Math.Clamp((int)Math.Round(value, MidpointRounding.ToEven), 0, 255);

    private sealed record ColorProfile(int Low, int High, double Hue, bool HasAccent);
}
