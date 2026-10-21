using System.Buffers.Binary;
using System.Security.Cryptography;
using GV5.Assets.Import;
using Xunit;

namespace GV5.Assets.Tests;

public sealed class AssetImportStagerTests
{
    [Fact]
    public async Task StageAsync_StreamsPngToTemporaryFileAndReportsCanonicalFacts()
    {
        var root = NewTempRoot();
        var bytes = CreatePng(64, 32);
        await using var source = new NonSeekableReadStream(bytes);

        try
        {
            var stager = new AssetImportStager(root);
            var staged = await stager.StageAsync(source, "IMAGE/PNG", TestContext.Current.CancellationToken);
            await using (staged)
            {
                Assert.True(staged.Id.IsValid);
                Assert.Equal("image/png", staged.MediaType);
                Assert.Equal(bytes.Length, staged.ByteLength);
                Assert.Equal(64, staged.Width);
                Assert.Equal(32, staged.Height);
                Assert.Equal(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), staged.Sha256);
                Assert.False(source.WasDisposed);

                await using var stagedContent = await staged.OpenReadAsync(TestContext.Current.CancellationToken);
                using var copy = new MemoryStream();
                await stagedContent.CopyToAsync(copy, TestContext.Current.CancellationToken);
                Assert.Equal(bytes, copy.ToArray());
                Assert.Single(Directory.GetFiles(root, "*.stage"));
            }

            Assert.Empty(Directory.GetFiles(root));
            await Assert.ThrowsAsync<ObjectDisposedException>(() => staged.OpenReadAsync(TestContext.Current.CancellationToken));
            Assert.False(source.WasDisposed);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task StageAsync_ReadsDimensionsFromJpegAndWebpHeaders()
    {
        var root = NewTempRoot();
        try
        {
            var stager = new AssetImportStager(root);
            await using (var jpeg = await stager.StageAsync(new MemoryStream(CreateJpeg(80, 40)), "image/jpeg", TestContext.Current.CancellationToken))
            {
                Assert.Equal("image/jpeg", jpeg.MediaType);
                Assert.Equal((80, 40), (jpeg.Width, jpeg.Height));
            }

            await using (var webp = await stager.StageAsync(new MemoryStream(CreateWebp(120, 60)), "image/webp", TestContext.Current.CancellationToken))
            {
                Assert.Equal("image/webp", webp.MediaType);
                Assert.Equal((120, 60), (webp.Width, webp.Height));
            }

            Assert.Empty(Directory.GetFiles(root));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task StageAsync_RejectsUnsupportedAndMismatchedDeclaredTypesWithoutLeavingFiles()
    {
        var root = NewTempRoot();
        try
        {
            var stager = new AssetImportStager(root);
            var unsupported = await Assert.ThrowsAsync<AssetImportException>(() =>
                stager.StageAsync(new MemoryStream(CreatePng(8, 8)), "image/gif", TestContext.Current.CancellationToken));
            Assert.Equal(AssetImportFailureCode.UnsupportedMediaType, unsupported.Code);

            var mismatch = await Assert.ThrowsAsync<AssetImportException>(() =>
                stager.StageAsync(new MemoryStream(CreatePng(8, 8)), "image/jpeg", TestContext.Current.CancellationToken));
            Assert.Equal(AssetImportFailureCode.DeclaredTypeMismatch, mismatch.Code);

            var malformedBytes = CreatePng(8, 8);
            BinaryPrimitives.WriteUInt32BigEndian(malformedBytes.AsSpan(8, 4), 12);
            var malformed = await Assert.ThrowsAsync<AssetImportException>(() =>
                stager.StageAsync(new MemoryStream(malformedBytes), "image/png", TestContext.Current.CancellationToken));
            Assert.Equal(AssetImportFailureCode.InvalidImage, malformed.Code);
            Assert.Empty(Directory.GetFiles(root));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task StageAsync_EnforcesByteAndPixelLimitsAndCleansPartialStage()
    {
        var root = NewTempRoot();
        var bytes = CreatePng(200, 200);
        try
        {
            var sizeLimited = new AssetImportStager(root, new AssetImportLimits(MaximumBytes: bytes.Length - 1));
            var tooLarge = await Assert.ThrowsAsync<AssetImportException>(() =>
                sizeLimited.StageAsync(new MemoryStream(bytes), "image/png", TestContext.Current.CancellationToken));
            Assert.Equal(AssetImportFailureCode.FileTooLarge, tooLarge.Code);
            Assert.Empty(Directory.GetFiles(root));

            var dimensionLimited = new AssetImportStager(root, new AssetImportLimits(MaximumDimension: 128, MaximumPixels: 100_000));
            var tooManyPixels = await Assert.ThrowsAsync<AssetImportException>(() =>
                dimensionLimited.StageAsync(new MemoryStream(bytes), "image/png", TestContext.Current.CancellationToken));
            Assert.Equal(AssetImportFailureCode.DimensionsOutOfRange, tooManyPixels.Code);
            Assert.Empty(Directory.GetFiles(root));

            var pixelLimited = new AssetImportStager(root, new AssetImportLimits(MaximumDimension: 256, MaximumPixels: 9_999));
            var excessivePixels = await Assert.ThrowsAsync<AssetImportException>(() =>
                pixelLimited.StageAsync(new MemoryStream(CreatePng(100, 100)), "image/png", TestContext.Current.CancellationToken));
            Assert.Equal(AssetImportFailureCode.DimensionsOutOfRange, excessivePixels.Code);
            Assert.Empty(Directory.GetFiles(root));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task StageAsync_CancellationRemovesIncompleteStage()
    {
        var root = NewTempRoot();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        try
        {
            var stager = new AssetImportStager(root);
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                stager.StageAsync(new MemoryStream(CreatePng(4, 4)), "image/png", cancellation.Token));
            Assert.Empty(Directory.GetFiles(root));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    private static byte[] CreatePng(int width, int height)
    {
        var bytes = new byte[45];
        new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }.CopyTo(bytes, 0);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(8, 4), 13);
        "IHDR"u8.CopyTo(bytes.AsSpan(12, 4));
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(16, 4), (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(20, 4), (uint)height);
        bytes[24] = 8;
        bytes[25] = 6;
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(33, 4), 0);
        "IEND"u8.CopyTo(bytes.AsSpan(37, 4));
        return bytes;
    }

    private static byte[] CreateJpeg(int width, int height) =>
    new byte[]
    {
        0xFF, 0xD8,
        0xFF, 0xC0, 0x00, 0x0B, 0x08,
        (byte)(height >> 8), (byte)height,
        (byte)(width >> 8), (byte)width,
        0x01, 0x01, 0x11, 0x00,
        0xFF, 0xD9
    };

    private static byte[] CreateWebp(int width, int height)
    {
        var bytes = new byte[30];
        "RIFF"u8.CopyTo(bytes.AsSpan(0, 4));
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4, 4), (uint)(bytes.Length - 8));
        "WEBP"u8.CopyTo(bytes.AsSpan(8, 4));
        "VP8X"u8.CopyTo(bytes.AsSpan(12, 4));
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(16, 4), 10);
        WriteUInt24LittleEndian(bytes.AsSpan(24, 3), width - 1);
        WriteUInt24LittleEndian(bytes.AsSpan(27, 3), height - 1);
        return bytes;
    }

    private static void WriteUInt24LittleEndian(Span<byte> destination, int value)
    {
        destination[0] = (byte)value;
        destination[1] = (byte)(value >> 8);
        destination[2] = (byte)(value >> 16);
    }

    private static string NewTempRoot() => Path.Combine(Path.GetTempPath(), $"gv5-asset-stage-{Guid.NewGuid():N}");

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private sealed class NonSeekableReadStream(byte[] bytes) : Stream
    {
        private readonly MemoryStream _inner = new(bytes, writable: false);

        public bool WasDisposed { get; private set; }
        public override bool CanRead => !WasDisposed;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => _inner.Read(buffer, offset, count);
        public override int Read(Span<byte> buffer) => _inner.Read(buffer);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => _inner.ReadAsync(buffer, cancellationToken);
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                WasDisposed = true;
                _inner.Dispose();
            }

            base.Dispose(disposing);
        }
    }
}
