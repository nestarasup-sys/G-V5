using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Renames one model part while preserving its stable identity and all source/edit data.</summary>
public sealed record ModelPartRenameCommand(ModelPartId PartId, string Before, string After) : IModelDraftCommand
{
    public ModelDraftContent Apply(ModelDraftContent content) => Replace(content, After);

    public ModelDraftContent Revert(ModelDraftContent content) => Replace(content, Before);

    private ModelDraftContent Replace(ModelDraftContent content, string name)
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
            return part.WithName(name);
        }).ToArray();
        if (!found)
        {
            throw new InvalidOperationException("The rename target no longer exists in this draft.");
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
            content.LayerOrder,
            content.RigJoints);
    }
}
