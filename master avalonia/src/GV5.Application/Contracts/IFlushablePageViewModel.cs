namespace GV5.Application.Contracts;

/// <summary>Flushes pending persistent edits before a page is left or the application closes.</summary>
public interface IFlushablePageViewModel
{
    Task<bool> FlushPendingChangesAsync(CancellationToken cancellationToken = default);
}
