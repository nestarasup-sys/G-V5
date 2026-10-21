using GV5.Geometry;
using Xunit;

namespace GV5.Geometry.Tests;

public sealed class RigAnchorSnapperTests
{
    [Fact]
    public void SnapAlignsBothAxesToNearestAnchorWithinThreshold()
    {
        var target = new Point2D(20, 30);
        var result = RigAnchorSnapper.Snap(new Point2D(17, 34), [target], 5);

        Assert.Equal(new Point2D(3, -4), result.Translation);
        Assert.Equal(SnapAxis.Vertical, result.XMatch?.Axis);
        Assert.Equal(SnapAxis.Horizontal, result.YMatch?.Axis);
    }

    [Fact]
    public void SnapLeavesAnchorUnchangedOutsideThreshold()
    {
        var original = new Point2D(17, 34);
        var result = RigAnchorSnapper.Snap(original, [new Point2D(20, 30)], 2);

        Assert.Equal(Point2D.Zero, result.Translation);
        Assert.Null(result.XMatch);
        Assert.Null(result.YMatch);
    }
}
