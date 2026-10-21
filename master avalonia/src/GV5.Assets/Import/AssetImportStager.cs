using System.Buffers.Binary;
using System.Security.Cryptography;
using GV5.Core.Identity;

namespace GV5.Assets.Import;

/// <summary>Limits applied before an imported image is eligible for publication.</summary>
public sealed record AssetImportLimits(
    long MaximumBytes = 256L * 1024 * 1024,
    int MaximumDimension = 16_384,
    long MaximumPixels = 100_000_000);

public enum AssetImportFailureCode
{
    UnsupportedMediaType = 1,
    DeclaredTypeMismatch = 2,
    InvalidImage = 3,
    FileTooLarge = 4,
    DimensionsOutOfRange = 5
}

public sealed class AssetImportException : Exception
{
    public AssetImportException(AssetImportFailureCode code, string message) : base(message)
    {
        if (!Enum.IsDefined(code))
        {
            throw new ArgumentOutOfRangeException(nameof(code));
        }

        Code = code;
    }

    public AssetImportFailureCode Code { get; }
}

/// <summary>
/// Copies an image stream to an isolated staging file, computes its content hash and checks its header.
/// The stage file is removed when the returned object is disposed; it is not yet published to the AssetStore.
/// </summary>
public sealed class AssetImportStager
{
    private readonly string _stagingDirectory;
    private readonly AssetImportLimits _limits;

    public AssetImportStager(string stagingDirectory, AssetImportLimits? limits = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(stagingDirectory);
        _stagingDirectory = Path.GetFullPath(stagingDirectory);
        _limits = limits ?? new AssetImportLimits();
        if (_limits.MaximumBytes < 1 || _limits.MaximumDimension < 1 || _limits.MaximumPixels < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(limits), "Asset import limits must be positive.");
        }
    }

    public async Task<StagedAssetImport> StageAsync(
        Stream content,
        string declaredMediaType,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (!content.CanRead)
        {
            throw new ArgumentException("The import stream must be readable.", nameof(content));
        }

        var normalizedDeclaredType = NormalizeDeclaredMediaType(declaredMediaType);
        Directory.CreateDirectory(_stagingDirectory);
        var assetId = AssetId.New();
        var stagingPath = Path.Combine(_stagingDirectory, $"asset-import-{Guid.NewGuid():N}.stage");
        try
        {
            var (byteLength, sha256) = await CopyAndHashAsync(content, stagingPath, cancellationToken).ConfigureAwait(false);
            if (byteLength == 0)
            {
                throw new AssetImportException(AssetImportFailureCode.InvalidImage, "The image stream is empty.");
            }

            await using var stagedFile = new FileStream(stagingPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
            var (actualMediaType, width, height) = ImageHeaderReader.Read(stagedFile);
            if (!string.Equals(normalizedDeclaredType, actualMediaType, StringComparison.Ordinal))
            {
                throw new AssetImportException(AssetImportFailureCode.DeclaredTypeMismatch, "The declared media type does not match the image header.");
            }

            ValidateDimensions(width, height);
            return new StagedAssetImport(assetId, stagingPath, actualMediaType, byteLength, width, height, sha256);
        }
        catch
        {
            TryDeleteStagingFile(stagingPath);
            throw;
        }
    }

    private async Task<(long ByteLength, string Sha256)> CopyAndHashAsync(Stream source, string destinationPath, CancellationToken cancellationToken)
    {
        long totalBytes = 0;
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[64 * 1024];
        await using (var destination = new FileStream(destinationPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, buffer.Length, FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.WriteThrough))
        {
            while (true)
            {
                var read = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (read == 0)
                {
                    break;
                }

                if (read > _limits.MaximumBytes - totalBytes)
                {
                    throw new AssetImportException(AssetImportFailureCode.FileTooLarge, $"The image exceeds the {_limits.MaximumBytes} byte import limit.");
                }

                totalBytes += read;
                hash.AppendData(buffer, 0, read);
                await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
            }

            await destination.FlushAsync(cancellationToken).ConfigureAwait(false);
            destination.Flush(flushToDisk: true);
        }

        return (totalBytes, Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant());
    }

    private void ValidateDimensions(int width, int height)
    {
        if (width < 1 || height < 1 || width > _limits.MaximumDimension || height > _limits.MaximumDimension || (long)width * height > _limits.MaximumPixels)
        {
            throw new AssetImportException(AssetImportFailureCode.DimensionsOutOfRange, "The image dimensions exceed the supported range.");
        }
    }

    private static string NormalizeDeclaredMediaType(string declaredMediaType)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(declaredMediaType);
        var normalized = declaredMediaType.Trim().ToLowerInvariant();
        if (normalized is not ("image/png" or "image/jpeg" or "image/webp"))
        {
            throw new AssetImportException(AssetImportFailureCode.UnsupportedMediaType, "Only PNG, JPEG and WebP images are supported.");
        }

        return normalized;
    }

    private static void TryDeleteStagingFile(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Preserve the original import error; a later staging recovery pass can remove abandoned files.
        }
    }
}

