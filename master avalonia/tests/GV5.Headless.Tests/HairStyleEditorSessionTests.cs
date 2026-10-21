using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Interaction;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class HairStyleEditorSessionTests
{
    [Fact]
    public void EditsOrderVisibilityTransformPaletteAndUndoRedoWithoutChangingModelSource()
    {
        var model = PublishedModel();
        var session = new HairStyleEditorSession(model);
        var originalReference = session.Draft.Model;
        var originalRevision = session.Draft.Revision;
        var back = HairLayer.Create(HairPartId.BackHair, AssetId.New(), Transform2D.Identity);
        var posterior = HairLayer.Create(HairPartId.RearHair, AssetId.New(), Transform2D.Identity);
        var fringe = HairLayer.Create(HairPartId.FrontHair, AssetId.New(), Transform2D.Identity);

        Assert.True(session.AddOrReplace(back));
        Assert.True(session.AddOrReplace(posterior));
        Assert.True(session.AddOrReplace(fringe));
        Assert.True(session.Move(HairPartId.FrontHair, -1));
        Assert.Equal(new[] { HairPartId.BackHair, HairPartId.FrontHair, HairPartId.RearHair }, session.Draft.Layers.Select(layer => layer.Part));
        Assert.True(session.SetVisibility(HairPartId.FrontHair, false));
        Assert.True(session.SetTransform(HairPartId.FrontHair,
            new Transform2D(new Point2D(12, -4), new Point2D(1.2, 0.8), 0.25, Point2D.Zero, flipX: true)));
        Assert.True(session.SetColor(HairColorRole.Base, 0x9B563E));
        Assert.True(session.CanUndo);
        Assert.True(session.Undo());
        Assert.False(session.Draft.Palette.Colors.ContainsKey(HairColorRole.Base));
        Assert.True(session.Redo());
        Assert.Equal(0x9B563Eu, session.Draft.Palette.Colors[HairColorRole.Base]);

        Assert.True(session.Undo());
        Assert.True(session.SetColor(HairColorRole.Fade, 0x633B37));
        Assert.False(session.CanRedo);
        Assert.Equal(originalReference, session.Draft.Model);
        Assert.True(session.Draft.Revision.Value > originalRevision.Value);
        Assert.True(model.Content.Parts.IsEmpty);
    }

    [Fact]
    public void ReplacesSharedSlotsAndCapsHistoryAtFiftyEdits()
    {
        var session = new HairStyleEditorSession(PublishedModel());
        var first = HairLayer.Create(HairPartId.BackHair, AssetId.New(), Transform2D.Identity);
        var alternative = HairLayer.Create(HairPartId.Ponytail, AssetId.New(), Transform2D.Identity);
        session.AddOrReplace(first);
        session.AddOrReplace(alternative);
        Assert.Single(session.Draft.Layers);
        Assert.Equal(HairPartId.Ponytail, session.Draft.Layers[0].Part);

        for (var index = 0; index < 60; index++)
            session.SetColor(HairColorRole.Base, (uint)(0x100000 + index));

        Assert.Equal(50, session.UndoCount);
        for (var index = 0; index < 50; index++) Assert.True(session.Undo());
        Assert.False(session.CanUndo);
    }

    [Fact]
    public void RejectsDraftFromADifferentModelPublication()
    {
        var model = PublishedModel();
        var draft = HairStyleDraft.Create(ModelRevisionReference.From(model), "Cabelo");
        var otherModel = PublishedModel();
        Assert.Throws<ArgumentException>(() => new HairStyleEditorSession(otherModel, draft));
    }

    private static PublishedModelRevision PublishedModel()
    {
        var modelId = ModelId.New();
        var content = ModelDraftContent.CreateEmpty(modelId, Revision.Initial);
        return PublishedModelRevision.Restore(ModelRevisionId.New(), modelId, Revision.Initial, Revision.Initial,
            "Modelo", 1, new string('b', 64), content);
    }
}
