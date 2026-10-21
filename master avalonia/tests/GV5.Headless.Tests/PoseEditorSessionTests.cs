using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Interaction;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class PoseEditorSessionTests
{
    [Fact]
    public void MoveSelectedPartTranslatesOnlyItsFixedDescendantsAndPoseAnchors()
    {
        var model = CreateModel();
        var session = new PoseEditorSession(model);
        var arm = model.Content.Parts.Single(part => part.Name == "Braço");
        session.SelectPart(arm.Id);
        var sourceTransforms = model.Content.Parts.Select(part => part.SourceTransform).ToArray();

        session.MoveSelected(new Point2D(5, 6));
        var preview = session.PreviewContent;

        Assert.Equal(new Point2D(15, 26), preview.Parts.Single(part => part.Name == "Braço").Transform.Translation);
        Assert.Equal(new Point2D(25, 26), preview.Parts.Single(part => part.Name == "Mão").Transform.Translation);
        Assert.Equal(new Point2D(30, 20), preview.Parts.Single(part => part.Name == "Perna").Transform.Translation);
        Assert.Equal(new Point2D(20, 69), preview.RigJoints[1].ParentAnchor);
        Assert.Equal(new Point2D(30, 69), preview.RigJoints[1].ChildAnchor);
        Assert.Equal(new Point2D(20, 69), preview.RigJoints[2].ParentAnchor);
        Assert.Equal(new Point2D(35, 75), preview.RigJoints[2].ChildAnchor);
        Assert.Equal(sourceTransforms, model.Content.Parts.Select(part => part.SourceTransform).ToArray());
        Assert.Equal(new Point2D(10, 20), model.Content.Parts.Single(part => part.Name == "Braço").Transform.Translation);
    }

    [Fact]
    public void RotateSelectedPartCanIncludeFixedButNotLooseDescendants()
    {
        var model = CreateModel();
        var session = new PoseEditorSession(model);
        var arm = model.Content.Parts.Single(part => part.Name == "Braço");
        session.SelectPart(arm.Id);

        session.RotateSelectedBy(Math.PI / 2, includeFixedDescendants: true);
        var preview = session.PreviewContent;
        var hand = preview.Parts.Single(part => part.Name == "Mão");
        var loosePart = preview.Parts.Single(part => part.Name == "Perna");

        Assert.Equal(Math.PI / 2, preview.Parts.Single(part => part.Name == "Braço").Transform.RotationRadians, 10);
        Assert.Equal(Math.PI / 2, hand.Transform.RotationRadians, 10);
        Assert.Equal(0, loosePart.Transform.RotationRadians, 10);
        AssertPoint(new Point2D(15, 35), hand.Transform.Apply(new Point2D(5, 5)));
        AssertPoint(new Point2D(35, 25), loosePart.Transform.Apply(new Point2D(5, 5)));
        Assert.Equal(new Point2D(15, 65), preview.RigJoints[1].ChildAnchor);
        Assert.Equal(model.Content.Parts.Select(part => part.SourceTransform), preview.Parts.Select(part => part.SourceTransform));
    }

    [Fact]
    public void PoseMoveRejectsTorsoAndUnknownSelection()
    {
        var model = CreateModel();
        var session = new PoseEditorSession(model);
        var torso = model.Content.Parts.Single(part => part.Name == "Tronco");
        Assert.False(session.SelectPart(torso.Id));
        Assert.Throws<InvalidOperationException>(() => session.MoveSelected(new Point2D(1, 0)));
        Assert.Throws<ArgumentException>(() => session.SelectPart(ModelPartId.New()));
    }

    private static PublishedModelRevision CreateModel()
    {
        var modelId = ModelId.New();
        var parts = new[]
        {
            CreatePart("Tronco", new Point2D(0, 20)),
            CreatePart("Braço", new Point2D(10, 20)),
            CreatePart("Mão", new Point2D(20, 20)),
            CreatePart("Perna", new Point2D(30, 20))
        };
        RigJoint Join(ModelPart parent, ModelPart child, Point2D parentAnchor, Point2D childAnchor, RigJointMode mode) =>
            new(RigJointId.New(), TransformNodeId.From(parent.Id.Value), TransformNodeId.From(child.Id.Value), parentAnchor, childAnchor, mode);
        var joints = new[]
        {
            Join(parts[0], parts[1], new Point2D(5, 75), new Point2D(15, 75), RigJointMode.Fixed),
            Join(parts[1], parts[2], new Point2D(15, 75), new Point2D(25, 75), RigJointMode.Fixed),
            Join(parts[1], parts[3], new Point2D(15, 75), new Point2D(35, 75), RigJointMode.Loose)
        };
        var content = ModelDraftContent.Restore(
            ModelDraftContent.CurrentSchemaVersion,
            modelId,
            Revision.Initial,
            ModelSlot.From(1),
            AssetId.New(),
            100,
            100,
            parts,
            parts.Select(part => part.Id),
            joints);
        return PublishedModelRevision.Restore(
            ModelRevisionId.New(), modelId, Revision.Initial, Revision.Initial, "Modelo de rig", 1,
            new string('a', 64), content);
    }

    private static ModelPart CreatePart(string name, Point2D translation)
    {
        var crop = new Rect2D(0, 0, 10, 10);
        var transform = new Transform2D(translation, new Point2D(1, 1), 0, Point2D.Zero);
        return new ModelPart(ModelPartId.New(), name, AssetId.New(), crop, transform,
            new ModelPartSourceTransform(crop, transform));
    }

    private static void AssertPoint(Point2D expected, Point2D actual)
    {
        Assert.Equal(expected.X, actual.X, 8);
        Assert.Equal(expected.Y, actual.Y, 8);
    }
}
