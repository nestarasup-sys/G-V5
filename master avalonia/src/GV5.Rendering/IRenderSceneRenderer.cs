namespace GV5.Rendering;

/// <summary>Renders an immutable scene snapshot and transfers ownership of the returned frame to the caller.</summary>
public interface IRenderSceneRenderer
{
    Task<RenderedFrame> RenderAsync(RenderScene scene, CancellationToken cancellationToken = default);
}
