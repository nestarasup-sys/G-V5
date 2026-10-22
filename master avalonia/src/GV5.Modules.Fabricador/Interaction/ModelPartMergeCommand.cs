using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Merges two adjacent pieces, preserving the left identity and exact prior content for undo.</summary>
public sealed record ModelPartMergeCommand(
    ModelPart LeftBefore,
    ModelPart RightBefore,
    ModelPart Merged,
    ImmutableArray<ModelPart> PartsBefore,
    ImmutableArray<ModelPartId> LayerOrderBefore,
    ImmutableArray<RigJoint> RigJointsBefore) : IModelDraftCommand
{
    public ModelDraftContent Apply(ModelDraftContent content)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (Merged.Id != LeftBefore.Id || LeftBefore.Id == RightBefore.Id
            || content.Parts.Any(part => part.Id == Merged.Id && part != LeftBefore)
            || !content.Parts.Contains(LeftBefore) || !content.Parts.Contains(RightBefore))
            throw new InvalidOperationException("The merge inputs no longer match the current model.");

        var leftIndex = content.LayerOrder.IndexOf(LeftBefore.Id);
        var rightIndex = content.LayerOrder.IndexOf(RightBefore.Id);
        if (Math.Abs(leftIndex - rightIndex) != 1)
            throw new InvalidOperationException("Merged pieces must be adjacent in the layer order.");

        var parts = content.Parts.Where(part => part.Id != RightBefore.Id)
            .Select(part => part.Id == LeftBefore.Id ? Merged : part).ToArray();
        var order = content.LayerOrder.Where(id => id != RightBefore.Id).ToImmutableArray();
        var leftNode = TransformNodeId.From(LeftBefore.Id.Value);
        var rightNode = TransformNodeId.From(RightBefore.Id.Value);
        var joints = content.RigJoints.Where(joint => joint.ParentPartId != rightNode && joint.ChildPartId != rightNode
            && !(joint.ParentPartId == leftNode && joint.ChildPartId == rightNode)
            && !(joint.ParentPartId == rightNode && joint.ChildPartId == leftNode));
        return ModelDraftContent.Restore(content.SchemaVersion, content.ModelId, content.Revision,
            content.Slot, content.SourceAssetId, content.SourceWidth, content.SourceHeight,
            parts, order, joints);
    }

    public ModelDraftContent Revert(ModelDraftContent content)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (!content.Parts.Contains(Merged) || content.Parts.Any(part => part.Id == RightBefore.Id))
            throw new InvalidOperationException("The merged piece must still be present before undoing the merge.");
        return ModelDraftContent.Restore(content.SchemaVersion, content.ModelId, content.Revision,
            content.Slot, content.SourceAssetId, content.SourceWidth, content.SourceHeight,
            PartsBefore, LayerOrderBefore, RigJointsBefore);
    }
}
