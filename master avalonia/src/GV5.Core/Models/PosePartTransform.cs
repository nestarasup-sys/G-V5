using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

/// <summary>The pose transform for one part in the referenced model revision.</summary>
public sealed record PosePartTransform
{
    private PosePartTransform(ModelPartId partId, Transform2D transform, bool isVisible)
    {
        PartId = partId;
        Transform = transform;
        IsVisible = isVisible;
    }

    public ModelPartId PartId { get; }
    public Transform2D Transform { get; }
    public bool IsVisible { get; }

    public static PosePartTransform Create(ModelPartId partId, Transform2D transform, bool isVisible = true)
    {
        if (!partId.IsValid)
        {
            throw new ArgumentException("A pose transform must refer to a valid model part.", nameof(partId));
        }
        return new PosePartTransform(partId, transform, isVisible);
    }
}
