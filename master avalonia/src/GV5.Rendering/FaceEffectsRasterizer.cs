using GV5.Core.Models;
using GV5.Geometry;
using SkiaSharp;

namespace GV5.Rendering;

/// <summary>Builds a disposable transparent overlay from immutable face-effect settings.</summary>
public static class FaceEffectsRasterizer
{
    public const int MaximumDimension = 8192;
    public const long MaximumPixels = 32_000_000;

    public static SKBitmap Render(FaceExpressionEffects effects, int width, int height, Point2D mouthAnchorNormalized)
    {
        ArgumentNullException.ThrowIfNull(effects);
        if (width <= 0 || width > MaximumDimension) throw new ArgumentOutOfRangeException(nameof(width));
        if (height <= 0 || height > MaximumDimension || (long)width * height > MaximumPixels)
            throw new ArgumentOutOfRangeException(nameof(height));
        if (!double.IsFinite(mouthAnchorNormalized.X) || mouthAnchorNormalized.X is < 0 or > 1
            || !double.IsFinite(mouthAnchorNormalized.Y) || mouthAnchorNormalized.Y is < 0 or > 1)
            throw new ArgumentOutOfRangeException(nameof(mouthAnchorNormalized));

        using var surface = SKSurface.Create(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul))
            ?? throw new InvalidOperationException("Skia could not create a facial effect surface.");
        var canvas = surface.Canvas;
        canvas.Clear(SKColors.Transparent);
        DrawShadow(canvas, effects.Shadow, width, height);
        DrawBlush(canvas, effects.Blush, width, height);
        DrawMouthBlush(canvas, effects.MouthBlush, width, height, mouthAnchorNormalized);
        using var image = surface.Snapshot();
        return SKBitmap.FromImage(image) ?? throw new InvalidOperationException("Skia could not copy the facial effect surface.");
    }

    private static void DrawShadow(SKCanvas canvas, FaceExpressionEffectParameters effect, int width, int height)
    {
        if (!effect.Enabled || effect.Opacity <= 0) return;
        var top = effect.OffsetY * height;
        var bottom = top + effect.Size * height;
        if (bottom <= 0 || top >= height) return;
        var color = WithOpacity(SKColor.Parse(effect.Color), effect.Opacity);
        var mid = Math.Clamp(0.4 + effect.Softness * 0.6, 0.01, 0.99);
        using var shader = SKShader.CreateLinearGradient(new SKPoint(0, (float)top), new SKPoint(0, (float)bottom),
            [color, color.WithAlpha(0)], [0, (float)mid], SKShaderTileMode.Clamp);
        using var paint = new SKPaint { Shader = shader, IsAntialias = true };
        canvas.DrawRect(SKRect.Create(0, (float)top, width, (float)(bottom - top)), paint);
    }

    private static void DrawBlush(SKCanvas canvas, FaceExpressionEffectParameters effect, int width, int height)
    {
        if (!effect.Enabled || effect.Opacity <= 0) return;
        var centerX = width * (0.5 + effect.OffsetX);
        var centerY = height * (0.5 + effect.OffsetY);
        var effectWidth = effect.Size * width;
        var effectHeight = effect.Size * effect.AspectRatio * height;
        var rotation = effect.RotationDegrees + (effect.Style == FaceExpressionEffectStyle.Diagonal ? -16 : 0);
        switch (effect.Style)
        {
            case FaceExpressionEffectStyle.Cheeks:
                DrawSoftOval(canvas, effect, centerX - effectWidth * 0.23, centerY, effectWidth * 0.48, effectHeight, rotation, 0.54);
                DrawSoftOval(canvas, effect, centerX + effectWidth * 0.23, centerY, effectWidth * 0.48, effectHeight, rotation, 0.54);
                break;
            case FaceExpressionEffectStyle.Bands:
                foreach (var offset in new[] { -0.25, 0d, 0.25 })
                    DrawSoftOval(canvas, effect, centerX, centerY + effectHeight * offset, effectWidth, effectHeight * 0.42, rotation, 0.54);
                break;
            default:
                DrawSoftOval(canvas, effect, centerX, centerY, effectWidth, effectHeight, rotation, 0.54);
                break;
        }
    }

    private static void DrawMouthBlush(SKCanvas canvas, FaceExpressionEffectParameters effect, int width,
        int height, Point2D mouthAnchor)
    {
        if (!effect.Enabled || effect.Opacity <= 0) return;
        var centerX = mouthAnchor.X * width + effect.OffsetX * width;
        var centerY = mouthAnchor.Y * height + effect.OffsetY * height;
        DrawSoftOval(canvas, effect, centerX, centerY, effect.Width * width, effect.Height * height,
            effect.RotationDegrees, 1);
    }

    private static void DrawSoftOval(SKCanvas canvas, FaceExpressionEffectParameters effect,
        double centerX, double centerY, double width, double height, double rotation, double opacityScale)
    {
        if (width <= 0 || height <= 0) return;
        var color = WithOpacity(SKColor.Parse(effect.Color), effect.Opacity * opacityScale);
        var stop = (float)Math.Clamp(0.4 + effect.Softness * 0.6, 0.01, 0.99);
        using var shader = SKShader.CreateRadialGradient(SKPoint.Empty, 1,
            [color, color.WithAlpha(0)], [stop, 1], SKShaderTileMode.Clamp);
        using var paint = new SKPaint { Shader = shader, IsAntialias = true };
        var save = canvas.Save();
        try
        {
            canvas.Translate((float)centerX, (float)centerY);
            canvas.RotateDegrees((float)rotation);
            canvas.Scale((float)(width / 2), (float)(height / 2));
            canvas.DrawOval(SKRect.Create(-1, -1, 2, 2), paint);
        }
        finally { canvas.RestoreToCount(save); }
    }

    private static SKColor WithOpacity(SKColor color, double opacity) =>
        color.WithAlpha((byte)Math.Round(color.Alpha * Math.Clamp(opacity, 0, 1)));
}
