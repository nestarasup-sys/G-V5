using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Core.Identity;
using SkiaSharp;

namespace GV5.Data.Thumbnails;

/// <summary>Creates deterministic PNG thumbnails and verifies disk cache files before returning them.</summary>
public sealed class ThumbnailService : IThumbnailService
{
    private const int GeneratorVersion = 1;
    private readonly IAssetStore _assetStore;
    private readonly IAppDataPaths _paths;
    private readonly AssetImageDecoder _decoder;
    private readonly KeyedGateSet _gates = new();

    public ThumbnailService(IAssetStore assetStore, IAppDataPaths paths, AssetImageDecoder decoder)
    {
        _assetStore = assetStore ?? throw new ArgumentNullException(nameof(assetStore));
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));
    }

    public async Task<Result<Stream>> GetOrCreateAsync(
        AssetId assetId,
        ThumbnailRecipe recipe,
        CancellationToken cancellationToken = default)
    {
        if (!assetId.IsValid)
        {
            return Failure(ApplicationErrorCode.Validation, "A valid asset ID is required.");
        }

        ArgumentNullException.ThrowIfNull(recipe);
        cancellationToken.ThrowIfCancellationRequested();

        var metadataResult = await _assetStore.GetMetadataAsync(assetId, cancellationToken).ConfigureAwait(false);
        if (metadataResult.IsFailure)
        {
            return Result<Stream>.Failure(metadataResult.Error!);
        }

        var metadata = metadataResult.Value;
        if (metadata.VerificationState != AssetVerificationState.Available)
        {
            return Failure(ApplicationErrorCode.Unavailable, "The source asset is not available for thumbnail generation.");
        }

        var cacheKey = BuildCacheKey(metadata.Sha256, recipe);
        var directory = Path.Combine(_paths.ThumbnailsDirectory, cacheKey[..2]);
        var thumbnailPath = Path.Combine(directory, $"{cacheKey}.png");
        var manifestPath = Path.Combine(directory, $"{cacheKey}.sha256");
        using var gate = await _gates.EnterAsync(cacheKey, cancellationToken).ConfigureAwait(false);

        try
        {
            Directory.CreateDirectory(directory);
            var cached = await TryOpenVerifiedAsync(thumbnailPath, manifestPath, cancellationToken).ConfigureAwait(false);
            if (cached is not null)
            {
                return Result<Stream>.Success(cached);
            }

            var sourceResult = await _assetStore.OpenReadAsync(assetId, cancellationToken).ConfigureAwait(false);
            if (sourceResult.IsFailure)
            {
                return Result<Stream>.Failure(sourceResult.Error!);
            }

            await using var sourceStream = sourceResult.Value;
            var decodeResult = await _decoder.DecodeAsync(sourceStream, cancellationToken).ConfigureAwait(false);
            if (decodeResult.IsFailure)
            {
                return Failure(ApplicationErrorCode.Validation, $"The source asset could not be decoded ({decodeResult.Error!.Code}).");
            }

            using var decoded = decodeResult.Image!;
            var encoded = await Task.Run(() => RenderPng(decoded.Bitmap, recipe), cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            var sha256 = Convert.ToHexStringLower(SHA256.HashData(encoded));
            await PublishAtomicallyAsync(thumbnailPath, manifestPath, encoded, sha256, cancellationToken).ConfigureAwait(false);
            return Result<Stream>.Success(OpenThumbnail(thumbnailPath));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException)
        {
            return Failure(ApplicationErrorCode.Persistence, "The thumbnail could not be generated or stored.");
        }
    }

    private static string BuildCacheKey(string contentHash, ThumbnailRecipe recipe)
    {
        var canonicalRecipe = $"thumbnail|generator={GeneratorVersion}|{recipe.Width}x{recipe.Height}|fit={(int)recipe.FitMode}|png|rgba-srgb-v1";
        var input = Encoding.UTF8.GetBytes($"{contentHash}|{canonicalRecipe}");
        return Convert.ToHexStringLower(SHA256.HashData(input));
    }

    private static byte[] RenderPng(SKBitmap source, ThumbnailRecipe recipe)
    {
        using var colorSpace = SKColorSpace.CreateSrgb();
        using var output = new SKBitmap(new SKImageInfo(recipe.Width, recipe.Height, SKColorType.Rgba8888, SKAlphaType.Unpremul, colorSpace));
        if (output.GetPixels() == IntPtr.Zero)
        {
            throw new InvalidOperationException("The thumbnail bitmap could not be allocated.");
        }

        output.Erase(SKColors.Transparent);
        var scaleX = recipe.Width / (float)source.Width;
        var scaleY = recipe.Height / (float)source.Height;
        var scale = recipe.FitMode switch
        {
            ThumbnailFitMode.Contain => Math.Min(scaleX, scaleY),
            ThumbnailFitMode.Cover => Math.Max(scaleX, scaleY),
            ThumbnailFitMode.Stretch => 1f,
            _ => throw new InvalidOperationException("The thumbnail recipe has an unsupported fit mode.")
        };

        var destination = recipe.FitMode == ThumbnailFitMode.Stretch
            ? new SKRect(0, 0, recipe.Width, recipe.Height)
            : new SKRect(
                (recipe.Width - source.Width * scale) / 2,
                (recipe.Height - source.Height * scale) / 2,
                (recipe.Width + source.Width * scale) / 2,
                (recipe.Height + source.Height * scale) / 2);

        using var canvas = new SKCanvas(output);
        using var paint = new SKPaint { FilterQuality = SKFilterQuality.High };
        canvas.DrawBitmap(source, destination, paint);
        canvas.Flush();
        using var data = output.Encode(SKEncodedImageFormat.Png, 100);
        return data?.ToArray() ?? throw new InvalidOperationException("SkiaSharp could not encode the thumbnail as PNG.");
    }

    private static async Task<Stream?> TryOpenVerifiedAsync(string thumbnailPath, string manifestPath, CancellationToken cancellationToken)
    {
        if (!File.Exists(thumbnailPath) || !File.Exists(manifestPath))
        {
            TryDelete(thumbnailPath);
            TryDelete(manifestPath);
            return null;
        }

        var stream = OpenThumbnail(thumbnailPath);
        try
        {
            if (new FileInfo(manifestPath).Length > 128)
            {
                await stream.DisposeAsync().ConfigureAwait(false);
                TryDelete(thumbnailPath);
                TryDelete(manifestPath);
                return null;
            }

            var manifest = await File.ReadAllTextAsync(manifestPath, cancellationToken).ConfigureAwait(false);
            var parts = manifest.Split('\n', StringSplitOptions.TrimEntries);
            if (parts.Length != 2 || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var expectedLength) || expectedLength != stream.Length ||
                parts[1].Length != 64 || parts[1].Any(character => character is not (>= '0' and <= '9' or >= 'a' and <= 'f')))
            {
                await stream.DisposeAsync().ConfigureAwait(false);
                TryDelete(thumbnailPath);
                TryDelete(manifestPath);
                return null;
            }

            var actualHash = Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false));
            if (!string.Equals(actualHash, parts[1], StringComparison.Ordinal))
            {
                await stream.DisposeAsync().ConfigureAwait(false);
                TryDelete(thumbnailPath);
                TryDelete(manifestPath);
                return null;
            }

            stream.Position = 0;
            return stream;
        }
        catch
        {
            await stream.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    private static async Task PublishAtomicallyAsync(
        string thumbnailPath,
        string manifestPath,
        byte[] bytes,
        string sha256,
        CancellationToken cancellationToken)
    {
        var operationId = Guid.NewGuid().ToString("N");
        var thumbnailTemp = $"{thumbnailPath}.{operationId}.tmp";
        var manifestTemp = $"{manifestPath}.{operationId}.tmp";
        try
        {
            await using (var output = new FileStream(thumbnailTemp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                await output.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                await output.FlushAsync(cancellationToken).ConfigureAwait(false);
                output.Flush(flushToDisk: true);
            }

            var manifest = $"{bytes.LongLength.ToString(CultureInfo.InvariantCulture)}\n{sha256}";
            await using (var output = new FileStream(manifestTemp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                await output.WriteAsync(Encoding.ASCII.GetBytes(manifest), cancellationToken).ConfigureAwait(false);
                await output.FlushAsync(cancellationToken).ConfigureAwait(false);
                output.Flush(flushToDisk: true);
            }

            cancellationToken.ThrowIfCancellationRequested();
            File.Move(thumbnailTemp, thumbnailPath, overwrite: true);
            File.Move(manifestTemp, manifestPath, overwrite: true);
        }
        finally
        {
            TryDelete(thumbnailTemp);
            TryDelete(manifestTemp);
        }
    }

    private static FileStream OpenThumbnail(string path) =>
        new(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 16 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (FileNotFoundException)
        {
        }
    }

    private static Result<Stream> Failure(ApplicationErrorCode code, string message) =>
        Result<Stream>.Failure(new ApplicationError(code, message));

    private sealed class KeyedGateSet
    {
        private readonly object _sync = new();
        private readonly Dictionary<string, Gate> _gates = new(StringComparer.Ordinal);

        public async Task<GateLease> EnterAsync(string key, CancellationToken cancellationToken)
        {
            Gate gate;
            lock (_sync)
            {
                if (!_gates.TryGetValue(key, out gate!))
                {
                    gate = new Gate();
                    _gates.Add(key, gate);
                }

                gate.References++;
            }

            try
            {
                await gate.Semaphore.WaitAsync(cancellationToken).ConfigureAwait(false);
                return new GateLease(this, key, gate);
            }
            catch
            {
                ReleaseReference(key, gate);
                throw;
            }
        }

        private void Exit(string key, Gate gate)
        {
            gate.Semaphore.Release();
            ReleaseReference(key, gate);
        }

        private void ReleaseReference(string key, Gate gate)
        {
            lock (_sync)
            {
                gate.References--;
                if (gate.References == 0 && _gates.TryGetValue(key, out var current) && ReferenceEquals(current, gate))
                {
                    _gates.Remove(key);
                    gate.Semaphore.Dispose();
                }
            }
        }

        public sealed class Gate
        {
            public SemaphoreSlim Semaphore { get; } = new(1, 1);
            public int References { get; set; }
        }

        public sealed class GateLease(KeyedGateSet owner, string key, Gate gate) : IDisposable
        {
            private int _disposed;

            public void Dispose()
            {
                if (Interlocked.Exchange(ref _disposed, 1) == 0)
                {
                    owner.Exit(key, gate);
                }
            }
        }
    }
}
