namespace GV5.Geometry;

/// <summary>Marker for coordinates stored in the authored character/model.</summary>
public readonly struct ModelSpace { }

/// <summary>Marker for coordinates in the composed scene.</summary>
public readonly struct SceneSpace { }

/// <summary>Marker for coordinates in a viewport/view; independent of any UI framework.</summary>
public readonly struct ViewSpace { }

/// <summary>A point whose type carries the coordinate space it belongs to.</summary>
public readonly record struct SpatialPoint<TSpace>(Point2D Value);

/// <summary>A directed affine conversion between two distinct coordinate spaces.</summary>
public readonly record struct SpaceTransform<TFrom, TTo>(Matrix2D Matrix)
{
    public SpatialPoint<TTo> Convert(SpatialPoint<TFrom> point) => new(Matrix.Transform(point.Value));

    public SpaceTransform<TFrom, TNext> Then<TNext>(SpaceTransform<TTo, TNext> next) => new(next.Matrix * Matrix);

    public SpaceTransform<TTo, TFrom> Invert() => new(Matrix.Invert());
}
