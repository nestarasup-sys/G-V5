using GV5.Geometry;

namespace GV5.Rendering;

/// <summary>Shared image-local to scene-space transform used by rendering, selection and overlays.</summary>
public static class RenderLayerGeometry
{
    public static Matrix2D GetSceneMatrix(RenderLayer layer, int targetHeight)
    {
        if (targetHeight < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(targetHeight));
        }

        var yFlip = Matrix2D.CreateScale(1, -1);
        return Matrix2D.CreateTranslation(0, targetHeight)
            * yFlip
            * layer.Transform.Matrix
            * Matrix2D.CreateTranslation(0, layer.Crop.Height)
            * yFlip;
    }
}
