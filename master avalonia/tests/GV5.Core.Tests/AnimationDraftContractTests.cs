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

    [Fact]
    public void AnimationFramePreviewUsesPinnedModelAssetsAndNeverChangesSourceTransforms()
    {
        var model = CreatePublishedModel();
        var pose = PoseDraft.CreateFromModelRevision(model, "Base");
        var animation = AnimationDraft.CreateFromPose(pose, "Aceno");
        var first = animation.Frames[0];
        var armId = model.Content.Parts[1].Id;
        var next = AnimationFrame.Create(250,
            first.Keys.Select(key => key.PartId == armId
                ? AnimationPartKey.Create(key.PartId, Transform(35), false)
                : key),
            first.RigJoints.Select(joint => joint with { ChildAnchor = new Point2D(35, 10) }));
        animation = animation.WithContent("Aceno", pose.Id, [first, next], AnimationEasing.Smooth,
            AnimationLoopMode.Loop, 1);

        var preview = animation.ApplyFrameToModelRevision(model, next.Id);
        var sourceArm = model.Content.Parts.Single(part => part.Id == armId);
        var previewArm = preview.Parts.Single(part => part.Id == armId);
        Assert.Equal(sourceArm.AssetId, previewArm.AssetId);
        Assert.Equal(sourceArm.SourceTransform, previewArm.SourceTransform);
        Assert.Equal(Transform(35), previewArm.Transform);
        Assert.False(previewArm.IsVisible);
        Assert.Equal(new Point2D(35, 10), Assert.Single(preview.RigJoints).ChildAnchor);
        Assert.Equal(model.Content.Parts.Select(part => part.Transform),
            model.Content.Parts.Select(part => part.SourceTransform.Transform));

        var otherPublication = CreatePublishedModel(model.ModelId, Revision.From(2), new string('b', 64));
        Assert.Throws<ArgumentException>(() => animation.ApplyFrameToModelRevision(otherPublication, next.Id));
        Assert.Throws<KeyNotFoundException>(() => animation.ApplyFrameToModelRevision(model, AnimationFrameId.New()));
    }

    [Fact]
    public void AnimationEvaluatorInterpolatesTransformsRigAndLoopModesDeterministically()
    {
        var model = CreatePublishedModel();
        var pose = PoseDraft.CreateFromModelRevision(model, "Base");
        var animation = AnimationDraft.CreateFromPose(pose, "Movimento");
        var first = animation.Frames[0];
        var armId = model.Content.Parts[1].Id;
        var second = AnimationFrame.Create(250,
            first.Keys.Select(key => key.PartId == armId
                ? AnimationPartKey.Create(key.PartId, Transform(30), false)
                : key),
            first.RigJoints.Select(joint => joint with { ChildAnchor = new Point2D(30, 10) }));
        animation = animation.WithContent("Movimento", pose.Id, [first, second], AnimationEasing.Linear,
            AnimationLoopMode.Once, 1);

        var middle = AnimationEvaluator.Evaluate(animation, model, 125);
        Assert.Equal(Transform(25), middle.Parts.Single(part => part.Id == armId).Transform);
        Assert.False(middle.Parts.Single(part => part.Id == armId).IsVisible);
        Assert.Equal(new Point2D(25, 10), Assert.Single(middle.RigJoints).ChildAnchor);
        Assert.Equal(Transform(30), AnimationEvaluator.Evaluate(animation, model, 1000)
            .Parts.Single(part => part.Id == armId).Transform);

        animation = animation.WithContent("Movimento", pose.Id, [first, second], AnimationEasing.Linear,
            AnimationLoopMode.Loop, 1);
        Assert.Equal(Transform(20), AnimationEvaluator.Evaluate(animation, model, animation.DurationMs)
            .Parts.Single(part => part.Id == armId).Transform);
        animation = animation.WithContent("Movimento", pose.Id, [first, second], AnimationEasing.Linear,
            AnimationLoopMode.PingPong, 1);
        Assert.Equal(Transform(25), AnimationEvaluator.Evaluate(animation, model, 375)
            .Parts.Single(part => part.Id == armId).Transform);
    }

    [Fact]
    public void AnimationEvaluatorRemainsFiniteForExtremeArmTransformsPivotsAndRigAnchors()
    {
        var model = CreatePublishedModel();
        var pose = PoseDraft.CreateFromModelRevision(model, "Base extrema");
        var animation = AnimationDraft.CreateFromPose(pose, "Braço extremo");
        var originalSourceTransforms = model.Content.Parts.Select(part => part.SourceTransform).ToArray();
        var armId = model.Content.Parts[1].Id;
        var first = animation.Frames[0];
        var left = new Transform2D(new Point2D(-1_000_000, 1_000_000), new Point2D(0.1, 8), Math.PI - 0.01,
            new Point2D(-100_000, 100_000), true, false);
        var right = new Transform2D(new Point2D(1_000_000, -1_000_000), new Point2D(4, 0.25), -Math.PI + 0.01,
            new Point2D(100_000, -100_000), false, true);
        var firstFrame = AnimationFrame.Create(250,
            first.Keys.Select(key => key.PartId == armId ? AnimationPartKey.Create(armId, left) : key),
            first.RigJoints.Select(joint => joint with
            {
                ParentAnchor = new Point2D(-1_000_000, 1_000_000),
                ChildAnchor = new Point2D(1_000_000, -1_000_000)
            }));
        var secondFrame = AnimationFrame.Create(250,
            first.Keys.Select(key => key.PartId == armId ? AnimationPartKey.Create(armId, right) : key),
            first.RigJoints.Select(joint => joint with
            {
                ParentAnchor = new Point2D(1_000_000, -1_000_000),
                ChildAnchor = new Point2D(-1_000_000, 1_000_000)
            }));
        animation = animation.WithContent("Braço extremo", null, [firstFrame, secondFrame],
            AnimationEasing.Linear, AnimationLoopMode.Once, 1);

        var evaluated = AnimationEvaluator.Evaluate(animation, model, 125);
        var transform = evaluated.Parts.Single(part => part.Id == armId).Transform;
        Assert.Equal(Point2D.Zero, transform.Translation);
        Assert.Equal(Point2D.Zero, transform.Pivot);
        Assert.Equal(new Point2D(2.05, 4.125), transform.Scale);
        Assert.InRange(Math.Abs(Math.Abs(transform.RotationRadians) - Math.PI), 0, 0.0001);
        var joint = Assert.Single(evaluated.RigJoints);
        Assert.Equal(Point2D.Zero, joint.ParentAnchor);
        Assert.Equal(Point2D.Zero, joint.ChildAnchor);
        Assert.Equal(originalSourceTransforms, model.Content.Parts.Select(part => part.SourceTransform));
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

    private static PublishedModelRevision CreatePublishedModel(ModelId? modelId = null, Revision? revision = null, string? hash = null)
    {
        var id = modelId ?? ModelId.New();
        var parts = new[]
        {
            CreatePart("Tronco", Transform(0)),
            CreatePart("Braço", Transform(20))
        };
        var joint = new RigJoint(RigJointId.New(), TransformNodeId.From(parts[0].Id.Value),
            TransformNodeId.From(parts[1].Id.Value), new Point2D(10, 10), new Point2D(20, 10), RigJointMode.Fixed);
        var content = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, id, Revision.Initial,
            ModelSlot.From(1), AssetId.New(), 100, 100, parts, parts.Select(part => part.Id), [joint]);
        return PublishedModelRevision.Restore(ModelRevisionId.New(), id, revision ?? Revision.Initial,
            Revision.Initial, "Modelo", 1234, hash ?? new string('a', 64), content);
    }

    private static ModelPart CreatePart(string name, Transform2D transform)
    {
        var crop = new Rect2D(0, 0, 10, 10);
        return new ModelPart(ModelPartId.New(), name, AssetId.New(), crop, transform,
            new ModelPartSourceTransform(crop, transform));
    }
}
