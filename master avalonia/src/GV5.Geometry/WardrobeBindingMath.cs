namespace GV5.Geometry;

/// <summary>Pose-independent geometry of the bone frame that owns a garment attachment.</summary>
public readonly record struct WardrobeBoneFrame
{
    public string BoneId { get; }
    public Rect2D Bounds { get; }
    public double RotationDegrees { get; }
    public bool FlipX { get; }
    public bool FlipY { get; }
    public Point2D Center => new(Bounds.X + Bounds.Width / 2, Bounds.Y + Bounds.Height / 2);

    public WardrobeBoneFrame(string boneId, Rect2D bounds, double rotationDegrees, bool flipX = false, bool flipY = false)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(boneId);
        if (bounds.Width <= 0 || bounds.Height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(bounds), "A wardrobe bone frame must have positive dimensions.");
        }
        GeometryValue.RequireFinite(rotationDegrees, nameof(rotationDegrees));
        BoneId = boneId;
        Bounds = bounds;
        RotationDegrees = rotationDegrees;
        FlipX = flipX;
        FlipY = flipY;
    }
}

/// <summary>Frozen garment-to-bone relation, normalized in the original bone's local frame.</summary>
public readonly record struct WardrobeBinding
{
    public int Version { get; }
    public string BoneId { get; }
    public double BoneWidth { get; }
    public double BoneHeight { get; }
    public double BoneRotationDegrees { get; }
    public double LocalCenterX { get; }
    public double LocalCenterY { get; }
    public double WidthRatio { get; }
    public double HeightRatio { get; }
    public double RelativeRotationDegrees { get; }

    private WardrobeBinding(
        string boneId,
        double boneWidth,
        double boneHeight,
        double boneRotationDegrees,
        double localCenterX,
        double localCenterY,
        double widthRatio,
        double heightRatio,
        double relativeRotationDegrees)
    {
        Version = 1;
        BoneId = boneId;
        BoneWidth = boneWidth;
        BoneHeight = boneHeight;
        BoneRotationDegrees = boneRotationDegrees;
        LocalCenterX = localCenterX;
        LocalCenterY = localCenterY;
        WidthRatio = widthRatio;
        HeightRatio = heightRatio;
        RelativeRotationDegrees = relativeRotationDegrees;
    }

    public static WardrobeBinding Bind(WardrobeBoneFrame sourceBone, Rect2D garmentBounds, double garmentRotationDegrees)
    {
        GeometryValue.RequireFinite(garmentRotationDegrees, nameof(garmentRotationDegrees));
        var boneCenter = sourceBone.Center;
        var garmentCenter = new Point2D(garmentBounds.X + garmentBounds.Width / 2, garmentBounds.Y + garmentBounds.Height / 2);
        var radians = -sourceBone.RotationDegrees * Math.PI / 180;
        var dx = garmentCenter.X - boneCenter.X;
        var dy = garmentCenter.Y - boneCenter.Y;
        var localX = (dx * Math.Cos(radians) - dy * Math.Sin(radians)) / sourceBone.Bounds.Width;
        var localY = (dx * Math.Sin(radians) + dy * Math.Cos(radians)) / sourceBone.Bounds.Height;
        var widthRatio = garmentBounds.Width / sourceBone.Bounds.Width;
        var heightRatio = garmentBounds.Height / sourceBone.Bounds.Height;
        var relativeRotation = garmentRotationDegrees - sourceBone.RotationDegrees;
        GeometryValue.RequireFinite(localX, nameof(garmentBounds));
        GeometryValue.RequireFinite(localY, nameof(garmentBounds));
        GeometryValue.RequireFinite(widthRatio, nameof(garmentBounds));
        GeometryValue.RequireFinite(heightRatio, nameof(garmentBounds));
        GeometryValue.RequireFinite(relativeRotation, nameof(garmentRotationDegrees));

        return new WardrobeBinding(
            sourceBone.BoneId,
            sourceBone.Bounds.Width,
            sourceBone.Bounds.Height,
            sourceBone.RotationDegrees,
            localX,
            localY,
            widthRatio,
            heightRatio,
            relativeRotation);
    }

    public static WardrobeBinding Restore(int version, string boneId, double boneWidth, double boneHeight,
        double boneRotationDegrees, double localCenterX, double localCenterY, double widthRatio,
        double heightRatio, double relativeRotationDegrees)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(boneId);
        if (version != 1) throw new ArgumentOutOfRangeException(nameof(version), "Wardrobe binding version is unsupported.");
        GeometryValue.RequireFinite(boneWidth, nameof(boneWidth));
        GeometryValue.RequireFinite(boneHeight, nameof(boneHeight));
        GeometryValue.RequireFinite(boneRotationDegrees, nameof(boneRotationDegrees));
        GeometryValue.RequireFinite(localCenterX, nameof(localCenterX));
        GeometryValue.RequireFinite(localCenterY, nameof(localCenterY));
        GeometryValue.RequireFinite(widthRatio, nameof(widthRatio));
        GeometryValue.RequireFinite(heightRatio, nameof(heightRatio));
        GeometryValue.RequireFinite(relativeRotationDegrees, nameof(relativeRotationDegrees));
        if (boneWidth <= 0 || boneHeight <= 0 || widthRatio <= 0 || heightRatio <= 0)
            throw new ArgumentOutOfRangeException(nameof(boneWidth), "Wardrobe binding dimensions and ratios must be positive.");
        return new WardrobeBinding(boneId, boneWidth, boneHeight, boneRotationDegrees, localCenterX,
            localCenterY, widthRatio, heightRatio, relativeRotationDegrees);
    }
}

