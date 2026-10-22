using System.Security.Cryptography;
using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Import;
using GV5.Modules.Fabricador.Interaction;
using SkiaSharp;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class ModelPartSplitTests
{
    [Fact]
    public async Task VerticalSplitPreservesPixelsAndAlphaAndCommandKeepsRigUndoable()
    {
        var store = new TestAssetStore();
        var sourceBytes = CreateStrip();
        var cancellationToken = TestContext.Current.CancellationToken;
        var originalAsset = await store.ImportAsync(new MemoryStream(sourceBytes), "image/png", cancellationToken);
        Assert.True(originalAsset.IsSuccess);
        var originalId = ModelPartId.New();
        var followingId = ModelPartId.New();
        var transform = new Transform2D(new Point2D(20, 30), new Point2D(1.5, 0.8), 0.25,
            new Point2D(2, 1), flipX: true);
        var crop = new Rect2D(1, 0, 4, 2);
        var original = new ModelPart(originalId, "Peça", originalAsset.Value.Id, crop, transform,
            new ModelPartSourceTransform(crop, transform));
        var following = new ModelPart(followingId, "Apoio", originalAsset.Value.Id,
            new Rect2D(0, 0, 1, 1), Transform2D.Identity,
            new ModelPartSourceTransform(new Rect2D(0, 0, 1, 1), Transform2D.Identity));
        var joint = new RigJoint(RigJointId.New(), TransformNodeId.From(originalId.Value),
            TransformNodeId.From(followingId.Value), Point2D.Zero, Point2D.Zero, RigJointMode.Fixed);
        var content = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, ModelId.New(),
            Revision.Initial, ModelSlot.From(1), originalAsset.Value.Id, 6, 2,
            [original, following], [originalId, followingId], [joint]);

        var result = await new ModelPartSplitService(store, new AssetImageDecoder()).SplitVerticallyAsync(original, cancellationToken);

        Assert.True(result.IsSuccess, result.Error?.Message);
        Assert.Equal((2, 2, 2), (result.Value.LeftWidth, result.Value.RightWidth, result.Value.Height));
        Assert.Equal(SKColors.Red, await ReadPixelAsync(store, result.Value.Left.Id, 0, 0));
        Assert.Equal(SKColors.Green, await ReadPixelAsync(store, result.Value.Left.Id, 1, 1));
        Assert.Equal(SKColors.Blue, await ReadPixelAsync(store, result.Value.Right.Id, 0, 0));
        Assert.Equal(0, (await ReadPixelAsync(store, result.Value.Right.Id, 1, 0)).Alpha);

        var left = new ModelPart(original.Id, original.Name, result.Value.Left.Id,
            new Rect2D(0, 0, 2, 2), original.Transform,
            new ModelPartSourceTransform(new Rect2D(1, 0, 2, 2), transform));
        var rightTransform = Offset(transform, 2);
        var rightSourceTransform = Offset(transform, 2);
        var right = new ModelPart(ModelPartId.New(), "Peça (2)", result.Value.Right.Id,
            new Rect2D(0, 0, 2, 2), rightTransform,
            new ModelPartSourceTransform(new Rect2D(3, 0, 2, 2), rightSourceTransform));
        var command = new ModelPartSplitCommand(original, left, right);

        var split = command.Apply(content);
        Assert.Equal(new[] { originalId, right.Id, followingId }, split.LayerOrder);
        Assert.Equal(originalId, split.Parts[0].Id);
        Assert.Contains(split.RigJoints, item => item.Id == joint.Id
            && item.ParentPartId == TransformNodeId.From(originalId.Value));
        Assert.Equal(transform.Apply(new Point2D(2, 0)), right.Transform.Apply(Point2D.Zero));

        var undone = command.Revert(split);
        Assert.Equal(content.Parts, undone.Parts);
        Assert.Equal(content.LayerOrder, undone.LayerOrder);
        Assert.Equal(content.RigJoints, undone.RigJoints);
        var redone = command.Apply(undone);
        Assert.Equal(split.Parts, redone.Parts);
        Assert.Equal(split.LayerOrder, redone.LayerOrder);
    }

    private static Transform2D Offset(Transform2D transform, double x)
    {
        var a = transform.Apply(Point2D.Zero);
        var b = transform.Apply(new Point2D(x, 0));
        return new Transform2D(transform.Translation + (b - a), transform.Scale,
            transform.RotationRadians, transform.Pivot, transform.FlipX, transform.FlipY);
    }

    private static byte[] CreateStrip()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(6, 2, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        for (var y = 0; y < bitmap.Height; y++)
        {
            bitmap.SetPixel(0, y, SKColors.Yellow);
            bitmap.SetPixel(1, y, SKColors.Red);
            bitmap.SetPixel(2, y, SKColors.Green);
            bitmap.SetPixel(3, y, SKColors.Blue);
            bitmap.SetPixel(4, y, new SKColor(255, 255, 255, 0));
            bitmap.SetPixel(5, y, SKColors.Magenta);
        }
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)!;
        return encoded.ToArray();
    }

    private static async Task<SKColor> ReadPixelAsync(TestAssetStore store, AssetId id, int x, int y)
    {
        var opened = await store.OpenReadAsync(id);
        Assert.True(opened.IsSuccess);
        await using var stream = opened.Value;
        using var bitmap = SKBitmap.Decode(stream)!;
        return bitmap.GetPixel(x, y);
    }

    private sealed class TestAssetStore : IAssetStore
    {
        private readonly Dictionary<AssetId, byte[]> _assets = [];

        public async Task<Result<AssetMetadata>> ImportAsync(Stream content, string mediaType, CancellationToken cancellationToken = default)
        {
            using var buffer = new MemoryStream();
            await content.CopyToAsync(buffer, cancellationToken);
            var bytes = buffer.ToArray();
            var id = AssetId.New();
            _assets.Add(id, bytes);
            return Result<AssetMetadata>.Success(new AssetMetadata(id,
                Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), mediaType,
                bytes.Length, AssetVerificationState.Available, 1));
        }

        public Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(_assets.TryGetValue(assetId, out var bytes)
                ? Result<Stream>.Success(new MemoryStream(bytes, writable: false))
                : Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Asset not found.")));

        public Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Metadata not tracked.")));

        public Task<Result<Unit>> AddReferenceAsync(AssetId assetId, AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));

        public Task<Result<Unit>> ReleaseReferenceAsync(AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));
    }
}
