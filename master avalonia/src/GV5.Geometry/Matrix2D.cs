namespace GV5.Geometry;

/// <summary>
/// Finite affine matrix using column vectors:
/// x' = M11*x + M21*y + OffsetX; y' = M12*x + M22*y + OffsetY.
/// Composition <c>a * b</c> applies <c>b</c> first and then <c>a</c>.
/// </summary>
public readonly record struct Matrix2D
{
    public double M11 { get; }
    public double M12 { get; }
    public double M21 { get; }
    public double M22 { get; }
    public double OffsetX { get; }
    public double OffsetY { get; }

    public Matrix2D(double m11, double m12, double m21, double m22, double offsetX, double offsetY)
    {
        GeometryValue.RequireFinite(m11, nameof(m11));
        GeometryValue.RequireFinite(m12, nameof(m12));
        GeometryValue.RequireFinite(m21, nameof(m21));
        GeometryValue.RequireFinite(m22, nameof(m22));
        GeometryValue.RequireFinite(offsetX, nameof(offsetX));
        GeometryValue.RequireFinite(offsetY, nameof(offsetY));
        M11 = m11;
        M12 = m12;
        M21 = m21;
        M22 = m22;
        OffsetX = offsetX;
        OffsetY = offsetY;
    }

    public static Matrix2D Identity => new(1, 0, 0, 1, 0, 0);
    public static Matrix2D CreateTranslation(double x, double y) => new(1, 0, 0, 1, x, y);
    public static Matrix2D CreateScale(double x, double y) => new(x, 0, 0, y, 0, 0);

    public Point2D Transform(Point2D point) => new(
        M11 * point.X + M21 * point.Y + OffsetX,
        M12 * point.X + M22 * point.Y + OffsetY);

    public static Matrix2D operator *(Matrix2D left, Matrix2D right) => new(
        left.M11 * right.M11 + left.M21 * right.M12,
        left.M12 * right.M11 + left.M22 * right.M12,
        left.M11 * right.M21 + left.M21 * right.M22,
        left.M12 * right.M21 + left.M22 * right.M22,
        left.M11 * right.OffsetX + left.M21 * right.OffsetY + left.OffsetX,
        left.M12 * right.OffsetX + left.M22 * right.OffsetY + left.OffsetY);
}
