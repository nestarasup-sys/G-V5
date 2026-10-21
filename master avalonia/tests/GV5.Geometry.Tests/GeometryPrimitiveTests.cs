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
        var move = new Transform2D(Matrix2D.CreateTranslation(5, 0));
        var scale = new Transform2D(Matrix2D.CreateScale(2, 2));

        Assert.Equal(new Point2D(12, 2), move.Then(scale).Apply(new Point2D(1, 1)));
    }
}
