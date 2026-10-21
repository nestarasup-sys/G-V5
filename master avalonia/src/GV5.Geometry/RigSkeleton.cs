namespace GV5.Geometry;

public enum RigJointMode
{
    Loose = 1,
    Fixed = 2
}

public readonly record struct RigJointId
{
    public Guid Value { get; }

    private RigJointId(Guid value) => Value = value;

    public static RigJointId New() => new(Guid.NewGuid());

    public static RigJointId From(Guid value) => value == Guid.Empty
        ? throw new ArgumentException("A rig joint ID cannot be empty.", nameof(value))
        : new RigJointId(value);
}

/// <summary>A directed bone connection whose two anchors meet in the composed pose.</summary>
public readonly record struct RigJoint(
    RigJointId Id,
    TransformNodeId ParentPartId,
    TransformNodeId ChildPartId,
    Point2D ParentAnchor,
    Point2D ChildAnchor,
    RigJointMode Mode = RigJointMode.Loose,
    bool IsSuggested = false);

/// <summary>
/// A forest of rig parts and joints. Each part has one local pose; world poses are composed parent-first.
/// The child anchor maps to its parent anchor plus the child's translation.
/// </summary>
public sealed class RigSkeleton
{
    private readonly HashSet<TransformNodeId> _parts;
    private readonly Dictionary<TransformNodeId, RigJoint> _jointByChild;

    private RigSkeleton(
        HashSet<TransformNodeId> parts,
        Dictionary<TransformNodeId, RigJoint> jointByChild)
    {
        _parts = parts;
        _jointByChild = jointByChild;
    }

    public static RigSkeleton Create(IEnumerable<TransformNodeId> parts, IEnumerable<RigJoint> joints)
    {
        ArgumentNullException.ThrowIfNull(parts);
        ArgumentNullException.ThrowIfNull(joints);
        var partSet = new HashSet<TransformNodeId>(parts);
        if (partSet.Any(part => part.Value == Guid.Empty))
        {
            throw new ArgumentException("Rig parts must have valid IDs.", nameof(parts));
        }

        var jointByChild = new Dictionary<TransformNodeId, RigJoint>();
        var jointIds = new HashSet<RigJointId>();
        foreach (var joint in joints)
        {
            if (joint.Id.Value == Guid.Empty || !jointIds.Add(joint.Id))
            {
                throw new ArgumentException("Rig joints require unique, valid IDs.", nameof(joints));
            }
            if (!partSet.Contains(joint.ParentPartId) || !partSet.Contains(joint.ChildPartId))
            {
                throw new ArgumentException("Every rig joint endpoint must reference an existing part.", nameof(joints));
            }
            if (joint.ParentPartId == joint.ChildPartId)
            {
                throw new ArgumentException("A rig part cannot be its own parent.", nameof(joints));
            }
            if (joint.Mode is not (RigJointMode.Loose or RigJointMode.Fixed))
            {
                throw new ArgumentOutOfRangeException(nameof(joints), "Rig joint mode is not supported.");
            }
            if (!jointByChild.TryAdd(joint.ChildPartId, joint))
            {
                throw new ArgumentException("A rig part can have only one parent joint.", nameof(joints));
            }
        }

        ValidateAcyclic(partSet, jointByChild);
        return new RigSkeleton(partSet, jointByChild);
    }

    public IReadOnlyDictionary<TransformNodeId, Matrix2D> EvaluateWorldMatrices(
        IReadOnlyDictionary<TransformNodeId, Transform2D> localPose)
    {
        ArgumentNullException.ThrowIfNull(localPose);
        if (localPose.Count != _parts.Count || _parts.Any(part => !localPose.ContainsKey(part)))
        {
            throw new ArgumentException("A rig pose must provide exactly one local transform for every part.", nameof(localPose));
        }

        var world = new Dictionary<TransformNodeId, Matrix2D>(_parts.Count);
        foreach (var part in _parts)
        {
            Evaluate(part);
        }
        return world;

        Matrix2D Evaluate(TransformNodeId part)
        {
            if (world.TryGetValue(part, out var cached))
            {
                return cached;
            }

            var transform = localPose[part];
            if (!_jointByChild.TryGetValue(part, out var joint))
            {
                var rootMatrix = transform.Matrix;
                world.Add(part, rootMatrix);
                return rootMatrix;
            }

            var local = Matrix2D.CreateTranslation(
                    joint.ParentAnchor.X + transform.Translation.X,
                    joint.ParentAnchor.Y + transform.Translation.Y)
                * Matrix2D.CreateRotation(transform.RotationRadians)
                * Matrix2D.CreateScale(
                    transform.Scale.X * (transform.FlipX ? -1 : 1),
                    transform.Scale.Y * (transform.FlipY ? -1 : 1))
                * Matrix2D.CreateTranslation(-joint.ChildAnchor.X, -joint.ChildAnchor.Y);
            var result = Evaluate(joint.ParentPartId) * local;
            world.Add(part, result);
            return result;
        }
    }

    private static void ValidateAcyclic(HashSet<TransformNodeId> parts, Dictionary<TransformNodeId, RigJoint> jointsByChild)
    {
        var visited = new HashSet<TransformNodeId>();
        var visiting = new HashSet<TransformNodeId>();
        foreach (var part in parts)
        {
            Visit(part);
        }

        void Visit(TransformNodeId part)
        {
            if (visited.Contains(part))
            {
                return;
            }
            if (!visiting.Add(part))
            {
                throw new ArgumentException("A rig cannot contain a joint cycle.", nameof(jointsByChild));
            }
            if (jointsByChild.TryGetValue(part, out var joint))
            {
                Visit(joint.ParentPartId);
            }
            visiting.Remove(part);
            visited.Add(part);
        }
    }
}
