using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Core.Tests;

public sealed class AnimationDraftContractTests
{
    [Fact]
    public void AnimationStartsFromPoseAndKeepsModelRigAndPartKeysPinned()
    {
        var pose = CreatePose();
        var animation = AnimationDraft.CreateFromPose(pose, "  Aceno  ");

        Assert.Equal("Aceno", animation.Name);
        Assert.Equal(Revision.Initial, animation.Revision);
        Assert.Equal(pose.Model, animation.Model);
        Assert.Equal(pose.Id, animation.BasePoseId);
        Assert.Equal(pose.LayerOrder, animation.LayerOrder);
        Assert.Equal(AnimationEasing.Smooth, animation.Easing);
        Assert.Equal(AnimationLoopMode.Once, animation.LoopMode);
        Assert.Equal(250, animation.DurationMs);
        Assert.Equal(pose.PartTransforms.Select(part => part.PartId).ToHashSet(),
            Assert.Single(animation.Frames).Keys.Select(key => key.PartId).ToHashSet());
        Assert.Equal(pose.RigJoints, animation.Frames[0].RigJoints);

        var second = AnimationFrame.Create(500,
            animation.Frames[0].Keys.Select(key => AnimationPartKey.Create(key.PartId,
                key.PartId == pose.PartTransforms[1].PartId ? Transform(30) : key.Transform, key.IsVisible)),
            animation.Frames[0].RigJoints.Select(joint => joint with { ChildAnchor = new Point2D(31, 10) }));
        var edited = animation.WithContent("Aceno longo", pose.Id, [animation.Frames[0], second],
            AnimationEasing.Linear, AnimationLoopMode.PingPong, 1.5);

        Assert.Equal(Revision.From(2), edited.Revision);
        Assert.Equal(750, edited.DurationMs);
        Assert.Equal(AnimationEasing.Linear, edited.Easing);
        Assert.Equal(AnimationLoopMode.PingPong, edited.LoopMode);
        Assert.Equal(new Point2D(31, 10), Assert.Single(edited.Frames[1].RigJoints).ChildAnchor);
        Assert.Equal(pose.LayerOrder, edited.LayerOrder);
        Assert.Equal(Revision.Initial, animation.Revision);
        Assert.Equal("Aceno", animation.Name);
    }

    [Fact]
    public void AnimationRejectsInvalidDurationsSpeedsDuplicateKeysAndIncompleteFrames()
    {
        var pose = CreatePose();
        var frame = AnimationDraft.CreateFromPose(pose, "Teste").Frames[0];
        var keys = frame.Keys;

        Assert.Throws<ArgumentOutOfRangeException>(() => AnimationFrame.Create(39, keys));
        Assert.Throws<ArgumentOutOfRangeException>(() => AnimationFrame.Create(10_001, keys));
        Assert.Throws<ArgumentException>(() => AnimationFrame.Create(250, [keys[0], keys[0]]));
        Assert.Throws<ArgumentOutOfRangeException>(() => AnimationDraft.Restore(AnimationId.New(), pose.Model,
            Revision.Initial, "Teste", pose.Id, [frame], AnimationEasing.Smooth, AnimationLoopMode.Once, 0));

        var incomplete = AnimationFrame.Create(250, [keys[0]]);
        Assert.Throws<ArgumentException>(() => AnimationDraft.Restore(AnimationId.New(), pose.Model,
            Revision.Initial, "Teste", pose.Id, [frame, incomplete], AnimationEasing.Smooth, AnimationLoopMode.Once, 1, pose.LayerOrder));

        var changedRig = AnimationFrame.Create(250, keys, []);
        Assert.Throws<ArgumentException>(() => AnimationDraft.Restore(AnimationId.New(), pose.Model,
            Revision.Initial, "Teste", pose.Id, [frame, changedRig], AnimationEasing.Smooth, AnimationLoopMode.Once, 1, pose.LayerOrder));

        var joint = Assert.Single(frame.RigJoints);
        var changedTopology = AnimationFrame.Create(250, keys, [joint with
        {
            ParentPartId = joint.ChildPartId,
            ChildPartId = joint.ParentPartId,
            ParentAnchor = joint.ChildAnchor,
            ChildAnchor = joint.ParentAnchor
        }]);
        Assert.Throws<ArgumentException>(() => AnimationDraft.Restore(AnimationId.New(), pose.Model,
            Revision.Initial, "Teste", pose.Id, [frame, changedTopology], AnimationEasing.Smooth, AnimationLoopMode.Once, 1, pose.LayerOrder));
    }

    [Fact]
    public void AnimationRejectsMoreThanThreeHundredFramesAndInvalidTransformScale()
    {
        var pose = CreatePose();
        var frame = AnimationDraft.CreateFromPose(pose, "Teste").Frames[0];
        var tooMany = Enumerable.Range(0, AnimationDraft.MaximumFrames + 1)
            .Select(_ => AnimationFrame.Create(40, frame.Keys, frame.RigJoints));

        Assert.Throws<ArgumentException>(() => AnimationDraft.Restore(AnimationId.New(), pose.Model,
            Revision.Initial, "Teste", pose.Id, tooMany, AnimationEasing.Step, AnimationLoopMode.Loop, 4, pose.LayerOrder));
        Assert.Throws<ArgumentException>(() => AnimationPartKey.Create(frame.Keys[0].PartId,
            new Transform2D(Point2D.Zero, new Point2D(-1, 1), 0, Point2D.Zero)));
    }

    private static PoseDraft CreatePose()
    {
        var torso = ModelPartId.New();
        var arm = ModelPartId.New();
        var joint = new RigJoint(RigJointId.New(), TransformNodeId.From(torso.Value), TransformNodeId.From(arm.Value),
            new Point2D(10, 10), new Point2D(20, 10), RigJointMode.Fixed);
        return PoseDraft.Create(ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(),
            Revision.Initial, new string('a', 64)), "Base", [
            PosePartTransform.Create(torso, Transform(0)),
            PosePartTransform.Create(arm, Transform(20))
        ], [joint]);
    }

    private static Transform2D Transform(double x) =>
        new(new Point2D(x, 0), new Point2D(1, 1), 0, Point2D.Zero);
}
