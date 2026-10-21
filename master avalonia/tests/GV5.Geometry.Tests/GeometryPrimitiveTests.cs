using GV5.Geometry;
using Xunit;

namespace GV5.Geometry.Tests;

public sealed class GeometryPrimitiveTests
{
    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Point_RejectsNonFiniteCoordinates(double value)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new Point2D(value, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new Point2D(0, value));
    }

    [Fact]
    public void Point_RejectsOverflowFromArithmetic()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new Point2D(double.MaxValue, 1) + new Point2D(double.MaxValue, 1));
    }

    [Fact]
    public void Rect_RequiresFiniteEdgesAndNonNegativeDimensions()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new Rect2D(0, 0, -1, 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => new Rect2D(0, 0, 1, double.NaN));
        Assert.Throws<ArgumentOutOfRangeException>(() => new Rect2D(double.MaxValue, 0, double.MaxValue, 1));

        var rectangle = new Rect2D(10, 20, 30, 40);
        Assert.True(rectangle.Contains(new Point2D(40, 60)));
        Assert.False(rectangle.Contains(new Point2D(40.01, 60)));
    }

    [Fact]
    public void Matrix_UsesDocumentedColumnVectorCompositionOrder()
    {
        var scale = Matrix2D.CreateScale(2, 3);
        var translate = Matrix2D.CreateTranslation(10, 20);
        var point = (translate * scale).Transform(new Point2D(1, 2));

        Assert.Equal(new Point2D(12, 26), point);
        Assert.Equal(new Point2D(22, 66), (scale * translate).Transform(new Point2D(1, 2)));
    }

    [Fact]
    public void Matrix_RejectsNonFiniteComponentsAndOverflow()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new Matrix2D(1, 0, 0, 1, double.PositiveInfinity, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => (Matrix2D.CreateScale(double.MaxValue, 1) * Matrix2D.CreateScale(2, 1)));
        Assert.Throws<ArgumentOutOfRangeException>(() => Matrix2D.CreateTranslation(double.MaxValue, 0).Transform(new Point2D(double.MaxValue, 0)));
    }

    [Fact]
    public void Transform_ThenAppliesTheNextTransformAfterThisOne()
    {
        var move = new Transform2D(new Point2D(5, 0), new Point2D(1, 1), 0, Point2D.Zero);
        var scale = new Transform2D(Point2D.Zero, new Point2D(2, 2), 0, Point2D.Zero);

        Assert.Equal(new Point2D(12, 2), (scale.Matrix * move.Matrix).Transform(new Point2D(1, 1)));
    }

    [Fact]
    public void Transform_RotatesAroundPivotAfterNonUniformScaleThenTranslates()
    {
        var transform = new Transform2D(
            translation: new Point2D(5, 6),
            scale: new Point2D(2, 3),
            rotationRadians: Math.PI / 2,
            pivot: Point2D.Zero);

        Assert.Equal(new Point2D(5, 8), transform.Apply(new Point2D(1, 0)));
        Assert.Equal(new Point2D(5, 6), transform.Apply(Point2D.Zero));

        var aroundPivot = new Transform2D(
            translation: new Point2D(5, 6),
            scale: new Point2D(2, 3),
            rotationRadians: Math.PI / 2,
            pivot: new Point2D(2, 3));
        var transformedPivotEdge = aroundPivot.Apply(new Point2D(3, 3));
        Assert.Equal(7, transformedPivotEdge.X, 10);
        Assert.Equal(11, transformedPivotEdge.Y, 10);
    }

    [Fact]
    public void Transform_PreservesTranslatedPivotAndRejectsNonFiniteRotation()
    {
        var pivot = new Point2D(4, -3);
        var transform = new Transform2D(new Point2D(-2, 7), new Point2D(0.5, 2), 1.2, pivot);

        var transformedPivot = transform.Apply(pivot);
        Assert.Equal(pivot.X - 2, transformedPivot.X, 10);
        Assert.Equal(pivot.Y + 7, transformedPivot.Y, 10);
        Assert.Throws<ArgumentOutOfRangeException>(() => new Transform2D(Point2D.Zero, new Point2D(1, 1), double.NaN, Point2D.Zero));
    }
}