public readonly record struct WardrobePlacement(
    Rect2D Bounds,
    double RotationDegrees,
    bool FlipX,
    bool FlipY,
    double ScaleX,
    double ScaleY);

/// <summary>Projects a frozen binding onto a posed bone without modifying the source garment.</summary>
public static class WardrobeBindingMath
{
    public static WardrobePlacement Resolve(WardrobeBinding binding, WardrobeBoneFrame poseBone)
    {
        if (binding.Version != 1)
        {
            throw new ArgumentOutOfRangeException(nameof(binding), "Wardrobe binding version is unsupported.");
        }
        if (!string.Equals(binding.BoneId, poseBone.BoneId, StringComparison.Ordinal))
        {
            throw new ArgumentException("The pose bone does not match the bone captured by this binding.", nameof(poseBone));
        }

        var scaleX = poseBone.Bounds.Width / binding.BoneWidth;
        var scaleY = poseBone.Bounds.Height / binding.BoneHeight;
        var width = binding.WidthRatio * poseBone.Bounds.Width;
        var height = binding.HeightRatio * poseBone.Bounds.Height;
        GeometryValue.RequireFinite(scaleX, nameof(poseBone));
        GeometryValue.RequireFinite(scaleY, nameof(poseBone));
        GeometryValue.RequireFinite(width, nameof(poseBone));
        GeometryValue.RequireFinite(height, nameof(poseBone));
        if (width <= 0 || height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(binding), "Resolved garment dimensions must be positive.");
        }

        var localX = binding.LocalCenterX * poseBone.Bounds.Width * (poseBone.FlipX ? -1 : 1);
        var localY = binding.LocalCenterY * poseBone.Bounds.Height * (poseBone.FlipY ? -1 : 1);
        var radians = poseBone.RotationDegrees * Math.PI / 180;
        var cosine = Math.Cos(radians);
        var sine = Math.Sin(radians);
        var centerX = poseBone.Center.X + localX * cosine - localY * sine;
        var centerY = poseBone.Center.Y + localX * sine + localY * cosine;
        var relativeRotation = binding.RelativeRotationDegrees;
        if (poseBone.FlipX && poseBone.FlipY)
        {
            relativeRotation += 180;
        }
        else if (poseBone.FlipX)
        {
            relativeRotation = 180 - relativeRotation;
        }
        else if (poseBone.FlipY)
        {
            relativeRotation = -relativeRotation;
        }

        var rotation = poseBone.RotationDegrees + relativeRotation;
        var bounds = new Rect2D(centerX - width / 2, centerY - height / 2, width, height);
        GeometryValue.RequireFinite(rotation, nameof(binding));
        return new WardrobePlacement(bounds, rotation, poseBone.FlipX, poseBone.FlipY, scaleX, scaleY);
    }
}
