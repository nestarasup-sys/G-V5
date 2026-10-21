namespace GV5.Geometry;

/// <summary>A finite point in a two-dimensional coordinate space.</summary>
public readonly record struct Point2D
{
    public double X { get; }
    public double Y { get; }

    public Point2D(double x, double y)
    {
        GeometryValue.RequireFinite(x, nameof(x));
        GeometryValue.RequireFinite(y, nameof(y));
        X = x;
        Y = y;
    }

    public static Point2D Zero => new(0, 0);

    public static Point2D operator +(Point2D left, Point2D right) => new(left.X + right.X, left.Y + right.Y);
    public static Point2D operator -(Point2D left, Point2D right) => new(left.X - right.X, left.Y - right.Y);
    public static Point2D operator *(Point2D point, double scalar)
    {
        GeometryValue.RequireFinite(scalar, nameof(scalar));
        return new Point2D(point.X * scalar, point.Y * scalar);
    }
}
