namespace GV5.Geometry;

/// <summary>Stable identity for a node in a transform hierarchy.</summary>
public readonly record struct TransformNodeId
{
    public Guid Value { get; }

    private TransformNodeId(Guid value) => Value = value;

    public static TransformNodeId New() => new(Guid.NewGuid());

    public static TransformNodeId From(Guid value) => value == Guid.Empty
        ? throw new ArgumentException("A transform node ID cannot be empty.", nameof(value))
        : new TransformNodeId(value);
}

/// <summary>
/// An immutable node. <see cref="ParentAnchor"/> is the attachment point in the parent's local space;
/// the local transform's pivot is this node's own anchor.
/// </summary>
public readonly record struct TransformHierarchyNode(
    TransformNodeId Id,
    TransformNodeId? ParentId,
    Point2D ParentAnchor,
    Transform2D LocalTransform);

/// <summary>An immutable forest of local transforms with calculated world transforms.</summary>
public sealed class TransformHierarchy
{
    private readonly Dictionary<TransformNodeId, TransformHierarchyNode> _nodes;

    private TransformHierarchy(Dictionary<TransformNodeId, TransformHierarchyNode> nodes) => _nodes = nodes;

    public IReadOnlyCollection<TransformHierarchyNode> Nodes => _nodes.Values;

    public static TransformHierarchy Create(IEnumerable<TransformHierarchyNode> nodes)
    {
        ArgumentNullException.ThrowIfNull(nodes);
        var index = new Dictionary<TransformNodeId, TransformHierarchyNode>();
        foreach (var node in nodes)
        {
            if (node.Id.Value == Guid.Empty)
            {
                throw new ArgumentException("Every transform node requires a valid ID.", nameof(nodes));
            }
            if (!index.TryAdd(node.Id, node))
            {
                throw new ArgumentException($"Transform node '{node.Id}' occurs more than once.", nameof(nodes));
            }
        }

        ValidateParentsAndCycles(index);
        return new TransformHierarchy(index);
    }

    public Matrix2D GetLocalMatrix(TransformNodeId id)
    {
        var node = GetNode(id);
        return Matrix2D.CreateTranslation(node.ParentAnchor.X, node.ParentAnchor.Y) * node.LocalTransform.Matrix;
    }

    public Matrix2D GetWorldMatrix(TransformNodeId id)
    {
        var node = GetNode(id);
        var local = GetLocalMatrix(id);
        return node.ParentId is { } parentId ? GetWorldMatrix(parentId) * local : local;
    }

    public TransformHierarchy Reparent(TransformNodeId id, TransformNodeId? parentId, Point2D parentAnchor)
    {
        var node = GetNode(id);
        var updated = new Dictionary<TransformNodeId, TransformHierarchyNode>(_nodes)
        {
            [id] = node with { ParentId = parentId, ParentAnchor = parentAnchor }
        };
        ValidateParentsAndCycles(updated);
        return new TransformHierarchy(updated);
    }

    private TransformHierarchyNode GetNode(TransformNodeId id) => _nodes.TryGetValue(id, out var node)
        ? node
        : throw new KeyNotFoundException($"Transform node '{id}' does not exist.");

    private static void ValidateParentsAndCycles(IReadOnlyDictionary<TransformNodeId, TransformHierarchyNode> nodes)
    {
        var states = new Dictionary<TransformNodeId, VisitState>();
        foreach (var id in nodes.Keys)
        {
            Visit(id);
        }

        void Visit(TransformNodeId id)
        {
            if (states.TryGetValue(id, out var state))
            {
                if (state == VisitState.Visiting)
                {
                    throw new ArgumentException("A transform hierarchy cannot contain a parent cycle.", nameof(nodes));
                }
                return;
            }

            states.Add(id, VisitState.Visiting);
            var parentId = nodes[id].ParentId;
            if (parentId is { } parent)
            {
                if (!nodes.ContainsKey(parent))
                {
                    throw new ArgumentException($"Parent transform node '{parent}' does not exist.", nameof(nodes));
                }
                Visit(parent);
            }
            states[id] = VisitState.Visited;
        }
    }

    private enum VisitState
    {
        Visiting,
        Visited
    }
}
