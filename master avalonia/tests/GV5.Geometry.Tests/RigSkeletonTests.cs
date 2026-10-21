using GV5.Geometry;
using Xunit;

namespace GV5.Geometry.Tests;

public sealed class RigSkeletonTests
{
    [Fact]
    public void ParentMovementPropagatesThroughAnchoredChildAndGrandchild()
    {
        var torso = TransformNodeId.New();
        var arm = TransformNodeId.New();
        var hand = TransformNodeId.New();
        var skeleton = RigSkeleton.Create(
            [torso, arm, hand],
            [
                Joint(torso, arm, new Point2D(2, 0), new Point2D(1, 0)),
                Joint(arm, hand, new Point2D(4, 0), new Point2D(1, 0))
            ]);
        var pose = new Dictionary<TransformNodeId, Transform2D>
        {
            [torso] = Transform(new Point2D(10, 5), new Point2D(2, 2)),
            [arm] = Transform(translation: new Point2D(1, 0), rotation: Math.PI / 2),
            [hand] = Transform()
        };

        var world = skeleton.EvaluateWorldMatrices(pose);

        Assert.Equal(new Point2D(16, 5), world[arm].Transform(new Point2D(1, 0)));
        Assert.Equal(new Point2D(16, 11), world[hand].Transform(new Point2D(1, 0)));
    }

    [Fact]
    public void SkeletonRejectsCyclesDuplicateParentsAndMissingParts()
    {
        var torso = TransformNodeId.New();
        var arm = TransformNodeId.New();
        var other = TransformNodeId.New();

        Assert.Throws<ArgumentException>(() => RigSkeleton.Create(
            [torso, arm],
            [Joint(torso, arm), Joint(arm, torso)]));
        Assert.Throws<ArgumentException>(() => RigSkeleton.Create(
            [torso, arm, other],
            [Joint(torso, arm), Joint(other, arm)]));
        Assert.Throws<ArgumentException>(() => RigSkeleton.Create([torso], [Joint(torso, arm)]));
    }

    [Fact]
    public void PoseMustContainEveryPartExactlyOnce()
    {
        var torso = TransformNodeId.New();
        var arm = TransformNodeId.New();
        var skeleton = RigSkeleton.Create([torso, arm], [Joint(torso, arm)]);

        Assert.Throws<ArgumentException>(() => skeleton.EvaluateWorldMatrices(
            new Dictionary<TransformNodeId, Transform2D> { [torso] = Transform() }));
    }

    private static RigJoint Joint(
        TransformNodeId parent,
        TransformNodeId child,
        Point2D parentAnchor = default,
        Point2D childAnchor = default) => new(
            RigJointId.New(),
            parent,
            child,
            parentAnchor,
            childAnchor);

    private static Transform2D Transform(
        Point2D translation = default,
        Point2D? scale = null,
        double rotation = 0) => new(
            translation,
            scale ?? new Point2D(1, 1),
            rotation,
            Point2D.Zero);
}
