using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.VisualTree;
using Avalonia.Controls.Shapes;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Interaction;
using GV5.Modules.Fabricador.Views;
using GV5.Rendering;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class ModelDraftHitTesterTests
{
    [Fact]
    public void HitTestChoosesTopmostVisiblePartAndUsesTheRenderCoordinateTransform()
    {
        var sourceId = AssetId.New();
        var bottom = CreatePart("base", new Point2D(20, 30));
        var top = CreatePart("topo", new Point2D(20, 30));
        var content = CreateContent(sourceId, [bottom, top], [bottom.Id, top.Id]);
        var topLayer = CreateLayer(top, 1);
        var point = RenderLayerGeometry.GetSceneMatrix(topLayer, 100).Transform(new Point2D(10, 10));

        Assert.Equal(top.Id, ModelDraftHitTester.HitTest(content, point));
        var bounds = ModelDraftHitTester.GetPartBounds(content, top.Id);
        Assert.Equal(new Rect2D(20, 50, 40, 20), bounds);
    }

    [Fact]
    public void HitTestSkipsHiddenTopLayerAndHandlesRotatedFlippedGeometry()
    {
        var sourceId = AssetId.New();
        var bottom = CreatePart("base", new Point2D(20, 30));
        var hiddenTop = CreatePart("topo", new Point2D(20, 30), bottom.Transform, isVisible: false);
        var content = CreateContent(sourceId, [bottom, hiddenTop], [bottom.Id, hiddenTop.Id]);
        var point = RenderLayerGeometry.GetSceneMatrix(CreateLayer(bottom, 0), 100).Transform(new Point2D(10, 10));

        Assert.Equal(bottom.Id, ModelDraftHitTester.HitTest(content, point));
        Assert.Null(ModelDraftHitTester.HitTest(content, new Point2D(2, 2)));

        var rotatedTransform = new Transform2D(new Point2D(20, 30), new Point2D(1, 1), Math.PI / 2, Point2D.Zero, flipX: true);
        var rotated = CreatePart("rotacionada", new Point2D(20, 30), rotatedTransform);
        var rotatedContent = CreateContent(sourceId, [rotated], [rotated.Id]);
        var rotatedPoint = RenderLayerGeometry.GetSceneMatrix(CreateLayer(rotated, 0), 100).Transform(new Point2D(10, 10));
        Assert.Equal(rotated.Id, ModelDraftHitTester.HitTest(rotatedContent, rotatedPoint));
    }

    [AvaloniaFact]
    public void CanvasZoomKeepsTheScenePointUnderThePointerAndPanChangesViewport()
    {
        var bitmap = new WriteableBitmap(new PixelSize(100, 50), new Vector(96, 96), PixelFormats.Rgba8888, AlphaFormat.Premul);
        var canvas = new FabricatorCanvas { Frame = bitmap };
        var window = new Window { Width = 400, Height = 300, Content = canvas };
        window.Show();
        try
        {
            var pointer = new Point(canvas.Bounds.Width * 0.67, canvas.Bounds.Height * 0.42);
            canvas.SetSelection(new Rect2D(10, 5, 20, 10));
            var overlay = Assert.Single(canvas.GetVisualDescendants().OfType<Rectangle>(), control => control.Name == "SelectionOverlay");
            Assert.True(overlay.IsVisible);
            Assert.True(overlay.Width > 0);

            var beforeZoom = canvas.ScreenToScene(pointer);
            canvas.ZoomAt(pointer, 1.5);
            var afterZoom = canvas.ScreenToScene(pointer);

            Assert.Equal(beforeZoom.X, afterZoom.X, precision: 6);
            Assert.Equal(beforeZoom.Y, afterZoom.Y, precision: 6);
            Assert.Equal(1.5, canvas.ZoomFactor, precision: 6);

            var overlayLeftBeforePan = Canvas.GetLeft(overlay);

            var offsetBeforePan = canvas.PanOffset;
            canvas.PanBy(new Vector(20, -10));
            Assert.Equal(offsetBeforePan + new Vector(20, -10), canvas.PanOffset);
            Assert.NotEqual(afterZoom, canvas.ScreenToScene(pointer));
            Assert.NotEqual(overlayLeftBeforePan, Canvas.GetLeft(overlay));

            canvas.SetTool(FabricatorTool.Pan);
            Assert.Equal(FabricatorTool.Pan, canvas.CurrentTool);

            canvas.ZoomAt(pointer, 100);
            Assert.Equal(8, canvas.ZoomFactor);
        }
        finally
        {
            canvas.Frame = null;
            window.Close();
        }
    }

    private static ModelPart CreatePart(string name, Point2D translation, Transform2D? transform = null, bool isVisible = true)
    {
        var crop = new Rect2D(0, 0, 40, 20);
        return new ModelPart(
            ModelPartId.New(),
            name,
            AssetId.New(),
            crop,
            transform ?? new Transform2D(translation, new Point2D(1, 1), 0, Point2D.Zero),
            new ModelPartSourceTransform(crop, Transform2D.Identity),
            isVisible);
    }

    private static ModelDraftContent CreateContent(AssetId sourceId, IReadOnlyList<ModelPart> parts, IReadOnlyList<ModelPartId> order) =>
        ModelDraftContent.Restore(
            ModelDraftContent.CurrentSchemaVersion,
            ModelId.New(),
            Revision.Initial,
            null,
            sourceId,
            100,
            100,
            parts,
            order);

    private static RenderLayer CreateLayer(ModelPart part, int zOrder) => new(
        RenderLayerId.New(),
        part.AssetId,
        new Rect2D(0, 0, part.SourceCrop.Width, part.SourceCrop.Height),
        part.Transform,
        1,
        RenderBlendMode.Normal,
        zOrder);
}
