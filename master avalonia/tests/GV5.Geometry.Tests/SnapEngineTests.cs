using GV5.Geometry;
using Xunit;

namespace GV5.Geometry.Tests;

public sealed class SnapEngineTests
{
    [Fact]
    public void SnapChoosesNearestEdgeOrCenterAndReturnsIndependentAxisDeltas()
    {
        var bounds = new Rect2D(10, 10, 10, 20);
        var result = SnapEngine.Snap(
            bounds,
            [
                new SnapGuide(SnapAxis.Vertical, 22),
                new SnapGuide(SnapAxis.Vertical, 14),
                new SnapGuide(SnapAxis.Horizontal, 9),
                new SnapGuide(SnapAxis.Horizontal, 31)
            ],
            threshold: 2);

        Assert.Equal(new Point2D(-1, -1), result.Translation);
        Assert.Equal(new SnapMatch(SnapAxis.Vertical, SnapAnchor.Center, 14, -1), result.XMatch);
        Assert.Equal(new SnapMatch(SnapAxis.Horizontal, SnapAnchor.Start, 9, -1), result.YMatch);
        Assert.Equal(new Rect2D(9, 9, 10, 20), result.Apply(bounds));
    }

    [Fact]
    public void SnapReturnsNoMatchOutsideThresholdAndRejectsInvalidInputs()
    {
        var bounds = new Rect2D(0, 0, 10, 10);
        var none = SnapEngine.Snap(bounds, [new SnapGuide(SnapAxis.Vertical, 12)], threshold: 1);

        Assert.Equal(Point2D.Zero, none.Translation);
        Assert.Null(none.XMatch);
        Assert.Null(none.YMatch);
        Assert.Throws<ArgumentOutOfRangeException>(() => SnapEngine.Snap(bounds, [], -1));
        Assert.Throws<ArgumentOutOfRangeException>(() => new SnapGuide((SnapAxis)99, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new SnapGuide(SnapAxis.Vertical, double.NaN));
    }

    [Fact]
    public void SnapIsDeterministicForEqualDistanceCandidates()
    {
        var result = SnapEngine.Snap(
            new Rect2D(10, 0, 10, 10),
            [new SnapGuide(SnapAxis.Vertical, 9), new SnapGuide(SnapAxis.Vertical, 11)],
            threshold: 2);

        Assert.Equal(-1, result.Translation.X);
        Assert.Equal(9, result.XMatch!.Value.GuideCoordinate);
    }
}
