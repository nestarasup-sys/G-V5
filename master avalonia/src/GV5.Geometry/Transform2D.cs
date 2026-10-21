namespace GV5.Geometry;

/// <summary>A named affine transform that maps points using an immutable matrix.</summary>
public readonly record struct Transform2D
{
    public Matrix2D Matrix { get; }

    public Transform2D(Matrix2D matrix) => Matrix = matrix;

    public static Transform2D Identity => new(Matrix2D.Identity);
    public Point2D Apply(Point2D point) => Matrix.Transform(point);

    /// <summary>Composes transforms so <paramref name="next"/> is applied after this transform.</summary>
    public Transform2D Then(Transform2D next) => new(next.Matrix * Matrix);
}
