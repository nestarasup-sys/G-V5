namespace GV5.Core.Models;

public enum FaceExpressionEffectStyle
{
    Oval = 1,
    Cheeks = 2,
    Bands = 3,
    Diagonal = 4,
    Spot = 5
}

/// <summary>Validated, UI-independent settings for one expression overlay.</summary>
public sealed record FaceExpressionEffectParameters
{
    private FaceExpressionEffectParameters(bool enabled, string color, double opacity, double softness,
        double size, double offsetX, double offsetY, double aspectRatio, double width, double height,
        double rotationDegrees, FaceExpressionEffectStyle style)
    {
        Enabled = enabled;
        Color = color;
        Opacity = opacity;
        Softness = softness;
        Size = size;
        OffsetX = offsetX;
        OffsetY = offsetY;
        AspectRatio = aspectRatio;
        Width = width;
        Height = height;
        RotationDegrees = rotationDegrees;
        Style = style;
    }

    public bool Enabled { get; }
    public string Color { get; }
    public double Opacity { get; }
    public double Softness { get; }
    public double Size { get; }
    public double OffsetX { get; }
    public double OffsetY { get; }
    public double AspectRatio { get; }
    public double Width { get; }
    public double Height { get; }
    public double RotationDegrees { get; }
    public FaceExpressionEffectStyle Style { get; }

    public static FaceExpressionEffectParameters Create(bool enabled, string color, double opacity, double softness,
        double size, double offsetY, double offsetX = 0, double aspectRatio = 0.52,
        double? width = null, double? height = null, double rotationDegrees = 0,
        FaceExpressionEffectStyle style = FaceExpressionEffectStyle.Oval)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(color);
        if (color.Length != 7 || color[0] != '#' || !color.AsSpan(1).ToString().All(Uri.IsHexDigit))
            throw new ArgumentException("Effect color must use #RRGGBB format.", nameof(color));
        ValidateRange(opacity, 0, 1, nameof(opacity));
        ValidateRange(softness, 0, 1, nameof(softness));
        ValidateRange(size, 0.05, 2, nameof(size));
        ValidateRange(offsetX, -0.5, 0.5, nameof(offsetX));
        ValidateRange(offsetY, -0.5, 0.5, nameof(offsetY));
        ValidateRange(aspectRatio, 0.05, 2, nameof(aspectRatio));
        var resolvedWidth = width ?? size;
        var resolvedHeight = height ?? size * aspectRatio;
        ValidateRange(resolvedWidth, 0.01, 2, nameof(width));
        ValidateRange(resolvedHeight, 0.01, 2, nameof(height));
        ValidateRange(rotationDegrees, -180, 180, nameof(rotationDegrees));
        if (!Enum.IsDefined(style)) throw new ArgumentOutOfRangeException(nameof(style));
        return new FaceExpressionEffectParameters(enabled, color.ToLowerInvariant(), opacity, softness, size,
            offsetX, offsetY, aspectRatio, resolvedWidth, resolvedHeight, rotationDegrees, style);
    }

    public static FaceExpressionEffectParameters Interpolate(FaceExpressionEffectParameters from,
        FaceExpressionEffectParameters to, double progress)
    {
        ArgumentNullException.ThrowIfNull(from);
        ArgumentNullException.ThrowIfNull(to);
        if (!double.IsFinite(progress) || progress is < 0 or > 1) throw new ArgumentOutOfRangeException(nameof(progress));
        var color = InterpolateColor(from.Color, to.Color, progress);
        return Create(progress < 0.5 ? from.Enabled : to.Enabled, color,
            Lerp(from.Opacity, to.Opacity, progress), Lerp(from.Softness, to.Softness, progress),
            Lerp(from.Size, to.Size, progress), Lerp(from.OffsetY, to.OffsetY, progress),
            Lerp(from.OffsetX, to.OffsetX, progress), Lerp(from.AspectRatio, to.AspectRatio, progress),
            Lerp(from.Width, to.Width, progress), Lerp(from.Height, to.Height, progress),
            Lerp(from.RotationDegrees, to.RotationDegrees, progress),
            progress < 0.5 ? from.Style : to.Style);
    }

    private static void ValidateRange(double value, double minimum, double maximum, string parameterName)
    {
        if (!double.IsFinite(value) || value < minimum || value > maximum)
            throw new ArgumentOutOfRangeException(parameterName);
    }

    private static double Lerp(double from, double to, double progress) => from + (to - from) * progress;

    private static string InterpolateColor(string from, string to, double progress)
    {
        var channels = new int[3];
        for (var index = 0; index < channels.Length; index++)
        {
            var a = Convert.ToInt32(from.Substring(1 + index * 2, 2), 16);
            var b = Convert.ToInt32(to.Substring(1 + index * 2, 2), 16);
            channels[index] = (int)Math.Round(Lerp(a, b, progress), MidpointRounding.AwayFromZero);
        }
        return $"#{channels[0]:x2}{channels[1]:x2}{channels[2]:x2}";
    }
}

/// <summary>The three independent expression overlays used by presets and facial playback.</summary>
public sealed record FaceExpressionEffects
{
    private FaceExpressionEffects(FaceExpressionEffectParameters shadow, FaceExpressionEffectParameters blush,
        FaceExpressionEffectParameters mouthBlush)
    {
        Shadow = shadow;
        Blush = blush;
        MouthBlush = mouthBlush;
    }

    public FaceExpressionEffectParameters Shadow { get; }
    public FaceExpressionEffectParameters Blush { get; }
    public FaceExpressionEffectParameters MouthBlush { get; }

    public static FaceExpressionEffects Create(FaceExpressionEffectParameters shadow,
        FaceExpressionEffectParameters blush, FaceExpressionEffectParameters mouthBlush) =>
        new(shadow ?? throw new ArgumentNullException(nameof(shadow)),
            blush ?? throw new ArgumentNullException(nameof(blush)),
            mouthBlush ?? throw new ArgumentNullException(nameof(mouthBlush)));

    public static FaceExpressionEffects LegacyDefaults { get; } = Create(
        FaceExpressionEffectParameters.Create(false, "#4b3542", 0.38, 0.55, 0.42, 0),
        FaceExpressionEffectParameters.Create(false, "#f0789c", 0.48, 0.72, 0.68, 0.04,
            aspectRatio: 0.52, style: FaceExpressionEffectStyle.Cheeks),
        FaceExpressionEffectParameters.Create(false, "#e86388", 0.38, 0.78, 0.12, 0,
            aspectRatio: 0.52, width: 0.12, height: 0.0624));

    public static FaceExpressionEffects Interpolate(FaceExpressionEffects from, FaceExpressionEffects to, double progress)
    {
        ArgumentNullException.ThrowIfNull(from);
        ArgumentNullException.ThrowIfNull(to);
        return Create(FaceExpressionEffectParameters.Interpolate(from.Shadow, to.Shadow, progress),
            FaceExpressionEffectParameters.Interpolate(from.Blush, to.Blush, progress),
            FaceExpressionEffectParameters.Interpolate(from.MouthBlush, to.MouthBlush, progress));
    }
}
