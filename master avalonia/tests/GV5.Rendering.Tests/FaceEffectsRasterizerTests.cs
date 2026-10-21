using GV5.Core.Models;
using GV5.Geometry;
using GV5.Rendering;
using Xunit;

namespace GV5.Rendering.Tests;

public sealed class FaceEffectsRasterizerTests
{
    [Fact]
    public void Render_ProducesTransparentOverlayWithEnabledBlushAndMouthEffect()
    {
        var defaults = FaceExpressionEffects.LegacyDefaults;
        var effects = FaceExpressionEffects.Create(defaults.Shadow,
            FaceExpressionEffectParameters.Create(true, "#ff0000", 1, 0.4, 0.5, 0,
                style: FaceExpressionEffectStyle.Cheeks),
            FaceExpressionEffectParameters.Create(true, "#0000ff", 1, 0.4, 0.2, 0,
                width: 0.2, height: 0.1));
        using var bitmap = FaceEffectsRasterizer.Render(effects, 100, 80, new Point2D(0.5, 0.75));

        Assert.Equal(100, bitmap.Width);
        Assert.Equal(80, bitmap.Height);
        Assert.True(bitmap.GetPixel(50, 40).Alpha > 0);
        Assert.True(bitmap.GetPixel(50, 60).Alpha > 0);
        Assert.Equal((byte)0, bitmap.GetPixel(0, 0).Alpha);
    }

    [Fact]
    public void Render_RejectsInvalidCanvasAndMouthAnchorAndLeavesDisabledEffectsTransparent()
    {
        var effects = FaceExpressionEffects.LegacyDefaults;
        using var bitmap = FaceEffectsRasterizer.Render(effects, 24, 18, new Point2D(0.5, 0.5));
        Assert.All(Enumerable.Range(0, bitmap.Height).SelectMany(y => Enumerable.Range(0, bitmap.Width).Select(x => bitmap.GetPixel(x, y))),
            pixel => Assert.Equal((byte)0, pixel.Alpha));
        Assert.Throws<ArgumentOutOfRangeException>(() => FaceEffectsRasterizer.Render(effects, 0, 18, new Point2D(0.5, 0.5)));
        Assert.Throws<ArgumentOutOfRangeException>(() => FaceEffectsRasterizer.Render(effects, 18, 18, new Point2D(1.1, 0.5)));
    }
}
