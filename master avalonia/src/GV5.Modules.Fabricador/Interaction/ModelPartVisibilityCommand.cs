using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Changes one part's visibility while preserving its identity and transform.</summary>
public sealed record ModelPartVisibilityCommand(ModelPartId PartId, bool Before, bool After) : IModelDraftCommand
{
    public ModelDraftContent Apply(ModelDraftContent content) => Replace(content, After);

    public ModelDraftContent Revert(ModelDraftContent content) => Replace(content, Before);

    private ModelDraftContent Replace(ModelDraftContent content, bool isVisible)
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
            return part.WithVisibility(isVisible);
        }).ToArray();
        if (!found)
        {
            throw new InvalidOperationException("The visibility target no longer exists in this draft.");
        }

        return ModelDraftContent.Restore(
            content.SchemaVersion,
            content.ModelId,
            content.Revision,
            content.Slot,
            content.SourceAssetId,
            content.SourceWidth,
            content.SourceHeight,
            parts,
            content.LayerOrder);
    }
}
