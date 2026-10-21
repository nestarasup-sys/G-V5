using System.Collections.Immutable;

namespace GV5.Geometry;

/// <summary>Result of translating a part and its transitively fixed descendants.</summary>
public sealed record RigMovementResult(
    ImmutableDictionary<TransformNodeId, Transform2D> Transforms,
    ImmutableArray<RigJoint> Joints,
    ImmutableHashSet<TransformNodeId> MovedParts);

/// <summary>Pure rig movement rules; loose child branches remain stationary.</summary>
public static class RigMovement
{
    public static RigMovementResult Translate(
        IEnumerable<TransformNodeId> parts,
        IReadOnlyDictionary<TransformNodeId, Transform2D> transforms,
        IEnumerable<RigJoint> joints,
        TransformNodeId root,
        Point2D delta)
    {
        ArgumentNullException.ThrowIfNull(parts);
        ArgumentNullException.ThrowIfNull(transforms);
        ArgumentNullException.ThrowIfNull(joints);
        var partArray = parts.ToArray();
        var jointArray = joints.ToArray();
        _ = RigSkeleton.Create(partArray, jointArray);
        if (!partArray.Contains(root))
        {
            throw new ArgumentException("The moved rig part does not exist.", nameof(root));
        }
        if (transforms.Count != partArray.Length || partArray.Any(part => !transforms.ContainsKey(part)))
        {
            throw new ArgumentException("A rig move requires one transform for every part.", nameof(transforms));
        }

        var fixedChildren = jointArray
            .Where(joint => joint.Mode == RigJointMode.Fixed)
            .GroupBy(joint => joint.ParentPartId)
            .ToDictionary(group => group.Key, group => group.Select(joint => joint.ChildPartId).ToArray());
        var moved = ImmutableHashSet.CreateBuilder<TransformNodeId>();
        var pending = new Stack<TransformNodeId>();
        pending.Push(root);
        while (pending.TryPop(out var current))
        {
            if (!moved.Add(current) || !fixedChildren.TryGetValue(current, out var children)) continue;
            foreach (var child in children) pending.Push(child);
        }

        var movedSet = moved.ToImmutable();
        var updatedTransforms = transforms.ToImmutableDictionary(pair => pair.Key, pair => movedSet.Contains(pair.Key)
            ? TranslateTransform(pair.Value, delta)
            : pair.Value);
        var updatedJoints = jointArray.Select(joint => joint with
        {
            ParentAnchor = movedSet.Contains(joint.ParentPartId) ? joint.ParentAnchor + delta : joint.ParentAnchor,
            ChildAnchor = movedSet.Contains(joint.ChildPartId) ? joint.ChildAnchor + delta : joint.ChildAnchor
        }).ToImmutableArray();
        return new RigMovementResult(updatedTransforms, updatedJoints, movedSet);
    }

    private static Transform2D TranslateTransform(Transform2D transform, Point2D delta) => new(
        transform.Translation + delta,
        transform.Scale,
        transform.RotationRadians,
        transform.Pivot,
        transform.FlipX,
        transform.FlipY);
}
