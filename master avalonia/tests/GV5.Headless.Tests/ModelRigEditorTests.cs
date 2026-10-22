using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Interaction;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class ModelRigEditorTests
{
    [Fact]
    public void MovingFixedParentMovesItsWholeFixedBranchAndUndoRestoresTransformsAndAnchors()
    {
        var (model, parts) = Model();
        var first = new RigJoint(RigJointId.New(), TransformNodeId.From(parts[0].Value), TransformNodeId.From(parts[1].Value), new Point2D(10, 11), new Point2D(12, 13), RigJointMode.Fixed);
        var second = new RigJoint(RigJointId.New(), TransformNodeId.From(parts[1].Value), TransformNodeId.From(parts[2].Value), new Point2D(20, 21), new Point2D(22, 23), RigJointMode.Fixed);
        var content = ModelDraftContent.Restore(
            model.SchemaVersion, model.ModelId, model.Revision, model.Slot, model.SourceAssetId,
            model.SourceWidth, model.SourceHeight, model.Parts, model.LayerOrder, [first, second]);
        var before = content.Parts.Select(part => part.Transform).ToArray();
        var command = new ModelPartTransformCommand(parts[0], before[0], new Transform2D(new Point2D(7, 9), before[0].Scale, before[0].RotationRadians, before[0].Pivot), MoveFixedDescendants: true);

        var moved = command.Apply(content);
        Assert.Equal(new Point2D(7, 9), moved.Parts[0].Transform.Translation);
        Assert.Equal(before[1].Translation + new Point2D(7, 9), moved.Parts[1].Transform.Translation);
        Assert.Equal(before[2].Translation + new Point2D(7, 9), moved.Parts[2].Transform.Translation);
        Assert.Equal(new Point2D(17, 2), moved.RigJoints[0].ParentAnchor);
        Assert.Equal(new Point2D(29, 14), moved.RigJoints[1].ChildAnchor);

        var reverted = command.Revert(moved);
        Assert.Equal(before, reverted.Parts.Select(part => part.Transform).ToArray());
        Assert.Equal(content.RigJoints, reverted.RigJoints);
        Assert.Equal(content.Parts.Select(part => part.SourceTransform), reverted.Parts.Select(part => part.SourceTransform));
    }

    [Fact]
    public void ConnectAnchorEditFixReconnectAndDisconnectKeepModelSourceUntouched()
    {
        var (model, parts) = Model();
        var source = model.Parts.Select(p => p.SourceTransform).ToArray();
        var editor = new ModelRigEditor(model);
        var first = editor.Connect(parts[0], parts[1], new Point2D(14, 21), new Point2D(3, 5));
        var second = editor.Connect(parts[1], parts[2], new Point2D(8, 9), Point2D.Zero);
        editor.ChangeAnchors(first.Id, new Point2D(19, 22), new Point2D(6, 7));
        editor.SetFixed(first.Id, true);
        editor.Reconnect(second.Id, parts[0], parts[2]);

        Assert.Equal(2, editor.Graph.Joints.Count);
        Assert.Equal(RigJointMode.Fixed, editor.Graph.Get(first.Id).Mode);
        Assert.Equal(new Point2D(19, 22), editor.Graph.Get(first.Id).ParentAnchor);
        Assert.Equal(new Point2D(6, 7), editor.Graph.Get(first.Id).ChildAnchor);
        Assert.Equal(TransformNodeId.From(parts[0].Value), editor.Graph.Get(second.Id).ParentPartId);
        Assert.Equal(source, model.Parts.Select(p => p.SourceTransform).ToArray());

        editor.Disconnect(first.Id);
        Assert.Single(editor.Graph.Joints);
        Assert.Equal(second.Id, editor.Graph.Joints[0].Id);
    }

    [Fact]
    public void InvalidConnectionAndCycleAreRejectedWithoutChangingAcceptedGraph()
    {
        var (model, parts) = Model();
        var editor = new ModelRigEditor(model);
        var first = editor.Connect(parts[0], parts[1], Point2D.Zero, Point2D.Zero);
        var second = editor.Connect(parts[1], parts[2], Point2D.Zero, Point2D.Zero);

        Assert.Throws<ArgumentException>(() => editor.Connect(parts[2], parts[0], Point2D.Zero, Point2D.Zero));
        Assert.Throws<ArgumentException>(() => editor.Connect(parts[0], parts[1], Point2D.Zero, Point2D.Zero));
        Assert.Throws<ArgumentException>(() => editor.Connect(parts[0], ModelPartId.New(), Point2D.Zero, Point2D.Zero));
        // Reconnecting 2→0 is valid; reconnecting 2→1 creates the real 1→2→1 cycle.
        Assert.Throws<ArgumentException>(() => editor.Reconnect(first.Id, parts[2], parts[1]));
        Assert.Throws<KeyNotFoundException>(() => editor.Disconnect(RigJointId.New()));
        Assert.Equal(2, editor.Graph.Joints.Count);
        Assert.Equal(first.Id, editor.Graph.Joints[0].Id);
        Assert.Equal(second.Id, editor.Graph.Joints[1].Id);
    }

    [Fact]
    public void ExistingRigMustReferencePartsInTheCurrentModel()
    {
        var (model, parts) = Model();
        var orphan = new RigJoint(RigJointId.New(),
            TransformNodeId.From(parts[0].Value), TransformNodeId.New(),
            Point2D.Zero, Point2D.Zero);
        Assert.Throws<ArgumentException>(() => new ModelRigEditor(model, [orphan]));
    }

    [Fact]
    public void RestoreSourceTransformsChangesOnlyRequestedTransformsAndIsReversible()
    {
        var (model, ids) = Model();
        var joint = new RigJoint(RigJointId.New(), TransformNodeId.From(ids[0].Value),
            TransformNodeId.From(ids[1].Value), Point2D.Zero, Point2D.Zero, RigJointMode.Fixed);
        var content = ModelDraftContent.Restore(model.SchemaVersion, model.ModelId, model.Revision,
            model.Slot, model.SourceAssetId, model.SourceWidth, model.SourceHeight,
            model.Parts, model.LayerOrder.Reverse(), [joint]);
        var editedPart = content.Parts[0];
        var editedTransform = new Transform2D(new Point2D(19, 23), editedPart.Transform.Scale,
            editedPart.Transform.RotationRadians, editedPart.Transform.Pivot);
        var editedContent = ModelDraftContent.Restore(content.SchemaVersion, content.ModelId, content.Revision,
            content.Slot, content.SourceAssetId, content.SourceWidth, content.SourceHeight,
            content.Parts.Select(part => part.Id == editedPart.Id ? part.WithTransform(editedTransform) : part),
            content.LayerOrder, content.RigJoints);
        var command = new ModelPartRestoreSourceTransformsCommand([
            new ModelPartTransformChange(editedPart.Id, editedTransform, editedPart.SourceTransform.Transform)
        ]);

        var restored = command.Apply(editedContent);
        Assert.Equal(editedPart.SourceTransform.Transform, restored.Parts.Single(part => part.Id == editedPart.Id).Transform);
        Assert.Equal(editedContent.Parts.Where(part => part.Id != editedPart.Id).Select(part => part.Transform),
            restored.Parts.Where(part => part.Id != editedPart.Id).Select(part => part.Transform));
        Assert.Equal(content.LayerOrder, restored.LayerOrder);
        Assert.Equal(content.RigJoints, restored.RigJoints);
        Assert.Equal(editedContent.Parts.Select(part => part.SourceTransform), restored.Parts.Select(part => part.SourceTransform));

        var reverted = command.Revert(restored);
        Assert.Equal(editedTransform, reverted.Parts.Single(part => part.Id == editedPart.Id).Transform);
        Assert.Equal(editedContent.Parts.Select(part => part.Transform), reverted.Parts.Select(part => part.Transform));
    }

    private static (ModelDraftContent Model, ModelPartId[] Parts) Model()
    {
        var parts = new[]
        {
            Part("Tronco", 0),
            Part("Braço", 20),
            Part("Mão", 40)
        };
        var model = ModelDraftContent.Restore(
            ModelDraftContent.CurrentSchemaVersion,
            ModelId.New(),
            Revision.Initial,
            ModelSlot.From(1),
            AssetId.New(),
            100,
            100,
            parts,
            parts.Select(p => p.Id));
        return (model, parts.Select(p => p.Id).ToArray());
    }

    private static ModelPart Part(string name, int x)
    {
        var crop = new Rect2D(x, 0, 10, 10);
        var transform = new Transform2D(new Point2D(x, 0), new Point2D(1, 1), 0, Point2D.Zero);
        return new ModelPart(ModelPartId.New(), name, AssetId.New(), crop, transform,
            new ModelPartSourceTransform(crop, transform));
    }
}
