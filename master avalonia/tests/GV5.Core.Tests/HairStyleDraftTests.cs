using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Core.Tests;

public sealed class HairStyleDraftTests
{
    [Fact]
    public void DraftTracksThreeOrderedSlotsAndReplacesLegacyVariantsInPlace()
    {
        var draft = HairStyleDraft.Create(ModelReference(), "  Cabelo da Luna  ");
        var back = HairLayer.Create(HairPartId.BackHair, AssetId.New(), Transform2D.Identity);
        var posterior = HairLayer.Create(HairPartId.RearHair, AssetId.New(), Transform2D.Identity);
        var fringe = HairLayer.Create(HairPartId.FrontHair, AssetId.New(), Transform2D.Identity);

        draft = draft.WithLayer(back).WithLayer(posterior).WithLayer(fringe);

        Assert.Equal("Cabelo da Luna", draft.Name);
        Assert.Equal(3, draft.Layers.Length);
        Assert.Equal(new[] { HairPartId.BackHair, HairPartId.RearHair, HairPartId.FrontHair }, draft.Layers.Select(layer => layer.Part));
        var priorRevision = draft.Revision;
        var ponytail = HairLayer.Create(HairPartId.Ponytail, AssetId.New(), Transform2D.Identity);
        draft = draft.WithLayer(ponytail);
        Assert.Equal(3, draft.Layers.Length);
        Assert.Equal(HairPartId.Ponytail, draft.Layers[0].Part);
        Assert.Equal(ponytail.AssetId, draft.Layers[0].AssetId);
        Assert.True(draft.Revision.Value > priorRevision.Value);

        draft = draft.MoveLayer(HairPartId.FrontHair, -1);
        Assert.Equal(new[] { HairPartId.Ponytail, HairPartId.FrontHair, HairPartId.RearHair }, draft.Layers.Select(layer => layer.Part));
        Assert.Equal(draft, draft.MoveLayer(HairPartId.Ponytail, -1));
        Assert.Throws<ArgumentOutOfRangeException>(() => draft.MoveLayer(HairPartId.FrontHair, 2));

        draft = draft.WithoutLayer(HairPartId.Ponytail);
        Assert.Equal(2, draft.Layers.Length);
        Assert.DoesNotContain(draft.Layers, layer => layer.Slot == HairSlotId.Back);
    }

    [Fact]
    public void RestoreRejectsDuplicateSlotsAndInvalidPartTransforms()
    {
        var model = ModelReference();
        var draft = HairStyleDraft.Create(model, "Cabelo");
        var back = HairLayer.Create(HairPartId.BackHair, AssetId.New(), Transform2D.Identity);
        var ponytail = HairLayer.Create(HairPartId.Ponytail, AssetId.New(), Transform2D.Identity);

        Assert.Throws<ArgumentException>(() => HairStyleDraft.Restore(draft.Id, model, Revision.Initial,
            "Cabelo", [back, ponytail]));
        Assert.Throws<ArgumentOutOfRangeException>(() => HairLayer.Create(HairPartId.BackHair, AssetId.New(),
            new Transform2D(Point2D.Zero, new Point2D(21, 1), 0, Point2D.Zero)));
        Assert.Throws<ArgumentOutOfRangeException>(() => HairLayer.Create(HairPartId.BackHair, AssetId.New(),
            new Transform2D(Point2D.Zero, new Point2D(1, 1), 0, Point2D.Zero, flipY: true)));
        Assert.Throws<ArgumentOutOfRangeException>(() => HairPartSlots.GetSlot((HairPartId)99));
    }

    [Fact]
    public void PaletteEditsAreImmutableAndUseOnlyKnownSixDigitRgbValues()
    {
        var draft = HairStyleDraft.Create(ModelReference(), "Cabelo");
        var before = draft.Palette;
        var updated = draft.WithPalette(before.WithColor(HairColorRole.Base, 0x9B563E)
            .WithColor(HairColorRole.Highlight, 0xE5AD83));

        Assert.Empty(before.Colors);
        Assert.Equal(0x9B563Eu, updated.Palette.Colors[HairColorRole.Base]);
        Assert.Equal(0xE5AD83u, updated.Palette.Colors[HairColorRole.Highlight]);
        Assert.False(updated.Palette.WithoutColor(HairColorRole.Base).Colors.ContainsKey(HairColorRole.Base));
        Assert.Throws<ArgumentOutOfRangeException>(() => before.WithColor((HairColorRole)99, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => before.WithColor(HairColorRole.Base, 0x1000000));
        Assert.Throws<ArgumentOutOfRangeException>(() => HairPaletteOverrides.Restore(
            [new KeyValuePair<HairColorRole, uint>(HairColorRole.Base, 0x1000000u)]));
    }

    private static ModelRevisionReference ModelReference() => ModelRevisionReference.Restore(
        ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('a', 64));
}
