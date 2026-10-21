using GV5.Geometry;
using Xunit;

namespace GV5.Geometry.Tests;

public sealed class WardrobeBindingMathTests
{
    [Fact]
    public void NeutralPosePreservesTheOriginalGarmentPlacement()
    {
        var bone = new WardrobeBoneFrame("torso", new Rect2D(100, 50, 200, 100), 0);
        var garment = new Rect2D(140, 60, 50, 20);
        var binding = WardrobeBinding.Bind(bone, garment, garmentRotationDegrees: 5);

        var resolved = WardrobeBindingMath.Resolve(binding, bone);

        AssertRect(garment, resolved.Bounds);
        Assert.Equal(5, resolved.RotationDegrees, 10);
        Assert.Equal(0.25, binding.WidthRatio, 10);
        Assert.Equal(0.2, binding.HeightRatio, 10);
    }

    [Fact]
    public void RotatedPosePreservesNormalizedOffsetAndNonUniformSizeRatios()
    {
        var sourceBone = new WardrobeBoneFrame("arm", new Rect2D(100, 50, 200, 100), 30);
        var garmentCenter = RotateAround(sourceBone.Center, new Point2D(20, 20), 30);
        var garment = new Rect2D(garmentCenter.X - 40, garmentCenter.Y - 12.5, 80, 25);
        var binding = WardrobeBinding.Bind(sourceBone, garment, garmentRotationDegrees: 45);
        var poseBone = new WardrobeBoneFrame("arm", new Rect2D(20, 30, 300, 120), -20);

        var resolved = WardrobeBindingMath.Resolve(binding, poseBone);
        var expectedCenter = RotateAround(poseBone.Center, new Point2D(30, 24), -20);

        Assert.Equal(120, resolved.Bounds.Width, 10);
        Assert.Equal(30, resolved.Bounds.Height, 10);
        Assert.Equal(expectedCenter.X, resolved.Bounds.X + resolved.Bounds.Width / 2, 9);
        Assert.Equal(expectedCenter.Y, resolved.Bounds.Y + resolved.Bounds.Height / 2, 9);
        Assert.Equal(-5, resolved.RotationDegrees, 9);
        Assert.Equal(1.5, resolved.ScaleX, 10);
        Assert.Equal(1.2, resolved.ScaleY, 10);
    }

    [Fact]
    public void MirroredPoseReflectsTheLocalOffsetAndGarmentOrientation()
    {
        var sourceBone = new WardrobeBoneFrame("leg", new Rect2D(100, 50, 200, 100), 0);
        var garment = new Rect2D(140, 60, 50, 20);
        var binding = WardrobeBinding.Bind(sourceBone, garment, garmentRotationDegrees: 30);
        var mirroredPose = new WardrobeBoneFrame("leg", sourceBone.Bounds, 0, flipX: true);

        var resolved = WardrobeBindingMath.Resolve(binding, mirroredPose);

        AssertRect(new Rect2D(210, 60, 50, 20), resolved.Bounds);
        Assert.Equal(150, resolved.RotationDegrees, 10);
        Assert.True(resolved.FlipX);
    }

    [Fact]
    public void BindingRejectsInvalidDimensionsAndMismatchedBoneIdentity()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new WardrobeBoneFrame("arm", new Rect2D(0, 0, 0, 10), 0));
        var arm = new WardrobeBoneFrame("arm", new Rect2D(0, 0, 10, 10), 0);
        var binding = WardrobeBinding.Bind(arm, new Rect2D(1, 1, 2, 2), 0);

        Assert.Throws<ArgumentException>(() => WardrobeBindingMath.Resolve(binding, new WardrobeBoneFrame("leg", arm.Bounds, 0)));
        Assert.Throws<ArgumentOutOfRangeException>(() => WardrobeBindingMath.Resolve(default, arm));
    }

    private static Point2D RotateAround(Point2D center, Point2D offset, double degrees)
    {
        var radians = degrees * Math.PI / 180;
        return new Point2D(
            center.X + offset.X * Math.Cos(radians) - offset.Y * Math.Sin(radians),
            center.Y + offset.X * Math.Sin(radians) + offset.Y * Math.Cos(radians));
    }

    private static void AssertRect(Rect2D expected, Rect2D actual)
    {
        Assert.Equal(expected.X, actual.X, 9);
        Assert.Equal(expected.Y, actual.Y, 9);
        Assert.Equal(expected.Width, actual.Width, 9);
        Assert.Equal(expected.Height, actual.Height, 9);
    }
}
