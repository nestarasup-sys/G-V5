namespace GV5.Geometry;

public enum SnapAxis
{
    Vertical = 1,
    Horizontal = 2
}

public enum SnapAnchor
{
    Start = 1,
    Center = 2,
    End = 3
}

/// <summary>A vertical guide uses an X coordinate; a horizontal guide uses a Y coordinate.</summary>
public readonly record struct SnapGuide
{
    public SnapAxis Axis { get; }
    public double Coordinate { get; }

    public SnapGuide(SnapAxis axis, double coordinate)
    {
        if (axis is not (SnapAxis.Vertical or SnapAxis.Horizontal))
        {
            throw new ArgumentOutOfRangeException(nameof(axis));
        }
        GeometryValue.RequireFinite(coordinate, nameof(coordinate));
        Axis = axis;
        Coordinate = coordinate;
    }
}

public readonly record struct SnapMatch(SnapAxis Axis, SnapAnchor Anchor, double GuideCoordinate, double Delta);

public readonly record struct SnapResult(Point2D Translation, SnapMatch? XMatch, SnapMatch? YMatch)
{
    public Rect2D Apply(Rect2D bounds) => new(
        bounds.X + Translation.X,
        bounds.Y + Translation.Y,
        bounds.Width,
        bounds.Height);
}

/// <summary>Pure, deterministic snapping of rectangle anchors to guide lines.</summary>
public static class SnapEngine
{
    public static SnapResult Snap(Rect2D movingBounds, IEnumerable<SnapGuide> guides, double threshold)
    {
        ArgumentNullException.ThrowIfNull(guides);
        GeometryValue.RequireFinite(threshold, nameof(threshold));
        if (threshold < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(threshold), "Snap threshold cannot be negative.");
        }

        var guideList = guides.ToArray();
        var xMatch = FindMatch(
            SnapAxis.Vertical,
            [new(SnapAnchor.Start, movingBounds.Left), new(SnapAnchor.Center, movingBounds.Left + movingBounds.Width / 2), new(SnapAnchor.End, movingBounds.Right)],
            guideList,
            threshold);
        var yMatch = FindMatch(
            SnapAxis.Horizontal,
            [new(SnapAnchor.Start, movingBounds.Top), new(SnapAnchor.Center, movingBounds.Top + movingBounds.Height / 2), new(SnapAnchor.End, movingBounds.Bottom)],
            guideList,
            threshold);

        return new SnapResult(
            new Point2D(xMatch?.Delta ?? 0, yMatch?.Delta ?? 0),
            xMatch,
            yMatch);
    }

    private static SnapMatch? FindMatch(
        SnapAxis axis,
        (SnapAnchor Anchor, double Coordinate)[] anchors,
        IReadOnlyList<SnapGuide> guides,
        double threshold)
    {
        SnapMatch? best = null;
        var bestDistance = double.PositiveInfinity;
        foreach (var guide in guides)
        {
            if (guide.Axis != axis)
            {
                continue;
            }

            foreach (var anchor in anchors)
            {
                var delta = guide.Coordinate - anchor.Coordinate;
                var distance = Math.Abs(delta);
                if (distance <= threshold && distance < bestDistance)
                {
                    best = new SnapMatch(axis, anchor.Anchor, guide.Coordinate, delta);
                    bestDistance = distance;
                }
            }
        }

        return best;
    }
}
