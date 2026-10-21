using GV5.Core.Models;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Rendering;

/// <summary>Builds a bounded preview scene from the Fabricator's persisted model snapshot.</summary>
public static class ModelDraftRenderSceneBuilder
{
    public const int MaximumPreviewDimension = 2048;

    public static RenderScene Build(ModelDraftContent content, int maximumDimension = MaximumPreviewDimension)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (maximumDimension < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumDimension));
        }
        if (content.SourceAssetId is not { } sourceAssetId || content.SourceWidth is not { } sourceWidth || content.SourceHeight is not { } sourceHeight)
        {
            throw new ArgumentException("A Fabricator preview requires a published source image.", nameof(content));
        }

        var scale = Math.Min(1d, (double)maximumDimension / Math.Max(sourceWidth, sourceHeight));
        var width = Math.Max(1, (int)Math.Round(sourceWidth * scale));
        var height = Math.Max(1, (int)Math.Round(sourceHeight * scale));
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

                var transform = part.Transform;
                var scaledTransform = new Transform2D(
                    new Point2D(transform.Translation.X * scale, transform.Translation.Y * scale),
                    new Point2D(transform.Scale.X * scale, transform.Scale.Y * scale),
                    transform.RotationRadians,
                    new Point2D(transform.Pivot.X * scale, transform.Pivot.Y * scale),
                    transform.FlipX,
                    transform.FlipY);
                layers.Add(new RenderLayer(
                    RenderLayerId.New(),
                    part.AssetId,
                    new Rect2D(0, 0, part.SourceCrop.Width, part.SourceCrop.Height),
                    scaledTransform,
                    1,
                    RenderBlendMode.Normal,
                    index));
            }
        }

        return new RenderScene(SceneId.New(), width, height, layers);
    }
}
