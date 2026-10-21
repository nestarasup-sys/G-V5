using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>A reversible transform edit recorded once when a pointer gesture completes.</summary>
public sealed record ModelPartTransformCommand(ModelPartId PartId, Transform2D Before, Transform2D After) : IModelDraftCommand
{
    public ModelDraftContent Apply(ModelDraftContent content) => Replace(content, After);

    public ModelDraftContent Revert(ModelDraftContent content) => Replace(content, Before);

    private ModelDraftContent Replace(ModelDraftContent content, Transform2D transform)
    {
        ArgumentNullException.ThrowIfNull(content);
        var found = false;
        var parts = content.Parts.Select(part =>
        {
            if (part.Id != PartId)
            {
                return part;
            }

            found = true;
            return part.WithTransform(transform);
        }).ToArray();
        if (!found)
        {
            throw new InvalidOperationException("The transformed model part no longer exists in this draft.");
        }

        // Pointer-move previews do not advance the persisted revision. The save transaction advances once for the final snapshot.
        return ModelDraftContent.Restore(
            content.SchemaVersion,
            content.ModelId,
            content.Revision,
            content.Slot,
            content.SourceAssetId,
            content.SourceWidth,
            content.SourceHeight,
            parts,
            content.LayerOrder,
            content.RigJoints);
    }
}
