namespace GV5.Geometry;

/// <summary>
/// Immutable, validated graph-editing model used by Fabricator rig tools.
/// Edits return a new snapshot so Undo/Redo can restore the previous graph.
/// This class does not draw handles, persist model drafts or mutate the source image.
/// </summary>
public sealed class RigJointGraph
{
    private readonly TransformNodeId[] _parts;
    private readonly RigJoint[] _joints;

    private RigJointGraph(TransformNodeId[] parts, RigJoint[] joints)
    {
        _parts = parts;
        _joints = joints;
    }

    public IReadOnlyList<TransformNodeId> Parts => Array.AsReadOnly(_parts);
    public IReadOnlyList<RigJoint> Joints => Array.AsReadOnly(_joints);

    public static RigJointGraph Create(IEnumerable<TransformNodeId> parts, IEnumerable<RigJoint> joints)
    {
        ArgumentNullException.ThrowIfNull(parts);
        ArgumentNullException.ThrowIfNull(joints);

        var partArray = parts.ToArray();
        var jointArray = joints.ToArray();
        if (partArray.Distinct().Count() != partArray.Length)
        {
            throw new ArgumentException("Rig parts must have unique IDs.", nameof(parts));
        }

        // The existing canonical validator rejects invalid references, duplicate joint IDs,
        // second parents, self-links, unsupported modes and cycles in the complete graph.
        _ = RigSkeleton.Create(partArray, jointArray);
        return new RigJointGraph(partArray, jointArray);
    }

    public RigJointGraph Add(RigJoint joint) =>
        Create(_parts, _joints.Append(joint));

    public RigJointGraph Edit(RigJoint joint)
    {
        var index = Array.FindIndex(_joints, existing => existing.Id == joint.Id);
        if (index < 0)
        {
            throw new KeyNotFoundException("The rig joint to edit does not exist.");
        }

        var updated = (RigJoint[])_joints.Clone();
        updated[index] = joint;
        return Create(_parts, updated);
    }

    public RigJointGraph SetMode(RigJointId id, RigJointMode mode)
    {
        var joint = Get(id);
        // Changing loose/fixed only alters future propagation; it must not snap an existing pose.
        return Edit(joint with { Mode = mode });
    }

    public RigJointGraph Remove(RigJointId id)
    {
        _ = Get(id); // Missing IDs are errors, not silent no-ops.
        return Create(_parts, _joints.Where(joint => joint.Id != id));
    }

    public RigJoint Get(RigJointId id)
    {
        foreach (var joint in _joints)
        {
            if (joint.Id == id)
            {
                return joint;
            }
        }

        throw new KeyNotFoundException("The rig joint does not exist.");
    }
}
