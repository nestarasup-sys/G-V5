namespace GV5.Geometry;

/// <summary>
/// A transform in a right-handed Cartesian plane. Positive angles rotate counter-clockwise.
/// The local point is scaled, rotated about <see cref="Pivot"/>, then translated.
/// </summary>
public readonly record struct Transform2D
{
    public Point2D Translation { get; }
    public Point2D Scale { get; }
    public double RotationRadians { get; }
    public Point2D Pivot { get; }
    public bool FlipX { get; }
    public bool FlipY { get; }
    public Matrix2D Matrix =>
        Matrix2D.CreateTranslation(Translation.X + Pivot.X, Translation.Y + Pivot.Y)
        * Matrix2D.CreateRotation(RotationRadians)
        * Matrix2D.CreateScale(Scale.X * (FlipX ? -1 : 1), Scale.Y * (FlipY ? -1 : 1))
        * Matrix2D.CreateTranslation(-Pivot.X, -Pivot.Y);

    public Transform2D(
        Point2D translation,
        Point2D scale,
        double rotationRadians,
        Point2D pivot,
        bool flipX = false,
        bool flipY = false)
    {
        GeometryValue.RequireFinite(rotationRadians, nameof(rotationRadians));
        Translation = translation;
        Scale = scale;
        RotationRadians = rotationRadians;
        Pivot = pivot;
        FlipX = flipX;
        FlipY = flipY;
    }

    public static Transform2D Identity => new(Point2D.Zero, new Point2D(1, 1), 0, Point2D.Zero);
    public Point2D Apply(Point2D point) => Matrix.Transform(point);
}