/// <summary>Validated staged content. Callers must close streams opened from it before disposing this object.</summary>
public sealed class StagedAssetImport : IAsyncDisposable
{
    private readonly string _stagingPath;
    private int _disposed;

    internal StagedAssetImport(AssetId id, string stagingPath, string mediaType, long byteLength, int width, int height, string sha256)
    {
        Id = id;
        _stagingPath = stagingPath;
        MediaType = mediaType;
        ByteLength = byteLength;
        Width = width;
        Height = height;
        Sha256 = sha256;
    }

    public AssetId Id { get; }
    public string MediaType { get; }
    public long ByteLength { get; }
    public int Width { get; }
    public int Height { get; }
    public string Sha256 { get; }

    public Task<Stream> OpenReadAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        cancellationToken.ThrowIfCancellationRequested();
        Stream stream = new FileStream(_stagingPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        return Task.FromResult(stream);
    }

    public ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            try
            {
                File.Delete(_stagingPath);
            }
            catch (FileNotFoundException)
            {
                // Already cleaned up by the host or a recovery pass.
            }
        }

        return ValueTask.CompletedTask;
    }
}

internal static class ImageHeaderReader
{
    private static readonly byte[] PngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

    public static (string MediaType, int Width, int Height) Read(Stream stream)
    {
        Span<byte> header = stackalloc byte[12];
        ReadExactly(stream, header);
        stream.Position = 0;

        if (header[..8].SequenceEqual(PngSignature))
        {
            return ReadPng(stream);
        }

        if (header[0] == 0xFF && header[1] == 0xD8)
        {
            return ReadJpeg(stream);
        }

        if (header[..4].SequenceEqual("RIFF"u8) && header[8..12].SequenceEqual("WEBP"u8))
        {
            return ReadWebP(stream);
        }

        throw new AssetImportException(AssetImportFailureCode.UnsupportedMediaType, "The file header is not a supported PNG, JPEG or WebP image.");
    }

    private static (string, int, int) ReadPng(Stream stream)
    {
        if (stream.Length < 45)
        {
            throw InvalidImage("The PNG header or terminal chunk is truncated.");
        }

        Span<byte> header = stackalloc byte[24];
        ReadExactly(stream, header);
        if (BinaryPrimitives.ReadUInt32BigEndian(header[8..12]) != 13 || !header[12..16].SequenceEqual("IHDR"u8))
        {
            throw InvalidImage("The PNG does not begin with a valid IHDR chunk.");
        }

        stream.Position = stream.Length - 12;
        Span<byte> end = stackalloc byte[8];
        ReadExactly(stream, end);
        if (BinaryPrimitives.ReadUInt32BigEndian(end[..4]) != 0 || !end[4..].SequenceEqual("IEND"u8))
        {
            throw InvalidImage("The PNG is missing its terminal IEND chunk.");
        }

        var width = BinaryPrimitives.ReadUInt32BigEndian(header[16..20]);
        var height = BinaryPrimitives.ReadUInt32BigEndian(header[20..24]);
        return ("image/png", ToDimension(width), ToDimension(height));
    }

    private static (string, int, int) ReadJpeg(Stream stream)
    {
        if (stream.Length < 4)
        {
            throw InvalidImage("The JPEG file is truncated.");
        }

        stream.Position = stream.Length - 2;
        Span<byte> end = stackalloc byte[2];
        ReadExactly(stream, end);
        if (end[0] != 0xFF || end[1] != 0xD9)
        {
            throw InvalidImage("The JPEG is missing its end marker.");
        }

        stream.Position = 2;
        Span<byte> markerPrefix = stackalloc byte[1];
        Span<byte> markerCode = stackalloc byte[1];
        Span<byte> segmentLengthBytes = stackalloc byte[2];
        Span<byte> frameHeader = stackalloc byte[5];
        while (stream.Position < stream.Length - 2)
        {
            ReadExactly(stream, markerPrefix);
            if (markerPrefix[0] != 0xFF)
            {
                continue;
            }

            do
            {
                ReadExactly(stream, markerCode);
            } while (markerCode[0] == 0xFF && stream.Position < stream.Length);

            var marker = markerCode[0];
            if (marker is 0x00 or 0xD8 or 0xD9 or >= 0xD0 and <= 0xD7 or 0x01)
            {
                continue;
            }

            ReadExactly(stream, segmentLengthBytes);
            var segmentLength = BinaryPrimitives.ReadUInt16BigEndian(segmentLengthBytes);
            if (segmentLength < 2 || segmentLength - 2 > stream.Length - stream.Position)
            {
                throw InvalidImage("The JPEG contains a truncated segment.");
            }

            if (IsStartOfFrame(marker))
            {
                if (segmentLength < 7)
                {
                    throw InvalidImage("The JPEG frame header is truncated.");
                }

                ReadExactly(stream, frameHeader);
                var height = BinaryPrimitives.ReadUInt16BigEndian(frameHeader[1..3]);
                var width = BinaryPrimitives.ReadUInt16BigEndian(frameHeader[3..5]);
                return ("image/jpeg", width, height);
            }

            stream.Position += segmentLength - 2;
        }

        throw InvalidImage("The JPEG has no supported frame header.");
    }

