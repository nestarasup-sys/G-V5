using GV5.Geometry;
using Xunit;

namespace GV5.Geometry.Tests;

public sealed class GeometryHitTesterTests
{
    [Fact]
    public void HitTestMapsWorldPointBackToLocalCoordinates()
    {
        var id = TransformNodeId.New();
        var matrix = Matrix2D.CreateTranslation(100, 50) * Matrix2D.CreateScale(2, 3);
        var hit = GeometryHitTester.HitTest(
            [new GeometryHitRegion(id, new Rect2D(0, 0, 10, 10), matrix, 1)],
            new Point2D(120, 80));

        Assert.NotNull(hit);
        Assert.Equal(id, hit.Value.Id);
        Assert.Equal(10, hit.Value.LocalPoint.X, 10);
        Assert.Equal(10, hit.Value.LocalPoint.Y, 10);
        Assert.Null(GeometryHitTester.HitTest(
            [new GeometryHitRegion(id, new Rect2D(0, 0, 10, 10), matrix, 1)],
            new Point2D(120.1, 80)));
    }

    [Fact]
    public void HitTestUsesClipAndTopmostZOrderWithStableTieRule()
    {
        var bottom = TransformNodeId.New();
        var top = TransformNodeId.New();
        var tiedLast = TransformNodeId.New();
        var bounds = new Rect2D(0, 0, 10, 10);
        var regions = new[]
        {
            new GeometryHitRegion(bottom, bounds, Matrix2D.Identity, 1),
            new GeometryHitRegion(top, bounds, Matrix2D.Identity, 2, new Rect2D(3, 3, 2, 2)),
            new GeometryHitRegion(tiedLast, bounds, Matrix2D.Identity, 2)
        };

        Assert.Equal(tiedLast, GeometryHitTester.HitTest(regions, new Point2D(1, 1))!.Value.Id);
        Assert.Equal(top, GeometryHitTester.HitTest(regions.Take(2), new Point2D(4, 4))!.Value.Id);
        Assert.Equal(bottom, GeometryHitTester.HitTest(regions.Take(2), new Point2D(1, 1))!.Value.Id);
        Assert.Null(GeometryHitTester.HitTest(regions.Skip(1).Take(1), new Point2D(5.1, 5.1)));
    }

    [Fact]
    public void HitTestSkipsSingularRegionsAndReturnsNoHitWhenAllAreSingular()
    {
        var id = TransformNodeId.New();
        var region = new GeometryHitRegion(id, new Rect2D(0, 0, 10, 10), Matrix2D.CreateScale(0, 1), 1);

        Assert.Null(GeometryHitTester.HitTest([region], Point2D.Zero));
    }

    [Fact]
    public void BoundsTransformRotatedAndFlippedRectanglesAndIntersectionHonorsCrop()
    {
        var rectangle = new Rect2D(0, 0, 2, 1);
        var rotated = Matrix2D.CreateRotation(Math.PI / 2).TransformBounds(rectangle);
        var flipped = Matrix2D.CreateFlipX().TransformBounds(rectangle);
        var crop = new Rect2D(-1, 0, 2, 2);

        Assert.Equal(-1, rotated.X, 10);
        Assert.Equal(0, rotated.Y, 10);
        Assert.Equal(1, rotated.Width, 10);
        Assert.Equal(2, rotated.Height, 10);
        Assert.Equal(-2, flipped.X);
        Assert.Equal(2, flipped.Width);
        Assert.Equal(new Rect2D(-1, 0, 1, 1), flipped.Intersect(crop));
        Assert.Null(new Rect2D(0, 0, 1, 1).Intersect(new Rect2D(2, 2, 1, 1)));
    }
}
