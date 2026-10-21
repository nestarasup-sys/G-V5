namespace GV5.Geometry;

/// <summary>A finite, axis-aligned rectangle with non-negative dimensions.</summary>
public readonly record struct Rect2D
{
    public double X { get; }
    public double Y { get; }
    public double Width { get; }
    public double Height { get; }
    public double Left => X;
    public double Top => Y;
    public double Right => X + Width;
    public double Bottom => Y + Height;
    public Point2D Origin => new(X, Y);
    public Point2D Size => new(Width, Height);

    public Rect2D(double x, double y, double width, double height)
    {
        GeometryValue.RequireFinite(x, nameof(x));
        GeometryValue.RequireFinite(y, nameof(y));
        GeometryValue.RequireFinite(width, nameof(width));
        GeometryValue.RequireFinite(height, nameof(height));
        if (width < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "Rectangle width cannot be negative.");
        }
        if (height < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(height), "Rectangle height cannot be negative.");
        }

        GeometryValue.RequireFinite(x + width, nameof(width));
        GeometryValue.RequireFinite(y + height, nameof(height));
        X = x;
        Y = y;
        Width = width;
        Height = height;
    }

    public bool Contains(Point2D point) => point.X >= Left && point.X <= Right && point.Y >= Top && point.Y <= Bottom;

    public Rect2D? Intersect(Rect2D other)
    {
        var left = Math.Max(Left, other.Left);
        var top = Math.Max(Top, other.Top);
        var right = Math.Min(Right, other.Right);
        var bottom = Math.Min(Bottom, other.Bottom);
        return right < left || bottom < top ? null : new Rect2D(left, top, right - left, bottom - top);
    }
}