    private static (string, int, int) ReadWebP(Stream stream)
    {
        var riffSize = BinaryPrimitives.ReadUInt32LittleEndian(ReadBytesAt(stream, 4, 4));
        var containerEnd = riffSize + 8L;
        if (containerEnd != stream.Length)
        {
            throw InvalidImage("The WebP RIFF size does not match the file length.");
        }

        stream.Position = 12;
        Span<byte> chunkHeader = stackalloc byte[8];
        Span<byte> extendedHeader = stackalloc byte[10];
        Span<byte> losslessHeader = stackalloc byte[5];
        while (stream.Position + chunkHeader.Length <= containerEnd)
        {
            ReadExactly(stream, chunkHeader);
            var chunkType = chunkHeader[..4];
            var chunkLength = BinaryPrimitives.ReadUInt32LittleEndian(chunkHeader[4..8]);
            var payloadStart = stream.Position;
            var paddedChunkLength = (long)chunkLength + (chunkLength & 1);
            if (paddedChunkLength > containerEnd - payloadStart)
            {
                throw InvalidImage("The WebP chunk exceeds the container boundary.");
            }

            if (chunkType.SequenceEqual("VP8X"u8))
            {
                if (chunkLength < 10)
                {
                    throw InvalidImage("The WebP extended header is truncated.");
                }

                ReadExactly(stream, extendedHeader);
                var width = 1 + ReadUInt24LittleEndian(extendedHeader[4..7]);
                var height = 1 + ReadUInt24LittleEndian(extendedHeader[7..10]);
                return ("image/webp", width, height);
            }

            if (chunkType.SequenceEqual("VP8 "u8))
            {
                if (chunkLength < 10)
                {
                    throw InvalidImage("The WebP lossy frame header is truncated.");
                }

                ReadExactly(stream, extendedHeader);
                if (extendedHeader[3] != 0x9D || extendedHeader[4] != 0x01 || extendedHeader[5] != 0x2A)
                {
                    throw InvalidImage("The WebP lossy frame marker is invalid.");
                }

                var width = BinaryPrimitives.ReadUInt16LittleEndian(extendedHeader[6..8]) & 0x3FFF;
                var height = BinaryPrimitives.ReadUInt16LittleEndian(extendedHeader[8..10]) & 0x3FFF;
                return ("image/webp", width, height);
            }

            if (chunkType.SequenceEqual("VP8L"u8))
            {
                if (chunkLength < 5)
                {
                    throw InvalidImage("The WebP lossless frame header is truncated.");
                }

                ReadExactly(stream, losslessHeader);
                if (losslessHeader[0] != 0x2F)
                {
                    throw InvalidImage("The WebP lossless frame marker is invalid.");
                }

                var bits = BinaryPrimitives.ReadUInt32LittleEndian(losslessHeader[1..5]);
                var width = 1 + (int)(bits & 0x3FFF);
                var height = 1 + (int)((bits >> 14) & 0x3FFF);
                return ("image/webp", width, height);
            }

            stream.Position = payloadStart + paddedChunkLength;
        }

        throw InvalidImage("The WebP container has no supported image frame.");
    }

    private static byte[] ReadBytesAt(Stream stream, long position, int count)
    {
        stream.Position = position;
        var bytes = new byte[count];
        ReadExactly(stream, bytes);
        return bytes;
    }

    private static int ReadUInt24LittleEndian(ReadOnlySpan<byte> value) => value[0] | (value[1] << 8) | (value[2] << 16);

    private static int ToDimension(uint value) => value <= int.MaxValue ? (int)value : int.MaxValue;

    private static bool IsStartOfFrame(byte marker) => marker is >= 0xC0 and <= 0xC3 or >= 0xC5 and <= 0xC7 or >= 0xC9 and <= 0xCB or >= 0xCD and <= 0xCF;

    private static AssetImportException InvalidImage(string message) => new(AssetImportFailureCode.InvalidImage, message);

    private static void ReadExactly(Stream stream, Span<byte> destination)
    {
        try
        {
            stream.ReadExactly(destination);
        }
        catch (EndOfStreamException exception)
        {
            throw InvalidImage($"The image header is truncated: {exception.Message}");
        }
    }

    private static void ReadExactly(Stream stream, byte[] destination) => ReadExactly(stream, destination.AsSpan());
}
