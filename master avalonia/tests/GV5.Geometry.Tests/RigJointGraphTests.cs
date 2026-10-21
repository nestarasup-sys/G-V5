using GV5.Geometry;
using Xunit;

namespace GV5.Geometry.Tests;

public sealed class RigJointGraphTests
{
    [Fact]
    public void AddEditAndRemove_CreateSnapshotsWithoutMutatingEarlierState()
    {
        var torso = TransformNodeId.New();
        var arm = TransformNodeId.New();
        var hand = TransformNodeId.New();
        var empty = RigJointGraph.Create([torso, arm, hand], []);
        var armJoint = Joint(torso, arm);
        var handJoint = Joint(arm, hand);
        var withArm = empty.Add(armJoint);
        var withHand = withArm.Add(handJoint);
        var edited = withHand.Edit(handJoint with
        {
            ParentAnchor = new Point2D(9, 3),
            IsSuggested = true
        });
        var removed = edited.Remove(armJoint.Id);

        Assert.Empty(empty.Joints);
        Assert.Single(withArm.Joints);
        Assert.Equal(2, withHand.Joints.Count);
        Assert.Equal(Point2D.Zero, withHand.Get(handJoint.Id).ParentAnchor);
        Assert.Equal(new Point2D(9, 3), edited.Get(handJoint.Id).ParentAnchor);
        Assert.True(edited.Get(handJoint.Id).IsSuggested);
        Assert.Single(removed.Joints);
        Assert.Equal(handJoint.Id, removed.Joints[0].Id);
        Assert.Equal(2, edited.Joints.Count);
    }

    [Fact]
    public void RejectsInvalidReferencesCyclesSecondParentsDuplicateIdsAndSelfLinks()
    {
        var torso = TransformNodeId.New();
        var arm = TransformNodeId.New();
        var hand = TransformNodeId.New();
        var outside = TransformNodeId.New();
        var graph = RigJointGraph.Create([torso, arm, hand], []);
        var first = Joint(torso, arm);
        var attached = graph.Add(first);

        Assert.Throws<ArgumentException>(() => attached.Add(Joint(hand, arm)));
        Assert.Throws<ArgumentException>(() => attached.Add(Joint(arm, outside)));
        Assert.Throws<ArgumentException>(() => attached.Add(Joint(arm, arm)));
        Assert.Throws<ArgumentException>(() => attached.Add(first));
        Assert.Throws<ArgumentException>(() => RigJointGraph.Create([torso, torso], []));
        var chain = attached.Add(Joint(arm, hand));
        Assert.Throws<ArgumentException>(() => chain.Add(Joint(hand, torso)));
        Assert.Throws<ArgumentException>(() => chain.Edit(first with { ParentPartId = hand }));
        Assert.Equal(2, chain.Joints.Count);
        Assert.Equal(torso, chain.Get(first.Id).ParentPartId);
    }

    [Fact]
    public void SetModeDoesNotMoveAnchorsOrRewriteThePreviousGraph()
    {
        var torso = TransformNodeId.New();
        var arm = TransformNodeId.New();
        var originalJoint = new RigJoint(
            RigJointId.New(), torso, arm,
            new Point2D(18, 21), new Point2D(2, 4),
            RigJointMode.Loose, true);
        var graph = RigJointGraph.Create([torso, arm], [originalJoint]);
        var fixedGraph = graph.SetMode(originalJoint.Id, RigJointMode.Fixed);

        Assert.Equal(RigJointMode.Loose, graph.Get(originalJoint.Id).Mode);
        Assert.Equal(RigJointMode.Fixed, fixedGraph.Get(originalJoint.Id).Mode);
        Assert.Equal(originalJoint.ParentAnchor, fixedGraph.Get(originalJoint.Id).ParentAnchor);
        Assert.Equal(originalJoint.ChildAnchor, fixedGraph.Get(originalJoint.Id).ChildAnchor);
        Assert.True(fixedGraph.Get(originalJoint.Id).IsSuggested);
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            graph.SetMode(originalJoint.Id, (RigJointMode)100));
    }

    [Fact]
    public void RejectsEditsAndDeletesForUnknownJointWithoutChangingGraph()
    {
        var torso = TransformNodeId.New();
        var arm = TransformNodeId.New();
        var graph = RigJointGraph.Create([torso, arm], []);
        var missing = Joint(torso, arm);

        Assert.Throws<KeyNotFoundException>(() => graph.Edit(missing));
        Assert.Throws<KeyNotFoundException>(() => graph.Remove(missing.Id));
        Assert.Throws<KeyNotFoundException>(() => graph.SetMode(missing.Id, RigJointMode.Fixed));
        Assert.Empty(graph.Joints);
    }

    private static RigJoint Joint(TransformNodeId parent, TransformNodeId child) =>
        new(RigJointId.New(), parent, child, Point2D.Zero, Point2D.Zero);
}
