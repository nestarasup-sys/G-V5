using GV5.Core.Models;
using Xunit;

namespace GV5.Core.Tests;

public sealed class FaceExpressionEffectsTests
{
    [Fact]
    public void LegacyDefaultsMatchExpressionPresetContract()
    {
        var effects = FaceExpressionEffects.LegacyDefaults;
        Assert.Equal(("#4b3542", 0.38, 0.55, 0.42),
            (effects.Shadow.Color, effects.Shadow.Opacity, effects.Shadow.Softness, effects.Shadow.Size));
        Assert.Equal(("#f0789c", 0.48, 0.72, 0.68, FaceExpressionEffectStyle.Cheeks),
            (effects.Blush.Color, effects.Blush.Opacity, effects.Blush.Softness, effects.Blush.Size, effects.Blush.Style));
        Assert.Equal(("#e86388", 0.38, 0.78, 0.12, 0.12, 0.0624),
            (effects.MouthBlush.Color, effects.MouthBlush.Opacity, effects.MouthBlush.Softness,
                effects.MouthBlush.Size, effects.MouthBlush.Width, effects.MouthBlush.Height));
        Assert.False(effects.Shadow.Enabled);
        Assert.False(effects.Blush.Enabled);
        Assert.False(effects.MouthBlush.Enabled);
    }

    [Fact]
    public void EffectSettingsValidateRangesColorsAndStyles()
    {
        Assert.Throws<ArgumentException>(() => FaceExpressionEffectParameters.Create(true, "red", 0.5, 0.5, 0.5, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => FaceExpressionEffectParameters.Create(true, "#ff0000", 1.01, 0.5, 0.5, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => FaceExpressionEffectParameters.Create(true, "#ff0000", 0.5, 0.5, 0.5, 0, offsetX: -0.51));
        Assert.Throws<ArgumentOutOfRangeException>(() => FaceExpressionEffectParameters.Create(true, "#ff0000", 0.5, 0.5, 0.5, 0,
            width: 2.01));
        Assert.Throws<ArgumentOutOfRangeException>(() => FaceExpressionEffectParameters.Create(true, "#ff0000", 0.5, 0.5, 0.5, 0,
            rotationDegrees: 181));
    }

    [Fact]
    public void InterpolationBlendsColorAndNumericValuesAndSwitchesDiscreteFieldsAtMidpoint()
    {
        var from = FaceExpressionEffectParameters.Create(false, "#000000", 0, 0, 0.1, -0.5,
            style: FaceExpressionEffectStyle.Oval);
        var to = FaceExpressionEffectParameters.Create(true, "#ffffff", 1, 1, 2, 0.5,
            style: FaceExpressionEffectStyle.Bands);

        var halfway = FaceExpressionEffectParameters.Interpolate(from, to, 0.5);
        Assert.Equal("#808080", halfway.Color);
        Assert.Equal(0.5, halfway.Opacity);
        Assert.Equal(0, halfway.OffsetY);
        Assert.True(halfway.Enabled);
        Assert.Equal(FaceExpressionEffectStyle.Bands, halfway.Style);
        Assert.Throws<ArgumentOutOfRangeException>(() => FaceExpressionEffectParameters.Interpolate(from, to, double.NaN));
    }
}
