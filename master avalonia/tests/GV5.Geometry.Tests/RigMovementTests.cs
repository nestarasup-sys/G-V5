using GV5.Geometry;
using Xunit;

namespace GV5.Geometry.Tests;

public sealed class RigMovementTests
{
    [Fact]
    public void TranslateMovesOnlyFixedDescendantsAndTheirJointAnchors()
    {
        var torso = TransformNodeId.New();
        var arm = TransformNodeId.New();
        var hand = TransformNodeId.New();
        var looseLeg = TransformNodeId.New();
        var joints = new[]
        {
            Joint(torso, arm, RigJointMode.Fixed),
            Joint(arm, hand, RigJointMode.Fixed),
            Joint(torso, looseLeg, RigJointMode.Loose)
        };
        var transforms = new Dictionary<TransformNodeId, Transform2D>
        {
            [torso] = Transform(new Point2D(1, 2)),
            [arm] = Transform(new Point2D(3, 4)),
            [hand] = Transform(new Point2D(5, 6)),
            [looseLeg] = Transform(new Point2D(7, 8))
        };
        var delta = new Point2D(10, -3);

        var result = RigMovement.Translate([torso, arm, hand, looseLeg], transforms, joints, torso, delta);

        Assert.Equal(new[] { torso, arm, hand }.Select(part => part.Value).Order(), result.MovedParts.Select(part => part.Value).Order());
        Assert.Equal(new Point2D(11, -1), result.Transforms[torso].Translation);
        Assert.Equal(new Point2D(13, 1), result.Transforms[arm].Translation);
        Assert.Equal(new Point2D(15, 3), result.Transforms[hand].Translation);
        Assert.Equal(new Point2D(7, 8), result.Transforms[looseLeg].Translation);
        Assert.Equal(new Point2D(10, -3), result.Joints[0].ParentAnchor);
        Assert.Equal(new Point2D(10, -3), result.Joints[0].ChildAnchor);
        Assert.Equal(new Point2D(10, -3), result.Joints[1].ParentAnchor);
        Assert.Equal(new Point2D(10, -3), result.Joints[1].ChildAnchor);
        Assert.Equal(new Point2D(10, -3), result.Joints[2].ParentAnchor);
        Assert.Equal(Point2D.Zero, result.Joints[2].ChildAnchor);
        Assert.Equal(new Point2D(3, 4), transforms[arm].Translation);
    }

    [Fact]
    public void TranslateRejectsUnknownRootAndIncompletePose()
    {
        var root = TransformNodeId.New();
        var transform = Transform();
        var transforms = new Dictionary<TransformNodeId, Transform2D> { [root] = transform };
        Assert.Throws<ArgumentException>(() => RigMovement.Translate([root], transforms, [], TransformNodeId.New(), Point2D.Zero));
        Assert.Throws<ArgumentException>(() => RigMovement.Translate([root], new Dictionary<TransformNodeId, Transform2D>(), [], root, Point2D.Zero));
    }

    private static RigJoint Joint(TransformNodeId parent, TransformNodeId child, RigJointMode mode) => new(
        RigJointId.New(), parent, child, Point2D.Zero, Point2D.Zero, mode);

    private static Transform2D Transform(Point2D translation = default) => new(
        translation, new Point2D(1, 1), 0, Point2D.Zero);
}
