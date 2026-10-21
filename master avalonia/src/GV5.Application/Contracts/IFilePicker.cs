namespace GV5.Application.Contracts;

/// <summary>System file-picker boundary. Selected streams remain owned by the caller until disposed.</summary>
public interface IFilePicker
{
    Task<PickedFile?> PickImageAsync(CancellationToken cancellationToken = default);
}

public sealed class PickedFile : IAsyncDisposable
{
    private readonly Stream _content;
    private int _disposed;

    public string Name { get; }
    public string MediaType { get; }

    public Stream Content
    {
        get
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
            return _content;
        }
    }

    public PickedFile(string name, string mediaType, Stream content)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(mediaType);
        ArgumentNullException.ThrowIfNull(content);
        if (!content.CanRead)
        {
            throw new ArgumentException("A picked file stream must be readable.", nameof(content));
        }

        Name = name;
        MediaType = mediaType;
        _content = content;
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            await _content.DisposeAsync().ConfigureAwait(false);
        }
    }
}
