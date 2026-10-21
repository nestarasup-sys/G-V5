namespace GV5.Geometry;

/// <summary>Snaps a moving rig anchor to the X and Y coordinates of other anchors.</summary>
public static class RigAnchorSnapper
{
    public static SnapResult Snap(Point2D anchor, IEnumerable<Point2D> guides, double threshold)
    {
        ArgumentNullException.ThrowIfNull(guides);
        var points = guides.ToArray();
        var snapGuides = points.SelectMany(point => new[]
        {
            new SnapGuide(SnapAxis.Vertical, point.X),
            new SnapGuide(SnapAxis.Horizontal, point.Y)
        });
        return SnapEngine.Snap(new Rect2D(anchor.X, anchor.Y, 0, 0), snapGuides, threshold);
    }
}
