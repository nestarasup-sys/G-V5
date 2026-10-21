using GV5.Core.Models;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Rendering;

public readonly record struct RenderScenePreviewSize(int Width, int Height, double Scale);

/// <summary>Builds a bounded preview scene from the Fabricator's persisted model snapshot.</summary>
public static class ModelDraftRenderSceneBuilder
{
    public const int MaximumPreviewDimension = 2048;

    public static RenderScene Build(ModelDraftContent content, int maximumDimension = MaximumPreviewDimension)
    {
        ArgumentNullException.ThrowIfNull(content);
        var previewSize = GetPreviewSize(content, maximumDimension);
        var sourceAssetId = content.SourceAssetId!.Value;
        var sourceWidth = content.SourceWidth!.Value;
        var sourceHeight = content.SourceHeight!.Value;
        var scale = previewSize.Scale;
        var parts = content.Parts.ToDictionary(part => part.Id);
        var layers = new List<RenderLayer>();

        if (content.Parts.IsDefaultOrEmpty)
        {
            layers.Add(new RenderLayer(
                RenderLayerId.New(),
                sourceAssetId,
                new Rect2D(0, 0, sourceWidth, sourceHeight),
                new Transform2D(Point2D.Zero, new Point2D(scale, scale), 0, Point2D.Zero),
                1,
                RenderBlendMode.Normal,
                0));
        }
        else
        {
            for (var index = 0; index < content.LayerOrder.Length; index++)
            {
                var part = parts[content.LayerOrder[index]];
                if (!part.IsVisible)
                {
                    continue;
                }

                layers.Add(CreatePartLayer(part, scale, index));
            }
        }

        return new RenderScene(SceneId.New(), previewSize.Width, previewSize.Height, layers);
    }

    public static RenderLayer CreatePartLayer(ModelPart part, double sceneScale, int zOrder)
    {
        ArgumentNullException.ThrowIfNull(part);
        if (!double.IsFinite(sceneScale) || sceneScale <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(sceneScale));
        }

        var transform = part.Transform;
        var scaledTransform = new Transform2D(
            new Point2D(
                transform.Translation.X * sceneScale + (sceneScale - 1) * transform.Pivot.X,
                transform.Translation.Y * sceneScale + (sceneScale - 1) * transform.Pivot.Y),
            new Point2D(transform.Scale.X * sceneScale, transform.Scale.Y * sceneScale),
            transform.RotationRadians,
            transform.Pivot,
            transform.FlipX,
            transform.FlipY);
        return new RenderLayer(
            RenderLayerId.New(),
            part.AssetId,
            new Rect2D(0, 0, part.SourceCrop.Width, part.SourceCrop.Height),
            scaledTransform,
            1,
            RenderBlendMode.Normal,
            zOrder);
    }

    public static RenderScenePreviewSize GetPreviewSize(ModelDraftContent content, int maximumDimension = MaximumPreviewDimension)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (maximumDimension < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumDimension));
        }
        if (content.SourceWidth is not { } sourceWidth || content.SourceHeight is not { } sourceHeight || content.SourceAssetId is null)
        {
            throw new ArgumentException("A Fabricator preview requires a published source image.", nameof(content));
        }

        var scale = Math.Min(1d, (double)maximumDimension / Math.Max(sourceWidth, sourceHeight));
        return new RenderScenePreviewSize(
            Math.Max(1, (int)Math.Round(sourceWidth * scale)),
            Math.Max(1, (int)Math.Round(sourceHeight * scale)),
            scale);
    }
}
