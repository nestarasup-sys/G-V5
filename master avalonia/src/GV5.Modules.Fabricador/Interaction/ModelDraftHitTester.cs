using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Rendering;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Hit tests model pieces in the same scene coordinates and z-order used by SkiaRenderer.</summary>
public static class ModelDraftHitTester
{
    public static ModelPartId? HitTest(ModelDraftContent content, Point2D scenePoint, int maximumDimension = ModelDraftRenderSceneBuilder.MaximumPreviewDimension)
    {
        ArgumentNullException.ThrowIfNull(content);
        var previewSize = ModelDraftRenderSceneBuilder.GetPreviewSize(content, maximumDimension);
        if (content.Parts.IsDefaultOrEmpty)
        {
            return null;
        }

        var scale = previewSize.Scale;
        var parts = content.Parts.ToDictionary(part => part.Id);
        for (var index = content.LayerOrder.Length - 1; index >= 0; index--)
        {
            var part = parts[content.LayerOrder[index]];
            if (!part.IsVisible)
            {
                continue;
            }

            var layer = ModelDraftRenderSceneBuilder.CreatePartLayer(part, scale, index);
            var localPoint = RenderLayerGeometry.GetSceneMatrix(layer, previewSize.Height).Invert().Transform(scenePoint);
            if (new Rect2D(0, 0, part.SourceCrop.Width, part.SourceCrop.Height).Contains(localPoint))
            {
                return part.Id;
            }
        }

        return null;
    }

    public static Rect2D? GetPartBounds(ModelDraftContent content, ModelPartId partId, int maximumDimension = ModelDraftRenderSceneBuilder.MaximumPreviewDimension)
    {
        ArgumentNullException.ThrowIfNull(content);
        var previewSize = ModelDraftRenderSceneBuilder.GetPreviewSize(content, maximumDimension);
        var part = content.Parts.FirstOrDefault(candidate => candidate.Id == partId && candidate.IsVisible);
        if (part is null)
        {
            return null;
        }

        var scale = previewSize.Scale;
        var partIndex = content.LayerOrder.IndexOf(partId);
        if (partIndex < 0)
        {
            return null;
        }

        var layer = ModelDraftRenderSceneBuilder.CreatePartLayer(part, scale, partIndex);
        return RenderLayerGeometry.GetSceneMatrix(layer, previewSize.Height)
            .TransformBounds(new Rect2D(0, 0, part.SourceCrop.Width, part.SourceCrop.Height));
    }
}
