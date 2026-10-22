using System.Collections.Immutable;
using GV5.Core.Models;
using GV5.Modules.Fabricador.Import;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Stores one raster mixer stroke as an undoable set of asset swaps.</summary>
public sealed record ModelPartMixerCommand(ImmutableArray<ModelPartAssetChange> Changes) : IModelDraftCommand
{
    public ModelDraftContent Apply(ModelDraftContent content) => Replace(content, useAfter: true);
    public ModelDraftContent Revert(ModelDraftContent content) => Replace(content, useAfter: false);

    private ModelDraftContent Replace(ModelDraftContent content, bool useAfter)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (Changes.IsDefaultOrEmpty) return content;
        var changes = Changes.ToDictionary(change => change.Before.Id);
        var found = new HashSet<GV5.Core.Identity.ModelPartId>();
        var parts = content.Parts.Select(part =>
        {
            if (!changes.TryGetValue(part.Id, out var change)) return part;
            var expected = useAfter ? change.Before : change.After;
            if (part.AssetId != expected.AssetId)
                throw new InvalidOperationException("A mixer asset changed since this history command was recorded.");
            found.Add(part.Id);
            return useAfter ? change.After : change.Before;
        }).ToArray();
        if (found.Count != changes.Count)
            throw new InvalidOperationException("A mixer part no longer exists in this model.");
        return ModelDraftContent.Restore(content.SchemaVersion, content.ModelId, content.Revision,
            content.Slot, content.SourceAssetId, content.SourceWidth, content.SourceHeight,
            parts, content.LayerOrder, content.RigJoints);
    }
}
