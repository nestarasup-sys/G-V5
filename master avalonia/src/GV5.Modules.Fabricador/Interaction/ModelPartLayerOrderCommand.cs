using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Reorders existing model parts without changing the persisted content revision.</summary>
public sealed record ModelPartLayerOrderCommand(
    ImmutableArray<ModelPartId> Before,
    ImmutableArray<ModelPartId> After) : IModelDraftCommand
{
    public ModelDraftContent Apply(ModelDraftContent content) => Replace(content, After);

    public ModelDraftContent Revert(ModelDraftContent content) => Replace(content, Before);

    private static ModelDraftContent Replace(ModelDraftContent content, ImmutableArray<ModelPartId> order)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (order.IsDefault)
        {
            throw new ArgumentException("A layer order command requires a concrete order.", nameof(order));
        }

        return ModelDraftContent.Restore(
            content.SchemaVersion,
            content.ModelId,
            content.Revision,
            content.Slot,
            content.SourceAssetId,
            content.SourceWidth,
            content.SourceHeight,
            content.Parts,
            order);
    }
}
