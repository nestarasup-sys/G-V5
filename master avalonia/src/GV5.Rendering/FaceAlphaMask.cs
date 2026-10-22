using GV5.Geometry;

namespace GV5.Rendering;

/// <summary>Compact immutable hit-test mask; one bit records whether a source pixel contributes alpha.</summary>
public sealed class FaceAlphaMask
{
    private readonly byte[] _opaquePixels;

    public FaceAlphaMask(int width, int height, ReadOnlySpan<byte> alphaPixels)
    {
        if (width < 1) throw new ArgumentOutOfRangeException(nameof(width));
        if (height < 1) throw new ArgumentOutOfRangeException(nameof(height));
        var pixelCount = checked(width * height);
        if (alphaPixels.Length != pixelCount)
            throw new ArgumentException("The alpha mask must contain one alpha byte for every source pixel.", nameof(alphaPixels));

        Width = width;
        Height = height;
        _opaquePixels = new byte[checked((pixelCount + 7) / 8)];
        for (var index = 0; index < pixelCount; index++)
            if (alphaPixels[index] != 0)
                _opaquePixels[index >> 3] |= (byte)(1 << (index & 7));
    }

    public int Width { get; }
    public int Height { get; }
    public int StorageBytes => _opaquePixels.Length;

    public bool IsOpaque(Point2D point, Rect2D sourceBounds)
    {
        if (!double.IsFinite(point.X) || !double.IsFinite(point.Y) || sourceBounds.Width <= 0 || sourceBounds.Height <= 0
            || !sourceBounds.Contains(point)) return false;
        var x = Math.Clamp((int)(point.X / sourceBounds.Width * Width), 0, Width - 1);
        var y = Math.Clamp((int)(point.Y / sourceBounds.Height * Height), 0, Height - 1);
        var index = checked(y * Width + x);
        return (_opaquePixels[index >> 3] & (1 << (index & 7))) != 0;
    }
}
