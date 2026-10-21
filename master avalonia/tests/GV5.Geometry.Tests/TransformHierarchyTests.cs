using GV5.Geometry;
using Xunit;

namespace GV5.Geometry.Tests;

public sealed class TransformHierarchyTests
{
    [Fact]
    public void WorldMatrixComposesParentChildAndAnchorOffsets()
    {
        var root = TransformNodeId.New();
        var child = TransformNodeId.New();
        var hierarchy = TransformHierarchy.Create(
        [
            new TransformHierarchyNode(
                root,
                null,
                Point2D.Zero,
                new Transform2D(new Point2D(10, 20), new Point2D(2, 3), 0, Point2D.Zero)),
            Node(child, root, new Point2D(3, 4), translation: new Point2D(1, 2))
        ]);

        var world = hierarchy.GetWorldMatrix(child);

        Assert.Equal(new Point2D(18, 38), world.Transform(Point2D.Zero));
        Assert.Equal(new Point2D(4, 6), hierarchy.GetLocalMatrix(child).Transform(Point2D.Zero));
    }

    [Fact]
    public void ReparentCreatesANewHierarchyAndPreservesTheOriginalSnapshot()
    {
        var firstRoot = TransformNodeId.New();
        var secondRoot = TransformNodeId.New();
        var child = TransformNodeId.New();
        var hierarchy = TransformHierarchy.Create(
        [
            Node(firstRoot, null, Point2D.Zero, translation: new Point2D(10, 0)),
            Node(secondRoot, null, Point2D.Zero, translation: new Point2D(30, 0)),
            Node(child, firstRoot, Point2D.Zero, translation: new Point2D(2, 0))
        ]);

        var reparented = hierarchy.Reparent(child, secondRoot, new Point2D(1, 0));

        Assert.Equal(new Point2D(12, 0), hierarchy.GetWorldMatrix(child).Transform(Point2D.Zero));
        Assert.Equal(new Point2D(33, 0), reparented.GetWorldMatrix(child).Transform(Point2D.Zero));
    }

    [Fact]
    public void CreationAndReparentRejectCyclesAndMissingParents()
    {
        var first = TransformNodeId.New();
        var second = TransformNodeId.New();
        var third = TransformNodeId.New();

        Assert.Throws<ArgumentException>(() => TransformHierarchy.Create(
        [
            Node(first, second, Point2D.Zero),
            Node(second, first, Point2D.Zero)
        ]));
        Assert.Throws<ArgumentException>(() => TransformHierarchy.Create([Node(first, third, Point2D.Zero)]));

        var valid = TransformHierarchy.Create(
        [
            Node(first, null, Point2D.Zero),
            Node(second, first, Point2D.Zero)
        ]);
        Assert.Throws<ArgumentException>(() => valid.Reparent(first, second, Point2D.Zero));
    }

    private static TransformHierarchyNode Node(
        TransformNodeId id,
        TransformNodeId? parent,
        Point2D parentAnchor,
        Point2D? translation = null) => new(
            id,
            parent,
            parentAnchor,
            new Transform2D(translation ?? Point2D.Zero, new Point2D(1, 1), 0, Point2D.Zero));
}
