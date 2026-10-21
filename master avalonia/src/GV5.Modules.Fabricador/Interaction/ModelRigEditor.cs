using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>
/// Model-specific rig editing session with typed part IDs. It is intentionally transient:
/// F07.02 adds and tests authoring operations; F07.05–F07.08 provide versioned pose/rig
/// persistence before the commands are exposed as durable published model data.
/// </summary>
public sealed class ModelRigEditor
{
    private readonly ModelId _modelId;
    private readonly HashSet<ModelPartId> _partIds;

    public ModelRigEditor(ModelDraftContent model, IEnumerable<RigJoint>? existingJoints = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        _modelId = model.ModelId;
        _partIds = model.Parts.Select(part => part.Id).ToHashSet();
        Graph = RigJointGraph.Create(
            _partIds.Select(partId => TransformNodeId.From(partId.Value)),
            existingJoints ?? []);
    }

    public ModelId ModelId => _modelId;
    public RigJointGraph Graph { get; private set; }

    public RigJoint Connect(
        ModelPartId parentId,
        ModelPartId childId,
        Point2D parentAnchor,
        Point2D childAnchor,
        bool suggested = false)
    {
        ValidatePart(parentId);
        ValidatePart(childId);
        var joint = new RigJoint(
            RigJointId.New(),
            TransformNodeId.From(parentId.Value),
            TransformNodeId.From(childId.Value),
            parentAnchor,
            childAnchor,
            RigJointMode.Loose,
            suggested);
        Graph = Graph.Add(joint);
        return joint;
    }

    public void ChangeAnchors(RigJointId id, Point2D parentAnchor, Point2D childAnchor)
    {
        var previous = Graph.Get(id);
        Graph = Graph.Edit(previous with
        {
            ParentAnchor = parentAnchor,
            ChildAnchor = childAnchor
        });
    }

    public void Reconnect(RigJointId id, ModelPartId parentId, ModelPartId childId)
    {
        ValidatePart(parentId);
        ValidatePart(childId);
        var previous = Graph.Get(id);
        Graph = Graph.Edit(previous with
        {
            ParentPartId = TransformNodeId.From(parentId.Value),
            ChildPartId = TransformNodeId.From(childId.Value)
        });
    }

    public void SetFixed(RigJointId id, bool isFixed) =>
        Graph = Graph.SetMode(id, isFixed ? RigJointMode.Fixed : RigJointMode.Loose);

    public void Disconnect(RigJointId id) =>
        Graph = Graph.Remove(id);

    private void ValidatePart(ModelPartId id)
    {
        if (!_partIds.Contains(id))
        {
            throw new ArgumentException("The rig endpoint must be a part of this model.", nameof(id));
        }
    }
}
