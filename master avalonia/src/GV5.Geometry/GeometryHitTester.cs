namespace GV5.Geometry;

/// <summary>A local rectangle mapped into world space with an optional local-space clip.</summary>
public readonly record struct GeometryHitRegion(
    TransformNodeId Id,
    Rect2D Bounds,
    Matrix2D LocalToWorld,
    int ZOrder,
    Rect2D? Clip = null);

public readonly record struct GeometryHitResult(TransformNodeId Id, Point2D LocalPoint, int ZOrder);

/// <summary>Framework-independent rectangular hit testing; later input wins equal z-order ties.</summary>
public static class GeometryHitTester
{
    public static GeometryHitResult? HitTest(IEnumerable<GeometryHitRegion> regions, Point2D worldPoint)
    {
        ArgumentNullException.ThrowIfNull(regions);
        var ordered = regions.Select((region, index) => (region, index))
            .OrderByDescending(item => item.region.ZOrder)
            .ThenByDescending(item => item.index);

        foreach (var (region, _) in ordered)
        {
            Point2D localPoint;
            try
            {
                localPoint = region.LocalToWorld.Invert().Transform(worldPoint);
            }
            catch (InvalidOperationException)
            {
                // Singular geometry has no unique local point and cannot be hit-tested.
                continue;
            }

            if (region.Bounds.Contains(localPoint) && (region.Clip is null || region.Clip.Value.Contains(localPoint)))
            {
                return new GeometryHitResult(region.Id, localPoint, region.ZOrder);
            }
        }

        return null;
    }
}
