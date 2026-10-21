using Avalonia.Threading;
using GV5.Rendering;

namespace GV5.App.Presentation;

public enum PreviewRenderStatus
{
    Published = 1,
    Superseded = 2,
    Canceled = 3
}

public readonly record struct PreviewRenderResult(long Version, PreviewRenderStatus Status);

/// <summary>Serializes preview intent, cancels obsolete work, and publishes only the current frame on the UI dispatcher.</summary>
public sealed class LatestPreviewRenderer(IRenderSceneRenderer renderer) : IDisposable
{
    private readonly IRenderSceneRenderer _renderer = renderer ?? throw new ArgumentNullException(nameof(renderer));
    private readonly object _sync = new();
    private long _version;
    private CancellationTokenSource? _activeRequest;
    private bool _disposed;

    /// <summary>
    /// Requests a preview for an immutable scene. The callback runs on Avalonia's UI dispatcher and borrows the frame
    /// only for that callback; copy it into its presentation bitmap before returning.
    /// </summary>
    public Task<PreviewRenderResult> RequestAsync(
        RenderScene scene,
        Action<long, RenderedFrame> publishCurrentFrame,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(scene);
        ArgumentNullException.ThrowIfNull(publishCurrentFrame);

        CancellationTokenSource request;
        CancellationTokenSource? previous;
        long version;
        lock (_sync)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            version = checked(++_version);
            previous = _activeRequest;
            request = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            _activeRequest = request;
        }

        // Cancel outside the lock: cancellation callbacks are allowed to request another preview.
        CancelSafely(previous);
        return RenderAndPublishAsync(scene, version, request, publishCurrentFrame);
    }

    public void Dispose()
    {
        CancellationTokenSource? active;
        lock (_sync)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _version = checked(_version + 1);
            active = _activeRequest;
            _activeRequest = null;
        }

        CancelSafely(active);
    }

    private async Task<PreviewRenderResult> RenderAndPublishAsync(
        RenderScene scene,
        long version,
        CancellationTokenSource request,
        Action<long, RenderedFrame> publishCurrentFrame)
    {
        RenderedFrame? frame = null;
        try
        {
            frame = await _renderer.RenderAsync(scene, request.Token).ConfigureAwait(false);
            var published = await Dispatcher.UIThread.InvokeAsync(() =>
            {
                lock (_sync)
                {
                    if (_disposed || version != _version || !ReferenceEquals(_activeRequest, request) || request.IsCancellationRequested)
                    {
                        return false;
                    }

                    // Keep the version check atomic with the callback, so a concurrent newer request cannot slip in between.
                    _activeRequest = null;
                    publishCurrentFrame(version, frame);
                    return true;
                }
            });

            if (published)
            {
                return new PreviewRenderResult(version, PreviewRenderStatus.Published);
            }

            lock (_sync)
            {
                return new PreviewRenderResult(version,
                    version == _version && !_disposed && request.IsCancellationRequested
                        ? PreviewRenderStatus.Canceled
                        : PreviewRenderStatus.Superseded);
            }
        }
        catch (OperationCanceledException) when (request.IsCancellationRequested)
        {
            lock (_sync)
            {
                return new PreviewRenderResult(version,
                    version == _version && !_disposed ? PreviewRenderStatus.Canceled : PreviewRenderStatus.Superseded);
            }
        }
        finally
        {
            frame?.Dispose();
            lock (_sync)
            {
                if (ReferenceEquals(_activeRequest, request))
                {
                    _activeRequest = null;
                }
            }
            request.Dispose();
        }
    }

    private static void CancelSafely(CancellationTokenSource? request)
    {
        if (request is null)
        {
            return;
        }

        try
        {
            request.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // The render may have completed between swapping the active request and signaling cancellation.
        }
    }
}
