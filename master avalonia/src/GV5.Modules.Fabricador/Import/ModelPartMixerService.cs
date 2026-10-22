using System.Collections.Immutable;
using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Rendering;
using SkiaSharp;

namespace GV5.Modules.Fabricador.Import;

/// <summary>Softens only opaque pixels on the uppermost visible part where a lower part is also opaque.</summary>
public sealed class ModelPartMixerService(IAssetStore assetStore, AssetImageDecoder decoder)
{
    private readonly IAssetStore _assetStore = assetStore ?? throw new ArgumentNullException(nameof(assetStore));
    private readonly AssetImageDecoder _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));

    public async Task<Result<ModelPartMixerResult>> ApplyStrokeAsync(
        ModelDraftContent content,
        IReadOnlyList<Point2D> scenePoints,
        double brushRadiusScenePixels = 24,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(scenePoints);
        if (scenePoints.Count == 0 || content.Parts.IsDefaultOrEmpty)
            return Result<ModelPartMixerResult>.Success(new ModelPartMixerResult([]));
        if (!double.IsFinite(brushRadiusScenePixels) || brushRadiusScenePixels <= 0)
            return Result<ModelPartMixerResult>.Failure(new ApplicationError(ApplicationErrorCode.Validation,
                "O tamanho do pincel precisa ser positivo."));

        var size = ModelDraftRenderSceneBuilder.GetPreviewSize(content);
        var partsById = content.Parts.ToDictionary(part => part.Id);
        var visible = content.LayerOrder.Reverse().Select(id => partsById[id]).Where(part => part.IsVisible).ToArray();
        var decodedImages = new List<DecodedAssetImage>();
        var layers = new List<MixerLayer>(visible.Length);
        try
        {
            foreach (var part in visible)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var opened = await _assetStore.OpenReadAsync(part.AssetId, cancellationToken).ConfigureAwait(false);
                if (opened.IsFailure) return Result<ModelPartMixerResult>.Failure(opened.Error!);
                await using var stream = opened.Value;
                var decoded = await _decoder.DecodeAsync(stream, cancellationToken).ConfigureAwait(false);
                if (decoded.IsFailure)
                    return Result<ModelPartMixerResult>.Failure(new ApplicationError(ApplicationErrorCode.Validation,
                        $"A imagem da peça “{part.Name}” não pode ser decodificada para o Misturador."));
                var image = decoded.Image!;
                decodedImages.Add(image);
                if (Math.Abs(part.SourceCrop.Width - image.Width) > 0.0001
                    || Math.Abs(part.SourceCrop.Height - image.Height) > 0.0001)
                    return Result<ModelPartMixerResult>.Failure(new ApplicationError(ApplicationErrorCode.Validation,
                        $"O recorte da peça “{part.Name}” não corresponde ao tamanho do asset."));

                var layer = ModelDraftRenderSceneBuilder.CreatePartLayer(part, size.Scale,
                    content.LayerOrder.IndexOf(part.Id));
                var matrix = RenderLayerGeometry.GetSceneMatrix(layer, size.Height);
                layers.Add(new MixerLayer(part, image.Bitmap, matrix, matrix.Invert(), new bool[image.Width * image.Height]));
            }

            await Task.Run(() => PaintStroke(layers, scenePoints, brushRadiusScenePixels, cancellationToken), cancellationToken)
                .ConfigureAwait(false);

            var changes = ImmutableArray.CreateBuilder<ModelPartAssetChange>();
            foreach (var layer in layers.Where(layer => layer.HasChanges))
            {
                cancellationToken.ThrowIfCancellationRequested();
                using var image = SKImage.FromBitmap(layer.Bitmap);
                using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
                    ?? throw new InvalidOperationException("The mixer image could not be encoded.");
                await using var input = new MemoryStream(encoded.ToArray(), writable: false);
                var imported = await _assetStore.ImportAsync(input, "image/png", cancellationToken).ConfigureAwait(false);
                if (imported.IsFailure) return Result<ModelPartMixerResult>.Failure(imported.Error!);

                var before = layer.Part;
                var after = new ModelPart(before.Id, before.Name, imported.Value.Id, before.SourceCrop,
                    before.Transform, before.SourceTransform, before.IsVisible);
                changes.Add(new ModelPartAssetChange(before, after));
            }

            return Result<ModelPartMixerResult>.Success(new ModelPartMixerResult(changes.ToImmutable()));
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or IOException or OutOfMemoryException)
        {
            return Result<ModelPartMixerResult>.Failure(new ApplicationError(ApplicationErrorCode.Persistence,
                "Não foi possível concluir o traço do Misturador."));
        }
        finally
        {
            foreach (var decoded in decodedImages) decoded.Dispose();
        }
    }

    private static void PaintStroke(IReadOnlyList<MixerLayer> layers, IReadOnlyList<Point2D> points,
        double radius, CancellationToken cancellationToken)
    {
        for (var segment = 0; segment < Math.Max(1, points.Count - 1); segment++)
        {
            var start = points[Math.Min(segment, points.Count - 1)];
            var end = points[Math.Min(segment + 1, points.Count - 1)];
            var distance = Math.Sqrt(Math.Pow(end.X - start.X, 2) + Math.Pow(end.Y - start.Y, 2));
            var steps = Math.Max(1, (int)Math.Ceiling(distance / 8));
            for (var step = 0; step <= steps; step++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var ratio = (double)step / steps;
                var center = new Point2D(start.X + (end.X - start.X) * ratio, start.Y + (end.Y - start.Y) * ratio);
                SoftenDab(layers, center, radius, cancellationToken);
            }
        }
    }

    private static void SoftenDab(IReadOnlyList<MixerLayer> layers, Point2D sceneCenter, double radius,
        CancellationToken cancellationToken)
    {
        for (var layerIndex = 0; layerIndex < layers.Count; layerIndex++)
        {
            var layer = layers[layerIndex];
            var localCenter = layer.SceneToLocal.Transform(sceneCenter);
            if (!Contains(layer, localCenter) || AlphaAt(layer, localCenter) == 0) continue;

            var hasOpaqueLayerUnderneath = false;
            for (var lowerIndex = layerIndex + 1; lowerIndex < layers.Count; lowerIndex++)
            {
                var lower = layers[lowerIndex];
                if (Contains(lower, lower.SceneToLocal.Transform(sceneCenter))
                    && AlphaAt(lower, lower.SceneToLocal.Transform(sceneCenter)) > 0)
                {
                    hasOpaqueLayerUnderneath = true;
                    break;
                }
            }
            if (!hasOpaqueLayerUnderneath) return;

            var localRadiusX = LocalRadius(layer.SceneToLocal, sceneCenter, new Point2D(sceneCenter.X + radius, sceneCenter.Y));
            var localRadiusY = LocalRadius(layer.SceneToLocal, sceneCenter, new Point2D(sceneCenter.X, sceneCenter.Y + radius));
            var width = layer.Bitmap.Width;
            var height = layer.Bitmap.Height;
            var centerX = localCenter.X / layer.Part.SourceCrop.Width * width;
            var centerY = localCenter.Y / layer.Part.SourceCrop.Height * height;
            var radiusX = Math.Max(1, localRadiusX / layer.Part.SourceCrop.Width * width);
            var radiusY = Math.Max(1, localRadiusY / layer.Part.SourceCrop.Height * height);
            var minX = Math.Max(0, (int)Math.Floor(centerX - radiusX));
            var maxX = Math.Min(width - 1, (int)Math.Ceiling(centerX + radiusX));
            var minY = Math.Max(0, (int)Math.Floor(centerY - radiusY));
            var maxY = Math.Min(height - 1, (int)Math.Ceiling(centerY + radiusY));
            for (var y = minY; y <= maxY; y++)
            for (var x = minX; x <= maxX; x++)
            {
                var index = y * width + x;
                if (layer.Touched[index]) continue;
                var local = new Point2D((x + 0.5) / width * layer.Part.SourceCrop.Width,
                    (y + 0.5) / height * layer.Part.SourceCrop.Height);
                var scenePixel = layer.LocalToScene.Transform(local);
                var dx = (scenePixel.X - sceneCenter.X) / radius;
                var dy = (scenePixel.Y - sceneCenter.Y) / radius;
                var radial = dx * dx + dy * dy;
                if (radial > 1) continue;

                var pixel = layer.Bitmap.GetPixel(x, y);
                if (pixel.Alpha == 0) continue;
                var covered = false;
                for (var lowerIndex = layerIndex + 1; lowerIndex < layers.Count; lowerIndex++)
                {
                    var lower = layers[lowerIndex];
                    var lowerLocal = lower.SceneToLocal.Transform(scenePixel);
                    if (Contains(lower, lowerLocal) && AlphaAt(lower, lowerLocal) > 0)
                    {
                        covered = true;
                        break;
                    }
                }
                if (!covered) continue;
                layer.Touched[index] = true;
                var alpha = (byte)Math.Clamp(Math.Round(pixel.Alpha * (1 - 0.3 * (1 - radial))), 0, 255);
                layer.Bitmap.SetPixel(x, y, new SKColor(pixel.Red, pixel.Green, pixel.Blue, alpha));
                layer.HasChanges = true;
            }
            return;
        }
    }

    private static double LocalRadius(Matrix2D inverse, Point2D center, Point2D edge) =>
        Math.Sqrt(Math.Pow(inverse.Transform(edge).X - inverse.Transform(center).X, 2)
            + Math.Pow(inverse.Transform(edge).Y - inverse.Transform(center).Y, 2));

    private static bool Contains(MixerLayer layer, Point2D local) =>
        local.X >= 0 && local.Y >= 0 && local.X < layer.Part.SourceCrop.Width && local.Y < layer.Part.SourceCrop.Height;

    private static byte AlphaAt(MixerLayer layer, Point2D local)
    {
        if (!Contains(layer, local)) return 0;
        var x = Math.Clamp((int)(local.X / layer.Part.SourceCrop.Width * layer.Bitmap.Width), 0, layer.Bitmap.Width - 1);
        var y = Math.Clamp((int)(local.Y / layer.Part.SourceCrop.Height * layer.Bitmap.Height), 0, layer.Bitmap.Height - 1);
        return layer.Bitmap.GetPixel(x, y).Alpha;
    }

    private sealed class MixerLayer(ModelPart part, SKBitmap bitmap, Matrix2D localToScene, Matrix2D sceneToLocal, bool[] touched)
    {
        public ModelPart Part { get; } = part;
        public SKBitmap Bitmap { get; } = bitmap;
        public Matrix2D LocalToScene { get; } = localToScene;
        public Matrix2D SceneToLocal { get; } = sceneToLocal;
        public bool[] Touched { get; } = touched;
        public bool HasChanges { get; set; }
    }
}

public sealed record ModelPartAssetChange(ModelPart Before, ModelPart After);
public sealed record ModelPartMixerResult(ImmutableArray<ModelPartAssetChange> Changes);
